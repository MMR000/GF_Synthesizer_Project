import { motion } from "framer-motion";
import type { HealthResponse } from "../api/client";

interface Props {
  health: HealthResponse | null;
  checking: boolean;
  onCheck: () => void;
}

const LANGS = ["Kazakh", "Russian", "English"];

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="pill border-white/10 bg-white/5">
      <span
        className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.7)]" : "bg-rose-500"}`}
      />
      <span className="text-slate-300">{label}</span>
    </span>
  );
}

export default function Header({ health, checking, onCheck }: Props) {
  return (
    <header className="glass mb-5 px-5 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-cyan-400 shadow-neon"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </motion.div>
          <div>
            <h1 className="animated-title font-display text-2xl font-bold leading-tight sm:text-3xl">
              Emotion TTS Studio
            </h1>
            <p className="text-xs text-slate-400 sm:text-sm">
              Local SGLang-Omni expressive speech generation lab
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {LANGS.map((l) => (
            <span key={l} className="pill border-white/10 bg-white/5 text-slate-300">
              {l}
            </span>
          ))}
          <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
          {health ? (
            <>
              <StatusDot ok={health.endpoints.vllm.reachable} label="vLLM 8095" />
              <StatusDot ok={health.endpoints.sglang.reachable} label="SGLang 9000" />
            </>
          ) : (
            <span className="pill border-white/10 bg-white/5 text-slate-400">server unknown</span>
          )}
          <button onClick={onCheck} disabled={checking} className="ghost-btn">
            {checking ? "Checking…" : "Health check"}
          </button>
        </div>
      </div>
    </header>
  );
}
