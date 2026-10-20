"use client";

import { fmt, sup } from "@/lib/format";
import type { ThetaAttempt } from "@/lib/t13-theta";

const W = 820;
const H = 300;
const TRACK = 196;
const L = 50;
const R = W - 40;

const CREATURES = [
  { q: 0.2, icon: "🐜", name: "мураха" },
  { q: 0.4, icon: "🐇", name: "заєць" },
  { q: 0.6, icon: "🚶", name: "людина" },
  { q: 0.8, icon: "🦒", name: "жирафа" },
  { q: 1.01, icon: "🦕", name: "велетень" },
];

/** «Кроки велетня»: сліди адаптивного θ-методу, розмір сліду ∝ lg h; червоні хрестики — відхилені спроби. */
export default function GiantStepsScene({ attempts, k, tMin, T, logX, hLo, hHi }: { attempts: ThetaAttempt[]; k: number; tMin: number; T: number; logX: boolean; hLo: number; hHi: number }) {
  const X = (t: number) => {
    const v = logX ? (Math.log10(Math.max(t, tMin)) - Math.log10(tMin)) / (Math.log10(T) - Math.log10(tMin)) : t / T;
    return L + Math.min(1, Math.max(0, v)) * (R - L);
  };
  const lh = (h: number) => Math.min(1, Math.max(0, (Math.log10(h) - Math.log10(hLo)) / (Math.log10(hHi) - Math.log10(hLo) || 1)));
  const kk = Math.min(k, attempts.length - 1);
  const cur = attempts[kk];
  const acc: { x: number; q: number; i: number }[] = [];
  const rej: { x: number; i: number }[] = [];
  let nAcc = 0;
  for (let i = 0; i <= kk; i++) {
    const a = attempts[i];
    if (a.accepted) {
      nAcc++;
      acc.push({ x: X(a.t + a.h), q: lh(a.h), i: nAcc });
    } else rej.push({ x: X(a.t + a.h), i });
  }
  const stride = Math.max(1, Math.ceil(acc.length / 350));
  const accShown = acc.filter((_, i) => i % stride === 0 || i === acc.length - 1);
  const rejShown = rej.slice(-120);
  const pos = cur ? X(cur.accepted ? cur.t + cur.h : cur.t) : L;
  const q = cur ? lh(cur.h) : 0;
  const who = CREATURES.find((c) => q < c.q) ?? CREATURES[4];
  const ticks: number[] = [];
  if (logX) for (let e = Math.ceil(Math.log10(tMin)); e <= Math.floor(Math.log10(T)); e += Math.max(1, Math.ceil((Math.log10(T) - Math.log10(tMin)) / 9))) ticks.push(Math.pow(10, e));
  else for (let i = 0; i <= 5; i++) ticks.push((T * i) / 5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none">
      <defs>
        <linearGradient id="gsBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d2a33" />
          <stop offset="1" stopColor="#0a0f1d" />
        </linearGradient>
        <linearGradient id="gsRuler" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4dd0e1" stopOpacity="0.2" />
          <stop offset="1" stopColor="#4dd0e1" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} rx="16" fill="url(#gsBg)" />
      <rect x={L} y={TRACK - 26} width={R - L} height="52" rx="10" fill="#ffffff07" />
      {ticks.map((t) => (
        <g key={t} transform={`translate(${X(t)},${TRACK + 34})`}>
          <line y1="-8" y2="0" stroke="#ffffff50" />
          <text y="13" textAnchor="middle" fontSize="10" fill="#ffffff80">
            {logX ? `10${sup(String(Math.round(Math.log10(t))))}` : fmt(t, 3)}
          </text>
        </g>
      ))}
      <text x={R} y={TRACK + 62} textAnchor="end" fontSize="10.5" fill="#ffffff70">
        {logX ? "час t (логарифмічна шкала)" : "час t"}
      </text>
      {accShown.map((f) => {
        const s = 4 + 16 * f.q;
        const up = f.i % 2 === 0;
        return (
          <ellipse
            key={`a${f.i}`}
            cx={f.x}
            cy={TRACK + (up ? -9 : 9)}
            rx={s * 0.42}
            ry={s * 0.75 * 0.5 + 1}
            fill="#4dd0e1"
            opacity={0.35 + 0.5 * f.q}
            transform={`rotate(90 ${f.x} ${TRACK + (up ? -9 : 9)})`}
          />
        );
      })}
      {rejShown.map((r) => (
        <text key={`r${r.i}`} x={r.x} y={TRACK - 34} textAnchor="middle" fontSize="13" fill="#ff5d73">
          ✗
        </text>
      ))}
      <g transform={`translate(${pos},${TRACK - 46})`}>
        <text textAnchor="middle" fontSize={22 + 22 * q}>
          {who.icon}
        </text>
      </g>

      <g transform="translate(50,26)">
        <text fontSize="13" fill="#ffffffd0" fontWeight="600">
          спроба №{kk + 1}: t = {cur ? fmt(cur.t, 3) : "0"}, h = {cur ? fmt(cur.h, 3) : "—"}
        </text>
        <text y="20" fontSize="12" fill={cur && !cur.accepted ? "#ff5d73" : "#3ee6a8"} fontFamily="var(--font-mono), monospace">
          {cur
            ? `‖err‖/tol = ${Number.isFinite(cur.ratio) ? fmt(cur.ratio, 3) : "∞ (Ньютон не збігся)"} → ${cur.accepted ? "прийнято ✓" : "відхилено ✗"}, h × ${fmt(cur.fac, 3)}`
            : ""}
        </text>
      </g>
      <g transform={`translate(${W - 300},16)`}>
        <rect width="260" height="10" rx="5" fill="url(#gsRuler)" opacity="0.6" />
        <circle cx={260 * q} cy="5" r="7" fill="#fff" />
        <text x="0" y="26" fontSize="10" fill="#ffffff80">
          {fmt(hLo, 2)}
        </text>
        <text x="260" y="26" textAnchor="end" fontSize="10" fill="#ffffff80">
          {fmt(hHi, 2)}
        </text>
        <text x="130" y="44" textAnchor="middle" fontSize="12" fill="#ffffffd0">
          {who.icon} крок «{who.name}»
        </text>
      </g>
    </svg>
  );
}
