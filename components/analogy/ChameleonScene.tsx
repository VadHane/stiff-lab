"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chips } from "@/components/ui/controls";
import { fmt } from "@/lib/format";
import { sampleAt, solve } from "@/lib/ode";

const S = 77.27,
  Q = 8.375e-6,
  W = 0.161;
const f = (_t: number, u: number[]) => [S * (u[1] + u[0] * (1 - Q * u[0] - u[1])), (u[2] - (1 + u[0]) * u[1]) / S, W * (u[0] - u[2])];
const jac = (_t: number, u: number[]) => [
  [S * (1 - 2 * Q * u[0] - u[1]), S * (1 - u[0]), 0],
  [-u[1] / S, -(1 + u[0]) / S, 1 / S],
  [W, 0, -W],
];
/** assumption of the analogy: one cycle of our flask lasts a minute (real BZ mixtures: from tens of seconds to minutes) */
const CYCLE_SEC = 60;
const LESSON = 90 * 60;
const RED: [number, number, number] = [214, 40, 72];
const BLUE: [number, number, number] = [58, 108, 255];
const mix = (c: number) => `rgb(${RED.map((v, i) => Math.round(v + (BLUE[i] - v) * Math.max(0, Math.min(1, c)))).join(",")})`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The BZ «chemical chameleon» in real time: the Oregonator solution mapped onto a 90-minute lecture. */
export default function ChameleonScene() {
  const data = useMemo(() => {
    const s = solve("ros", { f, jac, y0: [4, 1.1, 4], T: 720 }, { rtol: 1e-5, atol: 1e-8, maxSteps: 200000 });
    const lg = s.y.map((v) => Math.log10(Math.max(v[2], 1e-12)));
    let lo = Infinity,
      hi = -Infinity;
    for (const v of lg) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const at = (q: number, up: boolean, from = 0) => {
      const L = lo + q * (hi - lo);
      for (let k = 1; k < lg.length; k++)
        if (s.t[k] > from && (up ? lg[k - 1] < L && lg[k] >= L : lg[k - 1] >= L && lg[k] < L)) return s.t[k - 1] + ((L - lg[k - 1]) / (lg[k] - lg[k - 1])) * (s.t[k] - s.t[k - 1]);
      return NaN;
    };
    const up0 = at(0.5, true),
      down0 = at(0.5, false),
      up1 = at(0.5, true, down0);
    const P = up1 - up0;
    const unit = CYCLE_SEC / P;
    const flip = at(0.8, true, down0) - at(0.2, true, down0);
    const count = (tm: number) => (tm < up0 ? 0 : Math.floor((tm - up0) / P) + 1) + (tm < down0 ? 0 : Math.floor((tm - down0) / P) + 1);
    return { s, lg, lo, hi, up0, down0, up1, P, unit, flip, count, total: count(LESSON / unit) };
  }, []);

  const [speed, setSpeed] = useState(1);
  const [sec, setSec] = useState(0);
  const [run, setRun] = useState(true);
  const cfg = useRef({ speed, run });
  cfg.current = { speed, run };
  useEffect(() => {
    let raf = 0,
      last = 0;
    const frame = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (cfg.current.run && dt > 0) setSec((v) => Math.min(LESSON, v + dt * cfg.current.speed));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const tm = sec / data.unit;
  const tw = tm <= data.up1 ? tm : data.up1 + ((tm - data.up1) % data.P);
  const c = (sampleAt(data.s.t, data.lg, tw) - data.lo) / (data.hi - data.lo);
  const color = mix(c);
  const done = data.count(tm);
  const blueSec = (data.down0 - data.up0) * data.unit;
  const stripes = useMemo(() => {
    const out: number[][] = [];
    for (let k = 0; data.up0 + k * data.P < LESSON / data.unit; k++)
      out.push([(data.up0 + k * data.P) * data.unit, Math.min(LESSON, (data.down0 + k * data.P) * data.unit)]);
    return out;
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-3">
        <svg viewBox="0 0 120 150" className="h-[150px] w-[120px]">
          <clipPath id="cham-clip">
            <path d="M48 10 L48 56 L14 124 Q10 138 24 138 L96 138 Q110 138 106 124 L72 56 L72 10 Z" />
          </clipPath>
          <g clipPath="url(#cham-clip)">
            <rect x={0} y={62} width={120} height={90} fill={color} style={{ transition: speed > 1 ? "none" : "fill 60ms linear" }} />
            {[0, 1, 2, 3, 4].map((i) => (
              <circle key={i} cx={34 + i * 13} cy={132 - ((sec * (8 + i * 3) + i * 17) % 64)} r={2 + (i % 2)} fill="#fff" opacity={0.35} />
            ))}
          </g>
          <path d="M48 10 L48 56 L14 124 Q10 138 24 138 L96 138 Q110 138 106 124 L72 56 L72 10" fill="none" stroke="#ffffffaa" strokeWidth={2.5} />
        </svg>
        <div className="space-y-1.5 text-[13px] text-white/70">
          <div className="font-mono text-2xl text-white">
            ⏱ {clock(sec)} <span className="text-[13px] text-white/45">з 90:00</span>
          </div>
          <div>
            Змін кольору: <b className="text-white">{done}</b> з <b className="text-[var(--accent)]">{data.total}</b> за пару
          </div>
          <div className="text-[12px] text-white/55">
            Синя фаза ≈ {fmt(blueSec, 2)} с, червона ≈ {fmt(CYCLE_SEC - blueSec, 2)} с, а сам перекид у синій — ≈ {fmt(data.flip * data.unit, 2)} с.
          </div>
        </div>
      </div>
      <svg viewBox="0 0 900 26" className="w-full" preserveAspectRatio="none">
        <rect x={0} y={4} width={900} height={14} rx={3} fill={mix(0.1)} opacity={0.55} />
        {stripes.map(([a, b], i) => (
          <rect key={i} x={(a / LESSON) * 900} y={4} width={Math.max(1, ((b - a) / LESSON) * 900)} height={14} fill={mix(1)} />
        ))}
        <rect x={(sec / LESSON) * 900 - 1.5} y={0} width={3} height={22} fill="#fff" />
      </svg>
      <div className="flex flex-wrap items-center gap-2">
        <Chips
          value={speed}
          onChange={setSpeed}
          options={[
            { value: 1, label: "🐢 реальний час" },
            { value: 10, label: "⏩ ×10" },
            { value: 60, label: "🚀 ×60" },
          ]}
        />
        <button onClick={() => setRun((r) => !r)} className="rounded-full border border-white/15 px-3 py-1 text-[12.5px] text-white/75 hover:bg-white/10">
          {run ? "❚❚ пауза" : "▶ далі"}
        </button>
        <button
          onClick={() => {
            setSec(0);
            setRun(true);
          }}
          className="rounded-full border border-white/15 px-3 py-1 text-[12.5px] text-white/75 hover:bg-white/10"
        >
          ⟲ з початку пари
        </button>
      </div>
      <div className="text-[12px] leading-snug text-white/50">
        Колір — розв&apos;язок орегонатора (lg u₃, Ce(IV)), період моделі ≈ {fmt(data.P, 4)} од. часу. Умовно вважаємо, що в нашій колбі один цикл триває хвилину;
        тоді смужка — уся пара: {data.total} перемикань, і кожен перекид у синій займає лише {fmt((data.flip / data.P) * 100, 2)} % циклу.
      </div>
    </div>
  );
}
