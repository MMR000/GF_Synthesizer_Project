import type { ValidationWarning } from "../api/client";

interface Props {
  warnings: ValidationWarning[];
  onFixBracketLaughter: () => void;
  onRepeatTags: () => void;
}

const LEVEL_STYLE: Record<ValidationWarning["level"], string> = {
  error: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  warn: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  fix: "border-cyan-400/30 bg-cyan-500/10 text-cyan-200",
};
const LEVEL_ICON: Record<ValidationWarning["level"], string> = {
  error: "✕",
  warn: "!",
  fix: "✎",
};

export default function ValidationPanel({ warnings, onFixBracketLaughter, onRepeatTags }: Props) {
  const hasBracketLaughter = warnings.some((w) => w.code === "bracket_laughter");
  const hasLongSingleEmotion = warnings.some((w) => w.code === "long_single_emotion");
  const clean = warnings.length === 0;

  return (
    <section className="glass flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="panel-title">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" />
          Validation & Tips
        </div>
        <span
          className={`pill ${clean ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-amber-400/30 bg-amber-500/10 text-amber-200"}`}
        >
          {clean ? "Looks good" : `${warnings.length} hint${warnings.length > 1 ? "s" : ""}`}
        </span>
      </div>

      {(hasBracketLaughter || hasLongSingleEmotion) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {hasBracketLaughter && (
            <button onClick={onFixBracketLaughter} className="neon-btn px-2.5 py-1 text-xs">
              Fix [laughter] → &lt;|sfx:laughter|&gt;Haha
            </button>
          )}
          {hasLongSingleEmotion && (
            <button onClick={onRepeatTags} className="ghost-btn px-2.5 py-1 text-xs">
              Repeat delivery tags before paragraphs
            </button>
          )}
        </div>
      )}

      <div className="scroll-thin max-h-44 space-y-1.5 overflow-y-auto pr-1">
        {clean ? (
          <p className="py-4 text-center text-sm text-emerald-300/80">
            No issues detected. Your tagged text looks ready to generate.
          </p>
        ) : (
          warnings.map((w, i) => (
            <div
              key={`${w.code}-${i}`}
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${LEVEL_STYLE[w.level]}`}
            >
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-black/30 text-[10px]">
                {LEVEL_ICON[w.level]}
              </span>
              <span>{w.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
