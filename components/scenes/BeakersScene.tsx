"use client";

import { useMemo } from "react";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { sampleAt, type Solution } from "@/lib/ode";

const COLORS = ["#ffb547", "#ff5d73", "#5cc8ff"];
const NAMES = ["A", "B", "C"];

function rnd(i: number, k: number) {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Three beakers with A, B (×10⁴) and C, molecules and reaction arrows; time runs on a log scale. */
export default function BeakersScene({ sol, tMin = 1e-6 }: { sol: Solution; tMin?: number }) {
  const pb = usePlayback(14);
  const T = sol.t[sol.t.length - 1];
  const t = tMin * Math.pow(T / tMin, pb.progress);
  const comps = useMemo(() => [0, 1, 2].map((i) => sol.y.map((v) => v[i])), [sol]);
  const S0 = sol.y[0].reduce((s, v) => s + v, 0);
  const u = comps.map((c) => sampleAt(sol.t, c, t));
  const level = [u[0] / S0, Math.min(1, (u[1] * 1e4) / S0), u[2] / S0];
  const rates = [0.04 * u[0], 3e7 * u[1] * u[1], 1e4 * u[1] * u[2]];
  const lw = (r: number) => Math.max(0.6, Math.min(9, 1.6 * (Math.log10(Math.max(r, 1e-12)) + 7)));
  const phase = pb.progress * 40;

  const beaker = (k: number, x: number) => {
    const H = 150,
      W = 96,
      top = 40;
    const lv = Math.max(0, Math.min(1, level[k]));
    const yLiquid = top + H - lv * (H - 8);
    const nMol = Math.round(lv * 26);
    return (
      <g key={k}>
        <rect x={x} y={top} width={W} height={H} rx={12} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
        <rect x={x + 2} y={yLiquid} width={W - 4} height={Math.max(0, top + H - yLiquid - 2)} rx={10} fill={COLORS[k]} opacity={0.28} />
        <line x1={x + 4} x2={x + W - 4} y1={yLiquid} y2={yLiquid} stroke={COLORS[k]} strokeWidth={2} opacity={0.9} />
        {Array.from({ length: nMol }, (_, i) => {
          const px = x + 10 + rnd(i, k) * (W - 20) + 4 * Math.sin(phase * (0.7 + rnd(i, k + 7)) + i);
          const span = top + H - 8 - yLiquid;
          const py = yLiquid + 6 + rnd(i, k + 3) * Math.max(0, span - 6) + 3 * Math.cos(phase * (0.9 + rnd(i, k + 5)) + i * 2);
          return <circle key={i} cx={px} cy={Math.min(py, top + H - 6)} r={3} fill={COLORS[k]} opacity={0.9} />;
        })}
        <text x={x + W / 2} y={top + H + 22} textAnchor="middle" fill="white" fontSize={16} fontWeight={600}>
          {NAMES[k]}
          {k === 1 ? " ×10⁴" : ""}
        </text>
        <text x={x + W / 2} y={top + H + 40} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={12} fontFamily="monospace">
          {fmt(u[k], 4)}
        </text>
      </g>
    );
  };

  return (
    <div className="space-y-3">
      <svg viewBox="0 0 520 250" className="w-full">
        <defs>
          <marker id="bk-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="rgba(255,255,255,0.7)" />
          </marker>
        </defs>
        <path d="M 126 70 C 160 40, 180 40, 204 70" stroke={COLORS[0]} strokeWidth={lw(rates[0])} fill="none" markerEnd="url(#bk-arrow)" opacity={0.85} />
        <text x={165} y={30} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={11}>
          A→B: {fmt(rates[0], 2)}
        </text>
        <path d="M 318 70 C 350 40, 370 40, 400 70" stroke={COLORS[1]} strokeWidth={lw(rates[1])} fill="none" markerEnd="url(#bk-arrow)" opacity={0.85} />
        <text x={360} y={30} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={11}>
          2B→C+B: {fmt(rates[1], 2)}
        </text>
        <path d="M 210 205 C 160 236, 120 236, 104 200" stroke={COLORS[2]} strokeWidth={lw(rates[2])} fill="none" markerEnd="url(#bk-arrow)" opacity={0.6} strokeDasharray="6 4" />
        <text x={160} y={248} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={11}>
          B+C→A+C: {fmt(rates[2], 2)}
        </text>
        {beaker(0, 24)}
        {beaker(1, 212)}
        {beaker(2, 400)}
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-white/55">
        <span>
          Сума u₁+u₂+u₃ = <span className="font-mono text-white/80">{fmt(u[0] + u[1] + u[2], 8)}</span>
        </span>
        <span>Товщина стрілки ∝ lg(швидкість реакції)</span>
        <span>Час іде в логарифмічному масштабі</span>
      </div>
      <PlaybackBar pb={pb} label={`t = ${fmt(t, 3)}`} />
    </div>
  );
}
