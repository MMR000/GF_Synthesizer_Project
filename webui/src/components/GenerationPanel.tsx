import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  type GenSettings,
  type GenStatus,
  buildPayload,
  resolveEndpointUrl,
} from "../lib/types";

interface Props {
  settings: GenSettings;
  onChange: (patch: Partial<GenSettings>) => void;
  status: GenStatus;
  statusMessage: string;
  text: string;
  onGenerate: () => void;
  onGenerateAutoplay: () => void;
  onStop: () => void;
  onHealthCheck: () => void;
}

const STATUS_META: Record<GenStatus, { label: string; cls: string }> = {
  idle: { label: "Idle", cls: "border-white/15 bg-white/5 text-slate-300" },
  checking: { label: "Checking server…", cls: "border-cyan-400/30 bg-cyan-500/10 text-cyan-200" },
  generating: { label: "Generating…", cls: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200" },
  saved: { label: "Saved", cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" },
  failed: { label: "Failed", cls: "border-rose-400/30 bg-rose-500/10 text-rose-200" },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function GenerationPanel(props: Props) {
  const { settings: s, onChange, status, statusMessage, text } = props;
  const busy = status === "generating" || status === "checking";

  const payload = useMemo(() => buildPayload(text || "…", s), [text, s]);
  const payloadStr = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const url = resolveEndpointUrl(s);
  const curl = useMemo(() => {
    const body = JSON.stringify(payload).replace(/'/g, "'\\''");
    return `curl -s ${url} \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}' \\\n  --output ${s.filename}`;
  }, [payload, url, s.filename]);

  const sm = STATUS_META[status];

  return (
    <section className="glass flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="panel-title">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-400" />
          Generation
        </div>
        <span className={`pill ${sm.cls}`}>
          {status === "generating" && (
            <span className="h-2 w-2 animate-ping rounded-full bg-fuchsia-300" />
          )}
          {sm.label}
        </span>
      </div>

      <div className="space-y-3">
        <Field label="Endpoint mode">
          <select
            value={s.endpointMode}
            onChange={(e) => onChange({ endpointMode: e.target.value as GenSettings["endpointMode"] })}
            className="input-dark"
          >
            <option value="auto">Auto (vLLM → SGLang)</option>
            <option value="vllm">vLLM-Omni · localhost:8095</option>
            <option value="sglang">SGLang-Omni · localhost:9000</option>
            <option value="custom">Custom URL</option>
          </select>
        </Field>

        {s.endpointMode === "custom" && (
          <Field label="Custom URL">
            <input
              value={s.customUrl}
              onChange={(e) => onChange({ customUrl: e.target.value })}
              placeholder="http://localhost:9000/v1/audio/speech"
              className="input-dark font-mono text-xs"
            />
          </Field>
        )}

        <Field label="Model field">
          <select
            value={s.modelMode}
            onChange={(e) => onChange({ modelMode: e.target.value as GenSettings["modelMode"] })}
            className="input-dark"
          >
            <option value="include">Include model field</option>
            <option value="exclude">Do not include model field</option>
            <option value="auto">Auto retry (flip if it fails)</option>
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Temperature · ${s.temperature.toFixed(2)}`}>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={s.temperature}
              onChange={(e) => onChange({ temperature: Number(e.target.value) })}
              className="w-full accent-fuchsia-500"
            />
          </Field>
          <Field label="top_k">
            <input
              type="number"
              min={0}
              value={s.top_k}
              onChange={(e) => onChange({ top_k: Number(e.target.value) })}
              className="input-dark"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="max_new_tokens">
            <input
              type="number"
              min={64}
              step={64}
              value={s.max_new_tokens}
              onChange={(e) => onChange({ max_new_tokens: Number(e.target.value) })}
              className="input-dark"
            />
          </Field>
          <Field label="Output filename">
            <input
              value={s.filename}
              onChange={(e) => onChange({ filename: e.target.value })}
              className="input-dark font-mono text-xs"
            />
          </Field>
        </div>

        <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/[0.06] p-2.5">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={s.segmented}
              onChange={(e) => onChange({ segmented: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-fuchsia-500"
            />
            <span className="text-xs">
              <span className="font-semibold text-fuchsia-200">Segmented generation</span>
              <span className="block text-[11px] text-slate-400">
                Generate sentence-by-sentence and stitch — best for long text that fails in one pass.
              </span>
            </span>
          </label>
          {s.segmented && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 border-t border-white/10 pt-2">
              <input
                type="checkbox"
                checked={s.cloneVoice}
                onChange={(e) => onChange({ cloneVoice: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-cyan-400"
              />
              <span className="text-xs">
                <span className="font-semibold text-cyan-200">Keep one consistent voice</span>
                <span className="block text-[11px] text-slate-400">
                  Clone every segment from the first one (+ pitch-lock) so the speaker stays the same.
                </span>
              </span>
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <motion.button whileTap={{ scale: 0.97 }} onClick={props.onGenerate} disabled={busy} className="neon-btn">
          ▶ Generate WAV
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={props.onGenerateAutoplay}
          disabled={busy}
          className="neon-btn"
        >
          ▶ Generate + play
        </motion.button>
        <button onClick={props.onHealthCheck} disabled={busy} className="ghost-btn">
          Health check
        </button>
        <button
          onClick={props.onStop}
          disabled={status !== "generating"}
          className="ghost-btn border-rose-400/30 text-rose-200 hover:bg-rose-500/10"
        >
          ■ Stop
        </button>
      </div>

      {statusMessage && (
        <p
          className={`mt-3 break-words rounded-lg border px-3 py-2 text-xs ${
            status === "failed" ? STATUS_META.failed.cls : "border-white/10 bg-white/5 text-slate-300"
          }`}
        >
          {statusMessage}
        </p>
      )}

      <details className="mt-3 rounded-xl border border-white/10 bg-ink-900/50 p-2" open>
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Payload preview</summary>
        <pre className="scroll-thin mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] text-cyan-200">
          <code>{payloadStr}</code>
        </pre>
        <div className="mt-1 text-[11px] text-slate-500">POST → {url}</div>
      </details>

      <details className="mt-2 rounded-xl border border-white/10 bg-ink-900/50 p-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Equivalent curl</summary>
        <pre className="scroll-thin mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] text-lime-200">
          <code>{curl}</code>
        </pre>
      </details>
    </section>
  );
}
