"use client";

import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/controls";
import { fmt } from "@/lib/format";
import { solve } from "@/lib/ode";

const EPS = 0.05;
/** model time per real second: the a = 6 cycle (T ≈ 12.75) lasts ≈ 0.8 s, i.e. ≈ 75 beats per minute */
const SPEED = 16;
const WIN = 3;
const HEART = "M100 172 C 40 128, 8 92, 22 56 C 34 24, 78 18, 100 50 C 122 18, 166 24, 178 56 C 192 92, 160 128, 100 172 Z";

type Sim = { t: number; y: number[]; h: number; clock: number; beats: number[]; ecg: { s: number; e: number }[]; zap: number };

/** A live Zeeman heart: x(t) is integrated in real time (Rosenbrock), the monitor shows −ε·ẋ = x³ − ax + b. */
export default function HeartbeatScene() {
  const [a, setA] = useState(6);
  const aRef = useRef(a);
  aRef.current = a;
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(true);
  const sim = useRef<Sim>({ t: 0, y: [1, 0.05], h: 0, clock: 0, beats: [], ecg: [], zap: -10 });
  const [, setTick] = useState(0);

  useEffect(() => {
    const el = box.current;
    const io = el ? new IntersectionObserver(([e]) => (visible.current = e.isIntersecting)) : null;
    if (el && io) io.observe(el);
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const s = sim.current;
      if (dt > 0 && visible.current) {
        const A = aRef.current;
        const f = (_t: number, y: number[]) => [-(y[0] * y[0] * y[0] - A * y[0] + y[1]) / EPS, y[0] - 1];
        const sol = solve("ros", { f, y0: s.y, t0: s.t, T: s.t + SPEED * dt }, { rtol: 1e-6, atol: 1e-9, hInit: s.h || undefined, maxSteps: 4000 });
        for (let i = 1; i < sol.t.length; i++) {
          const [x, b] = sol.y[i];
          const sec = s.clock + (sol.t[i] - s.t) / SPEED;
          if (sol.y[i - 1][0] > 0 && x <= 0) s.beats.push(sec);
          s.ecg.push({ s: sec, e: x * x * x - A * x + b });
        }
        s.clock += dt;
        s.t = sol.t[sol.t.length - 1];
        s.y = sol.y[sol.y.length - 1];
        if (sol.hs.length) s.h = sol.hs[sol.hs.length - 1];
        while (s.ecg.length > 2 && s.ecg[0].s < s.clock - WIN) s.ecg.shift();
        while (s.beats.length > 6) s.beats.shift();
        setTick((k) => (k + 1) % 1e6);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);

  const s = sim.current;
  const [x, b] = s.y;
  const recent = s.beats.filter((v) => v > s.clock - 4);
  const gaps = recent.slice(1).map((v, i) => v - recent[i]);
  const bpm = gaps.length ? 60 / (gaps.reduce((p, v) => p + v, 0) / gaps.length) : 0;
  const rel = Math.max(0, Math.min(1, (x + 3) / 6));
  const scale = 0.76 + 0.24 * rel;
  const zap = s.clock - s.zap < 0.35;
  const regime = a <= 0 ? "складок немає — стрибків не буде" : a < 3 ? "спокій: серце стоїть, але поштовх викличе один удар" : "водій ритму працює — серце б'ється саме";
  const pts = s.ecg.map((p) => `${(300 * (p.s - (s.clock - WIN))) / WIN},${40 - 4.2 * Math.max(-9, Math.min(9, p.e))}`).join(" ");

  return (
    <div ref={box} className="space-y-3">
      <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
        <div className={`relative grid place-items-center rounded-2xl p-2 ${zap ? "bg-[#5cc8ff]/25" : "bg-gradient-to-b from-[#2a0d16] to-[#12060a]"}`}>
          <svg viewBox="0 0 200 190" className="h-[130px] w-[130px]">
            <g transform={`translate(100 95) scale(${scale}) translate(-100 -95)`}>
              <path d={HEART} fill="#ff3b5c" stroke="#ffd0d8" strokeOpacity={0.4} strokeWidth={2} />
              <path d="M84 30 C 84 14, 92 6, 104 4" stroke="#ff6b84" strokeWidth={8} strokeLinecap="round" fill="none" />
              <path d="M70 60 C 80 80, 78 110, 96 140" stroke="#ffd0d8" strokeOpacity={0.3} strokeWidth={3} fill="none" />
            </g>
          </svg>
          <div className="absolute bottom-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-white/80">{x < 0 ? "скорочення" : "розслаблення"}</div>
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl">💓</span>
            <span className="font-mono text-3xl text-[#ff7a8f]">{bpm > 0 ? Math.round(bpm) : "—"}</span>
            <span className="text-[12px] text-white/50">уд/хв</span>
          </div>
          <svg viewBox="0 0 300 80" className="w-full rounded-lg bg-black/40">
            <line x1={0} x2={300} y1={40} y2={40} stroke="#3ee6a822" />
            <polyline points={pts} fill="none" stroke="#3ee6a8" strokeWidth={1.8} />
          </svg>
          <div className="font-mono text-[11.5px] text-white/50">
            x = {fmt(x, 3)} · b = {fmt(b, 3)}
          </div>
        </div>
      </div>
      <Slider label="Збудливість серця a" value={a} onChange={setA} min={-1} max={8} step={0.1} hint={regime} />
      <button
        onClick={() => {
          sim.current.y = [sim.current.y[0] - 2.5, sim.current.y[1]];
          sim.current.h = 0;
          sim.current.zap = sim.current.clock;
        }}
        className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-black shadow-[0_0_18px_-6px_var(--accent)]"
      >
        ⚡ Дефібрилятор (x −= 2.5)
      </button>
      <div className="text-[12.5px] leading-snug text-white/55">
        Серце рахується наживо з ε = 0.05; одна одиниця часу моделі ≈ 1/16 с, тож при a = 6 період 12.75 дає ≈ 75 ударів за хвилину (при a = 8 — ≈ 61,
        при a = 3.2 — ≈ 98). Опустіть a нижче 3 — серце зупиниться; тоді «дефібрилятор» викличе рівно один удар.
      </div>
    </div>
  );
}
