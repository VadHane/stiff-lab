"use client";

import { useMemo, useState } from "react";
import { Chips } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { linear2Exact, solve } from "@/lib/ode";

const EX = linear2Exact(
  [
    [-1001, 1],
    [1, -1],
  ],
  [1000, 0],
  [0, 0],
);
const F = (_t: number, y: number[]) => [-1001 * y[0] + y[1] + 1000, y[0] - y[1]];
const T_END = 5;
const K = 9; // time warp: the first milliseconds play slowly

const warp = (p: number) => (T_END * (Math.exp(K * p) - 1)) / (Math.exp(K) - 1);

function Meter({ value, label, color, broken }: { value: number; label: string; color: string; broken?: boolean }) {
  const v = Math.max(-0.4, Math.min(1.4, value));
  const ang = -60 + ((v + 0.4) / 1.8) * 120;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 80" className="w-full max-w-[160px]">
        <path d="M14 70 A 50 50 0 0 1 106 70" fill="none" stroke="#ffffff22" strokeWidth={8} strokeLinecap="round" />
        {[0, 0.5, 1].map((m) => {
          const a = ((-60 + ((m + 0.4) / 1.8) * 120) * Math.PI) / 180;
          return (
            <g key={m}>
              <line x1={60 + 44 * Math.sin(a)} y1={70 - 44 * Math.cos(a)} x2={60 + 52 * Math.sin(a)} y2={70 - 52 * Math.cos(a)} stroke="#ffffff66" strokeWidth={2} />
              <text x={60 + 34 * Math.sin(a)} y={74 - 34 * Math.cos(a)} fontSize={8} fill="#ffffff88" textAnchor="middle">
                {m}
              </text>
            </g>
          );
        })}
        <g style={{ transform: `rotate(${broken ? (Date.now() % 400 < 200 ? -62 : 62) : ang}deg)`, transformOrigin: "60px 70px", transition: broken ? "none" : "transform 0.12s" }}>
          <line x1={60} y1={70} x2={60} y2={24} stroke={color} strokeWidth={3} strokeLinecap="round" />
        </g>
        <circle cx={60} cy={70} r={4} fill="#fff" />
      </svg>
      <div className="text-center text-[12px] text-white/65">{label}</div>
      <div className="font-mono text-[13px]" style={{ color }}>
        {broken ? "💥 зашкалює" : fmt(value, 4)}
      </div>
    </div>
  );
}

/** Switching on a laptop charger: a spark in milliseconds, then a slow settle — and a meter that "polls" every h. */
export default function ChargerScene() {
  const [h, setH] = useState(0.0025);
  const pb = usePlayback(10, false);
  const t = warp(pb.progress);
  const exact = EX.at(t);
  const euler = useMemo(() => solve("euler", { f: F, y0: [0, 0], T: T_END }, { h, blowup: 1e6 }), [h]);
  const i = Math.min(euler.t.length - 1, Math.floor(t / h + 1e-9));
  const shown = euler.y[i]?.[0] ?? NaN;
  const broken = !Number.isFinite(shown) || Math.abs(shown) > 3;
  const spark = Math.max(0, 1 - t / 0.004);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            pb.setProgress(0);
            pb.setPlaying(true);
          }}
          className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-black shadow-[0_0_18px_-6px_var(--accent)]"
        >
          🔌 Увімкнути
        </button>
        <Chips
          label=""
          value={h}
          onChange={setH}
          options={[
            { value: 0.0005, label: "раз на 0.5 мс" },
            { value: 0.0019, label: "раз на 1.9 мс" },
            { value: 0.0025, label: "раз на 2.5 мс" },
            { value: 0.02, label: "раз на 20 мс" },
          ]}
        />
      </div>
      <div className="relative grid grid-cols-3 items-end gap-2">
        <div className="flex flex-col items-center">
          <svg viewBox="0 0 80 80" className="w-full max-w-[110px]">
            <rect x={18} y={20} width={44} height={44} rx={8} fill="#ffffff10" stroke="#ffffff44" />
            <circle cx={32} cy={42} r={4} fill="#0008" />
            <circle cx={48} cy={42} r={4} fill="#0008" />
            {spark > 0.02 && (
              <g opacity={spark}>
                <path d="M40 10 L34 26 L42 26 L36 40" stroke="#ffe66d" strokeWidth={3} fill="none" />
                <circle cx={40} cy={30} r={18 * spark} fill="#ffe66d33" />
              </g>
            )}
            <circle cx={40} cy={74} r={4} fill={`rgba(255,216,77,${0.15 + 0.85 * Math.min(1, Math.max(0, exact[1]))})`} />
          </svg>
          <div className="text-center text-[12px] text-white/65">розетка й лампочка-індикатор (u₂)</div>
        </div>
        <Meter value={exact[0]} label="справжній струм u₁" color="#ffffff" />
        <Meter value={shown} label={`прилад «явний Ейлер», опитує раз на ${fmt(h * 1000, 3)} мс`} color={broken ? "#ff5d73" : "#ffd84d"} broken={broken} />
      </div>
      <PlaybackBar pb={pb} label={`t = ${t < 0.1 ? `${fmt(t * 1000, 3)} мс` : `${fmt(t, 3)} с`}`} />
      <div className="text-[12.5px] leading-snug text-white/55">
        Перші мілісекунди програються сповільнено. Прилад, що опитує частіше ніж раз на ~2 мс, показує правду. Якщо рідше — стрілка починає бити по
        упорах, хоча в справжньому колі все давно заспокоїлось.
      </div>
    </div>
  );
}
