"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Chips, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { plural } from "@/lib/relatable";

const MU = 8.5;
const N_TR = 60;
const N_KEEP = 40;
const N_ANIM = 12;
const WIN = 28;
const SPEED = 8;

/** u'' + u = μ(1−u²)u' + a·sin ωt from u(0)=2, u'(0)=1 (RK4, ≈0.02); the state is recorded at every push (force maximum). */
function simulate(a: number, w: number) {
  const Tp = (2 * Math.PI) / w;
  const sub = Math.ceil(Tp / 0.02);
  const h = Tp / sub;
  let u = 2,
    v = 1,
    t = 0;
  const F = (tt: number, uu: number, vv: number) => MU * (1 - uu * uu) * vv - uu + a * Math.sin(w * tt);
  const step = (hh: number) => {
    const k1u = v,
      k1v = F(t, u, v);
    const k2u = v + 0.5 * hh * k1v,
      k2v = F(t + hh / 2, u + 0.5 * hh * k1u, v + 0.5 * hh * k1v);
    const k3u = v + 0.5 * hh * k2v,
      k3v = F(t + hh / 2, u + 0.5 * hh * k2u, v + 0.5 * hh * k2v);
    const k4u = v + hh * k3v,
      k4v = F(t + hh, u + hh * k3u, v + hh * k3v);
    u += (hh / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    v += (hh / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    t += hh;
  };
  const q = Math.ceil(sub / 4);
  for (let k = 0; k < q; k++) step(Tp / 4 / q);
  const pu: number[] = [];
  const pv: number[] = [];
  const at: number[] = [];
  const au: number[] = [];
  let ups = 0;
  for (let n = 0; n < N_TR + N_KEEP; n++) {
    for (let k = 0; k < sub; k++) {
      const u0 = u;
      step(h);
      if (n >= N_TR && u0 < 0 && u >= 0) ups++;
      if (n >= N_TR + N_KEEP - N_ANIM && k % 4 === 0) {
        at.push(t);
        au.push(u);
      }
    }
    if (n >= N_TR) {
      pu.push(u);
      pv.push(v);
    }
  }
  // the pattern of the last WIN pushes repeats with the best period p ≤ 12; a "slip" = a push that broke the pattern
  let best = { p: 1, miss: Infinity, bad: [] as boolean[] };
  for (let p = 1; p <= 12; p++) {
    const bad: boolean[] = [];
    for (let n = N_KEEP - WIN; n < N_KEEP; n++) bad.push(Math.hypot(pu[n] - pu[n - p], (pv[n] - pv[n - p]) / 5) > 0.02);
    const miss = bad.filter(Boolean).length;
    if (miss < best.miss) best = { p, miss, bad };
  }
  return { Tp, pu, at, au, swings: Math.round((ups / N_KEEP) * best.p), ...best };
}

/** A child on a swing pushed with its own rhythm: the forced Van der Pol oscillator (μ = 8.5) of the assignment. */
export default function ForcedSwingScene() {
  const [w, setW] = useState(0.36);
  const [a, setA] = useState(1);
  const dW = useDeferredValue(w);
  const dA = useDeferredValue(a);
  const sim = useMemo(() => simulate(dA, dW), [dA, dW]);
  const natural = useMemo(() => {
    const s = simulate(0, (2 * Math.PI) / 10);
    const ups: number[] = [];
    for (let i = 1; i < s.au.length; i++)
      if (s.au[i - 1] < 0 && s.au[i] >= 0) ups.push(s.at[i - 1] + ((s.at[i] - s.at[i - 1]) * -s.au[i - 1]) / (s.au[i] - s.au[i - 1]));
    return ups.length > 1 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : NaN;
  }, []);
  const pb = usePlayback((N_ANIM * sim.Tp) / SPEED);
  const i = Math.min(sim.at.length - 1, Math.floor(pb.progress * sim.at.length));
  const t = sim.at[i];
  const u = sim.au[i];
  const force = dA * Math.sin(dW * t);
  const pushesDone = Math.floor(pb.progress * N_ANIM);
  const locked = sim.miss === 0;

  const PX = 280,
    PY = 18,
    R = 150;
  const ang = (x: number) => Math.max(-2.6, Math.min(2.6, x)) * 0.3;
  const seat = (x: number) => [PX + R * Math.sin(ang(x)), PY + R * Math.cos(ang(x))];
  const [sx, sy] = seat(u);
  const ghosts = sim.pu.slice(N_KEEP - N_ANIM, N_KEEP - N_ANIM + pushesDone).slice(-8);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Slider label="Ритм поштовхів ω" value={w} onChange={setW} min={0.2} max={1.2} step={0.01} hint={`поштовх раз на ${fmt(sim.Tp, 3)} од. часу`} />
        <Chips
          label="Сила поштовху a"
          value={a}
          onChange={setA}
          options={[
            { value: 0.5, label: "легенько (0.5)" },
            { value: 1, label: "помірно (1)" },
            { value: 2, label: "сильно (2)" },
          ]}
        />
      </div>
      <svg viewBox="0 0 560 210" className="w-full rounded-xl border border-white/8 bg-black/20">
        <rect x={150} y={10} width={260} height={8} rx={3} fill="#8a5a33" />
        {ghosts.map((g, k) => {
          const [gx, gy] = seat(g);
          return <circle key={k} cx={gx} cy={gy + 6} r={5} fill="#ffe66d" opacity={0.25 + (0.6 * (k + 1)) / ghosts.length} />;
        })}
        <line x1={PX} y1={PY} x2={sx} y2={sy} stroke="#ffffffaa" strokeWidth={2} />
        <rect x={sx - 18} y={sy} width={36} height={6} rx={2} fill="#ff7ad9" />
        <text x={sx} y={sy - 2} fontSize={22} textAnchor="middle">
          🧒
        </text>
        {Math.abs(force) > 0.02 && (
          <g>
            <line x1={sx} y1={sy + 16} x2={sx + force * 26} y2={sy + 16} stroke="#ffb547" strokeWidth={3} />
            <text x={sx + force * 26 + (force > 0 ? 6 : -6)} y={sy + 20} fontSize={11} fill="#ffb547" textAnchor={force > 0 ? "start" : "end"}>
              {force > 0 ? "штовх" : "тягне"}
            </text>
          </g>
        )}
        <text x={14} y={198} fontSize={11} fill="#ffffff77">
          жовті цятки — де була гойдалка в момент останніх поштовхів
        </text>
      </svg>
      <PlaybackBar pb={pb} label={`t = ${fmt(t, 4)}`} />
      <div className="flex flex-wrap items-center gap-1">
        {sim.bad.map((b, k) => (
          <span key={k} className={`h-3 w-3 rounded-sm ${b ? "bg-[#ff5d73]" : "bg-[#3ee6a8]"}`} title={b ? "збилась" : "у ритмі"} />
        ))}
      </div>
      <div className={`rounded-xl px-3 py-2 text-[13px] leading-snug ${locked ? "bg-[#3ee6a8]/10 text-white/85" : "bg-[#ff5d73]/10 text-white/85"}`}>
        {locked ? (
          <>
            ✅ У ритмі: за {sim.p} {plural(sim.p, ["поштовх", "поштовхи", "поштовхів"])} гойдалка робить рівно {sim.swings} {plural(sim.swings, ["гойдання", "гойдання", "гойдань"])} — картина
            повторюється, з {WIN} останніх поштовхів жодного «збою».
          </>
        ) : (
          <>
            🌀 Збивається: з {WIN} останніх поштовхів {sim.miss} не повторили попередню картину (найкраща спроба — період {sim.p}).
          </>
        )}
      </div>
      <div className="text-[12.5px] leading-snug text-white/55">
        Власний ритм цієї «гойдалки» (μ = 8.5, без поштовхів) — одне гойдання за ≈ {fmt(natural, 3)} од. часу. Коли поштовхи приходять приблизно в такт,
        гойдалка підлаштовується під них (захоплення частоти). Не в такт — рахуйте червоні квадратики. Модель — рівняння задачі, RK4 з кроком ≈ 0.02, перші{" "}
        {N_TR} поштовхів відкинуто як перехідний процес.
      </div>
    </div>
  );
}
