"use client";

import { fmt } from "@/lib/format";

export interface FeatherLane {
  label: string;
  color: string;
  u1: number;
  u2: number;
}

const W = 820;
const H = 300;
const TOP = 46;
const GROUND = 214;
const LO = -0.25;
const HI = 1.25;

function Feather({ color, tilt }: { color: string; tilt: number }) {
  return (
    <g transform={`rotate(${tilt})`}>
      <path d="M0,-26 C14,-18 16,6 2,26 C-10,8 -12,-14 0,-26 Z" fill={color} opacity="0.85" />
      <path d="M0,-24 L1,30" stroke="white" strokeWidth="1.4" opacity="0.8" />
      {[-14, -6, 2, 10].map((y) => (
        <g key={y} opacity="0.55">
          <path d={`M0.6,${y} L9,${y - 6}`} stroke="white" strokeWidth="0.8" />
          <path d={`M0.6,${y} L-8,${y - 6}`} stroke="white" strokeWidth="0.8" />
        </g>
      ))}
    </g>
  );
}

/** «Пір'їнка у примежовому шарі»: висота пір'їнки = u₁, світна кулька = u₂ (швидка мода). Час — логарифмічний. */
export default function FeatherScene({ lanes, t, eps, tMin, T, clock }: { lanes: FeatherLane[]; t: number; eps: number; tMin: number; T: number; clock: number }) {
  const n = lanes.length;
  const laneW = (W - 120) / Math.max(n, 1);
  const lx = (t1: number) => 60 + ((Math.log10(Math.max(t1, tMin)) - Math.log10(tMin)) / (Math.log10(T) - Math.log10(tMin))) * (W - 120);
  const inLayer = t < 5 * eps;
  const ticks = [eps, 5 * eps, 1, 10].filter((v, i, a) => v > tMin && v <= T && a.indexOf(v) === i);
  const scale = (GROUND - TOP) / (HI - LO);
  const Y = (u: number) => GROUND - (u - LO) * scale;
  const ground0 = Y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none">
      <defs>
        <linearGradient id="fsSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={inLayer ? "#2b1b4d" : "#0f2440"} />
          <stop offset="1" stopColor="#0a0f1f" />
        </linearGradient>
        <radialGradient id="fsOrb">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#7ce0ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} rx="16" fill="url(#fsSky)" />
      <rect x="0" y={Y(LO)} width={W} height={H - Y(LO) - 50} fill="#ffffff08" />
      <line x1="30" x2={W - 30} y1={ground0} y2={ground0} stroke="#ffffff40" strokeDasharray="4 5" />
      <text x="34" y={ground0 - 6} fontSize="11" fill="#ffffff70">u = 0</text>
      <line x1="30" x2={W - 30} y1={Y(1)} y2={Y(1)} stroke="#ffffff20" strokeDasharray="2 6" />
      <text x="34" y={Y(1) - 6} fontSize="11" fill="#ffffff70">u = 1</text>
      <text x={W - 30} y="26" textAnchor="end" fontSize="13" fill={inLayer ? "#ff9ff3" : "#7ce0ff"} fontWeight="600">
        {inLayer ? "🌪 примежовий шар: швидка мода ще жива" : "🍃 повільна стадія: лишилась тільки повільна мода eᵈᵗ"}
      </text>
      {lanes.map((l, i) => {
        const cx = 60 + laneW * (i + 0.5);
        const blown = !Number.isFinite(l.u1) || l.u1 > HI + 0.6 || l.u1 < LO - 0.6;
        const u1c = Math.min(HI + 0.12, Math.max(LO - 0.05, Number.isFinite(l.u1) ? l.u1 : HI));
        const u2c = Math.min(HI + 0.12, Math.max(LO - 0.05, Number.isFinite(l.u2) ? l.u2 : HI));
        const tilt = 18 * Math.sin(clock * 7 + i * 1.3) * Math.min(1, Math.abs(u1c) + 0.15);
        const sway = 10 * Math.sin(clock * 3.5 + i);
        return (
          <g key={l.label}>
            <line x1={cx} x2={cx} y1={TOP - 8} y2={Y(LO)} stroke={l.color} strokeOpacity="0.12" />
            <circle cx={cx - 26} cy={Y(u2c)} r="16" fill="url(#fsOrb)" opacity={0.25 + 0.75 * Math.min(1, Math.abs(u2c))} />
            <circle cx={cx - 26} cy={Y(u2c)} r="4" fill="#fff" />
            <g transform={`translate(${cx + 14 + sway * 0.3},${Y(u1c) - 4})`}>
              <Feather color={blown ? "#ff5d73" : l.color} tilt={tilt} />
            </g>
            <ellipse cx={cx + 14} cy={ground0 + 24} rx={10 + 12 * (1 - Math.min(1, Math.abs(u1c)))} ry="3" fill="#000" opacity="0.35" />
            {blown && (
              <text x={cx + 14} y={TOP} textAnchor="middle" fontSize="20">
                💥
              </text>
            )}
            <text x={cx} y={Y(LO) + 16} textAnchor="middle" fontSize="12" fill={l.color} fontWeight="600">
              {l.label}
            </text>
            <text x={cx} y={Y(LO) + 30} textAnchor="middle" fontSize="11" fill="#ffffffaa" fontFamily="var(--font-mono), monospace">
              u₁={fmt(l.u1, 3)} · u₂={fmt(l.u2, 3)}
            </text>
          </g>
        );
      })}
      <g transform={`translate(0,${H - 22})`}>
        <line x1="60" x2={W - 60} y1="0" y2="0" stroke="#ffffff40" />
        <rect x={lx(tMin)} y="-5" width={Math.max(0, lx(Math.min(5 * eps, T)) - lx(tMin))} height="10" rx="5" fill="#ff9ff3" opacity="0.25" />
        {ticks.map((v) => (
          <g key={v} transform={`translate(${lx(v)},0)`}>
            <line y1="-6" y2="6" stroke="#ffffff70" />
            <text y="17" textAnchor="middle" fontSize="10.5" fill="#ffffff90">
              {v === eps ? "ε" : v === 5 * eps ? "5ε" : fmt(v, 2)}
            </text>
          </g>
        ))}
        <circle cx={lx(t)} cy="0" r="6" fill="var(--accent)" />
        <text x="54" y="4" textAnchor="end" fontSize="10.5" fill="#ffffff70">
          lg t
        </text>
      </g>
    </svg>
  );
}
