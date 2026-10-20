"use client";

import { useState } from "react";
import { Chips } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";

const L2 = -500; // швидка мода задачі №3: «надчутливе кермо»
const W = 600;
const H = 190;
const MID = 95;
const LANE = 30; // пікселів на одиницю відхилення
const N = 12;

type Driver = "euler" | "ieuler";
const Rof = (d: Driver, h: number) => (d === "euler" ? 1 + h * L2 : 1 / (1 - h * L2));

/** Водій дивиться на дорогу раз на h і щоразу виправляє відхилення: для швидкої моди це множення на R(hλ₂). */
export default function SteeringScene() {
  const [h, setH] = useState(0.004);
  const [drv, setDrv] = useState<Driver>("euler");
  const pb = usePlayback(7, true);
  const R = Rof(drv, h);
  const dev = Array.from({ length: N + 1 }, (_, n) => Math.pow(R, n));
  const crashAt = dev.findIndex((v) => Math.abs(v) > 2.6);
  const last = crashAt < 0 ? N : crashAt;
  const X = (n: number) => 30 + (n / N) * (W - 60);
  const Y = (v: number) => MID - Math.max(-2.9, Math.min(2.9, v)) * LANE;
  const pos = Math.min(last, pb.progress * (N + 2));
  const k = Math.floor(pos);
  const fr = pos - k;
  const cy = k >= last ? Y(dev[last]) : Y(dev[k]) + (Y(dev[k + 1]) - Y(dev[k])) * fr;
  const cx = k >= last ? X(last) : X(k) + (X(k + 1) - X(k)) * fr;
  const ang = k >= last ? 0 : (Math.atan2(Y(dev[k + 1]) - Y(dev[k]), X(k + 1) - X(k)) * 180) / Math.PI;
  const crashed = crashAt >= 0 && pos >= crashAt;
  const verdict =
    Math.abs(Math.abs(R) - 1) < 1e-9
      ? { t: "вічний зигзаг: щоразу та сама помилка, але в інший бік", c: "#ffb547" }
      : Math.abs(R) > 1
        ? { t: "кожен зигзаг ширший за попередній — у кювет", c: "#ff5d73" }
        : Math.abs(R) < 1e-9
          ? { t: "одним рухом керма — точно в центр смуги", c: "#3ee6a8" }
          : R < 0
            ? { t: "перекермовує, але зигзаги стихають", c: "#5cc8ff" }
            : { t: "плавно повертається в смугу, без перестрибувань", c: "#3ee6a8" };
  return (
    <div className="space-y-3">
      <Chips
        label="Як часто водій дивиться на дорогу (крок h)"
        value={h}
        onChange={(v) => {
          setH(v);
          pb.setProgress(0);
        }}
        options={[0.002, 0.003, 0.004, 0.0042, 0.04].map((v) => ({ value: v, label: `раз на ${fmt(v * 1000, 2)} мс` }))}
      />
      <Chips
        label="Стиль водіння"
        value={drv}
        onChange={(v) => {
          setDrv(v);
          pb.setProgress(0);
        }}
        options={[
          { value: "euler", label: "🏎️ різкий (явний Ейлер)" },
          { value: "ieuler", label: "🚙 обережний (неявний Ейлер)" },
        ]}
      />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-[#2e7d32]/25">
        <rect x={0} y={MID - 2.2 * LANE} width={W} height={4.4 * LANE} fill="#3a3f4b" />
        <line x1={0} x2={W} y1={MID - 2.2 * LANE} y2={MID - 2.2 * LANE} stroke="#fff" strokeWidth={2} />
        <line x1={0} x2={W} y1={MID + 2.2 * LANE} y2={MID + 2.2 * LANE} stroke="#fff" strokeWidth={2} />
        <line x1={0} x2={W} y1={MID} y2={MID} stroke="#ffd84d" strokeWidth={2} strokeDasharray="14 10" />
        <polyline
          points={dev
            .slice(0, last + 1)
            .map((v, n) => `${X(n)},${Y(v)}`)
            .join(" ")}
          fill="none"
          stroke={verdict.c}
          strokeWidth={2}
          strokeDasharray="5 4"
          opacity={0.7}
        />
        {dev.slice(0, last + 1).map((v, n) => (
          <g key={n} opacity={n <= pos ? 1 : 0.35}>
            <circle cx={X(n)} cy={Y(v)} r={3.5} fill={verdict.c} />
            <text x={X(n)} y={Y(v) - 8} textAnchor="middle" fontSize={11}>
              👀
            </text>
          </g>
        ))}
        <g transform={`translate(${cx} ${cy}) rotate(${ang})`}>
          <rect x={-14} y={-8} width={28} height={16} rx={5} fill={crashed ? "#ff5d73" : "#5cc8ff"} />
          <rect x={4} y={-6} width={7} height={12} rx={2} fill="#0b1020aa" />
        </g>
        {crashed && (
          <text x={cx + 18} y={cy} fontSize={18} dominantBaseline="middle">
            💥
          </text>
        )}
      </svg>
      <PlaybackBar pb={pb} label={`погляд ${Math.min(k, last)} / ${last}`} />
      <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] leading-snug text-white/65">
        Кермо реагує за 1/500 с — це λ₂ = −500 із задачі. Між поглядами відхилення множиться на{" "}
        <b style={{ color: verdict.c }}>
          R = {drv === "euler" ? "1 + h·λ₂" : "1/(1 − h·λ₂)"} = {fmt(R, 3)}
        </b>
        : {verdict.t}. Після 12 поглядів відхилення ×{fmt(Math.abs(Math.pow(R, N)), 3)}.
      </div>
    </div>
  );
}
