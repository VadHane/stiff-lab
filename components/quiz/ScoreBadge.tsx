"use client";

import { useQuizStore } from "./store";

export default function ScoreBadge() {
  const { answers, totals } = useQuizStore();
  const all = Object.values(answers);
  const ok = all.filter((a) => a.ok).length;
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  if (!all.length) return null;
  return (
    <span
      className="flex items-center gap-1 rounded-full border border-[#ffd84d]/30 bg-[#ffd84d]/10 px-2.5 py-1 font-mono text-[12px] text-[#ffe9a3]"
      title={`Правильних відповідей: ${ok} з ${all.length} відповіданих${total ? ` (усього питань на відвіданих сторінках: ${total})` : ""}`}
    >
      🏆 {ok}
      {total ? <span className="text-[#ffe9a3]/55">/{total}</span> : null}
    </span>
  );
}
