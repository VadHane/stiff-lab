"use client";

import { useState } from "react";
import { Say } from "@/components/mode/Mode";
import { Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt } from "@/lib/format";
import { duration } from "@/lib/relatable";

const TAU_F = 1; // match burns out in ~1 s
const TAU_S = 300; // kettle: ~5 min
const T_END = 300;

function Match({ y }: { y: number }) {
  const big = Math.abs(y) > 3;
  const s = Math.min(Math.abs(y), 3);
  const neg = y < -1e-3;
  const fill = neg ? "#5cc8ff" : "#ffb547";
  return (
    <g>
      <rect x={34} y={78} width={6} height={52} rx={2} fill="#d9b48a" />
      <circle cx={37} cy={78} r={5} fill="#7a2b1d" />
      {s > 0.01 && (
        <g style={{ transformOrigin: "37px 76px", transform: `scale(${0.3 + s * 0.9})` }}>
          <path d="M37 76 C 26 64, 30 50, 37 38 C 44 50, 48 64, 37 76 Z" fill={fill} opacity={0.9} />
          <path d="M37 74 C 32 66, 34 58, 37 52 C 40 58, 42 66, 37 74 Z" fill="#fff6" />
        </g>
      )}
      {big && (
        <text x={37} y={20} textAnchor="middle" fontSize={14} fill="#ff5d73" fontFamily="var(--font-jetbrains)">
          💥 ×{fmt(Math.abs(y), 2)}
        </text>
      )}
      {neg && !big && (
        <text x={37} y={22} textAnchor="middle" fontSize={11} fill="#5cc8ff">
          «анти-вогонь»
        </text>
      )}
    </g>
  );
}

function Kettle({ T }: { T: number }) {
  const c = Math.max(0, Math.min(1, (T - 20) / 80));
  const col = `hsl(${220 - 220 * c}, 85%, ${55 + 5 * c}%)`;
  return (
    <g transform="translate(0,0)">
      <path d="M20 120 L28 70 H92 L100 120 Z" fill="#ffffff10" stroke="#ffffff55" strokeWidth={2} />
      <path d={`M${24 + (1 - c) * 2} 118 L${27 + (1 - c) * 2} ${118 - 44 * 0.85} H${93 - (1 - c) * 2} L${96 - (1 - c) * 2} 118 Z`} fill={col} opacity={0.55} />
      <path d="M92 82 Q 112 78 116 64" stroke="#ffffff55" strokeWidth={3} fill="none" />
      <rect x={46} y={60} width={28} height={10} rx={4} fill="#ffffff33" />
      {T > 95 && (
        <g className="animate-float" opacity={0.7}>
          <path d="M112 56 q -6 -8 0 -16 q 6 -8 0 -16" stroke="#fff" strokeWidth={2} fill="none" />
          <path d="M120 58 q -6 -8 0 -16 q 6 -8 0 -16" stroke="#fff" strokeWidth={2} fill="none" />
        </g>
      )}
      <text x={60} y={140} textAnchor="middle" fontSize={13} fill={Math.abs(T) > 1000 ? "#ff5d73" : "#fff"} fontFamily="var(--font-jetbrains)">
        {Math.abs(T) > 1e4 ? "💥" : `${fmt(T, 3)} °C`}
      </text>
    </g>
  );
}

function Row({ label, sub, y, T, looks, color }: { label: string; sub: string; y: number; T: number; looks: number; color: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="w-40 shrink-0">
        <div className="text-[14px] font-semibold" style={{ color }}>
          {label}
        </div>
        <div className="text-[12px] leading-snug text-white/50">{sub}</div>
        <div className="mt-1 font-mono text-[12px] text-white/70">поглядів: {looks}</div>
      </div>
      <svg viewBox="0 0 74 140" className="h-28 w-14 shrink-0">
        <Match y={y} />
      </svg>
      <svg viewBox="0 0 130 150" className="h-28 w-24 shrink-0">
        <Kettle T={T} />
      </svg>
      <div className="min-w-0 text-[12.5px] leading-snug text-white/60">
        сірник: <span className="font-mono text-white">{fmt(y, 3)}</span>
        <br />
        вода: <span className="font-mono text-white">{fmt(T, 4)} °C</span>
      </div>
    </div>
  );
}

/** Home-page analogy for stiffness: a match (fast, dies in a second) and a kettle (slow, five minutes). */
export default function StiffnessAnalogy() {
  const [h, setH] = useState(5);
  const pb = usePlayback(14);
  const t = pb.progress * T_END;
  const n = Math.floor(t / h + 1e-9);
  const exF = Math.pow(1 - h / TAU_F, n);
  const exT = 100 - 80 * Math.pow(1 - h / TAU_S, n);
  const imF = Math.pow(1 / (1 + h / TAU_F), n);
  const imT = 100 - 80 * Math.pow(1 / (1 + h / TAU_S), n);
  const trueF = Math.exp(-t / TAU_F);
  const trueT = 100 - 80 * Math.exp(-t / TAU_S);
  const explicitOk = h <= 2 * TAU_F;
  const looksNeeded = Math.ceil(T_END / (2 * TAU_F));
  return (
    <div className="glass mt-6 rounded-2xl p-4 sm:p-6">
      <div className="font-display mb-1 text-[17px] text-white">🔥 Сірник і чайник: жорсткість на кухні</div>
      <div className="mb-4 max-w-4xl text-[14.5px] leading-relaxed text-white/70">
        <Say
          simple={
            <>
              Ви одночасно стежите за сірником (згасає за секунду) і чайником (закипає хвилин п&apos;ять). Обчислювач не бачить їх безперервно — він
              «зазирає» раз на <b>h</b> секунд і перераховує стан. <b>Явний</b> спостерігач каже: «нове = старе + (як швидко змінюється зараз) × h». Якщо
              зазирати рідше, ніж раз на 2 секунди, розрахунок сірника вибухає — хоча справжній сірник давно згас! <b>Неявний</b> питає: «яким буде темп у
              момент наступного погляду?» — і спокійно дивиться хоч раз на хвилину.
            </>
          }
        >
          Система з двох незалежних мод: <Tex>{"y_1' = -y_1/\\tau_1,\\ \\tau_1 = 1"}</Tex> с і <Tex>{"T' = (100 - T)/\\tau_2,\\ \\tau_2 = 300"}</Tex> с.
          Коефіцієнт жорсткості <Tex>{"\\tau_2/\\tau_1 = 300"}</Tex>. Явний Ейлер множить швидку моду на <Tex>{"1 - h/\\tau_1"}</Tex> і стійкий лише при{" "}
          <Tex>{"h \\le 2\\tau_1"}</Tex>, хоча точність для повільної моди дозволяла б <Tex>{"h \\sim 30"}</Tex> с. Неявний Ейлер множить на{" "}
          <Tex>{"1/(1 + h/\\tau_1)"}</Tex> — стійкий при будь-якому h.
        </Say>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Slider label="Як часто зазираємо: h, секунд" value={h} onChange={setH} min={0.2} max={60} log format={(v) => `${fmt(v, 3)} с`} />
          <div className={`rounded-xl px-3 py-2 text-[13px] leading-snug ${explicitOk ? "bg-[#3ee6a8]/10 text-white/80" : "bg-[#ff5d73]/10 text-white/85"}`}>
            {explicitOk ? (
              <>✅ h ≤ 2 с: явний спостерігач справляється. Але за 5 хвилин він зазирне {Math.ceil(T_END / h)} разів.</>
            ) : (
              <>
                💥 h &gt; 2 с: кожен погляд множить «вогонь» на {fmt(1 - h / TAU_F, 3)} — він росте і міняє знак. Щоб вижити, явному треба ≥ {looksNeeded} поглядів, а
                неявному вистачить {Math.ceil(T_END / 60)}–{Math.ceil(T_END / 20)}.
              </>
            )}
          </div>
          <div className="text-[12.5px] leading-snug text-white/50">
            Справжній світ зараз: сірник {trueF < 1e-3 ? "згас 🪵" : `горить на ${fmt(trueF * 100, 2)} %`}, вода {fmt(trueT, 3)} °C. Минуло {duration(t)}.
          </div>
        </div>
        <div className="space-y-2">
          <Row label="Явний спостерігач" sub="нове = старе + темп_зараз × h" y={exF} T={exT} looks={n} color="#ff5d73" />
          <Row label="Неявний спостерігач" sub="нове = старе + темп_потім × h" y={imF} T={imT} looks={n} color="#3ee6a8" />
          <PlaybackBar pb={pb} label={`t = ${fmt(t, 3)} с`} />
        </div>
      </div>
    </div>
  );
}
