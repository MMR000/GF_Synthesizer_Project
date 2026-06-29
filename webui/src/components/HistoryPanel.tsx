import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { audioUrl, type HistoryItem } from "../api/client";

interface Props {
  history: HistoryItem[];
  onLoad: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onPlay: (item: HistoryItem) => void;
}

function ago(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

export default function HistoryPanel({ history, onLoad, onDelete, onPlay }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        h.filename.toLowerCase().includes(q) ||
        h.text.toLowerCase().includes(q) ||
        h.cleanText.toLowerCase().includes(q),
    );
  }, [history, query]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "history.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="glass flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="panel-title">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-purple-400 to-pink-400" />
          History
          <span className="text-[10px] font-normal text-slate-500">{history.length}</span>
        </div>
        <button onClick={exportJson} className="ghost-btn px-2.5 py-1 text-xs">
          ⬇ Export JSON
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by text, filename, emotion…"
        className="input-dark mb-3"
      />

      <div className="scroll-thin max-h-[26rem] space-y-2 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            {history.length === 0 ? "No generations yet." : "No history matches your search."}
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map((h) => (
              <motion.div
                key={h.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="rounded-xl border border-white/10 bg-ink-800/60 p-2.5"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-slate-200" title={h.filename}>
                    {h.filename}
                  </span>
                  <span
                    className={`pill shrink-0 ${
                      h.status === "saved"
                        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                        : "border-rose-400/30 bg-rose-500/10 text-rose-200"
                    }`}
                  >
                    {h.status}
                  </span>
                </div>
                <p className="mb-1.5 line-clamp-2 text-[11px] text-slate-400">{h.cleanText || "—"}</p>
                <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-500">
                  <span>{ago(h.timestamp)}</span>
                  <span>•</span>
                  <span>T={h.parameters.temperature}</span>
                  <span>•</span>
                  <span>{h.parameters.endpointMode}</span>
                </div>
                {h.status === "saved" && (
                  <audio controls src={audioUrl(h.filename)} className="mb-2 h-8 w-full" preload="none" />
                )}
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => onLoad(h)} className="ghost-btn px-2 py-0.5 text-[11px]">
                    Load text
                  </button>
                  {h.status === "saved" && (
                    <button onClick={() => onPlay(h)} className="ghost-btn px-2 py-0.5 text-[11px]">
                      Open
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(h.id)}
                    className="ghost-btn border-rose-400/30 px-2 py-0.5 text-[11px] text-rose-200 hover:bg-rose-500/10"
                  >
                    Delete
                  </button>
                </div>
                {h.error && <p className="mt-1 break-words text-[10px] text-rose-300/80">{h.error}</p>}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}
