"use client";

import { useEffect, useRef, useState } from "react";

/** Animation clock that runs progress 0 → 1 over `seconds` and loops. */
export function usePlayback(seconds = 8, autoplay = true) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current !== null) {
        const dt = (now - last.current) / 1000;
        setProgress((p) => {
          const n = p + (dt * speed) / seconds;
          return n >= 1 ? n - 1 : n;
        });
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, seconds, speed]);
  return { progress, setProgress, playing, setPlaying, speed, setSpeed };
}

export function PlaybackBar({
  pb,
  label,
}: {
  pb: ReturnType<typeof usePlayback>;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => pb.setPlaying(!pb.playing)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-black shadow-[0_0_20px_-4px_var(--accent)] transition-transform hover:scale-105"
        aria-label={pb.playing ? "Пауза" : "Відтворити"}
      >
        {pb.playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(pb.progress * 1000)}
        onChange={(e) => {
          pb.setPlaying(false);
          pb.setProgress(Number(e.target.value) / 1000);
        }}
        className="range flex-1"
        style={{ ["--p" as string]: `${pb.progress * 100}%` }}
      />
      <button
        onClick={() => pb.setSpeed(pb.speed >= 4 ? 0.25 : pb.speed * 2)}
        className="w-12 shrink-0 rounded-full border border-white/15 py-1 font-mono text-[11px] text-white/70 hover:bg-white/10"
        title="Швидкість"
      >
        {pb.speed}×
      </button>
      {label && <span className="hidden w-28 shrink-0 text-right font-mono text-[12px] text-white/60 sm:block">{label}</span>}
    </div>
  );
}
