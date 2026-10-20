"use client";

import { useMemo, useState } from "react";
import { Chips } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import Relatable from "@/components/ui/Relatable";
import { fmt } from "@/lib/format";
import type { Problem } from "@/lib/ode";
import { duration } from "@/lib/relatable";
import { thetaTrace } from "@/lib/t13-theta";

const T_END = 4e5;
const ROB: Problem = {
  f: (_t, y) => [-0.04 * y[0] + 1e4 * y[1] * y[2], 0.04 * y[0] - 1e4 * y[1] * y[2] - 3e7 * y[1] * y[1], 3e7 * y[1] * y[1]],
  jac: (_t, y) => [
    [-0.04, 1e4 * y[2], 1e4 * y[1]],
    [0.04, -1e4 * y[2] - 6e7 * y[1], -1e4 * y[1]],
    [0, 6e7 * y[1], 0],
  ],
  y0: [1, 0, 0],
  T: T_END,
};
const LO = -7;
const HI = Math.log10(T_END);
const W = 640;
const TOP = 26;
const BOT = 132;
const HIST = 186;
const X = (lt: number) => 18 + ((lt - LO) / (HI - LO)) * (W - 36);
const Y = (u2: number) => BOT - (Math.min(u2 * 1e4, 0.42) / 0.42) * (BOT - TOP);
const TICKS: [number, string][] = [
  [-6, "1 мкс"],
  [-3, "1 мс"],
  [0, "1 с"],
  [Math.log10(60), "1 хв"],
  [Math.log10(3600), "1 год"],
  [Math.log10(86400), "1 доба"],
];
const humanH = (s: number) => (s < 1e-3 ? `${fmt(s * 1e6, 2)} мкс` : s < 1 ? `${fmt(s * 1e3, 2)} мс` : duration(s));

/** GPS-навігатор на «маршруті» Робертсона: кожна точка — прийнятий крок адаптивного θ-методу (перерахунок маршруту). */
export default function GpsScene() {
  const [tol, setTol] = useState(1e-3);
  const pb = usePlayback(14, true);
  const tr = useMemo(() => thetaTrace({ ...ROB }, { theta: 0.55, rtol: tol, atol: tol * 1e-6, blowup: 1e6, maxFevals: 300000 }), [tol]);
  const pts = useMemo(() => tr.t.slice(1).map((t, i) => ({ lt: Math.log10(t), u2: tr.y[i + 1][1], h: tr.hs[i] })), [tr]);
  const rej = tr.attempts.filter((a) => !a.accepted);
  const hMin = Math.min(...tr.hs);
  const hist = useMemo(() => {
    const out: number[] = [];
    for (let d = LO; d < Math.ceil(HI); d++) out.push(pts.filter((p) => p.lt >= d && p.lt < d + 1).length);
    return out;
  }, [pts]);
  const histMax = Math.max(...hist, 1);

  const lt = LO + pb.progress * (HI - LO);
  let k = pts.findIndex((p) => p.lt > lt);
  if (k < 0) k = pts.length - 1;
  const a = pts[Math.max(0, k - 1)] ?? { lt: LO, u2: 0, h: NaN };
  const b = pts[k] ?? a;
  const fr = k <= 0 || b.lt === a.lt ? 0 : Math.min(1, Math.max(0, (lt - a.lt) / (b.lt - a.lt)));
  const carY = k <= 0 ? Y(b.u2) : Y(a.u2) + (Y(b.u2) - Y(a.u2)) * fr;
  const hNow = b.h;
  const ping = pts.some((p) => Math.abs(X(p.lt) - X(lt)) < 4);

  return (
    <div className="space-y-3">
      <Chips
        label="Точність навігатора (rtol)"
        value={tol}
        onChange={setTol}
        options={[
          { value: 1e-2, label: "груба 10⁻²" },
          { value: 1e-3, label: "звичайна 10⁻³" },
          { value: 1e-4, label: "точна 10⁻⁴" },
          { value: 1e-5, label: "прискіплива 10⁻⁵" },
        ]}
      />
      <svg viewBox={`0 0 ${W} 210`} className="w-full">
        {TICKS.map(([v, l]) => (
          <g key={l}>
            <line x1={X(v)} x2={X(v)} y1={TOP - 6} y2={HIST} stroke="#ffffff18" />
            <text x={X(v)} y={TOP - 10} fontSize={10} textAnchor="middle" fill="#ffffff80">
              {l}
            </text>
          </g>
        ))}
        <polyline points={pts.map((p) => `${X(p.lt)},${Y(p.u2)}`).join(" ")} fill="none" stroke="#3a3f4b" strokeWidth={12} strokeLinejoin="round" />
        <polyline points={pts.map((p) => `${X(p.lt)},${Y(p.u2)}`).join(" ")} fill="none" stroke="#ffd84d" strokeWidth={1.2} strokeDasharray="6 6" />
        {pts.map((p, i) => (
          <circle key={i} cx={X(p.lt)} cy={Y(p.u2)} r={2.6} fill={p.lt <= lt ? "#4dd0e1" : "#ffffff55"} />
        ))}
        {rej.map((r, i) => (
          <text key={i} x={X(Math.min(HI, Math.log10(r.t + r.h)))} y={BOT + 14} fontSize={10} textAnchor="middle" fill="#ff5d73">
            ✗
          </text>
        ))}
        <g transform={`translate(${X(lt)} ${carY - 9})`}>
          <rect x={-11} y={-6} width={22} height={11} rx={4} fill="#5cc8ff" />
          <circle cx={-6} cy={6} r={3} fill="#111" />
          <circle cx={6} cy={6} r={3} fill="#111" />
          {ping && (
            <text x={0} y={-10} fontSize={13} textAnchor="middle">
              📡
            </text>
          )}
        </g>
        {hist.map((c, i) => (
          <rect key={i} x={X(LO + i) + 2} y={HIST - (c / histMax) * 26} width={X(LO + i + 1) - X(LO + i) - 4} height={(c / histMax) * 26} rx={2} fill="#4dd0e1" opacity={0.5} />
        ))}
        <text x={18} y={HIST + 14} fontSize={10} fill="#ffffff70">
          перерахунків за кожну декаду часу (10× довший відрізок)
        </text>
      </svg>
      <PlaybackBar pb={pb} label={`t ≈ ${Math.pow(10, lt) < 1 ? humanH(Math.pow(10, lt)) : duration(Math.pow(10, lt))}`} />
      <div className="grid gap-2 text-[12.5px] leading-snug text-white/70 sm:grid-cols-2">
        <div className="rounded-xl bg-white/[0.04] px-3 py-2">
          Зараз навігатор перераховує маршрут раз на <b className="text-white">{humanH(hNow)}</b>. Усього за шлях {duration(T_END)}:{" "}
          <b className="text-white">{tr.steps}</b> перерахунків (+{tr.rejected} невдалих ✗).
        </div>
        <div className="rounded-xl bg-white/[0.04] px-3 py-2">
          Якби весь шлях перераховував так само часто, як на старті (раз на {humanH(hMin)}) — {fmt(T_END / hMin, 2)} разів.{" "}
          <Relatable kind="steps" n={T_END / hMin} />
        </div>
      </div>
      <div className="text-[12px] leading-snug text-white/50">
        Висота дороги — концентрація проміжної речовини u₂ (×10⁴) у задачі Робертсона; час — логарифмічний, у секундах. Точки — справжні кроки θ-методу
        (θ = 0.55) зі змінним кроком.
      </div>
    </div>
  );
}
