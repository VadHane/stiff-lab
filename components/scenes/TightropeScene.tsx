"use client";

import { fmt } from "@/lib/format";

const W = 820;
const H = 330;
const ROPE = 100;
const X0 = 70;
const X1 = W - 70;

/**
 * «Канатоходець на межі стійкості»: нахил жердини = похибка e_n на n-му кроці.
 * |R| < 1 — заспокоюється, |R| = 1 — вічно гойдається, |R| > 1 — падає.
 */
export default function TightropeScene({
  errs,
  n,
  color,
  label,
  R,
  scale = 8,
  failAt,
}: {
  errs: number[];
  n: number;
  color: string;
  label: string;
  R: number;
  scale?: number;
  /** step index where the solution blew up (undefined — never) */
  failAt?: number;
}) {
  const N = Math.max(errs.length - 1, 1);
  const k = Math.min(n, errs.length - 1);
  const e = errs[k] ?? 0;
  const fallen = (failAt !== undefined && n >= failAt) || !Number.isFinite(e) || Math.abs(e) > 4 * scale;
  const tilt = fallen ? (e >= 0 ? 1 : -1) * 120 : 55 * Math.tanh(e / scale);
  const x = X0 + 150 + ((X1 - X0 - 190) * k) / N;
  const sag = 16 * Math.sin((Math.PI * (x - X0)) / (X1 - X0));
  const footY = ROPE + sag;
  const fallY = fallen ? 62 : 0;

  // oscilloscope
  const OX = 40,
    OY = 262,
    OW = W - 80,
    OH = 48;
  const bw = OW / (N + 1);
  const amp = (v: number) => Math.sign(v) * Math.min(1, Math.log10(1 + Math.abs(v)) / Math.log10(1 + 4 * scale));

  const mood = fallen ? "😱" : Math.abs(e) > scale * 0.5 ? "😬" : Math.abs(e) > scale * 0.08 ? "🙂" : "😎";
  const verdict = R > 1.0005 ? "|R| > 1: розгойдування росте — падіння неминуче" : R > 0.9995 ? "|R| = 1: вічне балансування на межі" : "|R| < 1: коливання згасають";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none">
      <defs>
        <linearGradient id="trSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d1240" />
          <stop offset="1" stopColor="#0a0d1c" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} rx="16" fill="url(#trSky)" />
      {[...Array(24)].map((_, i) => (
        <circle key={i} cx={(i * 137) % W} cy={(i * 53) % 90 + 8} r={i % 3 === 0 ? 1.4 : 0.8} fill="#fff" opacity="0.4" />
      ))}
      <rect x={X0 - 8} y={ROPE - 6} width="8" height="104" fill="#6b5b95" />
      <rect x={X1} y={ROPE - 6} width="8" height="104" fill="#6b5b95" />
      <path d={`M${X0},${ROPE} Q${W / 2},${ROPE + 32} ${X1},${ROPE}`} stroke="#e8d9b0" strokeWidth="2.5" fill="none" />
      <path d={`M${X0 + 20},${ROPE + 70} Q${W / 2},${ROPE + 92} ${X1 - 20},${ROPE + 70}`} stroke="#ffffff30" strokeWidth="1" fill="none" strokeDasharray="3 4" />
      <text x={W / 2} y={ROPE + 100} textAnchor="middle" fontSize="10" fill="#ffffff50">
        страхувальна сітка
      </text>

      <g transform={`translate(${x},${footY + fallY}) rotate(${tilt})`} style={{ transition: "transform 0.12s linear" }}>
        <line x1="0" y1="0" x2="-7" y2="-28" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <line x1="0" y1="0" x2="7" y2="-28" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <line x1="0" y1="-28" x2="0" y2="-62" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="-62" y1="-50" x2="62" y2="-50" stroke={color} strokeWidth="4" strokeLinecap="round" />
        <circle cx="-62" cy="-50" r="5" fill={color} />
        <circle cx="62" cy="-50" r="5" fill={color} />
        <line x1="0" y1="-56" x2="-30" y2="-50" stroke="#fff" strokeWidth="2.5" />
        <line x1="0" y1="-56" x2="30" y2="-50" stroke="#fff" strokeWidth="2.5" />
        <text x="0" y="-66" textAnchor="middle" fontSize="22">
          {mood}
        </text>
      </g>

      <text x="24" y="28" fontSize="14" fill={color} fontWeight="700">
        {label}
      </text>
      <text x="24" y="48" fontSize="12" fill="#ffffffa0" fontFamily="var(--font-mono), monospace">
        крок n = {k} · похибка eₙ = {fmt(e, 3)}
      </text>
      <text x={W - 24} y="28" textAnchor="end" fontSize="13" fill={R > 1.0005 ? "#ff5d73" : R > 0.9995 ? "#ffb547" : "#3ee6a8"} fontWeight="600">
        {verdict}
      </text>
      <text x={W - 24} y="48" textAnchor="end" fontSize="12" fill="#ffffffa0" fontFamily="var(--font-mono), monospace">
        |R(hλ₂)| = {fmt(R, 4)}
      </text>

      <rect x={OX} y={OY - OH / 2 - 6} width={OW} height={OH + 12} rx="8" fill="#000" opacity="0.35" />
      <line x1={OX} x2={OX + OW} y1={OY} y2={OY} stroke="#3ee6a850" />
      {errs.slice(0, k + 1).map((v, i) => {
        const a = Number.isFinite(v) ? amp(v) : 1;
        return (
          <rect
            key={i}
            x={OX + i * bw}
            y={a >= 0 ? OY - a * (OH / 2) : OY}
            width={Math.max(bw - 0.6, 0.8)}
            height={Math.max(Math.abs(a) * (OH / 2), 0.5)}
            fill={Math.abs(a) > 0.95 ? "#ff5d73" : color}
            opacity={i === k ? 1 : 0.65}
          />
        );
      })}
      <text x={OX + 6} y={OY + OH / 2 + 20} fontSize="10.5" fill="#ffffff70">
        осцилограф похибки eₙ (лог-амплітуда, знак збережено)
      </text>
    </svg>
  );
}
