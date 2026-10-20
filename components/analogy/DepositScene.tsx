"use client";

import { useState } from "react";
import { Chips, Slider } from "@/components/ui/controls";
import { fmt } from "@/lib/format";

const BANKS = [
  { id: "euler", name: "Банк «Ейлер»", how: "рахує з суми на початку періоду", R: (z: number) => 1 + z, color: "#ff8a65" },
  { id: "ieuler", name: "Банк «Неявний»", how: "рахує з суми в кінці періоду", R: (z: number) => 1 / (1 - z), color: "#4dd0e1" },
  { id: "theta", name: "Банк «θ = 0.55»", how: "45 % — з початку, 55 % — з кінця", R: (z: number) => (1 + 0.45 * z) / (1 - 0.55 * z), color: "#b388ff" },
];
const N = 10;
const W = 420;
const RH = 66;
const SCALE = 24; // px на 1 (= весь вклад)

const money = (y: number) => `${y < 0 ? "−" : ""}${Math.abs(1000 * y) >= 1e6 ? fmt(Math.abs(1000 * y), 2) : Math.round(Math.abs(1000 * y)).toLocaleString("uk-UA")} ₴`;

function verdict(r: number) {
  if (Math.abs(Math.abs(r) - 1) < 1e-9) return { t: "🔁 ±1000 ₴ вічно", c: "#ffb547" };
  if (Math.abs(r) > 1) return { t: "💥 борг росте", c: "#ff5d73" };
  if (r < 0) return { t: "〰️ то борг, то вклад", c: "#ffb547" };
  return { t: "📉 тане, як має", c: "#3ee6a8" };
}

/** Вклад зі «ставкою згорання» λ: yₙ₊₁ = R(hλ)·yₙ — три банки по-різному нараховують ту саму ставку. */
export default function DepositScene() {
  const [lam, setLam] = useState(-10);
  const [h, setH] = useState(0.15);
  const z = h * lam;
  const bw = (W - 150) / (N + 1);
  return (
    <div className="space-y-3">
      <Chips label="Ставка згорання λ (на рік)" value={lam} onChange={setLam} options={[-1, -10, -20].map((v) => ({ value: v, label: `λ = ${v} (−${-v * 100} % річних)` }))} />
      <Slider label="Як часто нараховують, h (років)" value={h} onChange={setH} min={0.01} max={1} log format={(v) => `${fmt(v, 3)} ≈ ${fmt(v * 365, 3)} дн.`} />
      <svg viewBox={`0 0 ${W} ${RH * BANKS.length + 8}`} className="w-full">
        {BANKS.map((b, i) => {
          const r = b.R(z);
          const v = verdict(r);
          const y0 = 8 + i * RH + RH / 2;
          return (
            <g key={b.id}>
              <text x={0} y={y0 - 14} fontSize={11} fill={b.color}>
                {b.name}
              </text>
              <text x={0} y={y0 + 1} fontSize={9.5} fill="#ffffff80">
                {b.how}
              </text>
              <text x={0} y={y0 + 16} fontSize={10} fill={v.c}>
                ×{fmt(r, 3)} · {v.t}
              </text>
              <line x1={140} x2={W} y1={y0} y2={y0} stroke="#ffffff30" />
              {Array.from({ length: N + 1 }, (_, n) => {
                const y = Math.pow(r, n);
                const hh = Math.max(-1.25, Math.min(1.25, y)) * SCALE;
                const x = 146 + n * bw;
                const ex = Math.exp(lam * h * n) * SCALE;
                return (
                  <g key={n}>
                    <rect x={x} y={hh >= 0 ? y0 - hh : y0} width={bw * 0.7} height={Math.max(0.8, Math.abs(hh))} rx={1.5} fill={y < 0 ? "#ff5d73" : b.color} opacity={0.85} />
                    <line x1={x - 1} x2={x + bw * 0.7 + 1} y1={y0 - ex} y2={y0 - ex} stroke="#fff" strokeWidth={1.5} />
                    {Math.abs(y) > 1.25 && (
                      <text x={x + bw * 0.35} y={y > 0 ? y0 - SCALE * 1.25 - 2 : y0 + SCALE * 1.25 + 9} fontSize={8} textAnchor="middle" fill="#ff5d73">
                        {Math.abs(y) > 99 ? "💥" : `${fmt(Math.abs(y), 2)}×`}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] leading-snug text-white/65">
        Вклад 1000 ₴ тане неперервно, як e<sup>λt</sup>: за один період (h = {fmt(h, 3)} р.) — множиться на e<sup>hλ</sup> = {fmt(Math.exp(z), 3)} (білі риски). Після {N}{" "}
        нарахувань (t = {fmt(N * h, 3)} р.) має лишитися {money(Math.exp(z * N))}; банки показують:{" "}
        {BANKS.map((b, i) => (
          <span key={b.id} style={{ color: b.color }}>
            {i ? ", " : ""}
            {money(Math.pow(b.R(z), N))}
          </span>
        ))}
        . Стовпчики — баланс після кожного нарахування, червоні — борг.
      </div>
    </div>
  );
}
