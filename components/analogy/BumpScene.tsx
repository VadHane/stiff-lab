"use client";

import { useMemo, useState } from "react";
import { Chips } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";

const M = 1.25;
const K = 1500;
const T_END = 3;
const W = 600;
const CAR_X = 170;
const ROAD = 150;
const PX_S = 220; // пікселів дороги за секунду
const S = 260; // пікселів на одиницю зміщення кузова

type Profile = "pit" | "bump" | "cobble";
const KICKS: Record<Profile, { t: number; dv: number }[]> = {
  pit: [{ t: 0.3, dv: -2 }],
  bump: [{ t: 0.3, dv: 2 }],
  cobble: Array.from({ length: 20 }, (_, j) => ({ t: 0.3 + 0.09 * j, dv: j % 2 ? -0.5 : 0.5 })),
};
const SHOCKS = [
  { c: 10, label: "з умови, c = 10" },
  { c: 1, label: "убитий, c = 1" },
  { c: 40, label: "спортивний, c = 40" },
];

/** u(t) = Σ Δvⱼ·g(t − tⱼ): точна реакція m u'' + c u' + k u = 0 на поштовхи швидкості (g — імпульсна характеристика). */
function response(c: number, kicks: { t: number; dv: number }[]) {
  const a = c / (2 * M);
  const b = Math.sqrt(K / M - a * a);
  const g = (s: number) => (s <= 0 ? 0 : (Math.exp(-a * s) * Math.sin(b * s)) / b);
  return { u: (t: number) => kicks.reduce((acc, k) => acc + k.dv * g(t - k.t), 0), a, b };
}

function roadY(x: number, profile: Profile, t: number) {
  let y = ROAD;
  for (const k of KICKS[profile]) {
    const cx = CAR_X + (k.t - t) * PX_S;
    const d = x - cx;
    if (profile === "cobble") {
      if (Math.abs(d) < 9) y -= 4 * Math.cos((d / 9) * (Math.PI / 2));
    } else if (Math.abs(d) < 22) y += (profile === "pit" ? 14 : -14) * Math.cos((d / 22) * (Math.PI / 2)) ** 2;
  }
  return y;
}

export default function BumpScene() {
  const [profile, setProfile] = useState<Profile>("bump");
  const [c, setC] = useState(10);
  const pb = usePlayback(7, true);
  const t = pb.progress * T_END;
  const { u, a, b } = useMemo(() => response(c, KICKS[profile]), [c, profile]);
  const curve = useMemo(() => Array.from({ length: 301 }, (_, i) => u((T_END * i) / 300)), [u]);
  const uMax = Math.max(...curve.map(Math.abs));
  const now = u(t);
  const lift = Math.max(-20, Math.min(46, now * S));
  const hit = now * S > 46 || now * S < -20;
  const road = Array.from({ length: 61 }, (_, i) => (W * i) / 60);
  const sx = (i: number) => 20 + (i / 300) * (W - 40);
  const sy = (v: number) => 238 - (v / Math.max(uMax, 1e-9)) * 26;
  return (
    <div className="space-y-3">
      <Chips
        label="Що на дорозі"
        value={profile}
        onChange={(v) => {
          setProfile(v);
          pb.setProgress(0);
        }}
        options={[
          { value: "bump", label: "🛑 лежачий поліцейський (u′ += 2)" },
          { value: "pit", label: "🕳️ яма (u′ −= 2)" },
          { value: "cobble", label: "🧱 бруківка (±0.5 кожні 0.09 с)" },
        ]}
      />
      <Chips label="Амортизатор" value={c} onChange={setC} options={SHOCKS.map((s) => ({ value: s.c, label: s.label }))} />
      <svg viewBox={`0 0 ${W} 270`} className="w-full rounded-xl bg-white/[0.02]">
        <path d={`M0 ${ROAD + 40} L${road.map((x) => `${x} ${roadY(x, profile, t)}`).join(" L")} L${W} ${ROAD + 40} Z`} fill="#3a3f4b" />
        <g transform={`translate(${CAR_X} ${ROAD - 62 - lift})`}>
          <rect x={-58} y={0} width={116} height={30} rx={10} fill={hit ? "#ff5d73" : "#5cc8ff"} />
          <path d="M-34 0 L-20 -22 H22 L36 0 Z" fill="#5cc8ffbb" />
          <text x={0} y={-6} fontSize={14} textAnchor="middle">
            {Math.abs(now) < 0.01 ? "😊" : Math.abs(now) < 0.05 ? "😮" : "🤢"}
          </text>
        </g>
        {[-36, 36].map((dx) => {
          const wy = roadY(CAR_X + dx, profile, t) - 11;
          const top = ROAD - 32 - lift;
          const coils = Array.from({ length: 7 }, (_, i) => `${CAR_X + dx + (i % 2 ? 6 : -6)},${top + ((wy - top) * (i + 0.5)) / 7}`);
          return (
            <g key={dx}>
              <polyline points={`${CAR_X + dx},${top} ${coils.join(" ")} ${CAR_X + dx},${wy}`} fill="none" stroke="#ffd84d" strokeWidth={2} />
              <circle cx={CAR_X + dx} cy={wy} r={11} fill="#111" stroke="#888" strokeWidth={3} />
            </g>
          );
        })}
        <polyline points={curve.map((v, i) => `${sx(i)},${sy(v)}`).join(" ")} fill="none" stroke="#5cc8ff" strokeWidth={1.5} />
        <line x1={sx(pb.progress * 300)} x2={sx(pb.progress * 300)} y1={208} y2={268} stroke="#fff" strokeWidth={1} />
        <text x={20} y={204} fontSize={10} fill="#ffffff70">
          u(t) — зміщення кузова, точний розв&apos;язок
        </text>
      </svg>
      <PlaybackBar pb={pb} label={`t = ${fmt(t, 3)} с`} />
      <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] leading-snug text-white/65">
        Кузов (m = 1.25, k = 1500) гойдається {fmt(b / (2 * Math.PI), 3)} разів на секунду; амплітуда тане як e<sup>−{fmt(a, 3)}t</sup> — до 2 % за{" "}
        {fmt(4 / a, 3)} с. Найбільше зміщення за поїздку: <b className="text-white">{fmt(uMax, 3)}</b>
        {hit ? " — підвіска «пробивається» до упору 💥" : ""}.
      </div>
    </div>
  );
}
