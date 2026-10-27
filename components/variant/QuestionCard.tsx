"use client";

import { useId } from "react";
import { useMode } from "@/components/mode/Mode";
import { Tex } from "@/components/ui/Tex";
import { sup } from "@/lib/format";
import { keyNumber, roughDeviation, TEMPLATES, type Question } from "@/lib/variants";
import Rich from "./Rich";

/** Результат перевірки однієї відповіді. */
export interface QResult {
  status: "ok" | "bad" | "invalid" | "empty";
  relDev?: number;
  direction?: "low" | "high" | "ok";
  error?: string;
}

/** Після стількох невдалих спроб показуємо напрям («замало/забагато») і пораду. */
export const HINT_AFTER = 3;

const tolTex = (tol: number) => {
  const e = Math.round(Math.log10(tol));
  return Math.abs(10 ** e - tol) < 1e-15 ? `10^{${e}}` : String(tol);
};
/** «≈ 2·10^-5» → «≈ 2·10⁻⁵» */
const devText = (s: string) => s.replace(/10\^(-?\d+)/g, (_, e: string) => `10${sup(e)}`);

/**
 * Питання варіанта: умова (з KaTeX), формула методу, допуск, поле відповіді (або еталон — у режимі викладача),
 * результат перевірки з відносним відхиленням, після 3 невдалих спроб — напрям і порада.
 */
export default function QuestionCard({
  q,
  value = "",
  onChange,
  onSubmit,
  result,
  attempts = 0,
  teacher = false,
}: {
  q: Question;
  value?: string;
  onChange?: (v: string) => void;
  onSubmit?: () => void;
  result?: QResult;
  attempts?: number;
  /** показати еталонну відповідь замість поля (попередній перегляд викладача) */
  teacher?: boolean;
}) {
  const { mode } = useMode();
  const id = useId();
  const meta = TEMPLATES[q.template];
  const border =
    result?.status === "ok"
      ? "border-[#3ee6a8]/45 bg-[#3ee6a8]/[0.05]"
      : result?.status === "bad"
        ? "border-[#ff5d73]/40 bg-[#ff5d73]/[0.04]"
        : "border-white/10 bg-white/[0.03]";
  return (
    <div className={`rounded-xl border p-3 transition-colors sm:p-4 ${border}`} data-question={q.key}>
      <div className="flex items-start gap-3">
        <span
          className="font-display grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent)]/20 text-[13px] text-[var(--accent)]"
          title={meta.title}
          aria-label={`Питання ${meta.letter}`}
        >
          {meta.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white">
            <Rich text={q.title} />
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-white/80">
            <Rich text={q.text} />
          </p>
          {q.formula && <Tex block className="text-[13px] text-white/85">{q.formula}</Tex>}
          {mode === "simple" && q.simple && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
              💡 <Rich text={q.simple} />
            </p>
          )}
          {mode === "sci" && q.sci && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
              <Rich text={q.sci} />
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {teacher ? (
              <span className="rounded-lg border border-[#ffd166]/40 bg-[#ffd166]/10 px-2.5 py-1 font-mono text-[13px] text-[#ffe9a8]">🔑 {keyNumber(q.answer)}</span>
            ) : (
              <>
                <label htmlFor={id} className="sr-only">
                  Відповідь на питання {meta.letter}
                </label>
                <input
                  id={id}
                  value={value}
                  onChange={(e) => onChange?.(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ваша відповідь"
                  className="w-full min-w-0 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 font-mono text-[14px] text-white placeholder:text-white/30 focus:border-[var(--accent)] focus:outline-none sm:w-64"
                />
              </>
            )}
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11.5px] text-white/55">
              допуск: відносна похибка ≤ <Tex>{tolTex(q.tol)}</Tex>
            </span>
          </div>
          {!teacher && <div className="mt-1 text-[11.5px] text-white/40">{q.format}</div>}
          {teacher && q.details.length > 0 && <div className="mt-1 text-[11.5px] text-white/40">{q.details.join(" · ")}</div>}
          {result && <ResultLine r={result} q={q} attempts={attempts} />}
        </div>
      </div>
    </div>
  );
}

function ResultLine({ r, q, attempts }: { r: QResult; q: Question; attempts: number }) {
  if (r.status === "empty") return <div className="mt-2 text-[13px] text-white/45">— відповіді ще немає</div>;
  if (r.status === "invalid") return <div className="mt-2 text-[13px] text-[#ffb547]">⚠️ {r.error}</div>;
  const dev = roughDeviation(r.relDev ?? NaN);
  if (r.status === "ok")
    return (
      <div className="mt-2 text-[13px] text-[#3ee6a8]" role="status">
        ✓ Правильно — відносне відхилення <span className="font-mono">{devText(dev)}</span>
      </div>
    );
  return (
    <div className="mt-2 space-y-1 text-[13px]" role="status">
      <div className="text-[#ff8a9a]">
        ✗ Ще ні — відносне відхилення <span className="font-mono">{devText(dev)}</span> (треба ≤ <Tex>{tolTex(q.tol)}</Tex>)
        {attempts > 0 && <span className="text-white/40"> · невдалих спроб: {attempts}</span>}
      </div>
      {attempts >= HINT_AFTER ? (
        <div className="rounded-lg border border-[#ffb547]/30 bg-[#ffb547]/[0.07] px-3 py-2 text-white/75">
          <b className="text-white">{r.direction === "low" ? "Замало: правильне число більше за ваше." : "Забагато: правильне число менше за ваше."}</b> <Rich text={q.hint} />
        </div>
      ) : (
        <div className="text-[12px] text-white/40">Після {HINT_AFTER} невдалих спроб з'явиться підказка, у який бік помилка і що перевірити.</div>
      )}
    </div>
  );
}
