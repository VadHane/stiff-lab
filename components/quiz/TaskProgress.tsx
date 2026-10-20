"use client";

import { taskScore, useQuizStore } from "./store";

/** Small "✅ 2/3" chip for the task cards on the home page. */
export default function TaskProgress({ id }: { id: string }) {
  const { answers, totals } = useQuizStore();
  const { ok, done } = taskScore(answers, id);
  if (!done) return null;
  const total = totals[id] ?? done;
  return (
    <span className="rounded-full bg-[#3ee6a8]/12 px-2 py-0.5 font-mono text-[11px] text-[#3ee6a8]" title="Правильні відповіді у квізі">
      ✅ {ok}/{total}
    </span>
  );
}
