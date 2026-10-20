"use client";

import { indexAt } from "@/lib/ode";

interface Props {
  t: number[];
  u: number[];
  v: number[];
  time: number;
  mu: number;
  vMax: number;
}

const W = 600;
const H = 300;

export default function TubeOscillatorScene({ t, u, v, time, mu, vMax }: Props) {
  const i = indexAt(t, time);
  const uc = u[i] ?? 0;
  const vc = v[i] ?? 0;
  const pump = 1 - uc * uc;
  const power = mu * pump * vc * vc;
  const sx = (x: number) => 30 + 100 + (x / 2.6) * 95;
  const sy = (y: number) => 40 + 100 - (y / (vMax * 1.1 || 1)) * 85;
  const start = Math.max(0, i - 6000);
  const stride = Math.max(1, Math.floor((i - start) / 700));
  let trace = "";
  for (let k = start; k <= i; k += stride) trace += `${trace ? "L" : "M"}${sx(u[k]).toFixed(1)},${sy(v[k]).toFixed(1)}`;
  const glow = Math.min(1, Math.abs(pump) * 0.8 + 0.2);
  const tubeColor = pump > 0 ? "#ffb547" : "#5cc8ff";
  const cone = Math.max(-1, Math.min(1, uc / 2.2));
  const loud = Math.min(1, Math.abs(vc) / (vMax || 1));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 340 }}>
      <defs>
        <radialGradient id="tos-crt" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#0f3b22" />
          <stop offset="100%" stopColor="#03130a" />
        </radialGradient>
        <filter id="tos-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="tos-fil">
          <stop offset="0%" stopColor={tubeColor} stopOpacity={0.95} />
          <stop offset="100%" stopColor={tubeColor} stopOpacity={0} />
        </radialGradient>
        <linearGradient id="tos-cone" x1="0" x2="1">
          <stop offset="0%" stopColor="#3a3f63" />
          <stop offset="100%" stopColor="#1a1d33" />
        </linearGradient>
      </defs>

      <rect x={20} y={30} width={220} height={220} rx={22} fill="#1b1f38" stroke="#ffb547" strokeOpacity={0.25} />
      <rect x={30} y={40} width={200} height={200} rx={16} fill="url(#tos-crt)" />
      {[-2, -1, 0, 1, 2].map((g) => (
        <line key={`gx${g}`} x1={sx(g)} x2={sx(g)} y1={44} y2={236} stroke="#3ee6a8" strokeOpacity={g === 0 ? 0.25 : 0.08} />
      ))}
      <line x1={34} x2={226} y1={sy(0)} y2={sy(0)} stroke="#3ee6a8" strokeOpacity={0.25} />
      <rect x={sx(-1)} y={44} width={sx(1) - sx(-1)} height={192} fill="#ffb547" opacity={0.05} />
      <path d={trace} fill="none" stroke="#7cf29c" strokeWidth={1.4} strokeOpacity={0.85} filter="url(#tos-glow)" />
      <circle cx={sx(uc)} cy={sy(vc)} r={4} fill="#eaffef" filter="url(#tos-glow)" />
      <text x={36} y={232} fontSize={10} fill="#7cf29c" opacity={0.7} fontFamily="var(--font-mono), monospace">
        u
      </text>
      <text x={210} y={56} fontSize={10} fill="#7cf29c" opacity={0.7} fontFamily="var(--font-mono), monospace">
        u′
      </text>
      <text x={130} y={270} textAnchor="middle" fontSize={11} fill="#cfd6ff" opacity={0.7}>
        осцилограф: фазова площина
      </text>

      <g transform="translate(330 150)">
        <ellipse cx={0} cy={0} rx={70 * glow} ry={90 * glow} fill="url(#tos-fil)" opacity={0.35} />
        <path d="M-34,60 L-34,-40 Q-34,-88 0,-88 Q34,-88 34,-40 L34,60 Z" fill="#c9d6ff" fillOpacity={0.07} stroke="#c9d6ff" strokeOpacity={0.35} />
        <rect x={-38} y={60} width={76} height={22} rx={5} fill="#2a2e4d" />
        {[-22, -8, 8, 22].map((x) => (
          <line key={x} x1={x} x2={x} y1={82} y2={96} stroke="#8890b8" strokeWidth={2} />
        ))}
        <rect x={-20} y={-50} width={40} height={6} fill="#8890b8" opacity={0.7} />
        {[-30, -18, -6, 6, 18].map((y) => (
          <line key={y} x1={-22} x2={22} y1={y} y2={y} stroke="#8890b8" strokeOpacity={0.45} strokeDasharray="2 3" />
        ))}
        <path d="M-12,48 L-6,30 L0,48 L6,30 L12,48" fill="none" stroke={tubeColor} strokeWidth={2.5} opacity={0.4 + 0.6 * glow} filter="url(#tos-glow)" />
        <text x={0} y={120} textAnchor="middle" fontSize={11} fill={tubeColor}>
          {pump > 0 ? "|u| < 1: лампа підкачує енергію" : "|u| > 1: лампа гальмує"}
        </text>
        <text x={0} y={136} textAnchor="middle" fontSize={10.5} fill="#cfd6ff" opacity={0.6} fontFamily="var(--font-mono), monospace">
          dE/dt = μ(1−u²)u′² = {Math.abs(power) > 1e4 ? power.toExponential(1) : power.toFixed(2)}
        </text>
      </g>

      <g transform={`translate(${505 + cone * 10} 150)`}>
        <path d="M-30,-30 L0,-70 L0,70 L-30,30 Z" fill="url(#tos-cone)" stroke="#8890b8" strokeOpacity={0.5} />
        <rect x={-46} y={-30} width={16} height={60} rx={4} fill="#2a2e4d" stroke="#8890b8" strokeOpacity={0.4} />
        <ellipse cx={0} cy={0} rx={6 + 3 * Math.abs(cone)} ry={70} fill="none" stroke="#ffb547" strokeOpacity={0.6} />
        {[1, 2, 3].map((k) => (
          <path
            key={k}
            d={`M${14 + k * 16},-${22 + k * 12} Q${26 + k * 18},0 ${14 + k * 16},${22 + k * 12}`}
            fill="none"
            stroke="#ffb547"
            strokeWidth={2}
            strokeOpacity={Math.max(0, loud - 0.18 * (k - 1))}
          />
        ))}
      </g>
      <text x={505} y={270} textAnchor="middle" fontSize={11} fill="#cfd6ff" opacity={0.7}>
        динамік: зміщення ∝ u
      </text>

      <g fontFamily="var(--font-mono), monospace" fontSize={11}>
        <text x={W - 10} y={22} textAnchor="end" fill="#cfd6ff">
          t = {time.toFixed(2)} · u = {uc.toFixed(2)} · μ = {mu < 10 ? mu.toFixed(2) : mu.toFixed(0)}
        </text>
      </g>
    </svg>
  );
}
