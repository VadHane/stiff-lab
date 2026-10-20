"use client";

import { useState } from "react";
import { Chips, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";

const D = -0.5; // повільна мода: кава холоне, λ₁ = d
const T_END = 10;
const MIN_PER_UNIT = 15; // 1 одиниця часу задачі = 15 хвилин
const K = 8; // перші секунди програються сповільнено
const warp = (p: number) => (T_END * (Math.exp(K * p) - 1)) / (Math.exp(K) - 1);

const human = (t: number) => {
  const s = t * MIN_PER_UNIT * 60;
  return s < 120 ? `${fmt(s, 2)} с` : `${fmt(s / 60, 3)} хв`;
};

const SPIRAL = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 90; i++) {
    const a = (i / 90) * Math.PI * 5;
    const r = 4 + (i / 90) * 30;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
})();

function Cup({ swirl, spin, title, sub, bad }: { swirl: number; spin: number; title: string; sub: string; bad?: boolean }) {
  const a = Math.min(1, Math.abs(swirl));
  const grow = Math.min(1.6, Math.max(0.35, Math.abs(swirl)));
  const mix = 1 - a;
  const coffee = `rgb(${Math.round(92 + 110 * mix)},${Math.round(58 + 92 * mix)},${Math.round(30 + 82 * mix)})`;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="w-full max-w-[170px]">
        <path d="M104 52 q 16 0 16 14 q 0 14 -16 14" fill="none" stroke="#ffffff55" strokeWidth={5} />
        <circle cx={60} cy={62} r={50} fill="#ffffff12" stroke="#ffffff55" strokeWidth={2} />
        <circle cx={60} cy={62} r={42} fill={coffee} />
        <g transform={`translate(60 62) rotate(${spin}) scale(${Math.sign(swirl || 1) * grow} ${grow})`} opacity={0.15 + 0.85 * a}>
          <path d={SPIRAL} fill="none" stroke={bad ? "#ff8a9a" : "#f5ead8"} strokeWidth={4} strokeLinecap="round" />
        </g>
      </svg>
      <div className="text-center text-[12.5px] text-white/75">{title}</div>
      <div className={`text-center font-mono text-[12px] ${bad ? "text-[#ff5d73]" : "text-white/55"}`}>{sub}</div>
    </div>
  );
}

/** Кава з молоком: вихор молока (u₂ = e^{−t/ε}) зникає за ~5ε, кава холоне як e^{dt}; бариста-«явний Ейлер» заглядає раз на h. */
export default function CoffeeScene() {
  const [eps, setEps] = useState(0.01);
  const [h, setH] = useState(0.02);
  const pb = usePlayback(12, false);
  const t = warp(pb.progress);
  const swirl = Math.exp(-t / eps);
  const temp = 20 + 60 * Math.exp(D * t);
  const R = 1 - h / eps;
  const n = Math.floor(t / h + 1e-9);
  const seen = Math.pow(R, n);
  const boom = !Number.isFinite(seen) || Math.abs(seen) > 50;
  const edge = Math.abs(Math.abs(R) - 1) < 1e-9;
  const spin = (pb.progress * 2400) % 360;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            pb.setProgress(0);
            pb.setPlaying(true);
          }}
          className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-black shadow-[0_0_18px_-6px_var(--accent)]"
        >
          🥛 Влити молоко
        </button>
        <Chips
          label=""
          value={h}
          onChange={setH}
          options={[0.01, 0.02, 0.05].map((v) => ({ value: v, label: `бариста заглядає раз на ${human(v)}` }))}
        />
      </div>
      <Slider
        label={<>Час розмішування ε (5ε = {human(5 * eps)})</>}
        value={eps}
        onChange={setEps}
        min={0.002}
        max={0.2}
        log
        format={(v) => `${fmt(v, 3)} = ${human(v)}`}
      />
      <div className="grid grid-cols-3 items-end gap-2">
        <Cup swirl={swirl} spin={spin} title="справжня чашка" sub={`вихор u₂ = ${fmt(swirl, 3)}`} />
        <div className="flex flex-col items-center">
          <svg viewBox="0 0 60 120" className="h-[150px]">
            <rect x={24} y={8} width={12} height={92} rx={6} fill="#ffffff12" stroke="#ffffff55" />
            <circle cx={30} cy={104} r={11} fill="#ff6b5a" />
            <rect x={27} y={100 - ((temp - 15) / 70) * 90} width={6} height={((temp - 15) / 70) * 90} fill="#ff6b5a" />
          </svg>
          <div className="text-center text-[12.5px] text-white/75">кава холоне</div>
          <div className="text-center font-mono text-[12px] text-white/55">{fmt(temp, 3)} °C</div>
        </div>
        <Cup
          swirl={boom ? 2 : seen}
          spin={spin}
          bad={edge || Math.abs(R) > 1}
          title={`що бачить бариста-«Ейлер»`}
          sub={boom ? "💥 вихор уже більший за чашку" : `вихор ${fmt(seen, 3)}`}
        />
      </div>
      <PlaybackBar pb={pb} label={`t = ${human(t)}`} />
      <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] leading-snug text-white/65">
        Справжній вихор слабне як e<sup>−t/ε</sup>: за {human(5 * eps)} від нього лишається 0.7 %. Бариста ж «оновлює» вихор раз на {human(h)} множником{" "}
        <b className={edge ? "text-[#ffb547]" : Math.abs(R) > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>1 − h/ε = {fmt(R, 3)}</b>
        {edge
          ? " — вихор вічно крутиться то в один, то в інший бік."
          : Math.abs(R) > 1
            ? " — вихор у його уяві росте й щоразу змінює напрям."
            : R < 0
              ? " — вихор згасає, але кожного разу змінює напрям."
              : " — вихор згасає, як і в справжній чашці."}{" "}
        Кава тим часом холоне від 80 °C до {fmt(20 + 60 * Math.exp(D * T_END), 3)} °C за {fmt((T_END * MIN_PER_UNIT) / 60, 2)} год (одиниця часу задачі — 15 хв).
      </div>
    </div>
  );
}
