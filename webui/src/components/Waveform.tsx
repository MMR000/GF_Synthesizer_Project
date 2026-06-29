import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";

interface Props {
  url: string;
  height?: number;
}

export default function Waveform({ url, height = 72 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    setReady(false);
    setError(false);
    setPlaying(false);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: "rgba(148, 163, 184, 0.45)",
      progressColor: "#a855f7",
      cursorColor: "#22d3ee",
      barWidth: 2,
      barGap: 2,
      barRadius: 3,
      url,
    });
    wsRef.current = ws;
    ws.on("ready", () => setReady(true));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("error", () => setError(true));

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [url, height]);

  if (error) {
    return (
      <audio controls src={url} className="w-full">
        Your browser does not support audio playback.
      </audio>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/50 p-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => wsRef.current?.playPause()}
          disabled={!ready}
          className="neon-btn h-9 w-9 shrink-0 rounded-full p-0 text-base"
          title={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div ref={containerRef} className="min-w-0 flex-1" />
      </div>
      {!ready && !error && <p className="px-1 pt-1 text-[11px] text-slate-500">Loading waveform…</p>}
    </div>
  );
}
