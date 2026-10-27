/**
 * «Арена методів»: діаграми «похибка — вартість» (work-precision, як у Хайрера–Ваннера) для всіх методів платформи
 * на задачах курсу. Чистий модуль без React: еталони, розгортка за кроком / допуском, похибки, вартість,
 * інтерполяція «вартість досягнення ε», рейтинг, автоматичні висновки і дані для квізів.
 *
 * Обчислення оформлено як генератор {@link arenaJobs}: кожен `yield` — невелика порція роботи (один шматок інтегрування
 * на кілька мілісекунд), а {@link runSliced} виконує генератор порціями по ~40 мс через `MessageChannel`/`setTimeout(0)`,
 * віддаючи керування браузеру між порціями. Результати кешуються в пам'яті ({@link arenaStore}) за ключем
 * (задача, метод, параметр), тож зупинка й продовження нічого не перераховують.
 *
 * Методика (те саме пояснено на сторінці в режимі «Науково»):
 * - еталон: два незалежні розв'язки. Кращий — DOPRI rtol 1e-12; другий — RK4 з кроком, у 10 разів дрібнішим за
 *   середній крок DOPRI (нежорсткі задачі), або Розенброк rtol 1e-11 (жорсткі). Якщо DOPRI на жорсткій задачі не
 *   вкладається в 1.5·10⁵ кроків — Розенброк rtol 1e-11 (кращий) проти rtol 1e-10. Розбіжність δ між еталонами —
 *   оцінка їхньої похибки; межа довіри F = 10δ: похибки, менші за F, не оцінюються (показуються «в тумані» на рівні F),
 *   а цілі ε < F пропускаються. (Розенброк 2-го порядку при rtol 1e-11 на нежорстких задачах сам помиляється на
 *   10⁻⁸…10⁻⁶, тож там він не еталон.)
 * - хаотичні задачі (№5, №16, Лоренц): еталони йдуть синхронно по сітці T/200; T_cmp — останній вузол, до якого їхня
 *   розбіжність (відносно розмаху компонент) не перевищила 1e-8, причому жодна компонента в ньому не ближча до нуля,
 *   ніж 5 % свого розмаху (щоб відносна похибка мала зміст);
 * - похибка: E = max_i |y_i(T) − y_i^ref(T)| / max(|y_i^ref(T)|, a_i), a_i = 1e-6·max_t |y_i^ref(t)|;
 * - вартість: f-обчислення + n·(обчислення якобіана) — як коли якобіан рахують різницями;
 * - розгортка: сталий крок h = (T − t0)/N, N = 8·3^k (k = 0…8, до 52 488); адаптивні — rtol = 1e-2…1e-10,
 *   atol = rtol·σ (σ — співвідношення atol/rtol зі сторінки задачі, типово 1e-3), ліміт 5·10⁴ кроків.
 *
 * @module arena
 */
import { solve, isAdaptive, isExplicit, type MethodId, type Problem, type Solution } from "./ode";
import { compileSpec, type ProblemSpec } from "./problem-spec";
import { TASK_SPECS, specById } from "./task-specs";
import { fmt, sup } from "./format";

// ---------------------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------------------

/** Усі учасники в порядку таблиць. */
export const ARENA_METHODS: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "dopri", "ros", "thetaA"];
/** Явні методи (зокрема адаптивний DOPRI): не потребують розв'язування рівнянь, але обмежені стійкістю. */
export const EXPLICIT_METHODS: MethodId[] = ["euler", "rk2", "rk3", "rk4", "dopri"];
/** Неявні та лінійно-неявні методи: платять за якобіан і лінійні системи. */
export const IMPLICIT_METHODS: MethodId[] = ["ieuler", "theta", "trap", "bdf2", "ros", "thetaA"];
export const isExplicitFamily = (m: MethodId) => EXPLICIT_METHODS.includes(m);

/** Цільові точності. */
export const TARGETS = [1e-3, 1e-6, 1e-9] as const;
export type Target = (typeof TARGETS)[number];

/** Розгортка методів зі сталим кроком: N = 8·3^k кроків на [t0, T]. */
export const N_GRID: number[] = Array.from({ length: 9 }, (_, k) => 8 * 3 ** k);
/** Розгортка адаптивних методів за rtol. */
export const RTOL_GRID: number[] = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-10];
/** Ліміт кроків (прийнятих + відкинутих) адаптивного методу на один прогін. */
export const MAX_ADAPTIVE_STEPS = 50_000;
/** Ліміт кроків одного еталонного розв'язку. */
export const MAX_REF_STEPS = 3_000_000;
/** Хаотичні задачі: горизонт порівняння — доки еталони розходяться не більше ніж на це значення. */
export const CHAOS_DIVERGENCE = 1e-8;
/** Сітка пошуку T_cmp для хаотичних задач: T/CHAOS_GRID. */
export const CHAOS_GRID = 200;
/** Хаотичні задачі: T_cmp — вузол, де кожна компонента не ближча до нуля, ніж ця частка її розмаху. */
export const CHAOS_AWAY_FROM_ZERO = 0.05;
/** Поріг нуля компоненти: a_i = SCALE_FLOOR·max_t |y_i^ref(t)|. */
export const SCALE_FLOOR = 1e-6;
/** Межа довіри F = TRUST_FACTOR·δ. */
export const TRUST_FACTOR = 10;
/** Рядки сторінок задач, для яких розв'язок хаотичний. */
export const CHAOTIC_TASK_IDS = ["5", "16", "lorenz"];

/**
 * Еталони. Кращий — DOPRI rtol 1e-12; другий, незалежний: на нежорсткій задачі — RK4 зі сталим кроком, у
 * REF_RK4_FACTOR разів дрібнішим за середній крок DOPRI, на жорсткій — Розенброк rtol 1e-11. Якщо DOPRI на жорсткій
 * задачі не вкладається в бюджет — Розенброк rtol 1e-11 (кращий) і Розенброк rtol 1e-10.
 */
export const REF_DOPRI = { method: "dopri" as MethodId, rtol: 1e-12 };
export const REF_ROS = { method: "ros" as MethodId, rtol: 1e-11 };
export const REF_ROS_LOOSE = { method: "ros" as MethodId, rtol: 1e-10 };
export const REF_RK4_FACTOR = 10;
/** Бюджет кроків DOPRI-еталона на жорсткій задачі. */
export const DOPRI_STIFF_BUDGET = 150_000;

/** Основна специфікація кожної задачі (перша з `specsForTask`), у порядку реєстру. */
export const ARENA_MAIN_SPECS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of TASK_SPECS) {
    if (!s.taskId || seen.has(s.taskId)) continue;
    seen.add(s.taskId);
    out.push(s.id);
  }
  return out;
})();

/** Усі специфікації, доступні на арені. */
export const ARENA_ALL_SPECS: string[] = TASK_SPECS.filter((s) => s.taskId).map((s) => s.id);

/**
 * Представницький набір за замовчуванням: лінійна жорстка (№1), Робертсон (№12), жорсткий Ван дер Поль μ = 1000,
 * брюсселятор (№18), орегонатор (№24), гладка нежорстка RLC-задача (№22 — на ній чисто видно порядки), Лоренц,
 * Реслер (№5).
 */
export const DEFAULT_ARENA_SPECS: string[] = ["t1", "t5", "t12", "t14-stiff", "t18", "t22", "t24", "lorenz"];

/** Упорядкувати вибір за реєстром специфікацій (так рядки таблиць і адреса стабільні). */
export const sortSpecs = (ids: string[]) => ARENA_ALL_SPECS.filter((id) => ids.includes(id));
export const sortMethods = (ms: MethodId[]) => ARENA_METHODS.filter((m) => ms.includes(m));

/** Задачі, у яких перевіряються спостережені порядки методів зі сталим кроком (гладкі, нежорсткі). */
export const isChaoticSpec = (spec: ProblemSpec) => CHAOTIC_TASK_IDS.includes(spec.taskId);

/** Порядок методу для перевірки нахилів. */
export const NOMINAL_ORDER: Partial<Record<MethodId, number>> = { euler: 1, rk2: 2, rk3: 3, rk4: 4, ieuler: 1, theta: 1, trap: 2, bdf2: 2 };

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------

export interface RefRun {
  method: MethodId;
  /** NaN для RK4 зі сталим кроком */
  rtol: number;
  atol: number;
  /** кількість кроків RK4 */
  N?: number;
  steps: number;
  rejected: number;
  fevals: number;
  jevals: number;
  ms: number;
  failed?: string;
}

export interface Reference {
  specId: string;
  /** розмірність */
  n: number;
  t0: number;
  /** момент порівняння (T або T_cmp) */
  T: number;
  /** кінець відрізка зі специфікації */
  Tfull: number;
  chaotic: boolean;
  stiff: boolean;
  /** кращий еталон у момент T */
  y: number[];
  /** другий (менш точний) еталон у момент T */
  yAlt: number[];
  /** пороги нуля a_i */
  scale: number[];
  /** розбіжність еталонів δ у момент T (тією ж мірою, що й похибки) */
  delta: number;
  /** межа довіри F = 10δ (не менше 1e-13) */
  floor: number;
  /** співвідношення atol/rtol для адаптивних методів */
  sigma: number;
  /** поріг «вибуху» для прогонів */
  blowup: number;
  /** [другий, кращий] */
  runs: [RefRun, RefRun];
  /** для хаотичних: розбіжність еталонів на сітці (відносно розмаху компонент) і момент, коли вона перевищила поріг */
  divergence?: { t: number[]; d: number[]; lost?: number };
  /** чому DOPRI не став еталоном (жорсткі задачі) */
  dopriNote?: string;
  failed?: string;
  ms: number;
}

export type FailKind = "blowup" | "newton" | "steps" | "small" | "nan" | "other";

export interface ArenaRun {
  specId: string;
  method: MethodId;
  /** N для сталого кроку, rtol для адаптивних */
  param: number;
  /** похибка; NaN — прогін невдалий */
  error: number;
  /** f + n·J */
  cost: number;
  fevals: number;
  jevals: number;
  steps: number;
  rejected: number;
  ms: number;
  failed?: string;
  failKind?: FailKind;
}

export type CostAxis = "f" | "ms";

// ---------------------------------------------------------------------------------------------------------------------
// Store (module-level cache, survives re-mounts)
// ---------------------------------------------------------------------------------------------------------------------

export class ArenaStore {
  refs = new Map<string, Reference>();
  runs = new Map<string, ArenaRun>();
  /** spec|method → чому розгортку завершено раніше */
  stops = new Map<string, string>();
  /** spec|method → розгортку завершено */
  complete = new Set<string>();
  version = 0;
  /** версія даних окремої задачі: графік перераховується, лише коли змінилася його задача */
  specVersions = new Map<string, number>();
  private listeners = new Set<() => void>();
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  bump(specId?: string) {
    this.version++;
    if (specId) this.specVersions.set(specId, (this.specVersions.get(specId) ?? 0) + 1);
    for (const l of this.listeners) l();
  }
  clear() {
    this.refs.clear();
    this.runs.clear();
    this.stops.clear();
    this.complete.clear();
    this.specVersions.clear();
    this.bump();
  }
}

export const arenaStore = new ArenaStore();

export const runKey = (specId: string, m: MethodId, param: number) => `${specId}|${m}|${param}`;
export const curveKey = (specId: string, m: MethodId) => `${specId}|${m}`;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function classifyFailure(msg: string | undefined): FailKind | undefined {
  if (!msg) return undefined;
  if (msg.includes("вибухнув")) return "blowup";
  if (msg.includes("Ньютона")) return "newton";
  if (msg.includes("ліміт кроків")) return "steps";
  if (msg.includes("надто малим")) return "small";
  if (msg.includes("NaN")) return "nan";
  return "other";
}

/** Міра похибки арени: max_i |y_i − ref_i| / max(|ref_i|, a_i). NaN, якщо y містить NaN. */
export function arenaError(y: ArrayLike<number>, ref: ArrayLike<number>, scale: ArrayLike<number>): number {
  let e = 0;
  for (let i = 0; i < ref.length; i++) {
    const d = Math.abs(y[i] - ref[i]) / Math.max(Math.abs(ref[i]), scale[i]);
    if (!(d <= e)) e = d; // NaN propagates
  }
  return e;
}

const last = <T>(a: T[]) => a[a.length - 1];

function specSigma(spec: ProblemSpec): number {
  const d = spec.defaults;
  return d?.rtol && d?.atol ? d.atol / d.rtol : 1e-3;
}

interface Acc {
  fevals: number;
  jevals: number;
  steps: number;
  rejected: number;
  ms: number;
}
const acc0 = (): Acc => ({ fevals: 0, jevals: 0, steps: 0, rejected: 0, ms: 0 });
function addSol(a: Acc, s: Solution) {
  a.fevals += s.fevals;
  a.jevals += s.jevals;
  a.steps += s.steps;
  a.rejected += s.rejected;
  a.ms += s.ms;
}

/** Розмір шматка інтегрування (кроків) — так, щоб один шматок займав кілька мілісекунд. */
function chunkSteps(m: MethodId): number {
  if (isExplicit(m)) return 20000;
  if (m === "dopri") return 8000;
  if (m === "ros") return 4000;
  if (m === "thetaA") return 1200;
  return 2500; // ieuler, theta, trap
}

const isLimitMsg = (msg?: string) => !!msg && msg.startsWith("Вичерпано ліміт кроків");

interface RawRun extends Acc {
  y: number[] | null;
  tEnd: number;
  failed?: string;
}

/**
 * Адаптивний прогін шматками: `solve` з `maxSteps = шматок`; якщо ліміт шматка вичерпано, продовжуємо з останньої
 * точки з `hInit` = останній прийнятий крок (контролер кроку методів бібліотеки не має пам'яті, тож це майже те саме,
 * що й один суцільний прогін).
 */
function* adaptiveChunks(m: MethodId, p: Problem, rtol: number, atol: number, blowup: number, maxTotal: number, chunk = chunkSteps(m), visit?: (s: Solution) => void): Generator<void, RawRun> {
  const a = acc0();
  let t = p.t0 ?? 0;
  let y = p.y0.slice();
  let hInit: number | undefined;
  for (;;) {
    const lim = Math.max(1, Math.min(chunk, maxTotal - a.steps - a.rejected));
    const s = solve(m, { ...p, t0: t, y0: y }, { rtol, atol, maxSteps: lim, hInit, blowup });
    addSol(a, s);
    visit?.(s);
    const tEnd = last(s.t);
    const yEnd = last(s.y);
    if (!s.failed) return { ...a, y: yEnd.slice(), tEnd };
    if (isLimitMsg(s.failed)) {
      if (a.steps + a.rejected >= maxTotal) {
        return { ...a, y: null, tEnd, failed: `Вичерпано ліміт кроків (${maxTotal.toLocaleString("uk-UA")}) при t ≈ ${tEnd.toPrecision(4)}` };
      }
      if (s.steps > 0) {
        t = tEnd;
        y = yEnd.slice();
        hInit = last(s.hs);
      } else hInit = (hInit ?? 1e-3) * 0.1;
      yield;
      continue;
    }
    return { ...a, y: null, tEnd, failed: s.failed };
  }
}

/**
 * Прогін зі сталим кроком h = (T − t0)/N. Однокрокові методи інтегруються шматками по M кроків: це ТОЙ САМИЙ
 * розв'язок (кожен крок залежить лише від попередньої точки). BDF2 — двокроковий: його не можна перезапустити без
 * зміни методу, тому він виконується одним викликом.
 */
function* fixedChunks(m: MethodId, p: Problem, N: number, blowup: number, visit?: (s: Solution) => void): Generator<void, RawRun> {
  const t0 = p.t0 ?? 0;
  const T = p.T;
  const hG = (T - t0) / N;
  const a = acc0();
  if (m === "bdf2") {
    const s = solve(m, p, { h: hG, blowup });
    addSol(a, s);
    return { ...a, y: s.failed ? null : last(s.y).slice(), tEnd: last(s.t), failed: s.failed };
  }
  const M = chunkSteps(m);
  let done = 0;
  let y = p.y0.slice();
  while (done < N) {
    const k = Math.min(M, N - done);
    const ta = t0 + done * hG;
    const tb = done + k >= N ? T : t0 + (done + k) * hG;
    const s = solve(m, { ...p, t0: ta, T: tb, y0: y }, { h: (tb - ta) / k, blowup });
    addSol(a, s);
    visit?.(s);
    if (s.failed) return { ...a, y: null, tEnd: last(s.t), failed: s.failed };
    y = last(s.y).slice();
    done += k;
    if (done < N) yield;
  }
  return { ...a, y, tEnd: T };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------------------------------

/** Задача для прогонів методів: специфікація з T = T_cmp. */
export function arenaProblem(spec: ProblemSpec, ref: Pick<Reference, "T">): Problem {
  return compileSpec(spec, { T: ref.T });
}

function* computeReference(spec: ProblemSpec): Generator<void, Reference> {
  const start = now();
  const prob = compileSpec(spec);
  const n = prob.y0.length;
  const t0 = prob.t0 ?? 0;
  const chaotic = isChaoticSpec(spec);
  const stiff = !!spec.stiff;
  const sigma = specSigma(spec);
  const mk = (d: { method: MethodId; rtol: number }): RefRun => ({ method: d.method, rtol: d.rtol, atol: d.rtol * sigma, steps: 0, rejected: 0, fevals: 0, jevals: 0, ms: 0 });
  const maxAbs = prob.y0.map((v) => Math.abs(v));
  const visit = (s: Solution) => {
    for (const v of s.y) for (let i = 0; i < n; i++) maxAbs[i] = Math.max(maxAbs[i], Math.abs(v[i]));
  };
  const scaleOf = () => {
    const all = Math.max(...maxAbs);
    return maxAbs.map((v) => Math.max(SCALE_FLOOR * v, 1e-12 * all, 1e-300));
  };
  const blowupRef = 1e12;
  const book = (R: RefRun, raw: RawRun) => {
    R.steps += raw.steps;
    R.rejected += raw.rejected;
    R.fevals += raw.fevals;
    R.jevals += raw.jevals;
    R.ms += raw.ms;
    if (!raw.y) R.failed = raw.failed;
    return raw.y;
  };
  /** adaptive reference on [ta, tb] (chunked) */
  function* adaptive(R: RefRun, ta: number, tb: number, y: number[], budget: number): Generator<void, number[] | null> {
    const g = adaptiveChunks(R.method, { ...prob, t0: ta, T: tb, y0: y }, R.rtol, R.atol, blowupRef, budget - R.steps - R.rejected, R.method === "dopri" ? 20000 : 6000, visit);
    let res: IteratorResult<void, RawRun>;
    while (!(res = g.next()).done) yield;
    return book(R, res.value);
  }
  /** RK4 reference on [ta, tb] with N fixed steps (chunked, exact) */
  function* rk4(R: RefRun, ta: number, tb: number, y: number[], N: number): Generator<void, number[] | null> {
    const g = fixedChunks("rk4", { ...prob, t0: ta, T: tb, y0: y }, N, blowupRef, visit);
    let res: IteratorResult<void, RawRun>;
    while (!(res = g.next()).done) yield;
    R.N = (R.N ?? 0) + N;
    return book(R, res.value);
  }
  let failed: string | undefined;
  const dp = mk(REF_DOPRI);
  const rk: RefRun = { method: "rk4", rtol: NaN, atol: NaN, steps: 0, rejected: 0, fevals: 0, jevals: 0, ms: 0, N: 0 };
  let alt: RefRun = rk,
    best: RefRun = dp;
  let yAlt: number[] = prob.y0.slice(),
    yBest: number[] = prob.y0.slice();
  let Tcmp = prob.T;
  let divergence: Reference["divergence"];
  let dopriNote: string | undefined;
  if (!chaotic) {
    const yd = yield* adaptive(dp, t0, prob.T, prob.y0.slice(), stiff ? DOPRI_STIFF_BUDGET : MAX_REF_STEPS);
    yield;
    if (yd && !stiff) {
      // non-stiff: second reference — RK4 with a fixed step REF_RK4_FACTOR times finer than DOPRI's mean step
      const yr = yield* rk4(rk, t0, prob.T, prob.y0.slice(), Math.max(64, REF_RK4_FACTOR * dp.steps));
      yield;
      yBest = yd;
      yAlt = yr ?? yd;
      if (!yr) failed = `Еталон (RK4, N = ${rk.N}) не побудовано: ${rk.failed}`;
    } else if (yd) {
      // stiff: second reference — L-stable Rosenbrock rtol 1e-11 (RK4 is not a trustworthy reference on stiff problems)
      alt = mk(REF_ROS);
      const yr = yield* adaptive(alt, t0, prob.T, prob.y0.slice(), MAX_REF_STEPS);
      yield;
      yBest = yd;
      yAlt = yr ?? yd;
      if (!yr) failed = `Еталон (Розенброк, rtol ${alt.rtol}) не побудовано: ${alt.failed}`;
    } else {
      // explicit DOPRI is held back by stability: Rosenbrock rtol 1e-11 (better) vs 1e-10
      dopriNote = `DOPRI rtol ${dp.rtol} не вклався в ${DOPRI_STIFF_BUDGET.toLocaleString("uk-UA")} кроків (${dp.failed ?? ""})`;
      best = mk(REF_ROS);
      alt = mk(REF_ROS_LOOSE);
      const y1 = yield* adaptive(best, t0, prob.T, prob.y0.slice(), MAX_REF_STEPS);
      yield;
      const y2 = y1 ? yield* adaptive(alt, t0, prob.T, prob.y0.slice(), MAX_REF_STEPS) : null;
      yield;
      if (!y1 || !y2) failed = `Еталон (Розенброк) не побудовано: ${best.failed ?? alt.failed}`;
      else {
        yBest = y1;
        yAlt = y2;
      }
    }
  } else {
    // chaotic: both references advance in lockstep over the grid t_k = t0 + k(T − t0)/CHAOS_GRID; the divergence is
    // measured relative to each component's range (zero crossings do not fake a divergence); the comparison horizon is
    // the last node before it exceeds CHAOS_DIVERGENCE where no component is near zero (so the relative error is meaningful)
    const divT: number[] = [t0];
    const divD: number[] = [0];
    const nodes: { t: number; a: number[]; b: number[]; max: number[] }[] = [];
    let tPrev = t0;
    let ya = prob.y0.slice(),
      yb = prob.y0.slice();
    for (let k = 1; k <= CHAOS_GRID; k++) {
      const tb = k === CHAOS_GRID ? prob.T : t0 + ((prob.T - t0) * k) / CHAOS_GRID;
      const s0 = dp.steps;
      const nb = yield* adaptive(dp, tPrev, tb, yb, MAX_REF_STEPS);
      const na = nb ? yield* rk4(rk, tPrev, tb, ya, Math.max(16, REF_RK4_FACTOR * (dp.steps - s0))) : null;
      yield;
      if (!na || !nb) {
        failed = `Еталон не побудовано: ${dp.failed ?? rk.failed}`;
        break;
      }
      let d = 0;
      for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(na[i] - nb[i]) / Math.max(maxAbs[i], 1e-300));
      divT.push(tb);
      divD.push(d);
      if (!(d <= CHAOS_DIVERGENCE)) break;
      ya = na;
      yb = nb;
      tPrev = tb;
      nodes.push({ t: tb, a: na, b: nb, max: maxAbs.slice() });
    }
    // the last node with every component at least CHAOS_AWAY_FROM_ZERO of its range away from zero
    let pick = nodes.length - 1;
    while (pick >= 0 && nodes[pick].b.some((v, i) => Math.abs(v) < CHAOS_AWAY_FROM_ZERO * nodes[pick].max[i])) pick--;
    if (pick < 0) pick = nodes.length - 1;
    if (pick >= 0) {
      Tcmp = nodes[pick].t;
      yAlt = nodes[pick].a;
      yBest = nodes[pick].b;
    } else if (!failed) failed = "Еталони розходяться вже на першому вузлі сітки";
    divergence = { t: divT, d: divD, lost: divD[divD.length - 1] > CHAOS_DIVERGENCE ? divT[divT.length - 1] : undefined };
  }
  const scale = scaleOf();
  const delta = failed ? NaN : arenaError(yAlt, yBest, scale);
  const floor = Math.max(TRUST_FACTOR * delta, 1e-13);
  const top = Math.max(1, ...maxAbs);
  return {
    specId: spec.id,
    n,
    t0,
    T: Tcmp,
    Tfull: prob.T,
    chaotic,
    stiff,
    y: yBest,
    yAlt,
    scale,
    delta,
    floor,
    sigma,
    blowup: 1e6 * top,
    runs: [alt, best],
    dopriNote,
    divergence,
    failed,
    ms: now() - start,
  };
}

/** Цілі, які можна оцінити на задачі (ε ≥ межі довіри). */
export function evaluableTargets(ref: Reference | undefined): number[] {
  if (!ref || ref.failed) return [];
  return TARGETS.filter((e) => e >= ref.floor);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------------------------------------------------

export const sweepParams = (m: MethodId): number[] => (isAdaptive(m) ? RTOL_GRID : N_GRID);

function* runOne(spec: ProblemSpec, ref: Reference, m: MethodId, param: number): Generator<void, ArenaRun> {
  const p = arenaProblem(spec, ref);
  const g = isAdaptive(m) ? adaptiveChunks(m, p, param, param * ref.sigma, ref.blowup, MAX_ADAPTIVE_STEPS) : fixedChunks(m, p, param, ref.blowup);
  let res: IteratorResult<void, RawRun>;
  while (!(res = g.next()).done) yield;
  const raw = res.value;
  let error = NaN;
  let failed = raw.failed;
  if (raw.y) {
    error = arenaError(raw.y, ref.y, ref.scale);
    if (!Number.isFinite(error)) failed = "NaN у розв'язку";
  }
  return {
    specId: spec.id,
    method: m,
    param,
    error: failed ? NaN : error,
    cost: raw.fevals + ref.n * raw.jevals,
    fevals: raw.fevals,
    jevals: raw.jevals,
    steps: raw.steps,
    rejected: raw.rejected,
    ms: raw.ms,
    failed,
    failKind: classifyFailure(failed),
  };
}

/** Поріг зупинки розгортки: точніше вже не треба (нижче межі довіри або вдесятеро нижче найменшої цілі). */
export function stopThreshold(ref: Reference): number {
  const ev = evaluableTargets(ref);
  const eMin = ev.length ? Math.min(...ev) : 1e-3;
  return Math.max(ref.floor, eMin / 10);
}

export interface ArenaProgress {
  done: number;
  total: number;
  specId?: string;
  method?: MethodId;
  /** що зараз рахується */
  label: string;
}

/** Одиниць прогресу на еталон (він важчий за один прогін). */
const REF_UNITS = 12;

/**
 * Генератор усієї арени: задача за задачею — еталон, далі кожен метод по своїй розгортці.
 * Кожен `yield` — порція роботи на кілька мілісекунд. Уже пораховане береться з кешу.
 */
export function* arenaJobs(specIds: string[], methods: MethodId[], store: ArenaStore = arenaStore): Generator<ArenaProgress, void, void> {
  const specs = specIds.map((id) => specById(id)).filter((s): s is ProblemSpec => !!s);
  const total = specs.length * REF_UNITS + specs.reduce((s) => s + methods.reduce((a, m) => a + sweepParams(m).length, 0), 0);
  let done = 0;
  for (const spec of specs) {
    let ref = store.refs.get(spec.id);
    if (!ref) {
      const g = computeReference(spec);
      let res: IteratorResult<void, Reference>;
      while (!(res = g.next()).done) yield { done, total, specId: spec.id, label: "еталон" };
      ref = res.value;
      store.refs.set(spec.id, ref);
      store.bump(spec.id);
    }
    done += REF_UNITS;
    yield { done, total, specId: spec.id, label: "еталон готовий" };
    if (ref.failed) {
      done += methods.reduce((a, m) => a + sweepParams(m).length, 0);
      continue;
    }
    const stopAt = stopThreshold(ref);
    for (const m of methods) {
      const ck = curveKey(spec.id, m);
      const params = sweepParams(m);
      if (store.complete.has(ck)) {
        done += params.length;
        continue;
      }
      let stopped: string | undefined;
      for (let i = 0; i < params.length; i++) {
        const prm = params[i];
        const key = runKey(spec.id, m, prm);
        let run = store.runs.get(key);
        if (!run) {
          const g = runOne(spec, ref, m, prm);
          let res: IteratorResult<void, ArenaRun>;
          while (!(res = g.next()).done) yield { done, total, specId: spec.id, method: m, label: isAdaptive(m) ? `rtol = ${prm}` : `N = ${prm}` };
          run = res.value;
          store.runs.set(key, run);
          store.bump(spec.id);
        }
        done++;
        yield { done, total, specId: spec.id, method: m, label: isAdaptive(m) ? `rtol = ${prm}` : `N = ${prm}` };
        if (!run.failed && run.error <= stopAt) {
          stopped = run.error < ref.floor ? "below-floor" : "accurate";
        } else if (isAdaptive(m) && run.failKind === "steps") {
          stopped = "steps";
        }
        if (stopped) {
          done += params.length - 1 - i;
          store.stops.set(ck, stopped);
          break;
        }
      }
      store.complete.add(ck);
      store.bump(spec.id);
    }
  }
  yield { done: total, total, label: "готово" };
}

/** Кількість одиниць прогресу для набору. */
export function arenaTotal(specIds: string[], methods: MethodId[]): number {
  return specIds.length * (REF_UNITS + methods.reduce((a, m) => a + sweepParams(m).length, 0));
}

/** Скільки одиниць прогресу вже пораховано (з кешу) — для прогресу до старту і після зупинки. */
export function arenaDone(specIds: string[], methods: MethodId[], store: ArenaStore = arenaStore): number {
  let done = 0;
  for (const id of specIds) {
    const ref = store.refs.get(id);
    if (!ref) continue;
    done += REF_UNITS;
    for (const m of methods) {
      const params = sweepParams(m);
      if (ref.failed || store.complete.has(curveKey(id, m))) done += params.length;
      else done += params.filter((p) => store.runs.has(runKey(id, m, p))).length;
    }
  }
  return done;
}

export type TaskStatus = "pending" | "partial" | "done";
export function taskStatus(specId: string, methods: MethodId[], store: ArenaStore = arenaStore): TaskStatus {
  const ref = store.refs.get(specId);
  if (!ref) return "pending";
  if (ref.failed) return "done";
  return methods.every((m) => store.complete.has(curveKey(specId, m))) ? "done" : "partial";
}

// ---------------------------------------------------------------------------------------------------------------------
// Scheduler: generator in slices of ~40 ms (no Web Workers)
// ---------------------------------------------------------------------------------------------------------------------

export interface SliceHandle {
  stop(): void;
  readonly running: boolean;
}

/**
 * Виконує генератор порціями: у кожній порції — `next()`, доки не мине `sliceMs`, потім керування віддається браузеру
 * (`MessageChannel`, а без нього — `setTimeout(0)`), щоб сторінка малювалася й відповідала на кліки.
 */
export function runSliced<P>(gen: Generator<P, void, void>, opts: { sliceMs?: number; onProgress?: (p: P) => void; onDone?: () => void; onError?: (e: unknown) => void }): SliceHandle {
  const sliceMs = opts.sliceMs ?? 40;
  let running = true;
  let schedule: (fn: () => void) => void;
  let channel: MessageChannel | null = null;
  if (typeof MessageChannel !== "undefined") {
    channel = new MessageChannel();
    let pending: (() => void) | null = null;
    channel.port1.onmessage = () => {
      const f = pending;
      pending = null;
      f?.();
    };
    schedule = (fn) => {
      pending = fn;
      channel!.port2.postMessage(0);
    };
  } else schedule = (fn) => void setTimeout(fn, 0);
  const close = () => {
    running = false;
    if (channel) {
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
    }
  };
  const step = () => {
    if (!running) return;
    const t0 = now();
    let lastP: P | undefined;
    try {
      while (now() - t0 < sliceMs) {
        const r = gen.next();
        if (r.done) {
          if (lastP !== undefined) opts.onProgress?.(lastP);
          close();
          opts.onDone?.();
          return;
        }
        lastP = r.value;
      }
    } catch (e) {
      close();
      opts.onError?.(e);
      return;
    }
    if (lastP !== undefined) opts.onProgress?.(lastP);
    schedule(step);
  };
  schedule(step);
  return {
    stop: close,
    get running() {
      return running;
    },
  };
}

/** Синхронний прогін усієї арени (для node-скриптів перевірки). */
export function runArenaSync(specIds: string[], methods: MethodId[], store: ArenaStore = arenaStore): void {
  const g = arenaJobs(specIds, methods, store);
  while (!g.next().done);
}

// ---------------------------------------------------------------------------------------------------------------------
// Curves and «cost to reach ε»
// ---------------------------------------------------------------------------------------------------------------------

export interface MethodCurve {
  method: MethodId;
  /** усі прогони розгортки в порядку параметра */
  runs: ArenaRun[];
  /** вдалі прогони, за зростанням вартості (f + n·J) */
  ok: ArenaRun[];
  failures: ArenaRun[];
  complete: boolean;
  stop?: string;
}

export function methodCurve(specId: string, m: MethodId, store: ArenaStore = arenaStore): MethodCurve {
  const runs: ArenaRun[] = [];
  for (const prm of sweepParams(m)) {
    const r = store.runs.get(runKey(specId, m, prm));
    if (r) runs.push(r);
  }
  const ok = runs.filter((r) => !r.failed).sort((a, b) => a.cost - b.cost);
  return { method: m, runs, ok, failures: runs.filter((r) => r.failed), complete: store.complete.has(curveKey(specId, m)), stop: store.stops.get(curveKey(specId, m)) };
}

export const axisValue = (r: ArenaRun, axis: CostAxis) => (axis === "f" ? r.cost : Math.max(r.ms, 0.01));
/** Похибка для графіка: нижче межі довіри — на рівні межі. */
export const shownError = (r: ArenaRun, floor: number) => Math.max(r.error, floor);

export interface Reach {
  /** вартість досягнення ε (f + n·J або мс) */
  value: number;
  /** true — уже найдешевший прогін точніший за ε: справжня вартість ≤ value */
  upper: boolean;
  /** між якими параметрами інтерпольовано */
  between?: [number, number];
}

/**
 * Найменша вартість, з якої метод НАДІЙНО досягає ε: беремо останній (за вартістю) вдалий прогін з похибкою > ε
 * і наступний за ним; між ними — лінійна інтерполяція в координатах (lg вартості, lg похибки). Випадкові «провали»
 * похибки (компенсація) на дешевших прогонах так не зараховуються. Похибки нижче межі довіри беруться на рівні межі
 * (оцінка вартості зверху). Повертає null, якщо ε не досягнуто.
 */
export function costToReach(ok: ArenaRun[], eps: number, floor: number, axis: CostAxis = "f"): Reach | null {
  if (!ok.length) return null;
  const E = ok.map((r) => shownError(r, floor));
  let j = -1;
  for (let i = 0; i < ok.length; i++) if (E[i] > eps) j = i;
  if (j === ok.length - 1) return null;
  if (j < 0) return { value: axisValue(ok[0], axis), upper: true };
  const a = ok[j],
    b = ok[j + 1];
  const la = Math.log(E[j]),
    lb = Math.log(E[j + 1]);
  const w = lb === la ? 1 : (Math.log(eps) - la) / (lb - la);
  const ca = Math.log(axisValue(a, axis)),
    cb = Math.log(axisValue(b, axis));
  return { value: Math.exp(ca + w * (cb - ca)), upper: false, between: [a.param, b.param] };
}

export interface TaskVerdict {
  specId: string;
  eps: number;
  evaluable: boolean;
  /** усі вибрані методи завершили розгортку */
  ready: boolean;
  reach: Partial<Record<MethodId, Reach | null>>;
  winner?: MethodId;
  best?: number;
  /** вартість / вартість переможця */
  ratio: Partial<Record<MethodId, number>>;
}

export function taskVerdict(specId: string, methods: MethodId[], eps: number, axis: CostAxis = "f", store: ArenaStore = arenaStore): TaskVerdict {
  const ref = store.refs.get(specId);
  const evaluable = !!ref && !ref.failed && eps >= ref.floor;
  const reach: Partial<Record<MethodId, Reach | null>> = {};
  const ratio: Partial<Record<MethodId, number>> = {};
  let ready = !!ref;
  let winner: MethodId | undefined;
  let best = Infinity;
  for (const m of methods) {
    const c = methodCurve(specId, m, store);
    if (!c.complete) ready = false;
    if (!ref || !evaluable) continue;
    const r = costToReach(c.ok, eps, ref.floor, axis);
    reach[m] = r;
    if (r && r.value < best) {
      best = r.value;
      winner = m;
    }
  }
  if (winner) for (const m of methods) if (reach[m]) ratio[m] = reach[m]!.value / best;
  return { specId, eps, evaluable, ready, reach, winner, best: winner ? best : undefined, ratio };
}

export interface RankRow {
  method: MethodId;
  /** на скількох задачах досягнуто ε */
  finishes: number;
  /** на скількох задачах ε оцінювалась */
  entered: number;
  wins: number;
  /** геометричне середнє відношення вартості до переможця по задачах, де метод фінішував */
  geoMean: number | null;
}

/** Рейтинг: більше фінішів — вище; за рівності — менше геометричне середнє. */
export function ranking(verdicts: TaskVerdict[], methods: MethodId[]): RankRow[] {
  const rows = methods.map((m) => {
    let finishes = 0,
      entered = 0,
      wins = 0,
      logSum = 0;
    for (const v of verdicts) {
      if (!v.evaluable || !v.ready) continue;
      entered++;
      const r = v.ratio[m];
      if (r !== undefined) {
        finishes++;
        logSum += Math.log(r);
        if (v.winner === m) wins++;
      }
    }
    return { method: m, finishes, entered, wins, geoMean: finishes ? Math.exp(logSum / finishes) : null };
  });
  return rows.sort((a, b) => b.finishes - a.finishes || (a.geoMean ?? Infinity) - (b.geoMean ?? Infinity) || b.wins - a.wins);
}

// ---------------------------------------------------------------------------------------------------------------------
// Observed order of fixed-step methods
// ---------------------------------------------------------------------------------------------------------------------

export interface OrderFit {
  method: MethodId;
  /** нахил lg E від lg h (≈ порядок) */
  slope: number;
  points: number;
}

/**
 * Спостережений порядок: МНК-нахил lg E від lg h по вдалих прогонах в асимптотичній зоні
 * (E ≤ 1e-2 і E ≥ 3·межа довіри).
 */
export function observedOrder(specId: string, m: MethodId, store: ArenaStore = arenaStore): OrderFit | null {
  const ref = store.refs.get(specId);
  if (!ref || isAdaptive(m)) return null;
  const c = methodCurve(specId, m, store);
  const pts = c.ok.filter((r) => r.error <= 1e-2 && r.error >= 3 * ref.floor).map((r) => ({ x: Math.log10((ref.T - ref.t0) / r.param), y: Math.log10(r.error) }));
  if (pts.length < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let sxy = 0,
    sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  return { method: m, slope: sxx > 0 ? sxy / sxx : NaN, points: pts.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Failures summary
// ---------------------------------------------------------------------------------------------------------------------

export interface FailureSummary {
  total: number;
  byKind: Partial<Record<FailKind, number>>;
  /** найдрібніший N (або найменший rtol), на якому ще був збій */
  worstParam?: number;
  /** найгрубіший вдалий параметр */
  firstOk?: number;
}

export function failureSummary(c: MethodCurve): FailureSummary {
  const byKind: Partial<Record<FailKind, number>> = {};
  for (const f of c.failures) byKind[f.failKind ?? "other"] = (byKind[f.failKind ?? "other"] ?? 0) + 1;
  const adaptive = isAdaptive(c.method);
  const failedParams = c.failures.map((f) => f.param);
  const okParams = c.ok.map((r) => r.param);
  return {
    total: c.failures.length,
    byKind,
    worstParam: failedParams.length ? (adaptive ? Math.min(...failedParams) : Math.max(...failedParams)) : undefined,
    firstOk: okParams.length ? (adaptive ? Math.max(...okParams) : Math.min(...okParams)) : undefined,
  };
}

export const FAIL_LABEL: Record<FailKind, string> = {
  blowup: "вибух",
  newton: "Ньютон не збігся",
  steps: "ліміт кроків",
  small: "крок → 0",
  nan: "NaN",
  other: "збій",
};

// ---------------------------------------------------------------------------------------------------------------------
// Conclusions and quiz data (only what follows from the computed numbers)
// ---------------------------------------------------------------------------------------------------------------------

export interface Conclusion {
  tone: "good" | "bad" | "warn" | "info";
  text: string;
}

/** Медіана відношень; для парної кількості — середнє геометричне двох середніх. */
export function medianRatio(xs: number[]): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  const k = a.length >> 1;
  return a.length % 2 ? a[k] : Math.sqrt(a[k - 1] * a[k]);
}

/** 1e-6 → «10⁻⁶» */
export const epsLabel = (eps: number) => `10${sup(String(Math.round(Math.log10(eps))))}`;

const fmtRatio = (r: number) => (r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2));

/** Назва для тексту висновків (передається з UI, щоб модуль не залежав від назв). */
export type Namer = { method: (m: MethodId) => string; spec: (id: string) => string };

export function conclusions(specIds: string[], methods: MethodId[], eps: number, names: Namer, store: ArenaStore = arenaStore): Conclusion[] {
  const out: Conclusion[] = [];
  const verdicts = specIds.map((id) => taskVerdict(id, methods, eps, "f", store)).filter((v) => v.ready && v.evaluable);
  if (!verdicts.length) return out;
  const epsS = `ε = ${epsLabel(eps)}`;
  const stiffV = verdicts.filter((v) => store.refs.get(v.specId)?.stiff);
  const softV = verdicts.filter((v) => !store.refs.get(v.specId)?.stiff);
  const winsIn = (vs: TaskVerdict[]) => {
    const c = new Map<MethodId, number>();
    for (const v of vs) if (v.winner) c.set(v.winner, (c.get(v.winner) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  };
  const expl = methods.filter(isExplicitFamily);
  const impl = methods.filter((m) => !isExplicitFamily(m));
  if (stiffV.length) {
    const w = winsIn(stiffV);
    if (w.length) {
      out.push({
        tone: "good",
        text: `Жорсткі задачі (${stiffV.length}) при ${epsS}: найчастіше перемагає ${names.method(w[0][0])} — ${w[0][1]} з ${stiffV.length}` + (w.length > 1 ? `; далі ${w.slice(1).map(([m, k]) => `${names.method(m)} (${k})`).join(", ")}.` : "."),
      });
    }
    if (expl.length) {
      let dnf = 0,
        tot = 0;
      const blow = new Set<string>();
      for (const v of stiffV)
        for (const m of expl) {
          tot++;
          if (!v.reach[m]) {
            dnf++;
            const c = methodCurve(v.specId, m, store);
            if (c.failures.some((f) => f.failKind === "blowup")) blow.add(names.method(m));
          }
        }
      out.push({
        tone: dnf ? "bad" : "info",
        text: `Явні методи на жорстких задачах не досягли ${epsS} у ${dnf} з ${tot} пар «задача × метод»` + (blow.size ? `; «вибухи» на грубих кроках були в ${[...blow].join(", ")}.` : "."),
      });
    }
    // implicit vs explicit price on stiff tasks
    const gaps: { spec: string; r: number }[] = [];
    for (const v of stiffV) {
      const be = Math.min(...expl.map((m) => v.reach[m]?.value ?? Infinity));
      const bi = Math.min(...impl.map((m) => v.reach[m]?.value ?? Infinity));
      if (Number.isFinite(be) && Number.isFinite(bi)) gaps.push({ spec: v.specId, r: be / bi });
    }
    const big = gaps.filter((g) => g.r > 1).sort((a, b) => b.r - a.r);
    if (big.length) out.push({ tone: "info", text: `Де явний метод таки фінішував на жорсткій задачі, він дорожчий за найкращий неявний: найбільше — у ${fmtRatio(big[0].r)} раза на «${names.spec(big[0].spec)}».` });
  }
  if (softV.length) {
    const w = winsIn(softV);
    if (w.length)
      out.push({
        tone: "good",
        text: `Нежорсткі задачі (${softV.length}) при ${epsS}: найчастіше перемагає ${names.method(w[0][0])} — ${w[0][1]} з ${softV.length}` + (w.length > 1 ? `; далі ${w.slice(1).map(([m, k]) => `${names.method(m)} (${k})`).join(", ")}.` : "."),
      });
    if (expl.length && impl.length) {
      let cheaper = 0,
        implDnf = 0,
        cmp = 0;
      const ratios: number[] = [];
      for (const v of softV) {
        const be = Math.min(...expl.map((m) => v.reach[m]?.value ?? Infinity));
        const bi = Math.min(...impl.map((m) => v.reach[m]?.value ?? Infinity));
        if (!Number.isFinite(be) && !Number.isFinite(bi)) continue;
        cmp++;
        if (be < bi) cheaper++;
        if (!Number.isFinite(bi)) implDnf++;
        else if (Number.isFinite(be)) ratios.push(bi / be);
      }
      if (cmp) {
        const med = medianRatio(ratios);
        out.push({
          tone: "warn",
          text:
            `Ціна Ньютона: на ${cheaper} з ${cmp} нежорстких задач найкращий явний метод дешевший за найкращий неявний` +
            (implDnf ? ` (на ${implDnf} з них жоден неявний метод не досяг ${epsS})` : "") +
            (ratios.length ? `; де фінішували обидва, неявний дорожчий у ${fmtRatio(med)} раза (медіана).` : "."),
        });
      }
    }
  }
  // order-1 methods: share of finishes and the observed slope
  const ord1 = methods.filter((m) => m === "euler" || m === "ieuler" || m === "theta");
  if (ord1.length && eps <= 1e-6) {
    let fin = 0,
      tot = 0;
    const slopes: number[] = [];
    for (const v of verdicts)
      for (const m of ord1) {
        tot++;
        if (v.reach[m]) fin++;
        const o = observedOrder(v.specId, m, store);
        if (o && o.points >= 3) slopes.push(o.slope);
      }
    const ms = slopes.length ? slopes.reduce((a, b) => a + b, 0) / slopes.length : NaN;
    out.push({
      tone: "warn",
      text:
        `Методи 1-го порядку (${ord1.map(names.method).join(", ")}) досягли ${epsS} лише в ${fin} з ${tot} випадків` +
        (Number.isFinite(ms) ? `: спостережений нахил ≈ ${ms.toFixed(2)}, тобто кожна наступна цифра точності коштувала їм приблизно в ${Math.pow(10, 1 / ms).toFixed(0)} разів більше кроків.` : "."),
    });
  }
  return out;
}

export interface QuizData {
  /** ідентифікатор зі «відбитком» даних: зміна даних скидає збережену відповідь */
  id: string;
  ready: boolean;
  /** чому квіз ще недоступний */
  waitFor?: string;
  options: string[];
  correct: number;
  facts: Record<string, string | number>;
}

function pickOthers<T>(all: T[], exclude: T[], k: number): T[] {
  return all.filter((x) => !exclude.includes(x)).slice(0, k);
}

/** Квіз 1: хто переміг на Робертсоні (t12) при ε. */
export function quizRobertson(methods: MethodId[], eps: number, names: Namer, store: ArenaStore = arenaStore): QuizData {
  const id = "t12";
  const v = taskVerdict(id, methods, eps, "f", store);
  if (!v.ready || !v.evaluable || !v.winner) return { id: "q-rob", ready: false, waitFor: id, options: [], correct: 0, facts: {} };
  const ranked = methods.filter((m) => v.reach[m]).sort((a, b) => v.ratio[a]! - v.ratio[b]!);
  const distract = [...ranked.slice(1, 3), ...pickOthers(["rk4", "euler", "dopri", "trap"] as MethodId[], ranked.slice(0, 3), 3)].filter((m, i, a) => a.indexOf(m) === i && m !== v.winner && methods.includes(m)).slice(0, 3);
  const opts = [v.winner, ...distract];
  // stable order: by method list order
  const order = ARENA_METHODS.filter((m) => opts.includes(m));
  const second = ranked[1];
  return {
    id: `q-rob-${eps}-${v.winner}-${order.join("")}`,
    ready: true,
    options: order.map(names.method),
    correct: order.indexOf(v.winner),
    facts: {
      winnerId: v.winner,
      winnerExplicit: isExplicitFamily(v.winner) ? 1 : 0,
      winner: names.method(v.winner),
      cost: Math.round(v.best!),
      second: second ? names.method(second) : "",
      secondRatio: second ? fmtRatio(v.ratio[second]!) : "",
      finished: ranked.length,
      total: methods.length,
    },
  };
}

/** Квіз 2: чому RK4 не фінішує на жорсткій задачі (перша вибрана жорстка задача, де RK4 не досяг ε). */
export function quizRk4(specIds: string[], methods: MethodId[], eps: number, names: Namer, store: ArenaStore = arenaStore): QuizData {
  const base = { id: "q-rk4", ready: false, options: [], correct: 0, facts: {} };
  if (!methods.includes("rk4")) return { ...base, waitFor: "rk4" };
  let pending: string | undefined;
  for (const id of specIds) {
    const ref = store.refs.get(id);
    const v = taskVerdict(id, methods, eps, "f", store);
    if (!v.ready) {
      pending ??= id;
      continue;
    }
    if (!ref?.stiff || !v.evaluable || v.reach.rk4) continue;
    const c = methodCurve(id, "rk4", store);
    const fs = failureSummary(c);
    const blew = (fs.byKind.blowup ?? 0) > 0;
    const options = [
      "Не вистачає порядку: 4-й порядок замалий для такої точності",
      "Стійкість: на грубих кроках розв'язок «вибухає», а стійкий крок такий дрібний, що ліміт кроків вичерпується раніше",
      "Метод Ньютона не збігається на великих кроках",
      "Похибки округлення накопичуються при дрібному кроці",
    ];
    const ref0 = ref!;
    const okN = fs.firstOk;
    const bestErr = c.ok.length ? Math.min(...c.ok.map((r) => r.error)) : NaN;
    return {
      id: `q-rk4-${id}-${eps}-${blew ? "b" : "n"}`,
      ready: true,
      options,
      correct: blew ? 1 : 0,
      facts: {
        spec: names.spec(id),
        specId: id,
        blowups: fs.byKind.blowup ?? 0,
        runs: c.runs.length,
        worstN: fs.worstParam ?? "",
        hWorst: fs.worstParam ? ((ref0.T - ref0.t0) / fs.worstParam).toPrecision(2) : "",
        firstOkN: okN ?? "",
        bestErr: Number.isFinite(bestErr) ? fmt(bestErr, 2) : "—",
        maxN: N_GRID[N_GRID.length - 1],
      },
    };
  }
  return { ...base, waitFor: pending ?? "stiff-rk4" };
}

/** Квіз 3: на якій задачі найкращий явний метод дешевший за найкращий неявний (найбільший виграш). */
export function quizExplicitWins(specIds: string[], methods: MethodId[], eps: number, names: Namer, store: ArenaStore = arenaStore): QuizData {
  const base = { id: "q-expl", ready: false, options: [], correct: 0, facts: {} };
  const expl = methods.filter(isExplicitFamily);
  const impl = methods.filter((m) => !isExplicitFamily(m));
  if (!expl.length || !impl.length) return { ...base, waitFor: "methods" };
  const rows: { id: string; r: number; be: MethodId | undefined; bi: MethodId | undefined }[] = [];
  for (const id of specIds) {
    const v = taskVerdict(id, methods, eps, "f", store);
    if (!v.ready) return { ...base, waitFor: id };
    if (!v.evaluable) continue;
    let be: MethodId | undefined,
      bi: MethodId | undefined;
    for (const m of expl) if (v.reach[m] && (!be || v.reach[m]!.value < v.reach[be]!.value)) be = m;
    for (const m of impl) if (v.reach[m] && (!bi || v.reach[m]!.value < v.reach[bi]!.value)) bi = m;
    const cE = be ? v.reach[be]!.value : Infinity;
    const cI = bi ? v.reach[bi]!.value : Infinity;
    rows.push({ id, r: cI / cE, be, bi });
  }
  // prefer tasks where both classes finished (a finite ratio), then the largest advantage
  const wins = rows.filter((r) => r.r > 1).sort((a, b) => Number(Number.isFinite(b.r)) - Number(Number.isFinite(a.r)) || b.r - a.r);
  if (!wins.length) return { ...base, waitFor: "none" };
  const top = wins[0];
  const losers = rows.filter((r) => !(r.r > 1)).sort((a, b) => a.r - b.r).slice(0, 3);
  if (!losers.length) return { ...base, waitFor: "none" };
  const opts = [top.id, ...losers.map((l) => l.id)];
  const order = specIds.filter((id) => opts.includes(id));
  return {
    id: `q-expl-${eps}-${top.id}-${order.join("")}`,
    ready: true,
    options: order.map(names.spec),
    correct: order.indexOf(top.id),
    facts: {
      spec: names.spec(top.id),
      stiff: store.refs.get(top.id)?.stiff ? 1 : 0,
      explicit: top.be ? names.method(top.be) : "",
      implicit: top.bi ? names.method(top.bi) : "",
      ratio: Number.isFinite(top.r) ? fmtRatio(top.r) : "∞",
      count: wins.length,
      total: rows.length,
      loser: names.spec(losers[0].id),
      loserRatio: Number.isFinite(losers[0].r) ? fmtRatio(1 / losers[0].r) : "∞",
      loserExplicitDnf: losers[0].be ? "" : "1",
    },
  };
}
