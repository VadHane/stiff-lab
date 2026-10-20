"use client";

import { useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/controls";
import { usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { comp, sampleAt, solve } from "@/lib/ode";

const EPS = 0.08,
  AA = 0.7,
  BB = 0.8;
// resting state for I = 0: V³ + 0.75V + 2.625 = 0
const V_REST = (() => {
  const q = 2.625,
    p = 0.75;
  const s = Math.sqrt((q * q) / 4 + (p * p * p) / 27);
  return Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s);
})();
const W_REST = (V_REST + AA) / BB;
const T_END = 50;

const f = (_t: number, y: number[]) => [y[0] - (y[0] * y[0] * y[0]) / 3 - y[1], EPS * (y[0] + AA - BB * y[1])];
const poke = (dv: number) => solve("dopri", { f, y0: [V_REST + dv, W_REST], T: T_END }, { rtol: 1e-7, atol: 1e-9 });
const peak = (dv: number) => Math.max(...comp(poke(dv), 0));

/** A neuron at rest (FitzHugh–Nagumo, I = 0) poked by a finger with strength ΔV: below the threshold — nothing, above — a full spike. */
export default function NeuronPokeScene() {
  const [dv, setDv] = useState(0.4);
  const [poked, setPoked] = useState(false);
  const pb = usePlayback(5, false);
  const { progress, playing, setPlaying, setProgress } = pb;

  const thr = useMemo(() => {
    let lo = 0,
      hi = 1.5;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (peak(mid) > 0.5) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }, []);
  const sol = useMemo(() => {
    const s = poke(dv);
    const V = comp(s, 0);
    return { t: s.t, V, vmax: Math.max(...V) };
  }, [dv]);

  useEffect(() => {
    if (playing && progress > 0.985) {
      setPlaying(false);
      setProgress(0.999);
    }
  }, [playing, progress, setPlaying, setProgress]);

  const t = poked ? progress * T_END : 0;
  const V = poked ? sampleAt(sol.t, sol.V, t) : V_REST;
  const spike = sol.vmax > 0.5;
  const hot = Math.max(0, Math.min(1, (V + 1.2) / 3));
  const soma = `rgb(${Math.round(70 + 185 * hot)},${Math.round(110 + 20 * hot)},${Math.round(230 - 60 * hot)})`;
  const press = poked && t < 1.5 ? Math.min(1, dv / 1.5) : 0;
  const tUp = sol.t[sol.V.findIndex((v) => v > 1)] ?? NaN;
  const pulse = poked && spike && t > tUp ? (t - tUp) / 6 : -1;

  const W = 300,
    H = 90,
    vLo = -2.2,
    vHi = 2.2;
  const px = (tt: number) => (tt / T_END) * W;
  const py = (v: number) => H - ((v - vLo) / (vHi - vLo)) * H;
  const pts = poked
    ? sol.t
        .map((tt, i) => [tt, sol.V[i]] as const)
        .filter(([tt]) => tt <= t)
        .map(([tt, v]) => `${px(tt).toFixed(1)},${py(v).toFixed(1)}`)
        .join(" ")
    : "";

  return (
    <div className="space-y-3">
      <svg viewBox="0 0 300 120" className="w-full">
        <g transform={`translate(${8 + 30 * press},44)`}>
          <text fontSize={30}>👉</text>
        </g>
        <path d="M58 60 C70 55 80 58 92 60 M62 44 C76 48 84 52 94 56 M62 78 C76 72 84 68 94 64" stroke="#ffffff55" strokeWidth={2} fill="none" />
        {hot > 0.45 && <circle cx={115} cy={60} r={34 + 20 * hot} fill={soma} opacity={0.18} />}
        <circle cx={115} cy={60} r={24} fill={soma} stroke="#ffffffaa" strokeWidth={1.5} />
        <line x1={139} y1={60} x2={292} y2={60} stroke="#ffffff44" strokeWidth={5} strokeLinecap="round" />
        {pulse >= 0 && pulse <= 1 && <circle cx={139 + 153 * pulse} cy={60} r={7} fill="#ffe66d" style={{ filter: "drop-shadow(0 0 6px #ffe66d)" }} />}
        {V > 1 && (
          <text x={115} y={22} textAnchor="middle" fontSize={16}>
            ⚡
          </text>
        )}
        <text x={115} y={108} textAnchor="middle" fontSize={11} fill="#ffffffaa" fontFamily="var(--font-mono), monospace">
          V = {fmt(V, 3)}
        </text>
      </svg>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-black/20">
        <line x1={0} x2={W} y1={py(V_REST + thr)} y2={py(V_REST + thr)} stroke="#ffb547" strokeDasharray="4 4" strokeWidth={1} />
        <text x={W - 4} y={py(V_REST + thr) - 4} textAnchor="end" fontSize={9} fill="#ffb547">
          поріг
        </text>
        <line x1={0} x2={W} y1={py(V_REST)} y2={py(V_REST)} stroke="#5cc8ff66" strokeDasharray="2 4" strokeWidth={1} />
        <text x={W - 4} y={py(V_REST) + 11} textAnchor="end" fontSize={9} fill="#5cc8ffaa">
          спокій
        </text>
        {pts && <polyline points={pts} fill="none" stroke="#ff7ad9" strokeWidth={1.8} />}
      </svg>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
        <Slider label="Сила натискання ΔV" value={dv} onChange={(v) => {
            setDv(v);
            setPoked(false);
          }} min={0.05} max={1.5} step={0.05} hint={`поріг ≈ ${fmt(thr, 3)}`} />
        <button
          onClick={() => {
            setPoked(true);
            setProgress(0);
            setPlaying(true);
          }}
          className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-black shadow-[0_0_18px_-6px_var(--accent)]"
        >
          👉 Тицьнути
        </button>
      </div>
      {poked && progress > 0.6 && (
        <div className={`rounded-xl px-3 py-2 text-[13px] ${spike ? "bg-[#ff7ad9]/10 text-[#ffc6ef]" : "bg-[#5cc8ff]/10 text-[#bfe9ff]"}`}>
          {spike ? (
            <>⚡ Клац! Повний спайк: V злетіло до {fmt(sol.vmax, 3)}. Тисни сильніше — спайк майже той самий.</>
          ) : (
            <>😴 Тиша: V піднялося лише до {fmt(sol.vmax, 3)} і сповзло назад. Пружина повернула вимикач.</>
          )}
        </div>
      )}
      <div className="text-[12.5px] leading-snug text-white/55">
        Нейрон у спокої (рівняння ФіцХью–Нагумо, I = 0). Палець миттєво зсуває потенціал на ΔV, далі все робить сама модель: нижче порогу ≈ {fmt(thr, 2)} —
        тиша, вище — повний спайк, і його висота майже не залежить від сили натискання.
      </div>
    </div>
  );
}
