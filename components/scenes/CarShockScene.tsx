"use client";

import { fmt } from "@/lib/format";

export interface CarLane {
  label: string;
  color: string;
  u: number;
  /** vertical acceleration relative to the initial one (comfort) */
  acc: number;
  blown?: boolean;
}

const W = 820;
const LANE_H = 150;
const SPEED = 220;

function spring(x: number, y0: number, y1: number, coils = 6, w = 9) {
  const n = coils * 2;
  let d = `M${x},${y0} L${x},${y0 + 4}`;
  for (let i = 1; i < n; i++) {
    const y = y0 + 4 + ((y1 - y0 - 8) * i) / n;
    d += ` L${x + (i % 2 ? w : -w)},${y}`;
  }
  d += ` L${x},${y1 - 4} L${x},${y1}`;
  return d;
}

function face(acc: number, blown?: boolean) {
  if (blown) return "😱";
  if (acc < 0.08) return "😊";
  if (acc < 0.25) return "🙂";
  if (acc < 0.6) return "😬";
  return "🤢";
}

function Car({ lane, y0, t, scale }: { lane: CarLane; y0: number; t: number; scale: number }) {
  const ground = y0 + LANE_H - 22;
  const axleY = ground - 16;
  const rest = axleY - 64;
  const raw = Number.isFinite(lane.u) ? lane.u * scale : -1e4;
  const fly = lane.blown || Math.abs(raw) > 70;
  const off = fly ? -(LANE_H + 60) : -raw;
  const bodyY = rest + off;
  const cx = 300;
  const wheels = [cx - 70, cx + 70];
  const ang = ((t * SPEED) / 16) * (180 / Math.PI);
  const roadShift = -((t * SPEED) % 40);
  const bumpX = cx + 70 - t * SPEED;
  return (
    <g>
      <rect x="0" y={ground} width={W} height="22" fill="#2a2f45" />
      {[...Array(24)].map((_, i) => (
        <rect key={i} x={roadShift + i * 40} y={ground + 10} width="20" height="2.5" fill="#ffffff55" />
      ))}
      {bumpX > -60 && bumpX < W + 60 && <path d={`M${bumpX - 40},${ground} Q${bumpX},${ground - 26} ${bumpX + 40},${ground} Z`} fill="#3d4463" />}
      <text x="16" y={y0 + 22} fontSize="13" fill={lane.color} fontWeight="700">
        {lane.label}
      </text>
      <text x="16" y={y0 + 40} fontSize="11.5" fill="#ffffffa0" fontFamily="var(--font-mono), monospace">
        u = {fmt(lane.u, 3)} м
      </text>
      {wheels.map((wx) => (
        <g key={wx}>
          {!fly && (
            <>
              <path d={spring(wx - 14, Math.min(bodyY + 34, axleY - 6), axleY)} stroke={lane.color} strokeWidth="2.2" fill="none" />
              <rect x={wx + 8} y={Math.min(bodyY + 34, axleY - 30)} width="10" height="22" rx="2" fill="#9aa3c7" />
              <rect x={wx + 9} y={axleY - 30} width="8" height="30" rx="2" fill="#5d6588" />
            </>
          )}
          <g transform={`translate(${wx},${axleY}) rotate(${ang})`}>
            <circle r="16" fill="#151827" stroke="#9aa3c7" strokeWidth="3" />
            {[0, 60, 120].map((a) => (
              <line key={a} x1={-12 * Math.cos((a * Math.PI) / 180)} y1={-12 * Math.sin((a * Math.PI) / 180)} x2={12 * Math.cos((a * Math.PI) / 180)} y2={12 * Math.sin((a * Math.PI) / 180)} stroke="#9aa3c7" strokeWidth="1.5" />
            ))}
          </g>
        </g>
      ))}
      <g transform={`translate(0,${bodyY})`}>
        <path d={`M${cx - 110},34 L${cx - 110},14 Q${cx - 108},4 ${cx - 90},2 L${cx - 50},0 L${cx - 28},-26 Q${cx - 20},-32 ${cx},-32 L${cx + 40},-32 Q${cx + 58},-32 ${cx + 66},-20 L${cx + 78},0 L${cx + 104},4 Q${cx + 114},8 ${cx + 114},20 L${cx + 114},34 Z`} fill={lane.color} opacity="0.92" />
        <path d={`M${cx - 42},-2 L${cx - 24},-24 L${cx + 6},-24 L${cx + 6},-2 Z`} fill="#0b1020" opacity="0.75" />
        <path d={`M${cx + 14},-2 L${cx + 14},-24 L${cx + 38},-24 Q${cx + 50},-24 ${cx + 56},-14 L${cx + 64},-2 Z`} fill="#0b1020" opacity="0.75" />
        <text x={cx - 9} y="-6" textAnchor="middle" fontSize="17">
          {face(lane.acc, fly)}
        </text>
        <circle cx={cx + 108} cy="14" r="4" fill="#ffe66d" />
        {fly && (
          <text x={cx} y="70" textAnchor="middle" fontSize="26">
            🚀🔥
          </text>
        )}
      </g>
      {fly && (
        <text x={cx + 160} y={y0 + 70} fontSize="14" fill="#ff5d73" fontWeight="700">
          машину розгойдало до неба!
        </text>
      )}
    </g>
  );
}

/** «Машина на амортизаторі»: кузов коливається за u(t), лінія 1 — точний розв'язок, лінія 2 — числовий метод. */
export default function CarShockScene({ lanes, t, u0 }: { lanes: CarLane[]; t: number; u0: number }) {
  const scale = 38 / Math.max(Math.abs(u0), 1e-6);
  const Hh = LANE_H * lanes.length + 10;
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full select-none" style={{ overflow: "hidden" }}>
      <defs>
        <linearGradient id="csSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14254a" />
          <stop offset="1" stopColor="#0b0f1e" />
        </linearGradient>
        <clipPath id="csClip">
          <rect width={W} height={Hh} rx="16" />
        </clipPath>
      </defs>
      <g clipPath="url(#csClip)">
        <rect width={W} height={Hh} fill="url(#csSky)" />
        {lanes.map((l, i) => (
          <g key={l.label + i}>
            <clipPath id={`csLane${i}`}>
              <rect y={i * LANE_H} width={W} height={LANE_H} />
            </clipPath>
            <g clipPath={`url(#csLane${i})`}>
              <Car lane={l} y0={i * LANE_H} t={t} scale={scale} />
            </g>
          </g>
        ))}
        <text x={W - 16} y="20" textAnchor="end" fontSize="12" fill="#ffffffa0" fontFamily="var(--font-mono), monospace">
          t = {fmt(t, 3)} с
        </text>
      </g>
    </svg>
  );
}
