"use client";

import { indexAt } from "@/lib/ode";

interface Props {
  t: number[];
  u: number[];
  v: number[];
  time: number;
  w: number;
  a: number;
  strobe: { t: number; u: number; v: number }[];
  vMax: number;
}

const W = 600;
const H = 300;

export default function StroboscopeScene({ t, u, v, time, w, a, strobe, vMax }: Props) {
  const i = indexAt(t, time);
  const uc = u[i] ?? 0;
  const vc = v[i] ?? 0;
  const phase = w * time;
  const Tp = (2 * Math.PI) / w;
  // flashes happen at the strobe instants t = θ₀/ω + nT (the same ones that produce the Poincaré points)
  const off = strobe.length ? strobe[0].t % Tp : 0;
  const sinceFlash = (((time - off) % Tp) + Tp) % Tp;
  const flash = time >= off ? Math.max(0, 1 - sinceFlash / (0.12 * Tp)) : 0;
  const crank = 18 + 10 * Math.min(1, a / 2);
  const wx = 90,
    wy = 150;
  const cx = wx + crank * Math.cos(phase - Math.PI / 2),
    cy = wy + crank * Math.sin(phase - Math.PI / 2);
  const railX0 = 200,
    railX1 = 440;
  const px = (railX0 + railX1) / 2 + (uc / 2.6) * ((railX1 - railX0) / 2);
  const force = a * Math.sin(phase);
  const shown = strobe.filter((s) => s.t <= time);
  const sx = (x: number) => 520 + (x / 2.6) * 62;
  const sy = (y: number) => 150 - (y / (vMax * 1.1 || 1)) * 95;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 340 }}>
      <defs>
        <radialGradient id="sts-flash">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#ff7ad9" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="sts-rail" x1="0" x2="1">
          <stop offset="0%" stopColor="#5cc8ff" stopOpacity={0.35} />
          <stop offset="50%" stopColor="#ffffff" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#5cc8ff" stopOpacity={0.35} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="#ff7ad9" opacity={flash * 0.08} />

      <circle cx={wx} cy={wy} r={48} fill="#14172e" stroke="#ff7ad9" strokeOpacity={0.4} />
      {Array.from({ length: 12 }, (_, k) => (
        <line
          key={k}
          x1={wx + 40 * Math.cos(phase + (k * Math.PI) / 6)}
          y1={wy + 40 * Math.sin(phase + (k * Math.PI) / 6)}
          x2={wx + 48 * Math.cos(phase + (k * Math.PI) / 6)}
          y2={wy + 48 * Math.sin(phase + (k * Math.PI) / 6)}
          stroke="#ff7ad9"
          strokeOpacity={0.35}
        />
      ))}
      <line x1={wx} y1={wy} x2={cx} y2={cy} stroke="#ff7ad9" strokeWidth={4} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill="#ff7ad9" />
      <circle cx={wx} cy={wy} r={4} fill="#fff" />
      <text x={wx} y={wy + 72} textAnchor="middle" fontSize={11} fill="#cfd6ff" opacity={0.7}>
        двигун: a·sin ωt
      </text>
      <text x={wx} y={wy + 86} textAnchor="middle" fontSize={10.5} fill="#ff7ad9" fontFamily="var(--font-mono), monospace">
        F = {force.toFixed(2)}
      </text>

      <line x1={railX0 - 10} x2={railX1 + 10} y1={150} y2={150} stroke="url(#sts-rail)" strokeWidth={10} strokeLinecap="round" />
      {[-2, -1, 0, 1, 2].map((g) => (
        <g key={g}>
          <line x1={(railX0 + railX1) / 2 + (g / 2.6) * 120} x2={(railX0 + railX1) / 2 + (g / 2.6) * 120} y1={160} y2={168} stroke="#cfd6ff" strokeOpacity={0.4} />
          <text x={(railX0 + railX1) / 2 + (g / 2.6) * 120} y={182} textAnchor="middle" fontSize={10} fill="#cfd6ff" opacity={0.5}>
            {g}
          </text>
        </g>
      ))}
      <rect x={(railX0 + railX1) / 2 - 120 / 2.6} y={128} width={240 / 2.6} height={44} fill="#ffb547" opacity={0.06} />
      <path
        d={`M${cx},${cy} C${(cx + px) / 2},${cy - 40} ${(cx + px) / 2},${150 + 40} ${px - 16},150`}
        fill="none"
        stroke="#ff7ad9"
        strokeOpacity={0.35}
        strokeDasharray="4 4"
      />
      <line x1={px} x2={px + Math.max(-60, Math.min(60, vc * 6))} y1={118} y2={118} stroke="#7cf29c" strokeWidth={2} />
      <circle cx={px + Math.max(-60, Math.min(60, vc * 6))} cy={118} r={2.5} fill="#7cf29c" />
      <rect x={px - 16} y={136} width={32} height={28} rx={7} fill="#2a2e4d" stroke="#ff7ad9" strokeOpacity={0.8} />
      <circle cx={px} cy={150} r={22 + 30 * flash} fill="url(#sts-flash)" opacity={flash} />
      <text x={(railX0 + railX1) / 2} y={98} textAnchor="middle" fontSize={11} fill="#cfd6ff" opacity={0.7}>
        осцилятор: позиція u, стрілка — швидкість u′
      </text>

      <rect x={455} y={50} width={130} height={200} rx={12} fill="#0b0d22" stroke="#ff7ad9" strokeOpacity={0.3} />
      <line x1={460} x2={580} y1={150} y2={150} stroke="#cfd6ff" strokeOpacity={0.12} />
      <line x1={520} x2={520} y1={55} y2={245} stroke="#cfd6ff" strokeOpacity={0.12} />
      {shown.map((s, k) => (
        <circle key={k} cx={sx(s.u)} cy={sy(s.v)} r={k === shown.length - 1 ? 3.4 : 1.8} fill={k === shown.length - 1 ? "#ffffff" : "#ff7ad9"} opacity={k === shown.length - 1 ? 1 : 0.75} />
      ))}
      <text x={520} y={268} textAnchor="middle" fontSize={11} fill="#cfd6ff" opacity={0.7}>
        стробоскоп: {shown.length} спалахів
      </text>
      <text x={W - 10} y={22} textAnchor="end" fontSize={11} fill="#cfd6ff" fontFamily="var(--font-mono), monospace">
        t = {time.toFixed(1)} · період сили {Tp.toFixed(2)}
      </text>
    </svg>
  );
}
