import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Header from "./components/Header";
import TagLibrary from "./components/TagLibrary";
import TextComposer from "./components/TextComposer";
import TemplateGallery from "./components/TemplateGallery";
import ValidationPanel from "./components/ValidationPanel";
import GenerationPanel from "./components/GenerationPanel";
import AudioResultPanel from "./components/AudioResultPanel";
import HistoryPanel from "./components/HistoryPanel";
import CopyExportPanel from "./components/CopyExportPanel";
import ReferenceVoice from "./components/ReferenceVoice";
import * as api from "./api/client";
import type { GenerateResponse, HealthResponse, HistoryItem } from "./api/client";
import type { GenSettings, GenStatus } from "./lib/types";
import {
  makeMoreEmotional,
  normalizeSpaces,
  oneClickFixBracketLaughter,
  removeAllTags,
  repeatDeliveryTags,
  stripTags,
  validateClient,
} from "./lib/text";

const DEFAULT_SETTINGS: GenSettings = {
  endpointMode: "auto",
  customUrl: "http://localhost:9000/v1/audio/speech",
  modelMode: "auto",
  temperature: 0.8,
  top_k: 50,
  max_new_tokens: 4096,
  filename: "emotion_test.wav",
  segmented: false,
  cloneVoice: true,
};

const STARTER =
  "<|emotion:amusement|><|prosody:expressive_high|>Бейба ағам керемет <|sfx:laughter|>Haha, одан артық не керек?";

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [text, setTextState] = useState<string>(() => loadLS("tts_text", STARTER));
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [favorites, setFavorites] = useState<string[]>(() => loadLS("tts_favorites", []));
  const [settings, setSettings] = useState<GenSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadLS<Partial<GenSettings>>("tts_settings", {}),
  }));

  const [status, setStatus] = useState<GenStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState<string>("");

  const caretRef = useRef<number | null>(null);

  // Persist key bits of state.
  useEffect(() => localStorage.setItem("tts_text", JSON.stringify(text)), [text]);
  useEffect(() => localStorage.setItem("tts_favorites", JSON.stringify(favorites)), [favorites]);
  useEffect(() => localStorage.setItem("tts_settings", JSON.stringify(settings)), [settings]);

  // Restore caret after programmatic text changes.
  useEffect(() => {
    if (caretRef.current != null && textareaRef.current) {
      const pos = caretRef.current;
      const ta = textareaRef.current;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      caretRef.current = null;
    }
  }, [text]);

  const cleanText = useMemo(() => stripTags(text), [text]);
  const warnings = useMemo(() => validateClient(text), [text]);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const copy = useCallback(
    async (value: string, label = "Copied") => {
      try {
        await navigator.clipboard.writeText(value);
        flashToast(`${label} to clipboard`);
      } catch {
        flashToast("Copy failed (clipboard blocked)");
      }
    },
    [flashToast],
  );

  const pushUndo = useCallback((prev: string) => {
    setUndoStack((s) => [...s.slice(-49), prev]);
  }, []);

  const applyTextChange = useCallback(
    (next: string, caret?: number) => {
      pushUndo(text);
      if (caret != null) caretRef.current = caret;
      setTextState(next);
    },
    [text, pushUndo],
  );

  // Insert a tag at a specific index (drop) or current selection start (click).
  const insertTag = useCallback(
    (insert: string, atIndex?: number) => {
      const ta = textareaRef.current;
      const start = atIndex ?? (ta ? ta.selectionStart : selection.start);
      const next = text.slice(0, start) + insert + text.slice(start);
      applyTextChange(next, start + insert.length);
    },
    [text, selection.start, applyTextChange],
  );

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setTextState(prev);
      return s.slice(0, -1);
    });
  }, []);

  const setTextDirect = useCallback((next: string) => setTextState(next), []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.getHistory());
    } catch {
      /* backend offline; ignore */
    }
  }, []);

  const doHealthCheck = useCallback(async () => {
    setChecking(true);
    setStatus("checking");
    try {
      const h = await api.health();
      setHealth(h);
      const v = h.endpoints.vllm.reachable;
      const s = h.endpoints.sglang.reachable;
      setStatusMessage(
        `Backend alive. vLLM ${v ? "reachable" : "down"}, SGLang ${s ? "reachable" : "down"}.`,
      );
      setStatus("idle");
    } catch {
      setHealth(null);
      setStatusMessage("Backend proxy not reachable on :7860. Start it with run_emotion_web.sh.");
      setStatus("failed");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    doHealthCheck();
    refreshHistory();
  }, [doHealthCheck, refreshHistory]);

  const runGenerate = useCallback(
    async (autoplay: boolean) => {
      if (!text.trim()) {
        setStatus("failed");
        setStatusMessage("Text is empty.");
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("generating");
      setStatusMessage(
        settings.segmented
          ? "Segmented generation: splitting text and generating sentence-by-sentence… this can take a while."
          : "Sending request to local TTS server…",
      );
      try {
        const includeModel = settings.modelMode === "include" || settings.modelMode === "auto";
        const autoRetry = settings.modelMode === "auto" || settings.endpointMode === "auto";
        const res = await api.generate(
          {
            text,
            endpointMode: settings.endpointMode,
            customUrl: settings.customUrl,
            includeModel,
            autoRetry,
            temperature: settings.temperature,
            top_k: settings.top_k,
            max_new_tokens: settings.max_new_tokens,
            filename: settings.filename,
            segmented: settings.segmented,
            cloneVoice: settings.cloneVoice,
          },
          controller.signal,
        );
        if (res.ok && res.filename) {
          setResult(res);
          setStatus("saved");
          setStatusMessage(
            `Saved ${res.filename}${res.segments ? ` (${res.segments} segments)` : ""} via ${res.endpointUsed} in ${res.elapsed}s.`,
          );
          if (autoplay) {
            const audio = new Audio(api.audioUrl(res.filename));
            audio.play().catch(() => undefined);
          }
        } else {
          setResult(null);
          setStatus("failed");
          setStatusMessage(res.error || "Generation failed.");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setStatus("idle");
          setStatusMessage("Request cancelled.");
        } else {
          setStatus("failed");
          setStatusMessage(`Request error: ${(e as Error).message}. Is the backend on :7860 running?`);
        }
      } finally {
        abortRef.current = null;
        refreshHistory();
      }
    },
    [text, settings, refreshHistory],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onDeleteHistory = useCallback(
    async (id: string) => {
      try {
        await api.deleteHistory(id);
        flashToast("History item deleted");
      } catch {
        flashToast("Delete failed");
      }
      refreshHistory();
    },
    [flashToast, refreshHistory],
  );

  const loadHistoryItem = useCallback(
    (item: HistoryItem) => {
      applyTextChange(item.text);
      flashToast("Loaded text from history");
    },
    [applyTextChange, flashToast],
  );

  const openHistoryItem = useCallback((item: HistoryItem) => {
    setResult({
      ok: true,
      filename: item.filename,
      url: api.audioUrl(item.filename),
      endpointUsed: item.endpointUsed,
      fileSize: item.fileSize,
      elapsed: item.elapsed,
      historyItem: item,
    });
  }, []);

  const toggleFavorite = useCallback((tag: string) => {
    setFavorites((f) => (f.includes(tag) ? f.filter((t) => t !== tag) : [...f, tag]));
  }, []);

  const patchSettings = useCallback((patch: Partial<GenSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5">
      <Header health={health} checking={checking} onCheck={doHealthCheck} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[330px_minmax(0,1fr)_390px]">
        {/* LEFT: tag library */}
        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:self-start">
          <div className="h-full">
            <TagLibrary
              onInsert={(insert) => insertTag(insert)}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              onCopy={(t) => copy(t, "Tag")}
            />
          </div>
        </div>

        {/* CENTER: composer, templates, validation, export */}
        <div className="flex flex-col gap-4">
          <TextComposer
            text={text}
            onChange={setTextDirect}
            textareaRef={textareaRef}
            onDropTag={(insert, index) => insertTag(insert, index)}
            onSelectionChange={(start, end) => setSelection({ start, end })}
            onClear={() => applyTextChange("", 0)}
            onUndo={undo}
            onCopyTagged={() => copy(text, "Tagged text")}
            onRemoveTags={() => applyTextChange(removeAllTags(text))}
            onNormalize={() => applyTextChange(normalizeSpaces(text))}
            onRepeatTags={() => applyTextChange(repeatDeliveryTags(text))}
            onMakeEmotional={() => applyTextChange(makeMoreEmotional(text))}
            canUndo={undoStack.length > 0}
          />
          <ValidationPanel
            warnings={warnings}
            onFixBracketLaughter={() => applyTextChange(oneClickFixBracketLaughter(text))}
            onRepeatTags={() => applyTextChange(repeatDeliveryTags(text))}
          />
          <TemplateGallery
            onLoad={(t) => applyTextChange(t, t.length)}
            onAppend={(t) => applyTextChange((text ? text + "\n\n" : "") + t)}
            onCopy={(t) => copy(t, "Template")}
          />
          <CopyExportPanel text={text} cleanText={cleanText} settings={settings} onCopy={copy} />
        </div>

        {/* RIGHT: generation, audio, reference, history */}
        <div className="flex flex-col gap-4">
          <GenerationPanel
            settings={settings}
            onChange={patchSettings}
            status={status}
            statusMessage={statusMessage}
            text={text}
            onGenerate={() => runGenerate(false)}
            onGenerateAutoplay={() => runGenerate(true)}
            onStop={stop}
            onHealthCheck={doHealthCheck}
          />
          <AudioResultPanel
            result={result}
            taggedText={text}
            cleanText={cleanText}
            history={history}
            onRegenerate={() => runGenerate(false)}
            onCopy={copy}
          />
          <ReferenceVoice />
          <HistoryPanel
            history={history}
            onLoad={loadHistoryItem}
            onDelete={onDeleteHistory}
            onPlay={openHistoryItem}
          />
        </div>
      </div>

      <footer className="mt-6 pb-4 text-center text-[11px] text-slate-600">
        Emotion TTS Studio · local research tool · nothing is uploaded to external servers.
      </footer>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/15 bg-ink-700/95 px-4 py-2 text-sm text-slate-100 shadow-neon backdrop-blur"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
