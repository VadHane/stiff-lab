"use client";

import { useMemo } from "react";
import Plot from "@/components/plot/Plot";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { indexAt, type Solution } from "@/lib/ode";

const HEART =
  "M100 172 C 40 128, 8 92, 22 56 C 34 24, 78 18, 100 50 C 122 18, 166 24, 178 56 C 192 92, 160 128, 100 172 Z";

/** Stylised heart that contracts with x(t) of the Zeeman model + ECG-like monitor. */
export default function HeartScene({ sol, eps, period }: { sol: Solution; eps: number; period: number }) {
  const T = sol.t[sol.t.length - 1];
  const pb = usePlayback(Math.min(24, Math.max(8, T / 2.5)));
  const t = pb.progress * T;

  const data = useMemo(() => {
    const x = sol.y.map((v) => v[0]);
    const b = sol.y.map((v) => v[1]);
    const dx = sol.t.map((_, i) => {
      const j = Math.min(i + 1, sol.t.length - 1),
        k = Math.max(i - 1, 0);
      return (x[j] - x[k]) / (sol.t[j] - sol.t[k] || 1);
    });
    let xmin = Infinity,
      xmax = -Infinity,
      dmax = 0;
    for (let i = 0; i < x.length; i++) {
      xmin = Math.min(xmin, x[i]);
      xmax = Math.max(xmax, x[i]);
      dmax = Math.max(dmax, Math.abs(dx[i]));
    }
    // ECG-like signal: −ε·dx/dt makes a sharp spike at every jump
    const ecg = dx.map((v) => -v * eps);
    return { x, b, dx, ecg, xmin, xmax, dmax };
  }, [sol, eps]);

  const i = indexAt(sol.t, t);
  const x = data.x[i];
  const dx = data.dx[i];
  const span = Math.max(data.xmax - data.xmin, 1e-6);
  const relax = (x - data.xmin) / span; // 1 = relaxed (diastole), 0 = contracted (systole)
  const jumping = Math.abs(dx) > 0.15 * data.dmax && data.dmax > 1;
  const scale = span > 0.2 ? 0.78 + 0.22 * relax : 0.97 + 0.03 * Math.sin(t * 2);
  const phase = span < 0.2 ? "спокій" : jumping ? (dx < 0 ? "⚡ систола — стрибок!" : "⚡ діастола — стрибок назад") : x > (data.xmin + data.xmax) / 2 ? "діастола: розслаблення" : "систола: скорочення";
  const glow = jumping ? 1 : 0.35 + 0.4 * (1 - relax);

  const win = Math.min(T, Math.max(period > 0 ? period * 2.2 : T / 3, T / 6));
  const t0 = Math.max(0, t - win);
  const ecgSeries = useMemo(
    () => [{ x: sol.t, y: data.ecg, color: "#3ee6a8", width: 2, label: "−ε·dx/dt («ЕКГ»)" }],
    [sol, data],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="relative grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-b from-[#2a0d16] to-[#12060a] p-4">
          <svg viewBox="0 0 200 190" className="h-[220px] w-[220px]">
            <defs>
              <radialGradient id="hs-grad" cx="40%" cy="35%" r="75%">
                <stop offset="0%" stopColor="#ff9aa9" />
                <stop offset="55%" stopColor="#ff3b5c" />
                <stop offset="100%" stopColor="#8a0f26" />
              </radialGradient>
              <filter id="hs-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="8" />
              </filter>
            </defs>
            <g transform={`translate(100 95) scale(${scale}) translate(-100 -95)`}>
              <path d={HEART} fill="#ff3b5c" opacity={glow * 0.6} filter="url(#hs-glow)" />
              <path d={HEART} fill="url(#hs-grad)" stroke="#ffd0d8" strokeOpacity={0.35} strokeWidth={2} />
              <path d="M70 60 C 80 80, 78 110, 96 140" stroke="#ffd0d8" strokeOpacity={0.25} strokeWidth={3} fill="none" />
              <path d="M128 52 C 140 74, 132 104, 112 128" stroke="#ffd0d8" strokeOpacity={0.2} strokeWidth={3} fill="none" />
              <path d="M84 30 C 84 14, 92 6, 104 4" stroke="#ff6b84" strokeWidth={8} strokeLinecap="round" fill="none" />
              <path d="M112 36 C 116 18, 128 12, 140 14" stroke="#5cc8ff" strokeOpacity={0.8} strokeWidth={7} strokeLinecap="round" fill="none" />
            </g>
          </svg>
          <div className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[11px] text-white/80">x = {fmt(x, 3)}</div>
          <div className={`absolute bottom-3 rounded-full px-3 py-1 text-[12px] ${jumping ? "bg-[#ff5d73]/30 text-white" : "bg-black/40 text-white/75"}`}>{phase}</div>
        </div>
        <div className="space-y-2">
          <div className="rounded-2xl border border-[#3ee6a8]/20 bg-black/40 p-2">
            <Plot
              height={190}
              title="Кардіомонітор"
              xLabel="t"
              xDomain={[t0, Math.max(t0 + 1e-6, t)]}
              legend={false}
              series={ecgSeries}
              cursorX={t}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-white/45">волокно x</div>
              <div className="font-mono text-white">{fmt(x, 3)}</div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-white/45">сигнал b</div>
              <div className="font-mono text-white">{fmt(data.b[i], 3)}</div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-white/45">період</div>
              <div className="font-mono text-[var(--accent)]">{period > 0 ? fmt(period, 3) : "—"}</div>
            </div>
          </div>
        </div>
      </div>
      <PlaybackBar pb={pb} label={`t = ${t.toFixed(2)}`} />
    </div>
  );
}
