import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { TEMPLATES } from "../data/templates";

interface Props {
  onLoad: (text: string) => void;
  onAppend: (text: string) => void;
  onCopy: (text: string) => void;
}

const LANG_COLORS: Record<string, string> = {
  Kazakh: "border-sky-400/30 bg-sky-500/10 text-sky-200",
  Russian: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  English: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
};

export default function TemplateGallery({ onLoad, onAppend, onCopy }: Props) {
  const [lang, setLang] = useState<"All" | "Kazakh" | "Russian" | "English">("All");
  const items = useMemo(
    () => TEMPLATES.filter((t) => lang === "All" || t.language === lang),
    [lang],
  );

  return (
    <section className="glass flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="panel-title">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-amber-400 to-lime-400" />
          Template Gallery
        </div>
        <div className="flex gap-1.5">
          {(["All", "Kazakh", "Russian", "English"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`pill ${lang === l ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-white/5 text-slate-400"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-thin grid max-h-[20rem] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {items.map((t) => (
          <motion.div
            key={t.title}
            layout
            whileHover={{ y: -2 }}
            className="flex flex-col rounded-xl border border-white/10 bg-ink-800/60 p-3"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-100">{t.title}</h4>
              <span className={`pill shrink-0 ${LANG_COLORS[t.language]}`}>{t.language}</span>
            </div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="pill border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200">{t.mood}</span>
            </div>
            <p className="mb-3 flex-1 text-xs text-slate-400">{t.description}</p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => onLoad(t.text)} className="neon-btn px-2.5 py-1 text-xs">
                Load
              </button>
              <button onClick={() => onAppend(t.text)} className="ghost-btn px-2.5 py-1 text-xs">
                Append
              </button>
              <button onClick={() => onCopy(t.text)} className="ghost-btn px-2.5 py-1 text-xs">
                Copy raw
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
