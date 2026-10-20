"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Chips, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { comp, sampleAt, solve } from "@/lib/ode";

const B = 1.5;
const C = 0.84;
const T_END = 3;
const SPEED = 0.25;

const wrap = (x: number) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));

function Fan({ cx, arms, title, sub }: { cx: number; arms: { phi: number; a: number; o: number }[]; title: string; sub: string }) {
  return (
    <g>
      <circle cx={cx} cy={95} r={78} fill="#ffffff06" stroke="#ffffff22" />
      {arms.map((r, k) => (
        <g key={k} opacity={r.o}>
          <line x1={cx} y1={95} x2={cx + 70 * r.a * Math.cos(r.phi)} y2={95 - 70 * r.a * Math.sin(r.phi)} stroke="#9ad0ff" strokeWidth={6} strokeLinecap="round" />
          <circle cx={cx + 70 * r.a * Math.cos(r.phi)} cy={95 - 70 * r.a * Math.sin(r.phi)} r={6} fill="#ff7ad9" />
        </g>
      ))}
      <circle cx={cx} cy={95} r={6} fill="#fff" />
      <text x={cx} y={188} fontSize={12} textAnchor="middle" fill="#ffffffcc">
        {title}
      </text>
      <text x={cx} y={203} fontSize={10.5} textAnchor="middle" fill="#ffffff77">
        {sub}
      </text>
    </g>
  );
}

/** Fast phase seen through a camera with step h: the wagon-wheel effect, on the real φ(τ), a(τ) of the task (ω = 1). */
export default function FanStrobeScene() {
  const [eps, setEps] = useState(0.05);
  const [h, setH] = useState(0.18);
  const dEps = useDeferredValue(eps);
  const dH = useDeferredValue(h);
  const p = useMemo(() => ({ f: (_t: number, y: number[]) => [-y[0] + B * Math.sin(y[1]), 1 / dEps + C * Math.sin(2 * y[1])], y0: [1, 2 * Math.PI], T: T_END }), [dEps]);
  const ref = useMemo(() => {
    const s = solve("dopri", p, { rtol: 1e-9, atol: 1e-11, maxSteps: 200000 });
    return { t: s.t, a: comp(s, 0), phi: comp(s, 1) };
  }, [p]);
  const cam = useMemo(() => {
    const n = Math.floor(T_END / dH);
    let app = 0;
    for (let k = 0; k < n; k++) app += wrap(sampleAt(ref.t, ref.phi, (k + 1) * dH) - sampleAt(ref.t, ref.phi, k * dH));
    const rk = solve("rk4", p, { h: dH });
    let err = 0;
    rk.t.forEach((tt, k) => (err = Math.max(err, Math.abs(rk.y[k][0] - sampleAt(ref.t, ref.a, tt)))));
    return { apparent: app / (n * dH) / (2 * Math.PI), err };
  }, [ref, p, dH]);
  const trueRate = (ref.phi[ref.phi.length - 1] - ref.phi[0]) / T_END / (2 * Math.PI);
  const perTurn = 1 / (trueRate * dH);

  const pb = usePlayback(T_END / SPEED);
  const tau = pb.progress * T_END;
  const at = (x: number) => ({ phi: sampleAt(ref.t, ref.phi, x), a: sampleAt(ref.t, ref.a, x) });
  const blur = Array.from({ length: 6 }, (_, k) => ({ ...at(Math.max(0, tau - k * 0.004)), o: 1 - k * 0.15 }));
  const n = Math.floor(tau / dH + 1e-9);
  const shots = [3, 2, 1, 0].filter((k) => n - k >= 0).map((k) => ({ ...at((n - k) * dH), o: k ? 0.18 + (3 - k) * 0.12 : 1 }));
  const dir = Math.abs(cam.apparent) < 0.05 * Math.abs(trueRate) ? "майже стоїть" : cam.apparent > 0 ? "крутиться вперед" : "крутиться НАЗАД";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Chips
          label="Повільність фази ε"
          value={eps}
          onChange={setEps}
          options={[
            { value: 0.05, label: "ε = 0.05" },
            { value: 0.01, label: "ε = 0.01" },
          ]}
        />
        <Slider label="Крок камери h (як крок методу)" value={h} onChange={setH} min={0.005} max={0.4} log />
      </div>
      <svg viewBox="0 0 560 210" className="w-full rounded-xl border border-white/8 bg-black/20">
        <Fan cx={140} arms={blur} title="насправді" sub={`${fmt(trueRate, 3)} об. за одиницю τ`} />
        <Fan cx={420} arms={shots} title={`камера: кадр раз на h = ${fmt(dH, 3)}`} sub={`бачить ${fmt(cam.apparent, 3)} об./τ — ${dir}`} />
      </svg>
      <PlaybackBar pb={pb} label={`τ = ${fmt(tau, 3)}`} />
      <div className="grid grid-cols-1 gap-2 text-[12.5px] sm:grid-cols-2">
        <div className={`rounded-lg px-2.5 py-1.5 ${perTurn < 2 ? "bg-[#ff5d73]/10" : "bg-white/[0.04]"}`}>
          кадрів на один оберт: <span className="font-mono text-white">{fmt(perTurn, 3)}</span>
          {perTurn < 2 ? " — менше двох: напрям обертання не розгледіти" : ""}
        </div>
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          RK4 з таким кроком: похибка амплітуди a на [0, 3] = <span className="font-mono text-white">{fmt(cam.err, 2)}</span>
        </div>
      </div>
      <div className="text-[12.5px] leading-snug text-white/55">
        Лопать — це фазор задачі: кут φ(τ), довжина — амплітуда a(τ), що повільно «всихає». Ліворуч — як є (сповільнено), праворуч — лише те, що бачить
        камера раз на h. Метод з кроком h так само бачить sin φ лише в окремі миті: поки кадрів на оберт багато, він «усереднює» правильно; коли їх
        лишається два-три — похибка різко зростає.
      </div>
    </div>
  );
}
