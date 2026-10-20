"use client";

import { fmt } from "@/lib/format";

const X0 = 70,
  Y0 = 50,
  X1 = 510,
  Y1 = 270;
const PER = 2 * (X1 - X0 + Y1 - Y0);

/** Point on the rectangular loop at arc length s (clockwise from the top-left corner). */
function along(s: number): [number, number] {
  let r = ((s % PER) + PER) % PER;
  const w = X1 - X0,
    h = Y1 - Y0;
  if (r < w) return [X0 + r, Y0];
  r -= w;
  if (r < h) return [X1, Y0 + r];
  r -= h;
  if (r < w) return [X1 - r, Y1];
  r -= w;
  return [X0, Y1 - r];
}

/**
 * Послідовне RLC-коло (рис. 12.8): генератор ε(t), резистор, котушка, конденсатор.
 * Електрони зсуваються рівно на q(t) — бо заряд, що пройшов через переріз, і є q.
 */
export default function RLCScene({ q, i, qMax, iMax, emf, R }: { q: number; i: number; qMax: number; iMax: number; emf: number; R: number }) {
  const qn = Math.max(-1, Math.min(1, q / (qMax || 1)));
  const inr = Math.max(-1, Math.min(1, i / (iMax || 1)));
  const heat = inr * inr;
  const N = 34;
  const shift = (q / (qMax || 1)) * 120;
  const plus = qn >= 0;
  return (
    <svg viewBox="0 0 580 320" className="w-full">
      <defs>
        <radialGradient id="rlc-heat">
          <stop offset="0%" stopColor="#ff8c42" stopOpacity={0.15 + 0.7 * heat} />
          <stop offset="100%" stopColor="#ff8c42" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} fill="none" stroke="rgba(200,215,255,0.35)" strokeWidth="4" rx="6" />

      <g transform={`translate(200,${Y0})`}>
        <ellipse cx="40" cy="0" rx="70" ry="38" fill="url(#rlc-heat)" />
        <rect x="-6" y="-14" width="92" height="28" fill="#0d1022" />
        <path d="M-6,0 L4,-12 L16,12 L28,-12 L40,12 L52,-12 L64,12 L76,-12 L86,0" stroke={`rgb(255,${Math.round(220 - 120 * heat)},${Math.round(200 - 160 * heat)})`} strokeWidth="3" fill="none" strokeLinejoin="round" />
        <text x="40" y="-22" textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.75)">
          R = {fmt(R, 3)} Ом
        </text>
      </g>

      <g transform={`translate(${X1},110)`}>
        {[0, 1, 2].map((k) => (
          <ellipse key={k} cx="0" cy="50" rx={26 + k * 16} ry={58 + k * 14} fill="none" stroke="#5cc8ff" strokeOpacity={Math.abs(inr) * (0.5 - k * 0.14)} strokeDasharray="5 6" />
        ))}
        <rect x="-14" y="-4" width="28" height="108" fill="#0d1022" />
        {Array.from({ length: 6 }, (_, k) => (
          <path key={k} d={`M0,${k * 17} C22,${k * 17} 22,${k * 17 + 17} 0,${k * 17 + 17}`} stroke="#5cc8ff" strokeWidth="3" fill="none" />
        ))}
        <text x="26" y="-10" fontSize="13" fill="rgba(255,255,255,0.75)">
          L
        </text>
      </g>

      <g transform={`translate(290,${Y1})`}>
        <rect x="-14" y="-40" width="28" height="80" fill="#0d1022" />
        {Array.from({ length: 5 }, (_, k) => (
          <line key={k} x1={-8} x2={8} y1={-20 + k * 10} y2={-20 + k * 10} stroke="#ffe66d" strokeOpacity={Math.abs(qn) * 0.7} strokeWidth="1.5" />
        ))}
        <rect x="-38" y="-36" width="76" height="6" rx="2" fill={plus ? "#ff5d73" : "#5c7cff"} opacity={0.35 + 0.65 * Math.abs(qn)} style={{ filter: `drop-shadow(0 0 ${10 * Math.abs(qn)}px ${plus ? "#ff5d73" : "#5c7cff"})` }} />
        <rect x="-38" y="30" width="76" height="6" rx="2" fill={plus ? "#5c7cff" : "#ff5d73"} opacity={0.35 + 0.65 * Math.abs(qn)} style={{ filter: `drop-shadow(0 0 ${10 * Math.abs(qn)}px ${plus ? "#5c7cff" : "#ff5d73"})` }} />
        <text x="-50" y="-26" textAnchor="end" fontSize="16" fill={plus ? "#ff5d73" : "#5c7cff"}>
          {plus ? "+" : "−"}
        </text>
        <text x="-50" y="42" textAnchor="end" fontSize="16" fill={plus ? "#5c7cff" : "#ff5d73"}>
          {plus ? "−" : "+"}
        </text>
        <text x="52" y="6" fontSize="13" fill="rgba(255,255,255,0.75)">
          C · q = {fmt(q, 3)} мкКл
        </text>
      </g>

      <g transform={`translate(${X0},160)`}>
        <circle r="32" fill="#0d1022" stroke="#c38bff" strokeWidth="3" />
        <path d="M-18,0 C-12,-14 -6,-14 0,0 C6,14 12,14 18,0" stroke="#c38bff" strokeWidth="3" fill="none" />
        <text x="-40" y="5" textAnchor="end" fontSize="13" fill="rgba(255,255,255,0.75)">
          ε(t)
        </text>
        <rect x="40" y="-24" width="8" height="48" rx="3" fill="rgba(255,255,255,0.07)" />
        <rect x="40" y={emf > 0 ? -24 * emf : 0} width="8" height={24 * Math.abs(emf)} rx="3" fill="#c38bff" />
      </g>

      {Array.from({ length: N }, (_, k) => {
        const [x, y] = along((k / N) * PER + shift);
        return <circle key={k} cx={x} cy={y} r="4" fill="#7cf29c" opacity={0.55 + 0.45 * Math.abs(inr)} style={{ filter: `drop-shadow(0 0 ${2 + 6 * Math.abs(inr)}px #7cf29c)` }} />;
      })}
      <g transform="translate(290,160)">
        <text textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.7)" fontFamily="var(--font-jetbrains)">
          i = q′ = {fmt(i, 3)} мА
        </text>
        <text y="22" textAnchor="middle" fontSize="22" fill="#7cf29c" opacity={0.3 + 0.7 * Math.abs(inr)}>
          {Math.abs(inr) < 0.02 ? "·" : i > 0 ? "⟳" : "⟲"}
        </text>
      </g>
    </svg>
  );
}
