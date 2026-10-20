"use client";

import { fmt } from "@/lib/format";

const X_COL = [255, 159, 67];
const Y_COL = [92, 124, 255];

function mix(a: number[], b: number[], w: number) {
  const k = Math.min(1, Math.max(0, w));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
}

function rnd(i: number) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * «Хімічний годинник»: колба з розчином, колір якої — частка X (u₁) і Y (u₂),
 * молекули-кульки, кількість яких ∝ концентраціям, і циферблат фази навколо рівноваги.
 */
export default function ChemClockScene({
  t,
  u1,
  u2,
  u1Max,
  u2Max,
  eq,
  dot1,
}: {
  t: number;
  u1: number;
  u2: number;
  u1Max: number;
  u2Max: number;
  eq: [number, number];
  dot1: number;
}) {
  const n1 = Math.max(0, u1 / (u1Max || 1));
  const n2 = Math.max(0, u2 / (u2Max || 1));
  const share = n2 / (n1 + n2 + 1e-12);
  const liquid = mix(X_COL, Y_COL, share);
  const ang = Math.atan2((u2 - eq[1]) / (u2Max || 1), (u1 - eq[0]) / (u1Max || 1));
  const rad = Math.min(1, Math.hypot((u1 - eq[0]) / (u1Max || 1), (u2 - eq[1]) / (u2Max || 1)) * 2.2);
  const NX = Math.round(36 * Math.min(1, n1));
  const NY = Math.round(36 * Math.min(1, n2));
  const flash = Math.min(1, Math.abs(dot1) / (u1Max || 1) / 2);
  const molecules = [
    ...Array.from({ length: NX }, (_, i) => ({ i, c: "#ffb347", r: 3.6 })),
    ...Array.from({ length: NY }, (_, i) => ({ i: i + 100, c: "#7f9bff", r: 3 })),
  ];
  return (
    <svg viewBox="0 0 560 300" className="w-full">
      <defs>
        <radialGradient id="cc-glow" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor={liquid} stopOpacity={0.55 + 0.4 * flash} />
          <stop offset="100%" stopColor={liquid} stopOpacity="0" />
        </radialGradient>
        <clipPath id="cc-flask">
          <path d="M120,40 L120,120 L52,250 Q46,268 66,270 L234,270 Q254,268 248,250 L180,120 L180,40 Z" />
        </clipPath>
      </defs>
      <ellipse cx="150" cy="200" rx="150" ry="110" fill="url(#cc-glow)" />
      <g clipPath="url(#cc-flask)">
        <rect x="0" y="110" width="300" height="170" fill={liquid} opacity="0.85" />
        <path
          d={`M0,${112 + 4 * Math.sin(t * 3)} Q75,${104 + 6 * Math.sin(t * 2.3)} 150,112 T300,${110 + 4 * Math.cos(t * 2)} L300,130 L0,130 Z`}
          fill="white"
          opacity="0.12"
        />
        {molecules.map(({ i, c, r }) => {
          const bx = 60 + rnd(i) * 180;
          const by = 140 + rnd(i + 0.5) * 120;
          const x = bx + 7 * Math.sin(t * (1.3 + rnd(i + 2)) + i);
          const y = by + 6 * Math.cos(t * (1.1 + rnd(i + 3)) + 2 * i);
          return <circle key={i} cx={x} cy={y} r={r} fill={c} stroke="white" strokeOpacity="0.5" strokeWidth="0.6" />;
        })}
        {Array.from({ length: 7 }, (_, k) => {
          const sp = 18 + 14 * rnd(k + 40);
          const yy = 265 - (((t * sp + k * 37) % 150) + 150) % 150;
          return <circle key={`b${k}`} cx={80 + rnd(k + 50) * 140} cy={yy} r={2 + 2 * rnd(k + 60)} fill="white" opacity="0.25" />;
        })}
      </g>
      <path
        d="M120,40 L120,120 L52,250 Q46,268 66,270 L234,270 Q254,268 248,250 L180,120 L180,40"
        fill="none"
        stroke="rgba(220,230,255,0.75)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <rect x="112" y="30" width="76" height="12" rx="5" fill="rgba(220,230,255,0.25)" stroke="rgba(220,230,255,0.6)" />
      <text x="150" y="292" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.6)">
        <tspan fill="#ffb347">● X</tspan> ×{NX} <tspan dx="10" fill="#7f9bff">● Y</tspan> ×{NY}
      </text>

      <g transform="translate(420,120)">
        <circle r="92" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
        {Array.from({ length: 12 }, (_, k) => {
          const a = (k / 12) * Math.PI * 2;
          return <line key={k} x1={80 * Math.cos(a)} y1={80 * Math.sin(a)} x2={88 * Math.cos(a)} y2={88 * Math.sin(a)} stroke="rgba(255,255,255,0.4)" strokeWidth="2" />;
        })}
        <circle r={86 * rad} fill="none" stroke="var(--accent)" strokeOpacity="0.35" strokeDasharray="3 4" />
        <line x1="0" y1="0" x2={80 * rad * Math.cos(-ang)} y2={80 * rad * Math.sin(-ang)} stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
        <circle r="6" fill="var(--accent)" />
        <text y="-100" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.55)">
          фаза навколо рівноваги
        </text>
        <text y="118" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.75)" fontFamily="var(--font-jetbrains)">
          u₁={fmt(u1, 3)} · u₂={fmt(u2, 3)}
        </text>
      </g>
      <g transform="translate(290,40)">
        <rect x="0" y="0" width="16" height="200" rx="4" fill="rgba(255,255,255,0.05)" />
        <rect x="0" y={200 - 200 * Math.min(1, n1)} width="16" height={200 * Math.min(1, n1)} rx="4" fill="#ffb347" />
        <rect x="22" y="0" width="16" height="200" rx="4" fill="rgba(255,255,255,0.05)" />
        <rect x="22" y={200 - 200 * Math.min(1, n2)} width="16" height={200 * Math.min(1, n2)} rx="4" fill="#7f9bff" />
        <text x="8" y="216" textAnchor="middle" fontSize="11" fill="#ffb347">
          X
        </text>
        <text x="30" y="216" textAnchor="middle" fontSize="11" fill="#7f9bff">
          Y
        </text>
      </g>
    </svg>
  );
}
