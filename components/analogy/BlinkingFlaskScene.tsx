"use client";

import { useId, useMemo, useState } from "react";
import { Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { comp, sampleAt, solve } from "@/lib/ode";

const A = 1;
const T_END = 60;
const ORANGE = [255, 179, 71];
const BLUE = [127, 155, 255];

const mix = (k: number) => {
  const c = ORANGE.map((o, i) => Math.round(BLUE[i] + (o - BLUE[i]) * Math.min(1, Math.max(0, k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

/** A flask with the Brusselator inside (A = 1): above B = 1 + A² it starts blinking on its own. */
export default function BlinkingFlaskScene() {
  const [B, setB] = useState(3);
  const pb = usePlayback(20);
  const clip = `flask${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const run = useMemo(() => {
    const s = solve(
      "dopri",
      {
        f: (_t, y) => {
          const q = y[0] * y[0] * y[1];
          return [A + q - (B + 1) * y[0], B * y[0] - q];
        },
        y0: [1, 1],
        T: T_END,
      },
      { rtol: 1e-7, atol: 1e-9, maxSteps: 60000 },
    );
    const u1 = comp(s, 0),
      u2 = comp(s, 1);
    let lo = Infinity,
      hi = -Infinity,
      top = 0;
    for (let i = 0; i < u1.length; i++) {
      top = Math.max(top, u1[i], u2[i]);
      if (s.t[i] > T_END / 2) {
        lo = Math.min(lo, u1[i]);
        hi = Math.max(hi, u1[i]);
      }
    }
    const blinks: number[] = [];
    if (B > 1 + A * A && hi - lo > 0.05) {
      const thr = (hi + lo) / 2;
      for (let i = 1; i < u1.length; i++) if (u1[i - 1] < thr && u1[i] >= thr) blinks.push(s.t[i]);
    }
    const tail = blinks.filter((x) => x > T_END / 3);
    const period = tail.length >= 3 ? (tail[tail.length - 1] - tail[0]) / (tail.length - 1) : NaN;
    return { t: s.t, u1, u2, blinks, period, top: Math.max(top, 1) };
  }, [B]);

  const t = pb.progress * T_END;
  const u1 = sampleAt(run.t, run.u1, t);
  const u2 = sampleAt(run.t, run.u2, t);
  const share = u1 / (u1 + u2);
  const color = mix(share);
  const flash = Math.max(0, Math.min(1, (u1 - 1.5) / 2));
  const hopf = 1 + A * A;
  const ticking = B > hopf;
  const done = run.blinks.filter((x) => x <= t).length;

  const W = 300,
    H = 70;
  const px = (tt: number) => (tt / T_END) * W;
  const py = (v: number) => H - 4 - (v / run.top) * (H - 8);
  const line = (u: number[]) => run.t.map((tt, i) => `${px(tt).toFixed(1)},${py(u[i]).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] items-center gap-4">
        <svg viewBox="0 0 160 200" className="w-full">
          <defs>
            <clipPath id={clip}>
              <path d="M66 18 H94 V78 L146 178 Q150 190 138 190 H22 Q10 190 14 178 L66 78 Z" />
            </clipPath>
          </defs>
          {flash > 0.02 && <circle cx={80} cy={140} r={70} fill={color} opacity={0.18 * flash} />}
          <g clipPath={`url(#${clip})`}>
            <rect x={0} y={96} width={160} height={110} fill={color} opacity={0.85} style={{ transition: "fill 0.1s" }} />
            {[0, 1, 2, 3, 4].map((k) => {
              const ph = (t * 0.9 + k * 1.7) % 6;
              return <circle key={k} cx={40 + k * 20} cy={186 - ph * 15} r={2 + (k % 2)} fill="#ffffff55" />;
            })}
          </g>
          <path d="M66 18 H94 V78 L146 178 Q150 190 138 190 H22 Q10 190 14 178 L66 78 Z" fill="none" stroke="#ffffff66" strokeWidth={2.5} />
          <rect x={60} y={10} width={40} height={8} rx={3} fill="#ffffff33" />
        </svg>
        <div className="space-y-2 text-[13px]">
          <div className="flex gap-2">
            <span className="rounded-full px-2.5 py-0.5 font-mono" style={{ background: "#ffb34733", color: "#ffd49a" }}>
              X = {fmt(u1, 3)}
            </span>
            <span className="rounded-full px-2.5 py-0.5 font-mono" style={{ background: "#7f9bff33", color: "#c3d0ff" }}>
              Y = {fmt(u2, 3)}
            </span>
          </div>
          <div className={`rounded-xl px-3 py-2 ${ticking ? "bg-[#ffb547]/10 text-[#ffe0a8]" : "bg-[#3ee6a8]/10 text-[#b8f5dd]"}`}>
            {ticking ? (
              <>
                ⏰ B = {fmt(B, 3)} &gt; 1 + A² = {hopf}: колба блимає сама, період ≈ {Number.isFinite(run.period) ? fmt(run.period, 3) : "…"}
              </>
            ) : (
              <>
                😴 B = {fmt(B, 3)} ≤ 1 + A² = {hopf}: коливання згасають, колір завмирає (X → {A}, Y → {fmt(B / A, 3)})
              </>
            )}
          </div>
          <div className="font-mono text-[12px] text-white/55">
            спалахів: {done}
            {ticking ? ` з ${run.blinks.length} за t ≤ ${T_END}` : ""}
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-black/20">
        <polyline points={line(run.u2)} fill="none" stroke="#7f9bff" strokeWidth={1.4} />
        <polyline points={line(run.u1)} fill="none" stroke="#ffb347" strokeWidth={1.6} />
        <line x1={px(t)} x2={px(t)} y1={0} y2={H} stroke="#ffffff88" strokeWidth={1} />
      </svg>
      <Slider label="Подача речовини B (A = 1)" value={B} onChange={setB} min={1} max={6} step={0.1} hint="поріг годинника: B = 1 + A² = 2" />
      <PlaybackBar pb={pb} label={`t = ${fmt(t, 3)}`} />
      <div className="text-[12.5px] leading-snug text-white/55">
        Колір — частка X серед X + Y (помаранчевий ↔ синій), внизу — концентрації за справжнім розв&apos;язком рівнянь Брюсселятора. Посуньте B нижче 2 —
        і «світлофор» вимкнеться.
      </div>
    </div>
  );
}
