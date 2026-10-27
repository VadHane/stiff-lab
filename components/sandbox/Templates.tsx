"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMode } from "@/components/mode/Mode";
import type { ProblemSpec } from "@/lib/problem-spec";
import { fromTaskSpec, specKey } from "@/lib/sandbox-spec";
import { CLASSIC_TEMPLATES, classicById, type SandboxTemplate } from "@/lib/sandbox-templates";
import { TASK_SPECS, specById, specTitle } from "@/lib/task-specs";
import { TASKS, taskById } from "@/lib/tasks";

const badgeOf = (taskId: string) => {
  const t = taskById(taskId);
  return t ? (t.label ?? `№${t.num}`) : taskId;
};

/** Задачі курсу, згруповані за сторінками (порядок — як на головній). */
function courseGroups() {
  return TASKS.map((t) => ({ task: t, specs: TASK_SPECS.filter((s) => s.taskId === t.id) })).filter((g) => g.specs.length > 0);
}

/** Шаблон за id: класичний або задача курсу. */
export function templateSpec(src: string): ProblemSpec | null {
  const c = classicById(src);
  if (c) return c.spec;
  const s = specById(src);
  return s ? fromTaskSpec(s) : null;
}

/**
 * Шаблони: класичні системи (картки) і «Взяти задачу курсу» (список усіх специфікацій сторінок). Під ними —
 * опис активного шаблону, джерело, посилання на сторінку задачі й позначка «змінено».
 */
export default function Templates({
  src,
  current,
  onClassic,
  onCourse,
  onBlank,
  canUndo,
  onUndo,
}: {
  src: string;
  /** поточна система (щоб показати «змінено») */
  current: ProblemSpec;
  onClassic: (t: SandboxTemplate) => void;
  onCourse: (s: ProblemSpec) => void;
  onBlank: () => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const { mode } = useMode();
  const groups = useMemo(courseGroups, []);
  const classic = classicById(src);
  const course = classic ? undefined : specById(src);
  const base = templateSpec(src);
  const modified = !!base && specKey(base) !== specKey(current);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {CLASSIC_TEMPLATES.map((t) => {
          const on = t.id === src;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onClassic(t)}
              title={t.short}
              aria-pressed={on}
              className={`flex min-w-0 flex-col items-start rounded-xl border px-3 py-2 text-left transition-all ${
                on ? "border-[var(--accent)] bg-[var(--accent)]/12 shadow-[0_0_24px_-10px_var(--accent)]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
              }`}
            >
              <span className="text-xl leading-none">{t.emoji}</span>
              <span className="mt-1 text-[13px] font-semibold text-white">{t.title}</span>
              <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-white/50">{t.short}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="sandbox-course" className="text-[13px] text-white/70">
          📚 Взяти задачу курсу:
        </label>
        <select
          id="sandbox-course"
          value={course ? course.id : ""}
          onChange={(e) => {
            const s = specById(e.target.value);
            if (s) onCourse(s);
          }}
          className="min-w-0 max-w-full flex-1 basis-64 rounded-lg border border-white/12 bg-[#0d1024] px-2 py-1.5 text-[13px] text-white outline-none focus:border-[var(--accent)]"
        >
          <option value="">— оберіть задачу і варіант —</option>
          {groups.map((g) => (
            <optgroup key={g.task.id} label={`${g.task.label ?? `№${g.task.num}`}. ${g.task.title}`}>
              {g.specs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.variant ? `${s.title} — ${s.variant}` : s.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={onBlank} className="rounded-full border border-white/15 px-3 py-1.5 text-[12.5px] text-white/75 hover:border-white/30 hover:text-white">
          ✏️ Почати з нуля
        </button>
        {canUndo && (
          <button type="button" onClick={onUndo} className="rounded-full border border-[#ffb547]/40 bg-[#ffb547]/10 px-3 py-1.5 text-[12.5px] text-[#ffd59a] hover:bg-[#ffb547]/20">
            ↶ Повернути попередню систему
          </button>
        )}
      </div>

      {(classic || course) && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13.5px] leading-relaxed text-white/75">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">
              {classic ? `${classic.emoji} ${classic.spec.title}` : `${badgeOf(course!.taskId)} · ${specTitle(course!)}`}
            </span>
            {modified && <span className="rounded-full border border-[#ffb547]/40 bg-[#ffb547]/10 px-2 py-0.5 text-[11px] text-[#ffd59a]">змінено</span>}
            {course && (
              <Link href={`/task/${course.taskId}`} className="ml-auto text-[12.5px] text-[var(--accent)] hover:underline">
                ↗ сторінка задачі {badgeOf(course.taskId)}
              </Link>
            )}
          </div>
          {classic && <p>{classic.about}</p>}
          {course && (
            <p>
              {course.note ??
                (mode === "simple" ? "Система з задачі курсу: змініть що завгодно — параметри, рівняння, відрізок." : "Специфікація зі сторінки задачі (lib/task-specs.ts).")}
            </p>
          )}
          {classic && <p className="mt-1.5 text-[12px] text-white/45">Джерело: {classic.source}</p>}
        </div>
      )}
    </div>
  );
}
