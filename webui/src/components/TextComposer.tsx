import { useState } from "react";
import { stripTags, approxTokens } from "../lib/text";

interface Props {
  text: string;
  onChange: (t: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onDropTag: (insert: string, index: number) => void;
  onSelectionChange: (start: number, end: number) => void;
  onClear: () => void;
  onUndo: () => void;
  onCopyTagged: () => void;
  onRemoveTags: () => void;
  onNormalize: () => void;
  onRepeatTags: () => void;
  onMakeEmotional: () => void;
  canUndo: boolean;
}

export default function TextComposer(props: Props) {
  const { text, onChange, textareaRef } = props;
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<"raw" | "clean">("raw");

  const clean = stripTags(text);
  const chars = text.length;
  const tokens = approxTokens(text);
  const isLong = clean.length > 600;

  const reportSelection = () => {
    const ta = textareaRef.current;
    if (ta) props.onSelectionChange(ta.selectionStart, ta.selectionEnd);
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setDragActive(false);
    const insert =
      e.dataTransfer.getData("application/x-tts-tag") || e.dataTransfer.getData("text/plain");
    if (!insert) return;
    const ta = textareaRef.current;
    const index = ta ? ta.selectionStart : text.length;
    props.onDropTag(insert, index);
  };

  return (
    <section className="glass flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="panel-title">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400" />
          Tagged Text Composer
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>{chars} chars</span>
          <span className="text-slate-600">•</span>
          <span>~{tokens} tokens</span>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <button onClick={props.onUndo} disabled={!props.canUndo} className="ghost-btn px-2.5 py-1 text-xs">
          ↶ Undo insert
        </button>
        <button onClick={props.onCopyTagged} className="ghost-btn px-2.5 py-1 text-xs">⧉ Copy tagged</button>
        <button onClick={props.onNormalize} className="ghost-btn px-2.5 py-1 text-xs">Normalize spaces</button>
        <button onClick={props.onRepeatTags} className="ghost-btn px-2.5 py-1 text-xs">
          Repeat delivery tags ¶
        </button>
        <button onClick={props.onMakeEmotional} className="ghost-btn px-2.5 py-1 text-xs">
          ✨ Make more emotional
        </button>
        <button onClick={props.onRemoveTags} className="ghost-btn px-2.5 py-1 text-xs">Remove all tags</button>
        <button
          onClick={props.onClear}
          className="ghost-btn border-rose-400/30 px-2.5 py-1 text-xs text-rose-200 hover:bg-rose-500/10"
        >
          Clear
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onSelect={reportSelection}
        onKeyUp={reportSelection}
        onClick={reportSelection}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        spellCheck={false}
        placeholder="Type Kazakh / Russian / English text here, then click or drag tags from the library…"
        className={`scroll-thin h-64 w-full resize-y rounded-xl border bg-ink-800/70 p-3 font-mono text-sm leading-relaxed text-slate-100 outline-none transition ${
          dragActive ? "border-purple-400/70 shadow-neon" : "border-white/10 focus:border-white/25"
        }`}
      />

      <p className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-500/5 px-3 py-1.5 text-[11px] text-cyan-200/90">
        Single-pass generation helps keep timbre consistent, but long text may reduce emotion strength.
      </p>
      {isLong && (
        <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
          Long single-pass generation preserves speaker timbre better, but emotion may drift. Consider
          repeating emotion/prosody tags before paragraphs.
        </p>
      )}

      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <button
            onClick={() => setPreview("raw")}
            className={`pill ${preview === "raw" ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-white/5 text-slate-400"}`}
          >
            Raw tagged
          </button>
          <button
            onClick={() => setPreview("clean")}
            className={`pill ${preview === "clean" ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-white/5 text-slate-400"}`}
          >
            Clean text
          </button>
        </div>
        <div className="scroll-thin max-h-28 overflow-y-auto rounded-xl border border-white/10 bg-ink-900/60 p-2.5 text-xs">
          {preview === "raw" ? (
            <code className="whitespace-pre-wrap break-words font-mono text-slate-300">
              {text || <span className="text-slate-600">…</span>}
            </code>
          ) : (
            <span className="whitespace-pre-wrap break-words text-slate-300">
              {clean || <span className="text-slate-600">…</span>}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
