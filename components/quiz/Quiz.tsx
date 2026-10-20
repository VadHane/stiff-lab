"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMode } from "@/components/mode/Mode";
import { registerTotal, saveAnswer, useQuizStore } from "./store";

export interface QuizQuestion {
  id: string;
  /** the question; ask BEFORE the student looks at the answer in the lab */
  q: ReactNode;
  options: ReactNode[];
  correct: number;
  /** why — scientific wording */
  explain: ReactNode;
  /** why — plain-language wording (shown in the «Просто» mode) */
  explainSimple?: ReactNode;
  /** optional action that shows the answer live in the lab (e.g. sets h) */
  show?: { label: string; run: () => void };
}

const LETTERS = ["А", "Б", "В", "Г", "Д"];

function Burst({ ok }: { ok: boolean }) {
  const items = ok ? ["🎉", "✨", "⭐", "🎊", "✨", "🎉"] : ["🤔", "💭", "🤔"];
  return (
    <span className="pointer-events-none absolute right-4 top-3 flex">
      {items.map((e, i) => (
        <span key={i} className="quiz-burst text-xl" style={{ animationDelay: `${i * 60}ms`, ["--dx" as string]: `${(i - items.length / 2) * 14}px` }}>
          {e}
        </span>
      ))}
    </span>
  );
}

function Question({ taskId, q, idx, total }: { taskId: string; q: QuizQuestion; idx: number; total: number }) {
  const { answers } = useQuizStore();
  const { mode } = useMode();
  const saved = answers[`${taskId}:${q.id}`];
  const [fresh, setFresh] = useState(false);
  const chosen = saved?.chosen;
  const answered = chosen !== undefined;
  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      {answered && fresh && <Burst ok={chosen === q.correct} />}
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
        Питання {idx + 1} / {total}
      </div>
      <div className="mb-3 text-[15px] leading-relaxed text-white">{q.q}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.options.map((o, i) => {
          const isRight = i === q.correct;
          const picked = i === chosen;
          let cls = "border-white/10 bg-white/[0.02] text-white/80 hover:border-white/30 hover:bg-white/[0.05]";
          if (answered) {
            if (isRight) cls = "border-[#3ee6a8]/60 bg-[#3ee6a8]/12 text-white";
            else if (picked) cls = "border-[#ff5d73]/60 bg-[#ff5d73]/12 text-white";
            else cls = "border-white/5 bg-transparent text-white/40";
          }
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => {
                setFresh(true);
                saveAnswer(taskId, q.id, { chosen: i, ok: i === q.correct });
              }}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[14px] transition-all ${cls}`}
            >
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-[11px]">
                {answered && isRight ? "✓" : answered && picked ? "✗" : LETTERS[i]}
              </span>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`mt-3 rounded-xl px-4 py-3 text-[14px] leading-relaxed ${chosen === q.correct ? "bg-[#3ee6a8]/[0.07] text-white/85" : "bg-[#ff5d73]/[0.07] text-white/85"}`}>
          <div className="mb-1 font-semibold text-white">{chosen === q.correct ? "Правильно! 🎯" : "Не зовсім 🙃"}</div>
          {mode === "simple" && q.explainSimple ? q.explainSimple : q.explain}
          <div className="mt-2 flex flex-wrap gap-2">
            {q.show && (
              <button
                onClick={() => {
                  q.show!.run();
                  document.querySelector("[data-report-controls]")?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold text-black hover:scale-[1.03]">
                👀 {q.show.label}
              </button>
            )}
            <button
              onClick={() => {
                setFresh(false);
                saveAnswer(taskId, q.id, null);
              }}
              className="rounded-full border border-white/15 px-3 py-1 text-[12.5px] text-white/70 hover:bg-white/10"
            >
              ↺ Спробувати ще раз
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** «Спершу вгадай — потім перевір»: a few predict-then-check questions with score kept across pages. */
export default function QuizBlock({ taskId, questions, intro }: { taskId: string; questions: QuizQuestion[]; intro?: ReactNode }) {
  const { answers } = useQuizStore();
  useEffect(() => registerTotal(taskId, questions.length), [taskId, questions.length]);
  const ok = questions.filter((q) => answers[`${taskId}:${q.id}`]?.ok).length;
  const done = questions.filter((q) => answers[`${taskId}:${q.id}`]).length;
  return (
    <div className="space-y-3" data-report-skip="">
      <div className="flex flex-wrap items-center gap-3 text-[14px] text-white/65">
        <span>{intro ?? "Спершу дайте відповідь «на око», а потім перевірте себе в лабораторії вище."}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {questions.map((q) => {
            const a = answers[`${taskId}:${q.id}`];
            return <span key={q.id} className={`h-2.5 w-2.5 rounded-full ${!a ? "bg-white/15" : a.ok ? "bg-[#3ee6a8]" : "bg-[#ff5d73]"}`} />;
          })}
          <span className="ml-1 font-mono text-[12px] text-white/55">
            {ok}/{questions.length}
            {done === questions.length && ok === questions.length ? " 🏆" : ""}
          </span>
        </span>
      </div>
      {questions.map((q, i) => (
        <Question key={q.id} taskId={taskId} q={q} idx={i} total={questions.length} />
      ))}
    </div>
  );
}
