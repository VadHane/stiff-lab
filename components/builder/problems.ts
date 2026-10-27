import { TASK_SPECS, specTitle } from "@/lib/task-specs";
import { taskById } from "@/lib/tasks";
import type { ProblemSpec } from "@/lib/problem-spec";
import type { MethodId } from "@/lib/ode";

/** Основні специфікації: перша для кожної сторінки задачі. */
export const MAIN_SPECS: ProblemSpec[] = (() => {
  const seen = new Set<string>();
  return TASK_SPECS.filter((s) => {
    if (seen.has(s.taskId)) return false;
    seen.add(s.taskId);
    return true;
  });
})();

export const MAIN_IDS = MAIN_SPECS.map((s) => s.id);

export function specLabel(spec: ProblemSpec): string {
  const t = taskById(spec.taskId);
  const badge = t ? (t.label ?? `№${t.num}`) : spec.taskId;
  return `${t?.emoji ?? ""} ${badge}. ${specTitle(spec)}`.trim();
}

/** Вбудовані методи зі сталим кроком, з якими можна порівняти. */
export const BUILTIN: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "trap", "bdf2"];

/** Два вбудовані методи «того ж порядку»: явний і неявний. */
export function defaultBuiltins(p: number, implicit: boolean): MethodId[] {
  const ex: MethodId = p <= 1 ? "euler" : p === 2 ? "rk2" : p === 3 ? "rk3" : "rk4";
  const im: MethodId = p <= 1 ? "ieuler" : "trap";
  return implicit ? [im, ex] : [ex, im];
}
