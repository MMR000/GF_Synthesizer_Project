import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Waveform from "./Waveform";
import { audioUrl, type GenerateResponse, type HistoryItem } from "../api/client";

const PROJECT_OUTPUTS = "/home/mmr/PycharmProjects/tone_tts/outputs";

interface Props {
  result: GenerateResponse | null;
  taggedText: string;
  cleanText: string;
  history: HistoryItem[];
  onRegenerate: () => void;
  onCopy: (text: string, label?: string) => void;
}

function fmtSize(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function AudioResultPanel({
  result,
  taggedText,
  cleanText,
  history,
  onRegenerate,
  onCopy,
}: Props) {
  const [compare, setCompare] = useState(false);
  const saved = history.filter((h) => h.status === "saved");
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");

  const download = (filename: string) => {
    const a = document.createElement("a");
    a.href = audioUrl(filename);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <section className="glass flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="panel-title">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-lime-400 to-cyan-400" />
          Audio Result
        </div>
        <button
          onClick={() => setCompare((c) => !c)}
          className={`pill ${compare ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-white/5 text-slate-400"}`}
        >
          A/B compare
        </button>
      </div>

      <AnimatePresence mode="wait">
        {result?.ok && result.filename ? (
          <motion.div
            key={result.filename + (result.elapsed ?? "")}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <Waveform url={audioUrl(result.filename)} />

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                <div className="text-slate-500">File</div>
                <div className="truncate font-mono text-slate-200" title={result.filename}>
                  {result.filename}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                <div className="text-slate-500">Size</div>
                <div className="text-slate-200">{fmtSize(result.fileSize)}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                <div className="text-slate-500">Endpoint</div>
                <div className="truncate text-slate-200" title={result.endpointUsed}>
                  {result.endpointUsed || "—"}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                <div className="text-slate-500">Time</div>
                <div className="text-slate-200">{result.elapsed ? `${result.elapsed}s` : "—"}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => download(result.filename!)} className="ghost-btn px-2.5 py-1 text-xs">
                ⬇ Download
              </button>
              <button onClick={onRegenerate} className="ghost-btn px-2.5 py-1 text-xs">
                ↻ Regenerate
              </button>
              <button
                onClick={() => onCopy(`${PROJECT_OUTPUTS}/${result.filename}`, "File path")}
                className="ghost-btn px-2.5 py-1 text-xs"
              >
                ⧉ Copy path
              </button>
              <button onClick={() => onCopy(taggedText, "Tagged input")} className="ghost-btn px-2.5 py-1 text-xs">
                ⧉ Copy tagged
              </button>
              <button onClick={() => onCopy(cleanText, "Clean text")} className="ghost-btn px-2.5 py-1 text-xs">
                ⧉ Copy clean
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid place-items-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-10 text-center"
          >
            <div className="animate-float text-3xl">🎧</div>
            <p className="mt-2 text-sm text-slate-400">No audio yet.</p>
            <p className="text-xs text-slate-500">Generate a clip to see its waveform here.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {compare && (
        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-ink-900/40 p-3">
          <p className="text-xs text-slate-400">
            Compare two saved clips (neutral vs enthusiasm, sadness vs anger, laughter vs none…).
          </p>
          {(["A", "B"] as const).map((slot) => {
            const id = slot === "A" ? aId : bId;
            const setId = slot === "A" ? setAId : setBId;
            const item = saved.find((h) => h.id === id);
            return (
              <div key={slot} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="pill border-white/15 bg-white/5 text-slate-300">{slot}</span>
                  <select
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    className="input-dark text-xs"
                  >
                    <option value="">Select a clip…</option>
                    {saved.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.filename} — {h.cleanText.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                </div>
                {item && <audio controls src={audioUrl(item.filename)} className="w-full" />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
