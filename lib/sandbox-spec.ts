/**
 * «Своя система» (`/sandbox`): чернетка редактора ⇄ {@link ProblemSpec}, канонічна форма опису (для адреси й
 * порівняння), перетворення задачі курсу на шаблон.
 *
 * Чернетка зберігає ТЕКСТ полів (щоб «1e-» чи «2*pi» не губилися під час набору); числові поля приймають
 * числа (`0.5`, `1e-3`, `0,5`, `−2`) і сталі вирази без змінних (`2*pi`, `sqrt(2)/2`).
 *
 * @module sandbox-spec
 */
import { evaluate, formatNumber, freeNames, isConstantName, parse } from "./expr";
import type { ParamSpec, ProblemSpec } from "./problem-spec";
import { specTitle } from "./task-specs";

/** Найбільше змінних у редакторі. */
export const MAX_VARS = 8;
export const MAX_PARAMS = 16;
export const MAX_DEFS = 12;

export interface DraftVar {
  name: string;
  rhs: string;
  y0: string;
}
export interface DraftParam {
  name: string;
  value: string;
  label: string;
  min: string;
  max: string;
  log: boolean;
}
export interface DraftDef {
  name: string;
  expr: string;
}
/** Стан редактора (усе — рядки, як їх набрав користувач). */
export interface Draft {
  id: string;
  title: string;
  t: string;
  vars: DraftVar[];
  params: DraftParam[];
  defs: DraftDef[];
  t0: string;
  T: string;
}

/** Помилка числового поля чернетки. */
export interface NumError {
  field: "y0" | "param" | "paramMin" | "paramMax" | "t0" | "T";
  index?: number;
  message: string;
}

const num = (x: number) => formatNumber(x);

/**
 * Канонічна копія опису для «Своєї системи»: фіксований порядок ключів, лише поля, які редагує сторінка
 * (без varLabels, діапазонів y0/T, defaults, note — вони б ламалися після зміни кількості змінних).
 */
export function canonSpec(s: ProblemSpec): ProblemSpec {
  const out: ProblemSpec = {
    id: s.id || "custom",
    taskId: "",
    title: s.title || "Своя система",
    vars: s.vars.slice(),
    params: s.params.map((p) => {
      const q: ParamSpec = { name: p.name, value: p.value };
      if (p.label) q.label = p.label;
      if (p.range) q.range = [p.range[0], p.range[1]];
      if (p.log) q.log = true;
      if (p.integer) q.integer = true;
      return q;
    }),
    rhs: s.rhs.slice(),
    y0: s.y0.slice(),
    T: s.T,
  };
  if (s.t && s.t !== "t") out.t = s.t;
  if (s.t0 !== undefined && s.t0 !== 0) out.t0 = s.t0;
  if (s.defs && s.defs.length) out.defs = s.defs.map((d) => ({ name: d.name, expr: d.expr }));
  return out;
}

/** Рядок для порівняння описів (однаковий для однакових систем незалежно від порядку ключів). */
export const specKey = (s: ProblemSpec): string => JSON.stringify(canonSpec(s));

/** Задача курсу → шаблон «Своєї системи» (назва з варіантом, без службових полів). */
export function fromTaskSpec(s: ProblemSpec): ProblemSpec {
  return canonSpec({ ...s, title: specTitle(s) });
}

export function draftFromSpec(s: ProblemSpec): Draft {
  return {
    id: s.id || "custom",
    title: s.title || "Своя система",
    t: s.t || "t",
    vars: s.vars.map((v, i) => ({ name: v, rhs: s.rhs[i] ?? "0", y0: num(s.y0[i] ?? 0) })),
    params: s.params.map((p) => ({
      name: p.name,
      value: num(p.value),
      label: p.label ?? "",
      min: p.range ? num(p.range[0]) : "",
      max: p.range ? num(p.range[1]) : "",
      log: !!p.log,
    })),
    defs: (s.defs ?? []).map((d) => ({ name: d.name, expr: d.expr })),
    t0: num(s.t0 ?? 0),
    T: num(s.T),
  };
}

/**
 * Число з поля: `0.5`, `.5`, `1e-3`, `0,5` (кома), `−2` (типографський мінус), сталий вираз `2*pi`.
 * `undefined` — порожнє поле; `null` — не число.
 */
export function parseNumberField(src: string): number | null | undefined {
  const s = src.trim().replace(/−/g, "-").replace(/(\d),(\d)/g, "$1.$2");
  if (!s) return undefined;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }
  const r = parse(s);
  if (!r.ok) return null;
  if (freeNames(r.ast).some((n) => !isConstantName(n))) return null;
  const v = evaluate(r.ast, {});
  return Number.isFinite(v) ? v : null;
}

const NUM_HINT = "очікується число, напр. 0.5, 1e-3 або 2*pi";

/**
 * Чернетка → опис. Числові поля, що не розбираються, дають {@link NumError} (тоді `spec` = null).
 * Вирази й імена тут НЕ перевіряються — це робить `validateSpec`.
 */
export function specFromDraft(d: Draft): { spec: ProblemSpec | null; numErrors: NumError[] } {
  const errs: NumError[] = [];
  const need = (field: NumError["field"], src: string, what: string, index?: number): number => {
    const v = parseNumberField(src);
    if (v === undefined) {
      errs.push({ field, index, message: `${what}: порожнє поле — ${NUM_HINT}` });
      return NaN;
    }
    if (v === null) {
      errs.push({ field, index, message: `${what}: «${src.trim()}» — не число (${NUM_HINT})` });
      return NaN;
    }
    return v;
  };
  const y0 = d.vars.map((v, i) => need("y0", v.y0, `${v.name || `змінна ${i + 1}`}(t₀)`, i));
  const params: ParamSpec[] = d.params.map((p, i) => {
    const what = `Параметр «${p.name || i + 1}»`;
    const q: ParamSpec = { name: p.name.trim(), value: need("param", p.value, what, i) };
    if (p.label.trim()) q.label = p.label.trim();
    const lo = parseNumberField(p.min),
      hi = parseNumberField(p.max);
    if (lo === null) errs.push({ field: "paramMin", index: i, message: `${what}: мінімум діапазону — не число` });
    if (hi === null) errs.push({ field: "paramMax", index: i, message: `${what}: максимум діапазону — не число` });
    if (typeof lo === "number" && typeof hi === "number") q.range = [lo, hi];
    else if ((lo === undefined) !== (hi === undefined) && lo !== null && hi !== null)
      errs.push({ field: lo === undefined ? "paramMin" : "paramMax", index: i, message: `${what}: для повзунка задайте і мінімум, і максимум (або залиште обидва порожніми)` });
    if (p.log && q.range) q.log = true;
    return q;
  });
  const t0 = need("t0", d.t0, "t₀");
  const T = need("T", d.T, "T");
  if (errs.length) return { spec: null, numErrors: errs };
  const spec = canonSpec({
    id: d.id,
    taskId: "",
    title: d.title.trim() || "Своя система",
    t: d.t.trim() || "t",
    vars: d.vars.map((v) => v.name.trim()),
    params,
    defs: d.defs.map((x) => ({ name: x.name.trim(), expr: x.expr })),
    rhs: d.vars.map((v) => v.rhs),
    y0,
    t0,
    T,
  });
  return { spec, numErrors: [] };
}

const NAME_POOL = ["x", "y", "z", "u", "v", "w", "p", "q", "r", "s"];

/** Перше вільне ім'я для нової змінної / параметра. */
export function freshName(taken: string[], pool: string[] = NAME_POOL, prefix = "y"): string {
  for (const n of pool) if (!taken.includes(n)) return n;
  for (let k = 1; ; k++) if (!taken.includes(`${prefix}${k}`)) return `${prefix}${k}`;
}

/** Усі імена чернетки (для пошуку вільного). */
export const draftNames = (d: Draft): string[] => [d.t, ...d.vars.map((v) => v.name), ...d.params.map((p) => p.name), ...d.defs.map((x) => x.name)];
