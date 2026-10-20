"use client";

import { fmt } from "@/lib/format";

const W = 820;
const H = 340;
const MID = 170;
const UNIT = 90;

/** Compressed vertical scale: linear up to |y| = 1.2, logarithmic above. */
const sh = (y: number) => {
  if (!Number.isFinite(y)) return Math.sign(y || 1) * 1.45;
  const a = Math.abs(y);
  const v = a <= 1.2 ? a : 1.2 + Math.min(0.25, 0.1 * Math.log10(a / 1.2));
  return Math.sign(y) * v;
};

/** «Вибухне чи ні?»: стовпчики y_n = R(hλ)^n з'являються один за одним; білі риски — точне e^{λ t_n}. */
export default function BlowupBarsScene({
  ys,
  exact,
  shown,
  color,
  title,
  verdict,
  reveal,
}: {
  ys: number[];
  exact: number[];
  shown: number;
  color: string;
  title: string;
  verdict?: { text: string; tone: "good" | "bad" | "warn" };
  reveal: boolean;
}) {
  const N = ys.length;
  const bw = (W - 80) / Math.max(N, 1);
  const k = Math.min(shown, N);
  const last = k > 0 ? ys[k - 1] : 1;
  const boom = k > 0 && Math.abs(last) > 1.2;
  const shake = boom ? Math.sin(shown * 12.3) * Math.min(6, Math.log10(Math.abs(last) + 1) * 2) : 0;
  const vc = verdict ? { good: "#3ee6a8", bad: "#ff5d73", warn: "#ffb547" }[verdict.tone] : "#fff";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none">
      <defs>
        <linearGradient id="bbBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a1030" />
          <stop offset="1" stopColor="#0b0d1d" />
        </linearGradient>
        <linearGradient id="bbBoom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5d73" />
          <stop offset="1" stopColor="#ffb547" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} rx="16" fill="url(#bbBg)" />
      <g transform={`translate(${shake},0)`}>
        <rect x="40" y={MID - 1.2 * UNIT} width={W - 80} height={2.4 * UNIT} fill="#3ee6a8" opacity="0.04" />
        {[1, -1].map((s) => (
          <g key={s}>
            <line x1="40" x2={W - 40} y1={MID - s * UNIT} y2={MID - s * UNIT} stroke="#ffffff30" strokeDasharray="4 5" />
            <text x="34" y={MID - s * UNIT + 4} textAnchor="end" fontSize="11" fill="#ffffff70">
              {s > 0 ? "+1" : "−1"}
            </text>
          </g>
        ))}
        <line x1="40" x2={W - 40} y1={MID} y2={MID} stroke="#ffffff55" />
        <text x="34" y={MID + 4} textAnchor="end" fontSize="11" fill="#ffffff70">
          0
        </text>
        <line x1="40" x2={W - 40} y1={MID - 1.2 * UNIT} y2={MID - 1.2 * UNIT} stroke="#ff5d73" strokeOpacity="0.4" />
        <line x1="40" x2={W - 40} y1={MID + 1.2 * UNIT} y2={MID + 1.2 * UNIT} stroke="#ff5d73" strokeOpacity="0.4" />
        {ys.slice(0, k).map((y, i) => {
          const v = sh(y);
          const x = 40 + i * bw;
          const out = Math.abs(y) > 1.2;
          return (
            <g key={i}>
              <rect
                x={x + bw * 0.15}
                y={v >= 0 ? MID - v * UNIT : MID}
                width={bw * 0.7}
                height={Math.max(1, Math.abs(v) * UNIT)}
                rx={Math.min(4, bw * 0.2)}
                fill={out ? "url(#bbBoom)" : color}
                opacity={i === k - 1 ? 1 : 0.75}
              />
              {out && i === k - 1 && (
                <text x={x + bw / 2} y={v >= 0 ? MID - v * UNIT - 8 : MID - v * UNIT + 20} textAnchor="middle" fontSize="18">
                  💥
                </text>
              )}
              <line x1={x + bw * 0.05} x2={x + bw * 0.95} y1={MID - sh(exact[i]) * UNIT} y2={MID - sh(exact[i]) * UNIT} stroke="#fff" strokeWidth="2" opacity="0.85" />
            </g>
          );
        })}
      </g>
      <text x="40" y="24" fontSize="13.5" fill={color} fontWeight="700">
        {title}
      </text>
      <text x={W - 40} y="24" textAnchor="end" fontSize="12" fill="#ffffffa0" fontFamily="var(--font-mono), monospace">
        n = {Math.max(0, k - 1)} · yₙ = {fmt(last, 3)}
      </text>
      {reveal && verdict && (
        <g>
          <rect x={W / 2 - 230} y={H - 34} width="460" height="28" rx="14" fill={vc} opacity="0.15" stroke={vc} />
          <text x={W / 2} y={H - 15} textAnchor="middle" fontSize="13.5" fill={vc} fontWeight="700">
            {verdict.text}
          </text>
        </g>
      )}
    </svg>
  );
}
