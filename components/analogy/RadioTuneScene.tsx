"use client";

import { useEffect, useRef, useState } from "react";
import { Chips, Slider } from "@/components/ui/controls";
import { fmt } from "@/lib/format";

// the circuit of the task: L = 25 H, C = 10 nF ⇒ ω₀ = 2 rad/ms; ε₀ = 10 V ⇒ e₀ = 0.4 μC/ms²
const L = 25,
  W0 = 2,
  E0 = 0.4;
const W_MIN = 0.2,
  W_MAX = 20;

/** current amplitude (mA) of the steady forced oscillation: ω·e₀/√((ω₀² − ω²)² + 4γ²ω²) */
const current = (w: number, g: number) => (w * E0) / Math.sqrt((W0 * W0 - w * w) ** 2 + 4 * g * g * w * w);

/** An old radio: turn the knob (generator frequency ω) — the needle shows the current amplitude from the frequency response. */
export default function RadioTuneScene() {
  const [w, setW] = useState(1);
  const [R, setR] = useState(1e5);
  const [sound, setSound] = useState(false);
  const audio = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);

  const g = R / (2 * L) / 1000;
  const iMax = E0 / (2 * g);
  const i = current(w, g);
  const level = i / iMax;
  const hz = (w / (2 * Math.PI)) * 1000;
  const latest = useRef({ hz, level });
  latest.current = { hz, level };

  useEffect(() => {
    if (!sound) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = latest.current.hz;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    void ctx.resume();
    audio.current = { ctx, osc, gain };
    return () => {
      audio.current = null;
      try {
        osc.stop();
      } catch {}
      void ctx.close();
    };
  }, [sound]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const now = a.ctx.currentTime;
    a.osc.frequency.setTargetAtTime(hz, now, 0.03);
    a.gain.gain.setTargetAtTime(0.12 * level, now, 0.05);
  }, [hz, level, sound]);

  const pos = (x: number) => (Math.log10(x / W_MIN) / Math.log10(W_MAX / W_MIN)) * 260 + 20;
  const curve = Array.from({ length: 121 }, (_, k) => {
    const x = W_MIN * Math.pow(W_MAX / W_MIN, k / 120);
    return `${pos(x).toFixed(1)},${(64 - 52 * (current(x, g) / iMax)).toFixed(1)}`;
  }).join(" ");
  const ang = -70 + 140 * level;

  return (
    <div className="space-y-3">
      <svg viewBox="0 0 300 200" className="w-full">
        <rect x={6} y={6} width={288} height={188} rx={18} fill="#3a2a1f" stroke="#ffffff22" />
        <rect x={16} y={14} width={268} height={70} rx={8} fill="#f3e2b833" />
        <polyline points={curve} fill="none" stroke="#ffe66d88" strokeWidth={1.5} />
        {[0.5, 1, 2, 5, 10].map((x) => (
          <g key={x}>
            <line x1={pos(x)} x2={pos(x)} y1={70} y2={78} stroke="#ffffff66" />
            <text x={pos(x)} y={82} textAnchor="middle" fontSize={7} fill="#ffffffaa">
              {fmt((x / (2 * Math.PI)) * 1000, 3)} Гц
            </text>
          </g>
        ))}
        <text x={pos(W0)} y={24} textAnchor="middle" fontSize={8} fill="#ffe66d">
          📡 ω₀
        </text>
        <line x1={pos(w)} x2={pos(w)} y1={14} y2={84} stroke="#ff5d73" strokeWidth={2} />
        <g transform="translate(90,150)">
          <path d="M-46 0 A46 46 0 0 1 46 0" fill="none" stroke="#ffffff33" strokeWidth={6} />
          <line x1={0} y1={0} x2={0} y2={-40} stroke={level > 0.7 ? "#3ee6a8" : "#ffe66d"} strokeWidth={3} strokeLinecap="round" transform={`rotate(${ang.toFixed(2)})`} />
          <circle r={4} fill="#fff" />
          <text y={22} textAnchor="middle" fontSize={9} fill="#ffffffaa">
            гучність = струм
          </text>
        </g>
        <g transform="translate(220,145)">
          {[0, 1, 2, 3, 4].map((k) => (
            <circle key={k} r={8 + k * 7} fill="none" stroke="#ffffff" opacity={sound ? 0.06 + 0.12 * level : 0.05} />
          ))}
          <circle r={9} fill="#00000066" stroke="#ffffff44" />
        </g>
      </svg>
      <Slider label="Ручка налаштування ω, рад/мс" value={w} onChange={setW} min={W_MIN} max={W_MAX} log format={(v) => `${fmt(v, 3)} (${fmt((v / (2 * Math.PI)) * 1000, 3)} Гц)`} />
      <div className="flex flex-wrap items-center gap-3">
        <Chips
          label=""
          value={R}
          onChange={setR}
          options={[
            { value: 1e5, label: "R = 100 кОм (умова)" },
            { value: 1e4, label: "10 кОм" },
            { value: 1e3, label: "1 кОм" },
          ]}
        />
        <button
          onClick={() => setSound((s) => !s)}
          className="rounded-full border border-white/15 px-3 py-1 text-[12.5px] text-white/80 hover:bg-white/10"
        >
          {sound ? "🔇 Вимкнути звук" : "🔊 Увімкнути звук"}
        </button>
      </div>
      <div className="rounded-xl bg-white/[0.04] px-3 py-2 font-mono text-[12.5px] text-white/70">
        струм {fmt(i, 3)} мА з {fmt(iMax, 3)} можливих ({fmt(level * 100, 3)} %) · добротність Q = ω₀/2γ = {fmt(W0 / (2 * g), 3)}
      </div>
      <div className="text-[12.5px] leading-snug text-white/55">
        Коло задачі (L = 25 Гн, C = 10 нФ) «налаштоване» на ω₀ = 2 рад/мс ≈ 318 Гц. Шкала — справжня АЧХ струму. З опором з умови пік широкий і пологий: коло
        критично загальмоване й «ловить усе підряд». Зменште R — і налаштування стане гострим, як у справжнього приймача.
      </div>
    </div>
  );
}
