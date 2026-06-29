import { useMemo } from "react";
import { type GenSettings, buildPayload, resolveEndpointUrl } from "../lib/types";

interface Props {
  text: string;
  cleanText: string;
  settings: GenSettings;
  onCopy: (text: string, label?: string) => void;
}

function Block({
  title,
  code,
  tone,
  onCopy,
}: {
  title: string;
  code: string;
  tone: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/50 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">{title}</span>
        <button onClick={onCopy} className="ghost-btn px-2 py-0.5 text-[11px]">
          ⧉ Copy
        </button>
      </div>
      <pre className={`scroll-thin max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] ${tone}`}>
        <code className="whitespace-pre-wrap break-words">{code}</code>
      </pre>
    </div>
  );
}

export default function CopyExportPanel({ text, cleanText, settings, onCopy }: Props) {
  const url = resolveEndpointUrl(settings);
  const payload = useMemo(() => buildPayload(text || "…", settings), [text, settings]);

  const curl = useMemo(() => {
    const body = JSON.stringify(payload).replace(/'/g, "'\\''");
    return `curl -s ${url} \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}' \\\n  --output ${settings.filename}`;
  }, [payload, url, settings.filename]);

  const python = useMemo(() => {
    return `import requests

url = "${url}"
payload = ${JSON.stringify(payload, null, 4)}

resp = requests.post(url, json=payload, timeout=600)
resp.raise_for_status()
with open("${settings.filename}", "wb") as f:
    f.write(resp.content)
print("saved ${settings.filename}", len(resp.content), "bytes")`;
  }, [payload, url, settings.filename]);

  return (
    <section className="glass flex flex-col gap-2 p-4">
      <div className="panel-title mb-1">
        <span className="h-2 w-2 rounded-full bg-gradient-to-r from-cyan-400 to-lime-400" />
        Copy / Export
      </div>
      <Block title="Equivalent curl" code={curl} tone="text-lime-200" onCopy={() => onCopy(curl, "curl command")} />
      <Block title="Python requests" code={python} tone="text-cyan-200" onCopy={() => onCopy(python, "Python code")} />
      <Block
        title="Raw tagged text"
        code={text || "…"}
        tone="text-slate-300"
        onCopy={() => onCopy(text, "Raw tagged text")}
      />
      <Block
        title="Clean text (no tags)"
        code={cleanText || "…"}
        tone="text-slate-300"
        onCopy={() => onCopy(cleanText, "Clean text")}
      />
    </section>
  );
}
