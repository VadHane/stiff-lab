"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import SpecTex from "@/components/math/SpecTex";
import { useMode } from "@/components/mode/Mode";
import type { ResolvedValues } from "@/lib/problem-spec";
import { specById } from "@/lib/task-specs";
import { taskById } from "@/lib/tasks";

/** Заголовок задачі варіанта і її система з параметрами варіанта (KaTeX). */
export default function TaskHead({ taskId, specId, values, actions }: { taskId: string; specId: string; values: ResolvedValues; actions?: ReactNode }) {
  const { mode } = useMode();
  const t = taskById(taskId);
  const spec = specById(specId);
  if (!t || !spec) return null;
  const badge = t.label ?? `№${t.num}`;
  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl" aria-hidden>
          {t.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-display whitespace-nowrap rounded-full bg-[var(--task-accent)] px-2.5 py-0.5 text-[12px] text-black" style={{ ["--task-accent" as string]: t.accent }}>
            {badge}
          </span>
          <h3 className="font-display mt-1.5 text-[17px] leading-snug text-white sm:text-[19px]">{t.title}</h3>
          {spec.variant && <div className="mt-0.5 text-[12.5px] text-white/50">{spec.variant}</div>}
        </div>
        <Link
          href={`/task/${taskId}/`}
          className="shrink-0 rounded-full border border-white/12 px-3 py-1 text-[12.5px] text-white/70 hover:border-[var(--accent)] hover:text-white"
        >
          Сторінка задачі →
        </Link>
      </div>
      <div className="mt-3 rounded-xl border border-white/8 bg-black/20 px-3 py-1 sm:px-4">
        <SpecTex spec={spec} values={values} show={{ system: true, defs: true, params: true, initial: true }} />
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-white/50">
        {mode === "simple"
          ? "Це система рівнянь вашого варіанта: числа параметрів, початкові умови й відрізок часу — саме ваші. Сторінка задачі пояснює, що тут відбувається."
          : `Параметри, початкові умови і T — індивідуальні для варіанта; решта — як у специфікації ${spec.id} (lib/task-specs.ts).`}
      </p>
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
