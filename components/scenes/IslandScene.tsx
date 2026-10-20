"use client";

import { useMemo } from "react";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { sampleAt } from "@/lib/ode";

function rnd(i: number, k: number) {
  const s = Math.sin(i * 91.3 + k * 47.9) * 24634.6345;
  return s - Math.floor(s);
}

const MAXN = 16;

/** Island with prey (u) and predators (v); the predator trait θ evolves slowly. Data: t, ln u, ln v, θ. */
export default function IslandScene({ t: ts, lnU, lnV, theta, marks }: { t: number[]; lnU: number[]; lnV: number[]; theta: number[]; marks: { at: number; label: string }[] }) {
  const pb = usePlayback(18);
  const T = ts[ts.length - 1];
  const t = pb.progress * T;
  const lu = sampleAt(ts, lnU, t),
    lv = sampleAt(ts, lnV, t),
    th = sampleAt(ts, theta, t);
  const u = Math.exp(lu),
    v = Math.exp(lv);
  const nU = Math.min(MAXN, Math.round((u / 2) * MAXN));
  const nV = Math.min(MAXN, Math.round(Math.min(v, 20) * 0.8));
  const thMax = useMemo(() => Math.max(1.3, ...theta) * 1.05, [theta]);
  const hop = (i: number) => Math.abs(Math.sin(pb.progress * 90 + i * 1.7)) * 4;

  const pos = (i: number, k: number) => {
    const a = rnd(i, k) * Math.PI * 2,
      r = Math.sqrt(rnd(i, k + 11)) * 0.82;
    return { x: 210 + Math.cos(a) * r * 165, y: 128 + Math.sin(a) * r * 62 };
  };
  const badge = (l: number) => (l < Math.log(1e-3) ? `10^${(l / Math.LN10).toFixed(0)}` : fmt(Math.exp(l), 3));
  const lastMark = marks.filter((m) => m.at <= t).pop();

  return (
    <div className="space-y-3">
      <svg viewBox="0 0 420 270" className="w-full">
        <defs>
          <radialGradient id="isl-sea" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#0f3b5c" />
            <stop offset="100%" stopColor="#081a2b" />
          </radialGradient>
          <radialGradient id="isl-land" cx="45%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#6fcf7a" />
            <stop offset="70%" stopColor="#3a9b55" />
            <stop offset="100%" stopColor="#c9b77a" />
          </radialGradient>
        </defs>
        <rect width={420} height={270} rx={18} fill="url(#isl-sea)" />
        {[0, 1, 2].map((k) => (
          <ellipse key={k} cx={210} cy={130} rx={196 - k * 4 + 3 * Math.sin(pb.progress * 40 + k)} ry={86 - k * 2} fill="none" stroke="rgba(255,255,255,0.08)" />
        ))}
        <ellipse cx={210} cy={130} rx={188} ry={80} fill="url(#isl-land)" />
        {Array.from({ length: 7 }, (_, i) => {
          const p = pos(i, 99);
          return (
            <text key={`tr${i}`} x={p.x} y={p.y} fontSize={18} textAnchor="middle" opacity={0.75}>
              🌳
            </text>
          );
        })}
        {Array.from({ length: nU }, (_, i) => {
          const p = pos(i, 1);
          return (
            <text key={`u${i}`} x={p.x} y={p.y - hop(i)} fontSize={17} textAnchor="middle">
              🐇
            </text>
          );
        })}
        {nU === 0 && (
          <text x={150} y={132} fontSize={20} textAnchor="middle" opacity={0.25}>
            🐇
          </text>
        )}
        {Array.from({ length: nV }, (_, i) => {
          const p = pos(i, 5);
          return (
            <text key={`v${i}`} x={p.x} y={p.y - hop(i + 40) * 0.5} fontSize={19} textAnchor="middle">
              🦊
            </text>
          );
        })}
        {nV === 0 && (
          <text x={270} y={132} fontSize={20} textAnchor="middle" opacity={0.25}>
            🦊
          </text>
        )}
        <g transform="translate(20 226)">
          <text x={0} y={-6} fill="rgba(255,255,255,0.65)" fontSize={11}>
            ознака хижака θ = {th.toFixed(3)}
          </text>
          <rect x={0} y={0} width={380} height={10} rx={5} fill="rgba(255,255,255,0.1)" />
          <rect x={0} y={0} width={Math.max(4, (th / thMax) * 380)} height={10} rx={5} fill="#7cf29c" />
          {[
            { v: 1 / 7, l: "1/7" },
            { v: 5 / 7, l: "5/7" },
            { v: 8 / 7, l: "8/7" },
          ].map((m) => (
            <g key={m.l}>
              <line x1={(m.v / thMax) * 380} x2={(m.v / thMax) * 380} y1={-2} y2={14} stroke="white" strokeOpacity={0.6} />
              <text x={(m.v / thMax) * 380} y={26} fill="rgba(255,255,255,0.5)" fontSize={9} textAnchor="middle">
                {m.l}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <div className="grid grid-cols-2 gap-2 text-center text-[12px] sm:grid-cols-4">
        <div className="rounded-xl bg-white/[0.04] p-2">
          <div className="text-white/45">🐇 жертви u</div>
          <div className="font-mono text-white">{badge(lu)}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-2">
          <div className="text-white/45">🦊 хижаки v</div>
          <div className="font-mono text-white">{badge(lv)}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-2">
          <div className="text-white/45">ознака θ</div>
          <div className="font-mono text-[var(--accent)]">{fmt(th, 4)}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-2">
          <div className="text-white/45">подія</div>
          <div className="text-white/85">{lastMark ? lastMark.label : "старт"}</div>
        </div>
      </div>
      <PlaybackBar pb={pb} label={`t = ${t.toFixed(1)}`} />
    </div>
  );
}
