import { useState } from "react";

export default function ReferenceVoice() {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [transcript, setTranscript] = useState("");

  return (
    <section className="glass p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="panel-title">
          <span className="h-2 w-2 rounded-full bg-gradient-to-r from-pink-400 to-amber-400" />
          Reference Voice
          <span className="pill border-white/10 bg-white/5 text-[10px] text-slate-400">optional</span>
        </span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
            ⚠ Only use voices you have permission to clone. Nothing here is uploaded externally.
          </p>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Reference audio
            </span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-slate-200 hover:file:bg-white/20"
            />
            {fileName && <span className="mt-1 block text-[11px] text-slate-500">Selected: {fileName}</span>}
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Reference transcript
            </span>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={3}
              placeholder="Exact words spoken in the reference clip…"
              className="input-dark resize-y font-mono text-xs"
            />
          </label>

          <p className="text-[11px] text-slate-500">
            TODO: voice-clone wiring is UI-only for now. When the local server exposes a reference
            field, the backend payload can include{" "}
            <code className="text-cyan-300">references: [{`{ audio_path, text }`}]</code>. This does not
            block normal generation.
          </p>
        </div>
      )}
    </section>
  );
}
