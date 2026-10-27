/**
 * Опис задачі Коші як ДАНИХ: імена змінних, параметри, праві частини-рядки, початкові умови.
 * З опису будуються: {@link compileSpec} → `Problem` для `lib/ode.ts` (з аналітичним якобіаном),
 * TeX-запис системи і якобіана (для KaTeX), код Python/MATLAB (`lib/codegen.ts`), варіанти задач.
 *
 * Праві частини — вирази `lib/expr.ts`. У них доступні: ім'я часу (`spec.t`, типово `t`), змінні стану,
 * параметри, допоміжні величини `defs` (оголошені раніше), константи `pi`/`e` (якщо не перевизначені) і функції
 * `sin cos tan asin acos atan atan2 sinh cosh tanh exp log ln log10 sqrt abs sign min max pow floor ceil`.
 *
 * @module problem-spec
 */
import {
  CONSTANTS,
  add,
  astEqual,
  compile,
  diff,
  findName,
  fold,
  formatNumber,
  freeNames,
  isConstantName,
  isFunctionName,
  isIdentifier,
  mul,
  nameToTex,
  parse,
  simplify,
  substitute,
  sym,
  toTex,
  type Compiled,
  type Expr,
} from "./expr";
import type { Mat, Vec } from "./linalg";
import type { MethodId, Problem } from "./ode";

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------

/** Параметр задачі. */
export interface ParamSpec {
  /** ім'я у виразах, напр. "eps", "σ" */
  name: string;
  /** значення за замовчуванням (з умови / зі сторінки) */
  value: number;
  /** підпис українською, напр. «Малий параметр ε» */
  label?: string;
  /** розумний діапазон для варіантів/слайдерів, у якому якісна поведінка задачі та сама */
  range?: [number, number];
  /** діапазон логарифмічний (значення варто брати рівномірно за log) */
  log?: boolean;
  /** лише цілі значення */
  integer?: boolean;
}

/**
 * Допоміжна величина: позначення для підвиразу, напр. `γ = R/(2*L)/1000` або `u = exp(w)`.
 * Може залежати від часу, змінних, параметрів і попередніх `defs`. При компіляції підставляється у праві частини
 * (той самий порядок операцій, що й при окремому обчисленні), у коді Python/MATLAB — обчислюється окремим рядком.
 */
export interface DefSpec {
  name: string;
  expr: string;
  label?: string;
}

/** Опис задачі Коші y′ = f(t, y), y(t0) = y0 на [t0, T]. */
export interface ProblemSpec {
  /** унікальний id, напр. "t12", "t12-ic2", "t25-log", "lorenz" */
  id: string;
  /** id сторінки з lib/tasks.ts ("12", "lorenz"); "" для власних систем */
  taskId: string;
  /** «Хімічна кінетика Робертсона» */
  title: string;
  /** «друга початкова умова», «логарифмічні змінні» */
  variant?: string;
  /** ім'я часу, за замовчуванням "t" */
  t?: string;
  /** імена змінних стану */
  vars: string[];
  /** підписи змінних для графіків/таблиць (Unicode), напр. "u₁ = HBrO₂"; за замовчуванням — імена */
  varLabels?: string[];
  params: ParamSpec[];
  /** допоміжні величини (необов'язково) */
  defs?: DefSpec[];
  /** праві частини, по одній на змінну (рядки-вирази lib/expr) */
  rhs: string[];
  y0: number[];
  t0?: number;
  T: number;
  /** діапазони початкових умов для варіантів (необов'язково) */
  y0Range?: [number, number][];
  TRange?: [number, number];
  /** чи задача жорстка за результатами сторінки */
  stiff?: boolean;
  /** параметри методів, з якими працює сторінка за замовчуванням */
  defaults?: { methods?: MethodId[]; h?: number; rtol?: number; atol?: number };
  /** коротко: звідки умова, що виправлено проти методички */
  note?: string;
}

/** Конкретні значення, що перекривають типові зі специфікації (усі поля необов'язкові). */
export interface SpecValues {
  params?: Record<string, number>;
  y0?: number[];
  t0?: number;
  T?: number;
}

/** Повний набір значень після підстановки типових. */
export interface ResolvedValues {
  params: Record<string, number>;
  y0: number[];
  t0: number;
  T: number;
}

export type SpecField = "id" | "taskId" | "title" | "t" | "vars" | "varLabels" | "params" | "defs" | "rhs" | "y0" | "t0" | "T" | "y0Range" | "TRange" | "defaults";

/** Помилка в описі задачі. Для `rhs`/`defs` — `index` рівняння і позиція [pos, end) у рядку. */
export interface SpecError {
  field: SpecField;
  index?: number;
  message: string;
  pos?: number;
  end?: number;
}

/** Розібрана специфікація (кешується для кожного об'єкта spec). */
export interface ParsedSpec {
  /** ім'я часу */
  t: string;
  vars: string[];
  /** праві частини: AST з іменами defs (не підставленими) */
  rhs: Expr[];
  /** defs у порядку оголошення */
  defs: { name: string; ast: Expr }[];
  /** якобіан ∂rhs_i/∂vars_j з урахуванням defs (ланцюгове правило), спрощений; через імена параметрів і defs */
  jac: Expr[][];
}

// ---------------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------------

export const timeName = (spec: Pick<ProblemSpec, "t">): string => spec.t || "t";

const isFiniteNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Перевіряє опис: імена (допустимі, без дублікатів, без конфліктів із функціями), розбір кожного виразу,
 * невідомі імена, кількості (rhs/y0/varLabels/y0Range = кількість змінних), скінченність чисел, T > t0, діапазони.
 * Константи `pi`/`e` можна перевизначати параметром чи змінною (тоді в усіх виразах це ім'я користувача).
 */
export function validateSpec(spec: ProblemSpec): { errors: SpecError[] } {
  const errors: SpecError[] = [];
  const err = (e: SpecError) => errors.push(e);
  const tName = timeName(spec);
  const declared = new Map<string, string>(); // name → what («змінна», «параметр», …)

  const declare = (field: SpecField, index: number | undefined, name: unknown, what: string) => {
    if (typeof name !== "string" || !name) {
      err({ field, index, message: `Порожнє ім'я (${what})` });
      return;
    }
    if (!isIdentifier(name)) {
      err({ field, index, message: `«${name}» — недопустиме ім'я (${what}): лише літери, цифри та «_», першою — літера` });
      return;
    }
    if (isFunctionName(name)) {
      err({ field, index, message: `Ім'я «${name}» (${what}) збігається з назвою функції — оберіть інше` });
      return;
    }
    const prev = declared.get(name);
    if (prev) {
      err({ field, index, message: `Ім'я «${name}» уже зайняте (${prev})` });
      return;
    }
    declared.set(name, what);
  };

  if (typeof spec.id !== "string" || !spec.id) err({ field: "id", message: "Порожній id задачі" });
  declare("t", undefined, tName, "час");

  if (!Array.isArray(spec.vars) || spec.vars.length === 0) err({ field: "vars", message: "Потрібна хоча б одна змінна стану" });
  const vars = Array.isArray(spec.vars) ? spec.vars : [];
  vars.forEach((v, i) => declare("vars", i, v, "змінна"));

  const params = Array.isArray(spec.params) ? spec.params : [];
  if (!Array.isArray(spec.params)) err({ field: "params", message: "params має бути масивом (можна порожнім)" });
  params.forEach((p, i) => {
    declare("params", i, p?.name, "параметр");
    if (!isFiniteNum(p?.value)) err({ field: "params", index: i, message: `Параметр «${p?.name}»: значення має бути скінченним числом` });
    if (p?.range !== undefined) {
      const r = p.range;
      if (!Array.isArray(r) || r.length !== 2 || !isFiniteNum(r[0]) || !isFiniteNum(r[1]) || r[0] > r[1])
        err({ field: "params", index: i, message: `Параметр «${p.name}»: діапазон має бути [min, max] зі скінченними min ≤ max` });
      else {
        if (p.log && r[0] <= 0) err({ field: "params", index: i, message: `Параметр «${p.name}»: логарифмічний діапазон має бути додатним` });
        if (isFiniteNum(p.value) && (p.value < r[0] || p.value > r[1]))
          err({ field: "params", index: i, message: `Параметр «${p.name}»: значення ${formatNumber(p.value)} поза діапазоном [${formatNumber(r[0])}, ${formatNumber(r[1])}]` });
      }
    }
  });

  const known = new Set<string>([tName, ...vars, ...params.map((p) => p?.name)]);
  const checkExpr = (field: "rhs" | "defs", index: number, src: unknown, where: string): void => {
    if (typeof src !== "string") {
      err({ field, index, message: `${where}: вираз має бути рядком` });
      return;
    }
    const r = parse(src);
    if (!r.ok) {
      err({ field, index, message: `${where}: ${r.error.message}`, pos: r.error.pos, end: r.error.end });
      return;
    }
    for (const n of freeNames(r.ast)) {
      if (known.has(n) || isConstantName(n)) continue;
      const hit = findName(r.ast, n);
      const pos = hit?.pos;
      err({
        field,
        index,
        message: `${where}: невідоме ім'я «${n}». Оголосіть його як змінну, параметр чи допоміжну величину`,
        pos,
        end: pos !== undefined ? pos + n.length : undefined,
      });
    }
  };

  const defs = Array.isArray(spec.defs) ? spec.defs : [];
  defs.forEach((d, i) => {
    declare("defs", i, d?.name, "допоміжна величина");
    checkExpr("defs", i, d?.expr, `Величина «${d?.name}»`);
    if (typeof d?.name === "string") known.add(d.name); // visible to later defs and rhs only
  });

  if (!Array.isArray(spec.rhs)) err({ field: "rhs", message: "rhs має бути масивом рядків" });
  else {
    if (spec.rhs.length !== vars.length)
      err({ field: "rhs", message: `Кількість правих частин (${spec.rhs.length}) не дорівнює кількості змінних (${vars.length})` });
    spec.rhs.forEach((s, i) => checkExpr("rhs", i, s, `Рівняння для ${vars[i] ?? `№${i + 1}`}′`));
  }

  if (!Array.isArray(spec.y0) || spec.y0.length !== vars.length)
    err({ field: "y0", message: `Початкових умов має бути стільки ж, скільки змінних (${vars.length})` });
  else spec.y0.forEach((v, i) => !isFiniteNum(v) && err({ field: "y0", index: i, message: `${vars[i]}(t₀) має бути скінченним числом` }));

  if (spec.varLabels !== undefined && (!Array.isArray(spec.varLabels) || spec.varLabels.length !== vars.length))
    err({ field: "varLabels", message: "Підписів змінних має бути стільки ж, скільки змінних" });

  const t0 = spec.t0 ?? 0;
  if (!isFiniteNum(t0)) err({ field: "t0", message: "t₀ має бути скінченним числом" });
  if (!isFiniteNum(spec.T)) err({ field: "T", message: "T має бути скінченним числом" });
  else if (isFiniteNum(t0) && !(spec.T > t0)) err({ field: "T", message: "Кінець відрізка T має бути більшим за t₀" });

  if (spec.y0Range !== undefined) {
    if (!Array.isArray(spec.y0Range) || spec.y0Range.length !== vars.length) err({ field: "y0Range", message: "y0Range: по діапазону на кожну змінну" });
    else
      spec.y0Range.forEach((r, i) => {
        if (!Array.isArray(r) || r.length !== 2 || !isFiniteNum(r[0]) || !isFiniteNum(r[1]) || r[0] > r[1])
          err({ field: "y0Range", index: i, message: `y0Range для ${vars[i]}: потрібно [min, max], min ≤ max` });
      });
  }
  if (spec.TRange !== undefined) {
    const r = spec.TRange;
    if (!Array.isArray(r) || r.length !== 2 || !isFiniteNum(r[0]) || !isFiniteNum(r[1]) || r[0] > r[1]) err({ field: "TRange", message: "TRange: потрібно [min, max], min ≤ max" });
  }
  const d = spec.defaults;
  if (d) {
    if (d.h !== undefined && !(isFiniteNum(d.h) && d.h > 0)) err({ field: "defaults", message: "defaults.h має бути додатним" });
    if (d.rtol !== undefined && !(isFiniteNum(d.rtol) && d.rtol > 0)) err({ field: "defaults", message: "defaults.rtol має бути додатним" });
    if (d.atol !== undefined && !(isFiniteNum(d.atol) && d.atol > 0)) err({ field: "defaults", message: "defaults.atol має бути додатним" });
  }
  return { errors };
}

/** Текст першої помилки або null. */
export function firstSpecError(spec: ProblemSpec): string | null {
  const { errors } = validateSpec(spec);
  return errors.length ? errors[0].message : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing (cached) and symbolic Jacobian
// ---------------------------------------------------------------------------------------------------------------------

const parsedCache = new WeakMap<ProblemSpec, ParsedSpec>();

/**
 * Замінює піддерева, що збігаються з виразом допоміжної величини, її ім'ям: `exp(w) → u` при `u = exp(w)`.
 * Робить якобіан коротшим (і таким, як його пишуть руками).
 */
function resubstituteDefs(ast: Expr, defs: { name: string; ast: Expr }[]): Expr {
  if (!defs.length) return ast;
  const rec = (n: Expr): Expr => {
    for (const d of defs) if (d.ast.type !== "sym" && d.ast.type !== "num" && astEqual(n, d.ast)) return sym(d.name);
    switch (n.type) {
      case "num":
      case "sym":
        return n;
      case "neg":
        return { type: "neg", arg: rec(n.arg) };
      case "bin":
        return { type: "bin", op: n.op, left: rec(n.left), right: rec(n.right) };
      case "call":
        return { type: "call", fn: n.fn, args: n.args.map(rec) };
    }
  };
  return rec(ast);
}

/**
 * Розбирає специфікацію (кешується у WeakMap за об'єктом spec — не мутуйте spec після першого виклику).
 * Кидає `Error`, якщо опис невалідний (див. {@link validateSpec}).
 */
export function parseSpec(spec: ProblemSpec): ParsedSpec {
  const cached = parsedCache.get(spec);
  if (cached) return cached;
  const { errors } = validateSpec(spec);
  if (errors.length) throw new Error(`Задача «${spec.id}»: ${errors[0].message}`);
  const p = (s: string) => {
    const r = parse(s);
    if (!r.ok) throw new Error(r.error.message);
    return r.ast;
  };
  const defs = (spec.defs ?? []).map((d) => ({ name: d.name, ast: p(d.expr) }));
  const rhs = spec.rhs.map(p);
  const defMap = new Map(defs.map((d) => [d.name, d.ast]));
  // total derivative through defs: ∂e/∂x + Σ_d ∂e/∂d · dd/dx
  const memo = new Map<string, Expr>();
  const total = (e: Expr, x: string): Expr => {
    let r = diff(e, x);
    for (const n of freeNames(e)) {
      const dAst = defMap.get(n);
      if (!dAst) continue;
      const key = `${n}\u0000${x}`;
      let dd = memo.get(key);
      if (!dd) {
        dd = total(dAst, x);
        memo.set(key, dd);
      }
      r = add(r, mul(diff(e, n), dd));
    }
    return simplify(r);
  };
  const jac = rhs.map((e) => spec.vars.map((x) => resubstituteDefs(total(e, x), defs)));
  const parsed: ParsedSpec = { t: timeName(spec), vars: spec.vars.slice(), rhs, defs, jac };
  parsedCache.set(spec, parsed);
  return parsed;
}

/** Вбудовує допоміжні величини у вираз (рекурсивно, у порядку оголошення). */
export function inlineDefs(ast: Expr, defs: { name: string; ast: Expr }[]): Expr {
  if (!defs.length) return ast;
  const map: Record<string, Expr> = {};
  for (const d of defs) map[d.name] = substitute(d.ast, map); // earlier defs already inlined
  return substitute(ast, map);
}

// ---------------------------------------------------------------------------------------------------------------------
// Values and compilation
// ---------------------------------------------------------------------------------------------------------------------

/** Підставляє типові значення там, де `values` нічого не задає (або задає некоректне). */
export function resolveValues(spec: ProblemSpec, values?: SpecValues): ResolvedValues {
  const params: Record<string, number> = {};
  for (const p of spec.params) {
    const v = values?.params?.[p.name];
    params[p.name] = isFiniteNum(v) ? v : p.value;
  }
  const y0 = values?.y0 && values.y0.length === spec.y0.length && values.y0.every(isFiniteNum) ? values.y0.slice() : spec.y0.slice();
  const t0 = isFiniteNum(values?.t0) ? values!.t0! : (spec.t0 ?? 0);
  const T = isFiniteNum(values?.T) ? values!.T! : spec.T;
  return { params, y0, t0, T };
}

/**
 * Будує `Problem` для `solve()` з `lib/ode.ts`: `f` — скомпільовані праві частини (новий масив на кожен виклик),
 * `jac` — АНАЛІТИЧНИЙ якобіан, отриманий символьним диференціюванням (сталі елементи обчислюються один раз).
 * Порядок арифметичних операцій у `f` той самий, що в рядках `rhs`, тож `f` збігається з рукописною функцією
 * сторінки біт-у-біт, якщо рядок записано в тому самому порядку.
 * Кидає `Error` для невалідного опису. Розбір кешується за об'єктом `spec` (WeakMap): після зміни опису створюйте
 * НОВИЙ об'єкт, а не мутуйте старий.
 */
export function compileSpec(spec: ProblemSpec, values?: SpecValues): Problem {
  const parsed = parseSpec(spec);
  const v = resolveValues(spec, values);
  const n = parsed.vars.length;
  // value slots: [t, y_1 … y_n, def_1 … def_k]; a def is computed ONCE per call (same value as inlining it)
  const defNames = parsed.defs.map((d) => d.name);
  const names = [parsed.t, ...parsed.vars, ...defNames];
  const keep = names;
  const prep = (e: Expr, simp: boolean) => {
    let x = substitute(e, v.params);
    if (simp) x = simplify(x);
    return fold(x, { constants: true, keep });
  };
  // defs that depend only on parameters fold to numbers here; the rest are evaluated per call
  const defFns: Compiled[] = parsed.defs.map((d) => compile(prep(d.ast, false), names));
  const k = defFns.length;
  const fs: Compiled[] = parsed.rhs.map((e) => compile(prep(e, false), names));
  const fill = (buf: Float64Array, t: number, y: Vec) => {
    buf[0] = t;
    for (let i = 0; i < n; i++) buf[i + 1] = y[i];
    for (let j = 0; j < k; j++) buf[n + 1 + j] = defFns[j](buf);
  };
  const fScratch = new Float64Array(n + 1 + k);
  const [f0, f1, f2, f3] = fs;
  // packed array literals for the usual sizes (faster than new Array(n) + writes)
  const f: (t: number, y: Vec) => Vec =
    n === 1
      ? (t, y) => (fill(fScratch, t, y), [f0(fScratch)])
      : n === 2
        ? (t, y) => (fill(fScratch, t, y), [f0(fScratch), f1(fScratch)])
        : n === 3
          ? (t, y) => (fill(fScratch, t, y), [f0(fScratch), f1(fScratch), f2(fScratch)])
          : n === 4
            ? (t, y) => (fill(fScratch, t, y), [f0(fScratch), f1(fScratch), f2(fScratch), f3(fScratch)])
            : (t, y) => {
                fill(fScratch, t, y);
                const out: number[] = [];
                for (let i = 0; i < n; i++) out.push(fs[i](fScratch));
                return out;
              };
  // Jacobian: constant entries are evaluated once; the rest — compiled closures (defs via the same slots)
  const jScratch = new Float64Array(n + 1 + k);
  const entries: Compiled[][] = parsed.jac.map((row) =>
    row.map((e) => {
      const a = prep(e, true);
      if (a.type === "num") {
        const c = a.value;
        return () => c;
      }
      return compile(a, names);
    }),
  );
  const rowFns: ((b: Float64Array) => number[])[] = entries.map((r) => {
    const [g0, g1, g2, g3] = r;
    if (n === 1) return (b) => [g0(b)];
    if (n === 2) return (b) => [g0(b), g1(b)];
    if (n === 3) return (b) => [g0(b), g1(b), g2(b)];
    if (n === 4) return (b) => [g0(b), g1(b), g2(b), g3(b)];
    return (b) => r.map((g) => g(b));
  });
  const jac = (t: number, y: Vec): Mat => {
    fill(jScratch, t, y);
    const J: Mat = [];
    for (let i = 0; i < n; i++) J.push(rowFns[i](jScratch));
    return J;
  };
  return { f, jac, y0: v.y0, t0: v.t0, T: v.T };
}

/** Імена, що їх бачать вирази: час, змінні, параметри, defs. */
export function specNames(spec: ProblemSpec): string[] {
  return [timeName(spec), ...spec.vars, ...spec.params.map((p) => p.name), ...(spec.defs ?? []).map((d) => d.name)];
}

// ---------------------------------------------------------------------------------------------------------------------
// TeX
// ---------------------------------------------------------------------------------------------------------------------

export interface SpecTexOptions {
  /** підставити числові значення параметрів (і згорнути константи) замість імен */
  substitute?: boolean;
  /** значення для підстановки (типово — зі специфікації) */
  values?: SpecValues;
}

const userNamesOf = (spec: ProblemSpec) => new Set(specNames(spec));

/** Значення допоміжних величин, що залежать лише від параметрів (γ = R/2L/1000 → 2), для показу з числами. */
function numericDefs(spec: ProblemSpec, params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of parseSpec(spec).defs) {
    const x = fold(substitute(substitute(d.ast, out), params), { constants: true, keep: specNames(spec) });
    if (x.type === "num") out[d.name] = x.value;
  }
  return out;
}

function texOf(spec: ProblemSpec, ast: Expr, opts: SpecTexOptions = {}): string {
  const user = userNamesOf(spec);
  let e = ast;
  if (opts.substitute) {
    const v = resolveValues(spec, opts.values);
    // parameter-only defs become numbers too; identities (1·t → t) are simplified for reading
    e = simplify(fold(substitute(substitute(e, numericDefs(spec, v.params)), v.params)));
  }
  return toTex(e, nameToTex, (n) => user.has(n));
}

/** TeX-рядки рівнянь: `["u_{1}' = -k_{1} u_{1} + …", …]`. */
export function specRhsTex(spec: ProblemSpec, opts: SpecTexOptions = {}): string[] {
  const parsed = parseSpec(spec);
  return parsed.rhs.map((e, i) => `${nameToTex(spec.vars[i])}' = ${texOf(spec, e, opts)}`);
}

/**
 * TeX-рядки допоміжних величин: `["\gamma = \frac{R}{2 L}…", …]`. З `substitute: true` величини, що залежать лише
 * від параметрів, уже підставлені числами в рівняння, тому тут лишаються тільки ті, що залежать від стану/часу.
 */
export function specDefsTex(spec: ProblemSpec, opts: SpecTexOptions = {}): string[] {
  const parsed = parseSpec(spec);
  const skip = opts.substitute ? numericDefs(spec, resolveValues(spec, opts.values).params) : {};
  return parsed.defs.filter((d) => !(d.name in skip)).map((d) => `${nameToTex(d.name)} = ${texOf(spec, d.ast, opts)}`);
}

/** Система цілком: `\begin{cases} … \end{cases}` (для однієї змінної — просто рівняння). */
export function specSystemTex(spec: ProblemSpec, opts: SpecTexOptions = {}): string {
  const lines = specRhsTex(spec, opts);
  if (lines.length === 1) return lines[0];
  return `\\begin{cases} ${lines.join(", \\\\ ")} \\end{cases}`;
}

/** Початкові умови і відрізок: `u_{1}(0) = 1,\ u_{2}(0) = 0,\quad t \in [0, 10]`. */
export function specInitialTex(spec: ProblemSpec, values?: SpecValues): string {
  const v = resolveValues(spec, values);
  const t = nameToTex(timeName(spec));
  const t0 = texOf(spec, { type: "num", value: v.t0 });
  const ics = spec.vars.map((x, i) => `${nameToTex(x)}(${t0}) = ${texOf(spec, { type: "num", value: v.y0[i] })}`);
  return `${ics.join(",\\ ")},\\quad ${t} \\in [${t0},\\ ${texOf(spec, { type: "num", value: v.T })}]`;
}

/** Параметри: `k_{1} = 0.04,\ k_{2} = 10^{4}, …` (порожній рядок, якщо параметрів немає). */
export function specParamsTex(spec: ProblemSpec, values?: SpecValues): string {
  const v = resolveValues(spec, values);
  return spec.params.map((p) => `${nameToTex(p.name)} = ${texOf(spec, { type: "num", value: v.params[p.name] })}`).join(",\\ ");
}

/**
 * Матриця якобіана в TeX: `J = \begin{pmatrix} … \end{pmatrix}`. Елементи — символьні похідні
 * (через імена параметрів і допоміжних величин; з `substitute: true` — з числами).
 */
export function specJacobianTex(spec: ProblemSpec, opts: SpecTexOptions & { withLhs?: boolean } = {}): string {
  const parsed = parseSpec(spec);
  const rows = parsed.jac.map((row) => row.map((e) => texOf(spec, opts.substitute ? simplify(e) : e, opts)).join(" & "));
  const m = `\\begin{pmatrix} ${rows.join(" \\\\ ")} \\end{pmatrix}`;
  return opts.withLhs === false ? m : `J = ${m}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Untrusted input (URL, JSON)
// ---------------------------------------------------------------------------------------------------------------------

const isStr = (x: unknown): x is string => typeof x === "string";
const isRange = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && isFiniteNum(x[0]) && isFiniteNum(x[1]);
const METHOD_IDS: readonly MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "dopri", "ros", "thetaA"];

/**
 * Перевіряє СТРУКТУРУ невідомого значення (напр. JSON з адреси сторінки) і повертає чисту копію `ProblemSpec`
 * лише з відомими полями або `null`. Семантику (розбір виразів, імена) перевіряє {@link validateSpec}.
 * Обмеження розміру: ≤ 12 змінних, ≤ 40 параметрів/defs, вирази ≤ 2000 символів.
 */
export function sanitizeSpec(x: unknown): ProblemSpec | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const strArr = (a: unknown, max: number) => (Array.isArray(a) && a.length <= max && a.every((s) => isStr(s) && s.length <= 2000) ? (a as string[]).slice() : null);
  const vars = strArr(o.vars, 12);
  const rhs = strArr(o.rhs, 12);
  if (!vars || !rhs) return null;
  if (!Array.isArray(o.y0) || o.y0.length > 12 || !o.y0.every(isFiniteNum)) return null;
  if (!isFiniteNum(o.T)) return null;
  const params: ParamSpec[] = [];
  if (o.params !== undefined) {
    if (!Array.isArray(o.params) || o.params.length > 40) return null;
    for (const p of o.params as unknown[]) {
      if (!p || typeof p !== "object") return null;
      const q = p as Record<string, unknown>;
      if (!isStr(q.name) || !isFiniteNum(q.value)) return null;
      const ps: ParamSpec = { name: q.name, value: q.value };
      if (isStr(q.label)) ps.label = q.label.slice(0, 200);
      if (isRange(q.range)) ps.range = [q.range[0], q.range[1]];
      if (q.log === true) ps.log = true;
      if (q.integer === true) ps.integer = true;
      params.push(ps);
    }
  }
  const spec: ProblemSpec = {
    id: isStr(o.id) && o.id ? o.id.slice(0, 80) : "custom",
    taskId: isStr(o.taskId) ? o.taskId.slice(0, 40) : "",
    title: isStr(o.title) ? o.title.slice(0, 200) : "Своя система",
    vars,
    params,
    rhs,
    y0: (o.y0 as number[]).slice(),
    T: o.T,
  };
  if (isStr(o.variant)) spec.variant = o.variant.slice(0, 200);
  if (isStr(o.t) && o.t) spec.t = o.t.slice(0, 40);
  if (isFiniteNum(o.t0)) spec.t0 = o.t0;
  const labels = strArr(o.varLabels, 12);
  if (labels) spec.varLabels = labels;
  if (Array.isArray(o.defs) && o.defs.length <= 40) {
    const defs: DefSpec[] = [];
    for (const d of o.defs as unknown[]) {
      const q = d as Record<string, unknown> | null;
      if (!q || !isStr(q.name) || !isStr(q.expr) || q.expr.length > 2000) return null;
      defs.push(isStr(q.label) ? { name: q.name, expr: q.expr, label: q.label.slice(0, 200) } : { name: q.name, expr: q.expr });
    }
    if (defs.length) spec.defs = defs;
  }
  if (Array.isArray(o.y0Range) && o.y0Range.every(isRange)) spec.y0Range = (o.y0Range as [number, number][]).map((r) => [r[0], r[1]]);
  if (isRange(o.TRange)) spec.TRange = [o.TRange[0], o.TRange[1]];
  if (typeof o.stiff === "boolean") spec.stiff = o.stiff;
  if (o.defaults && typeof o.defaults === "object") {
    const d = o.defaults as Record<string, unknown>;
    const def: NonNullable<ProblemSpec["defaults"]> = {};
    if (Array.isArray(d.methods)) def.methods = (d.methods as unknown[]).filter((m): m is MethodId => METHOD_IDS.includes(m as MethodId));
    if (isFiniteNum(d.h) && d.h > 0) def.h = d.h;
    if (isFiniteNum(d.rtol) && d.rtol > 0) def.rtol = d.rtol;
    if (isFiniteNum(d.atol) && d.atol > 0) def.atol = d.atol;
    spec.defaults = def;
  }
  if (isStr(o.note)) spec.note = o.note.slice(0, 2000);
  return spec;
}

/** Константи, які вирази бачать без оголошення (для довідки в редакторі). */
export const BUILTIN_CONSTANTS: Readonly<Record<string, number>> = CONSTANTS;
