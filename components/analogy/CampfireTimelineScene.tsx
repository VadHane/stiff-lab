"use client";

import { useMemo } from "react";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { eigenvalues } from "@/lib/linalg";
import { indexAt, sampleAt, solve } from "@/lib/ode";
import { duration, relatableSteps } from "@/lib/relatable";

const f = (_t: number, u: number[]) => [-0.04 * u[0] + 1e4 * u[1] * u[2], 0.04 * u[0] - 1e4 * u[1] * u[2] - 3e7 * u[1] * u[1], 3e7 * u[1] * u[1]];
const jac = (_t: number, u: number[]) => [
  [-0.04, 1e4 * u[2], 1e4 * u[1]],
  [0.04, -1e4 * u[2] - 6e7 * u[1], -1e4 * u[1]],
  [0, 6e7 * u[1], 0],
];
const LG0 = -6,
  LG1 = 11;
const W = 600;
const X = (lg: number) => 14 + ((lg - LG0) / (LG1 - LG0)) * (W - 28);
const HUMAN: [number, string][] = [
  [1e-3, "1 мс"],
  [1, "1 с"],
  [3600, "1 год"],
  [3.156e7, "1 рік"],
  [3.156e10, "1000 років"],
];

function Jar({ label, emoji, level, value, color }: { label: string; emoji: string; level: number; value: string; color: string }) {
  const hgt = 70 * Math.max(0, Math.min(1, level));
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 60 90" className="h-[84px] w-[56px]">
        <rect x={8} y={8} width={44} height={74} rx={6} fill="#ffffff08" stroke="#ffffff44" />
        <rect x={10} y={80 - hgt} width={40} height={hgt} rx={4} fill={color} opacity={0.75} />
        <text x={30} y={52} textAnchor="middle" fontSize={20}>
          {emoji}
        </text>
      </svg>
      <div className="text-[11.5px] text-white/60">{label}</div>
      <div className="font-mono text-[12px] text-white">{value}</div>
    </div>
  );
}

/** Robertson's kinetics as a campfire on a logarithmic clock: from a millisecond flash to millennia of smouldering. */
export default function CampfireTimelineScene() {
  const pb = usePlayback(20, false);
  const data = useMemo(() => {
    const s = solve("ros", { f, jac, y0: [1, 0, 0], T: 1e11 }, { rtol: 1e-4, atol: 1e-10, maxSteps: 20000 });
    const lgt = s.t.map((t) => Math.log10(Math.max(t, 1e-9)));
    const comps = [0, 1, 2].map((i) => s.y.map((y) => y[i]));
    const lam = s.y.map((y) => Math.max(...eigenvalues(jac(0, y)).map((e) => Math.abs(e.re))));
    const expl = [0];
    for (let k = 1; k < s.t.length; k++) expl.push(expl[k - 1] + ((s.t[k] - s.t[k - 1]) * (lam[k] + lam[k - 1])) / 4);
    const when = (pred: (y: number[]) => boolean) => s.t[s.y.findIndex(pred)];
    let iB = 0;
    comps[1].forEach((v, k) => v > comps[1][iB] && (iB = k));
    const events = [
      { t: s.t[iB], label: "🔥 полум'я спалахнуло: B на максимумі" },
      { t: when((y) => y[0] < 0.99), label: "1 % дров перетворилося на попіл" },
      { t: when((y) => y[0] < 0.5), label: "згоріла половина дров" },
      { t: when((y) => y[0] < 0.1), label: "згоріло 90 %" },
      { t: when((y) => y[0] < 0.01), label: "згоріло 99 %" },
      { t: when((y) => y[0] < 0.001), label: "згоріло 99,9 % — лишився жар" },
    ];
    return { s, lgt, comps, expl, events, bMax: comps[1][iB] };
  }, []);

  const lg = LG0 + pb.progress * (LG1 - LG0);
  const t = Math.pow(10, lg);
  const u = data.comps.map((c) => sampleAt(data.lgt, c, lg));
  const rosSteps = indexAt(data.s.t, t);
  const expl = sampleAt(data.lgt, data.expl, lg);
  const passed = data.events.filter((e) => e.t <= t);
  const last = passed[passed.length - 1];

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} 86`} className="w-full">
        <rect x={X(LG0)} y={34} width={X(lg) - X(LG0)} height={6} rx={3} fill="#ffb547" opacity={0.5} />
        <line x1={X(LG0)} x2={X(LG1)} y1={37} y2={37} stroke="#ffffff33" strokeWidth={6} strokeLinecap="round" />
        {Array.from({ length: LG1 - LG0 + 1 }, (_, i) => (
          <line key={i} x1={X(LG0 + i)} x2={X(LG0 + i)} y1={42} y2={47} stroke="#ffffff55" />
        ))}
        {HUMAN.map(([v, l]) => (
          <g key={l}>
            <line x1={X(Math.log10(v))} x2={X(Math.log10(v))} y1={42} y2={56} stroke="#ffffff99" />
            <text x={X(Math.log10(v))} y={68} fontSize={11} fill="#ffffffaa" textAnchor="middle">
              {l}
            </text>
          </g>
        ))}
        {data.events.map((e, i) => (
          <g key={i} opacity={e.t <= t ? 1 : 0.35}>
            <line x1={X(Math.log10(e.t))} x2={X(Math.log10(e.t))} y1={12} y2={32} stroke="#ff7a59" />
            <circle cx={X(Math.log10(e.t))} cy={10} r={7} fill="#ff7a59" />
            <text x={X(Math.log10(e.t))} y={13.5} fontSize={9} textAnchor="middle" fill="#000">
              {i + 1}
            </text>
          </g>
        ))}
        <circle cx={X(lg)} cy={37} r={7} fill="#fff" />
        <text x={X(LG0)} y={84} fontSize={10} fill="#ffffff66">
          10⁻⁶
        </text>
        <text x={X(LG1)} y={84} fontSize={10} fill="#ffffff66" textAnchor="end">
          10¹¹ од. часу
        </text>
      </svg>
      <PlaybackBar pb={pb} label={`t = ${fmt(t, 2)}`} />
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <div className="flex gap-1">
          <Jar label="дрова A" emoji="🪵" level={u[0]} value={fmt(u[0], 3)} color="#c98a4b" />
          <Jar label="полум'я B ×10⁴" emoji="🔥" level={u[1] * 1e4} value={fmt(u[1], 2)} color="#ff7a59" />
          <Jar label="попіл C" emoji="⚫" level={u[2]} value={fmt(u[2], 3)} color="#9aa3b5" />
        </div>
        <div className="space-y-1.5 text-[12.5px] leading-snug text-white/70">
          <div>
            Якщо 1 од. часу = 1 с, минуло: <b className="text-white">{duration(t)}</b>
          </div>
          <div>{last ? `${data.events.indexOf(last) + 1}. ${last.label}` : "Сірник ще не чиркнув…"}</div>
          <div className="font-mono text-[12px]">
            Розенброк: <span className="text-[#3ee6a8]">{rosSteps.toLocaleString("uk-UA")}</span> кроків · явний Ейлер: ≥{" "}
            <span className="text-[#ff5d73]">{fmt(Math.max(expl, 0), 3)}</span>
          </div>
          {expl > 120 && <div className="text-[11.5px] text-[#ffe9a3]">🗣️ Ейлер: {relatableSteps(expl)}</div>}
        </div>
      </div>
      <div className="text-[12px] leading-snug text-white/50">
        Колби — розв&apos;язок задачі Робертсона з (1, 0, 0) (Розенброк, rtol = 10⁻⁴). «Явний Ейлер ≥» — скільки кроків h ≤ 2/|λ| знадобилося б до цього моменту
        (інтеграл ∫|λ|/2 dt уздовж траєкторії). Полум&apos;я B завжди крихітне — щонайбільше {fmt(data.bMax, 3)}, у ~{Math.round(1 / data.bMax / 1000)} тисяч разів менше за
        дрова, — але саме через нього все горить.
      </div>
    </div>
  );
}
