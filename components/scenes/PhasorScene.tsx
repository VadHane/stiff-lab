"use client";

import { indexAt } from "@/lib/ode";

interface Props {
  t: number[];
  a: number[];
  phi: number[];
  time: number;
  omegaOverEps: number;
  c: number;
}

const W = 600;
const H = 300;
const CX = 150;
const CY = 150;
const R = 88;

export default function PhasorScene({ t, a, phi, time, omegaOverEps, c }: Props) {
  const i = indexAt(t, time);
  const ac = a[i] ?? 0;
  const pc = phi[i] ?? 0;
  const tipX = CX + R * ac * Math.cos(pc);
  const tipY = CY - R * ac * Math.sin(pc);
  let trail = "";
  for (let k = i; k >= 0; k--) {
    if (Math.abs(phi[i] - phi[k]) > 4.5 || i - k > 400) break;
    const x = CX + R * a[k] * Math.cos(phi[k]);
    const y = CY - R * a[k] * Math.sin(phi[k]);
    trail += `${trail ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  const avg = Math.exp(-time);
  const span = 1.2;
  const t0 = Math.max(0, time - span);
  const j0 = indexAt(t, t0);
  const stride = Math.max(1, Math.floor((i - j0) / 400));
  let wave = "";
  for (let k = j0; k <= i; k += stride) {
    const x = 330 + ((t[k] - t0) / span) * 230;
    const y = 110 - 60 * Math.sin(phi[k]);
    wave += `${wave ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  let aw = "";
  for (let k = j0; k <= i; k += stride) {
    const x = 330 + ((t[k] - t0) / span) * 230;
    const y = 240 - 40 * a[k];
    aw += `${aw ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  const locked = Math.abs(omegaOverEps) < c;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 340 }}>
      <defs>
        <radialGradient id="phs-bg">
          <stop offset="0%" stopColor="#9ad0ff" stopOpacity={0.12} />
          <stop offset="100%" stopColor="#9ad0ff" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r={R * 1.6} fill="url(#phs-bg)" />
      {[0.5, 1, 1.5].map((r) => (
        <circle key={r} cx={CX} cy={CY} r={R * r} fill="none" stroke="#9ad0ff" strokeOpacity={0.12} />
      ))}
      <line x1={CX - R * 1.6} x2={CX + R * 1.6} y1={CY} y2={CY} stroke="#9ad0ff" strokeOpacity={0.15} />
      <line x1={CX} x2={CX} y1={CY - R * 1.6} y2={CY + R * 1.6} stroke="#9ad0ff" strokeOpacity={0.15} />
      <circle cx={CX} cy={CY} r={R * avg} fill="none" stroke="#ffe66d" strokeDasharray="5 4" strokeOpacity={0.8} />
      <path d={trail} fill="none" stroke="#9ad0ff" strokeOpacity={0.45} strokeWidth={2} />
      <line x1={CX} y1={CY} x2={tipX} y2={tipY} stroke="#ffffff" strokeWidth={3} strokeLinecap="round" />
      <circle cx={tipX} cy={tipY} r={6} fill="#9ad0ff" stroke="#fff" />
      <line x1={tipX} y1={tipY} x2={330 + 230} y2={110 - 60 * Math.sin(pc)} stroke="#9ad0ff" strokeOpacity={0.15} strokeDasharray="2 4" />
      <text x={CX} y={H - 8} textAnchor="middle" fontSize={11} fill="#cfd6ff" opacity={0.7}>
        фазор a·e^(iφ); жовте коло — усереднення e^(−τ)
      </text>

      <rect x={322} y={40} width={246} height={140} rx={10} fill="#0b0d22" fillOpacity={0.6} stroke="#9ad0ff" strokeOpacity={0.2} />
      <line x1={330} x2={560} y1={110} y2={110} stroke="#cfd6ff" strokeOpacity={0.12} />
      <path d={wave} fill="none" stroke="#9ad0ff" strokeWidth={1.3} />
      <text x={330} y={56} fontSize={10.5} fill="#9ad0ff">
        sin φ (останні {span} од. τ)
      </text>
      <rect x={322} y={196} width={246} height={84} rx={10} fill="#0b0d22" fillOpacity={0.6} stroke="#9ad0ff" strokeOpacity={0.2} />
      <line x1={330} x2={560} y1={240} y2={240} stroke="#cfd6ff" strokeOpacity={0.12} />
      <line x1={330} x2={560} y1={240 - 40 * avg} y2={240 - 40 * avg} stroke="#ffe66d" strokeDasharray="4 4" strokeOpacity={0.7} />
      <path d={aw} fill="none" stroke="#ffffff" strokeWidth={1.6} />
      <text x={330} y={210} fontSize={10.5} fill="#cfd6ff">
        a(τ) = {ac.toFixed(3)}
      </text>

      <g fontFamily="var(--font-mono), monospace" fontSize={11}>
        <text x={W - 10} y={22} textAnchor="end" fill="#cfd6ff">
          τ = {time.toFixed(2)} · ω/ε = {omegaOverEps.toFixed(1)}
        </text>
        <text x={10} y={22} fill={locked ? "#ff7ad9" : "#7cf29c"}>
          {locked ? "🔒 захоплення фази: |ω/ε| < c" : "↻ фаза обертається"}
        </text>
      </g>
    </svg>
  );
}
