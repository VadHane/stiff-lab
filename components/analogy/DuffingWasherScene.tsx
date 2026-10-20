"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Chips, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { comp, sampleAt, solve } from "@/lib/ode";

const M = 0.01;
const C = 0.15;
const K = 2;
const T_END = 0.6;
const H_BOOK = 0.01;
const S = 2.4;
const RK4_FRAMES = (2 * Math.PI) / 2.83;

function Spring({ x, top, bottom, color }: { x: number; top: number; bottom: number; color: string }) {
  const n = 9;
  let d = `M${x},${top}`;
  for (let k = 1; k <= n; k++) d += ` L${x + (k % 2 ? 11 : -11)},${top + ((bottom - top) * (k - 0.5)) / n}`;
  d += ` L${x},${bottom}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />;
}

/** A washing machine on rubber feet: m u'' + c u' + k u + d u³ = 0 with the coefficients of the assignment; the feet get stiffer the more they are squeezed. */
export default function DuffingWasherScene() {
  const [u0, setU0] = useState(10);
  const [d, setD] = useState(2);
  const dU0 = useDeferredValue(u0);
  const dD = useDeferredValue(d);
  const sol = useMemo(() => {
    const s = solve(
      "dopri",
      { f: (_t, y) => [y[1], -(C * y[1] + K * y[0] + dD * y[0] ** 3) / M], y0: [dU0, 0], T: T_END },
      { rtol: 1e-8, atol: 1e-10, maxSteps: 100000 },
    );
    return { t: s.t, u: comp(s, 0) };
  }, [dU0, dD]);
  const pb = usePlayback(12);
  const t = pb.progress * T_END;
  const u = sampleAt(sol.t, sol.u, t);
  const kEff = K + 3 * dD * u * u;
  const ratio = kEff / K;
  const period = (2 * Math.PI) / Math.sqrt(kEff / M);
  const frames = period / H_BOOK;
  const hue = 140 * (1 - Math.min(1, Math.log10(ratio) / Math.log10(400)));
  const color = `hsl(${hue}, 85%, 58%)`;
  const kMax = K + 3 * dD * dU0 * dU0;
  const pMin = (2 * Math.PI) / Math.sqrt(kMax / M);

  const off = u * S;
  const bodyTop = 34 + off;
  const bodyBot = 134 + off;
  const strip = sol.t.map((tt, k) => `${k ? "L" : "M"}${(330 + (tt / T_END) * 215).toFixed(1)},${(105 - (sol.u[k] / 15) * 60).toFixed(1)}`).join("");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Slider label="Наскільки стиснули опори на старті: u(0)" value={u0} onChange={setU0} min={1} max={15} step={0.5} />
        <Chips
          label="Опори"
          value={d}
          onChange={setD}
          options={[
            { value: 2, label: "гумові, d = 2 (умова)" },
            { value: 0, label: "звичайні пружини, d = 0" },
          ]}
        />
      </div>
      <svg viewBox="0 0 560 210" className="w-full rounded-xl border border-white/8 bg-black/20">
        <line x1={20} x2={300} y1={200} y2={200} stroke="#ffffff44" strokeWidth={2} />
        <Spring x={70} top={bodyBot} bottom={200} color={color} />
        <Spring x={250} top={bodyBot} bottom={200} color={color} />
        <rect x={148} y={160} width={24} height={40} rx={2} fill="#ffffff18" stroke="#ffffff55" />
        <rect x={156} y={bodyBot} width={8} height={30} fill="#ffffff66" />
        <rect x={150} y={bodyBot + 28} width={20} height={4} fill="#ffffffaa" />
        <rect x={40} y={bodyTop} width={240} height={100} rx={10} fill="#e8eef9" stroke="#ffffff" strokeWidth={1.5} opacity={0.92} />
        <circle cx={160} cy={bodyTop + 52} r={34} fill="#1d2433" stroke="#9aa6bd" strokeWidth={4} />
        <g style={{ transform: `rotate(${pb.progress * 7200}deg)`, transformOrigin: `160px ${bodyTop + 52}px` }}>
          <path d={`M160 ${bodyTop + 52} L160 ${bodyTop + 26}`} stroke="#5cc8ff" strokeWidth={5} strokeLinecap="round" />
          <circle cx={160} cy={bodyTop + 30} r={7} fill="#ff7ad9" />
        </g>
        <text x={160} y={bodyTop + 14} fontSize={10} textAnchor="middle" fill="#334">
          віджим
        </text>
        <line x1={330} x2={545} y1={105} y2={105} stroke="#ffffff22" />
        <path d={strip} fill="none" stroke="#8ef0c5" strokeWidth={1.4} />
        <line x1={330 + (t / T_END) * 215} x2={330 + (t / T_END) * 215} y1={40} y2={170} stroke="#ffffff66" />
        <text x={330} y={30} fontSize={10.5} fill="#ffffff88">
          стиск опор u(t), перші 0.6 с
        </text>
        <text x={330} y={190} fontSize={11} fill={color}>
          жорсткість опор зараз: ×{fmt(ratio, 3)}
        </text>
      </svg>
      <PlaybackBar pb={pb} label={`t = ${fmt(t * 1000, 3)} мс`} />
      <div className="grid grid-cols-1 gap-2 text-[12.5px] sm:grid-cols-3">
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          одне коливання зараз триває <span className="font-mono text-white">{fmt(period * 1000, 3)} мс</span>
        </div>
        <div className={`rounded-lg px-2.5 py-1.5 ${frames < RK4_FRAMES ? "bg-[#ff5d73]/10" : "bg-white/[0.04]"}`}>
          «кадрів» з кроком 10 мс на одне коливання: <span className="font-mono text-white">{fmt(frames, 3)}</span>
          {frames < RK4_FRAMES && <span className="text-[#ff8597]"> — менше {fmt(RK4_FRAMES, 3)}: навіть RK4 тут за межею стійкості</span>}
        </div>
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          найкоротше коливання (на старті): <span className="font-mono text-white">{fmt(pMin * 1000, 3)} мс</span>
        </div>
      </div>
      <div className="text-[12.5px] leading-snug text-white/55">
        Рух — точний розв&apos;язок рівняння задачі (m = 0.01, c = 0.15, k = 2), сповільнений у 20 разів. Колір пружин — миттєва жорсткість k + 3du²: зелений —
        м&apos;яко, червоний — «камінь». Що сильніше стиснули гумові опори, то частіше вони тремтять — і то частіше мусить «фотографувати» чисельний метод.
        Звичайні пружини (d = 0) тремтять з однаковою частотою за будь-якого стиску.
      </div>
    </div>
  );
}
