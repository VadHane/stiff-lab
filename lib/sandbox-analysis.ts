/**
 * «Своя система» (`/sandbox`): безпечний запуск методів на довільній системі користувача, аналіз жорсткості
 * (власні числа, межі стійкості явних методів) і чесна рекомендація методу.
 *
 * Захист від «поганих» систем:
 * - перевірка f(t₀, y₀) і J(t₀, y₀) на NaN/∞ ще до запуску ({@link checkStart});
 * - ліміт часу на метод: обгортка {@link guardProblem} після дедлайну повертає NaN, і будь-який метод ядра
 *   (`lib/ode.ts`) зупиняється за кілька кроків, зберігши вже пораховану частину розв'язку;
 * - ліміт кроків: адаптивним — `maxSteps`; методам зі сталим кроком відрізок обрізається до `maxSteps·h`
 *   (інакше h = 10⁻⁶ на [0, 10⁵] означало б 10¹¹ кроків і мільярди масивів у пам'яті);
 * - поріг «вибуху» |yᵢ| > blowup і розпізнавання NaN (ділення на нуль, корінь/логарифм від'ємного).
 *
 * Правило рекомендації ({@link recommend}): DOPRI 5(4) і Розенброк 2(3) запускаються з тим самим rtol = 10⁻⁶
 * (atol = 10⁻⁹) і лімітами кроків/часу; K = кроки DOPRI / кроки Розенброка. Система жорстка, якщо водночас
 * K ≥ {@link K_STIFF} (явний метод робить у рази більше кроків) і S = max(−Re λ)·(T − t₀) ≥ {@link S_STIFF}
 * (на відрізку вміщається багато «часів життя» найшвидшої загасаючої моди). Додатково — частка кроків DOPRI,
 * обмежених стійкістю (h ≥ 0.5·h_стійк), як пояснення «чому».
 *
 * Чому поріг K ≥ 3, а не K > 1: при rtol = 10⁻⁶ і гладкому нежорсткому розв'язку DOPRI (5-й порядок) робить
 * у 7–14 разів МЕНШЕ кроків, ніж Розенброк (2-й порядок): K ≈ 0.07–0.15 (Лоренц, Кеплер, маятник, SIR — перевірено
 * скриптом). Тож K ≥ 3 означає, що явний метод програє в 20–40 разів більше, ніж «має» через порядок, — і майже
 * завжди це крок на межі стійкості (у жорстких задачах курсу 99–100 % кроків DOPRI мають h ≈ h_стійк). Самого S
 * недостатньо: у Лоренца S ≈ 500, але K ≈ 0.09 — система нежорстка.
 *
 * @module sandbox-analysis
 */
import { eigenvalues, type Complex, type Mat, type Vec } from "./linalg";
import { isAdaptive, numJac, solve, type MethodId, type Problem, type Solution } from "./ode";

// ---------------------------------------------------------------------------------------------------------------------
// Time and guards
// ---------------------------------------------------------------------------------------------------------------------

export const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Стан обгортки: чи настав дедлайн і де права частина вперше дала NaN/∞. */
export interface GuardState {
  deadline: number;
  timedOut: boolean;
  /** перша точка, де f дала неcкінченне значення (до дедлайну) */
  nonFinite: { t: number; index: number; y: Vec } | null;
  calls: number;
}

const nanVec = (n: number): Vec => new Array(n).fill(NaN);

/**
 * Обгортає f і J: кожні 32 виклики перевіряє час; після дедлайну повертає NaN — методи ядра відкидають такі кроки
 * (адаптивні зменшують h до «надто малого», явні фіксують «вибух», неявні — відмову Ньютона) і зупиняються.
 * Також запам'ятовує першу точку, де f дала NaN/∞ (щоб пояснити, що сталося).
 */
export function guardProblem(p: Problem, timeMs: number): { problem: Problem; state: GuardState } {
  const state: GuardState = { deadline: now() + timeMs, timedOut: false, nonFinite: null, calls: 0 };
  const tick = () => {
    if (state.timedOut) return true;
    if ((++state.calls & 31) === 0 && now() > state.deadline) state.timedOut = true;
    return state.timedOut;
  };
  const n = p.y0.length;
  const f = (t: number, y: Vec): Vec => {
    if (tick()) return nanVec(n);
    const r = p.f(t, y);
    if (!state.nonFinite && y.every(Number.isFinite)) {
      const i = r.findIndex((v) => !Number.isFinite(v));
      if (i >= 0) state.nonFinite = { t, index: i, y: y.slice() };
    }
    return r;
  };
  const jac = (t: number, y: Vec): Mat => {
    if (tick()) return Array.from({ length: n }, () => nanVec(n));
    return p.jac ? p.jac(t, y) : numJac(p.f, t, y);
  };
  return { problem: { ...p, f, jac }, state };
}

// ---------------------------------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------------------------------

export type RunStatus = "ok" | "blowup" | "nan" | "newton" | "steps" | "tiny" | "time" | "error";

export const STATUS_LABEL: Record<RunStatus, string> = {
  ok: "OK",
  blowup: "вибух",
  nan: "NaN / ∞",
  newton: "відмова Ньютона",
  steps: "ліміт кроків",
  tiny: "крок → 0",
  time: "ліміт часу",
  error: "помилка",
};

export interface RunLimits {
  /** крок методів зі сталим кроком */
  h: number;
  /** відносна точність адаптивних методів */
  rtol: number;
  /** абсолютна точність адаптивних методів (типово rtol·10⁻³) */
  atol?: number;
  /** ліміт кроків: адаптивним — кроки + відхилені, сталим — кількість кроків */
  maxSteps: number;
  /** поріг «вибуху» |yᵢ| */
  blowup: number;
  /** ліміт часу на один метод, мс */
  timeMs: number;
}

export interface RunResult {
  method: MethodId;
  sol: Solution;
  status: RunStatus;
  /** пояснення українською (для статусу ≠ ok) */
  message: string;
  /** до якого t дійшов метод */
  tEnd: number;
  /** для сталого кроку: скільки кроків потрібно на весь відрізок */
  stepsNeeded?: number;
}

const tp = (t: number) => Number(t.toPrecision(4)).toString();

/** Відкидає хвіст розв'язку з NaN/∞ (точки, що їх метод встиг записати перед зупинкою). */
function trimNonFinite(sol: Solution): void {
  while (sol.y.length > 1 && !sol.y[sol.y.length - 1].every(Number.isFinite)) {
    sol.y.pop();
    sol.t.pop();
    if (sol.hs.length) sol.hs.pop();
    sol.steps = Math.max(0, sol.steps - 1);
  }
}

/**
 * Запускає один метод з усіма запобіжниками. Ніколи не кидає винятків: помилку перетворює на статус.
 * @param varNames  імена змінних — для повідомлень «права частина для x′ дала NaN»
 */
export function runMethod(problem: Problem, method: MethodId, lim: RunLimits, varNames?: string[]): RunResult {
  const t0 = problem.t0 ?? 0;
  const span = problem.T - t0;
  let stepsNeeded: number | undefined;
  let p = problem;
  let truncated = false;
  if (!isAdaptive(method)) {
    stepsNeeded = Math.max(1, Math.round(span / lim.h));
    if (stepsNeeded > lim.maxSteps) {
      // the core has no step limit for fixed-step methods: integrate only the first maxSteps steps
      p = { ...problem, T: t0 + lim.maxSteps * (span / stepsNeeded) };
      truncated = true;
    }
  }
  const { problem: gp, state } = guardProblem(p, lim.timeMs);
  let sol: Solution;
  try {
    sol = solve(method, gp, {
      h: lim.h,
      rtol: lim.rtol,
      atol: lim.atol ?? lim.rtol * 1e-3,
      maxSteps: lim.maxSteps,
      blowup: lim.blowup,
    });
  } catch (e) {
    const s: Solution = { method, t: [t0], y: [problem.y0.slice()], hs: [], steps: 0, rejected: 0, fevals: 0, jevals: 0, ms: 0 };
    return { method, sol: s, status: "error", message: `Помилка обчислення: ${(e as Error).message}`, tEnd: t0, stepsNeeded };
  }
  const lastY = sol.y[sol.y.length - 1];
  const lastBad = !lastY.every(Number.isFinite);
  trimNonFinite(sol);
  const tEnd = sol.t[sol.t.length - 1];
  const name = (i: number) => varNames?.[i] ?? `y${i + 1}`;
  let status: RunStatus = "ok";
  let message = "";
  if (state.timedOut) {
    status = "time";
    message = `Перевищено ліміт часу ${lim.timeMs < 1000 ? `${Math.round(lim.timeMs)} мс` : `${Number((lim.timeMs / 1000).toPrecision(2))} с`} — метод зупинено при t ≈ ${tp(tEnd)}`;
  } else if (sol.failed) {
    const f = sol.failed;
    const nf = state.nonFinite;
    if (nf || lastBad) {
      status = "nan";
      message = nf
        ? `Права частина для ${name(nf.index)}′ дала NaN/∞ при t ≈ ${tp(nf.t)} (ділення на нуль? корінь чи логарифм від'ємного? переповнення exp?)`
        : `Розв'язок став NaN/∞ при t ≈ ${tp(tEnd)} (переповнення або ділення на нуль)`;
    } else if (f.includes("вибухнув")) {
      status = "blowup";
      message = `|y| перевищив поріг ${lim.blowup.toExponential(0)} при t ≈ ${tp(tEnd)}: метод нестійкий або розв'язок справді росте`;
    } else if (f.includes("Ньютона")) {
      status = "newton";
      message = f;
    } else if (f.includes("ліміт кроків")) {
      status = "steps";
      message = `Вичерпано ліміт ${lim.maxSteps.toLocaleString("uk-UA")} кроків при t ≈ ${tp(tEnd)}`;
    } else if (f.includes("надто малим")) {
      status = "tiny";
      message = `${f}: схоже на особливість (вертикальну асимптоту) розв'язку`;
    } else {
      status = "error";
      message = f;
    }
  } else if (truncated) {
    status = "steps";
    message = `Потрібно ${stepsNeeded!.toLocaleString("uk-UA")} кроків > ліміту ${lim.maxSteps.toLocaleString("uk-UA")}: пораховано лише до t ≈ ${tp(tEnd)}. Збільште h або ліміт кроків`;
  }
  return { method, sol, status, message, tEnd, stepsNeeded };
}

/**
 * Перевірка до запуску: f(t₀, y₀) і J(t₀, y₀) мають бути скінченними. Повертає повідомлення або null.
 */
export function checkStart(problem: Problem, varNames: string[]): string | null {
  const t0 = problem.t0 ?? 0;
  let f: Vec;
  try {
    f = problem.f(t0, problem.y0);
  } catch (e) {
    return `Не вдалося обчислити праву частину в t₀: ${(e as Error).message}`;
  }
  const bad = f.findIndex((v) => !Number.isFinite(v));
  if (bad >= 0)
    return `Права частина для ${varNames[bad]}′ у початковій точці дорівнює ${Number.isNaN(f[bad]) ? "NaN" : "∞"} — ділення на нуль, корінь або логарифм від'ємного числа? Змініть початкові умови чи рівняння.`;
  if (problem.jac) {
    let J: Mat;
    try {
      J = problem.jac(t0, problem.y0);
    } catch (e) {
      return `Не вдалося обчислити якобіан у t₀: ${(e as Error).message}`;
    }
    for (let i = 0; i < J.length; i++)
      for (let j = 0; j < J.length; j++)
        if (!Number.isFinite(J[i][j]))
          return `Похідна ∂(${varNames[i]}′)/∂${varNames[j]} у початковій точці нескінченна (напр. √x чи |x| у нулі). Неявні методи й Розенброк тут не працюють — змініть y₀.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stability of explicit methods along eigenvalue rays
// ---------------------------------------------------------------------------------------------------------------------

type C = [number, number];

/** Коефіцієнти многочлена стійкості R(z) = Σ cₖ zᵏ явних методів. */
const POLY: Record<"euler" | "rk2" | "rk3" | "rk4" | "dopri", number[]> = {
  euler: [1, 1],
  rk2: [1, 1, 1 / 2],
  rk3: [1, 1, 1 / 2, 1 / 6],
  rk4: [1, 1, 1 / 2, 1 / 6, 1 / 24],
  // DOPRI 5(4), розв'язок 5-го порядку: c₆ = bᵀA⁵𝟙 = 1/600
  dopri: [1, 1, 1 / 2, 1 / 6, 1 / 24, 1 / 120, 1 / 600],
};
export type ExplicitKind = keyof typeof POLY;

function polyAbs(c: number[], z: C): number {
  // Horner in complex arithmetic
  let re = c[c.length - 1],
    im = 0;
  for (let k = c.length - 2; k >= 0; k--) {
    const r = re * z[0] - im * z[1] + c[k];
    im = re * z[1] + im * z[0];
    re = r;
  }
  return Math.hypot(re, im);
}

/**
 * Найбільше s > 0 таке, що |R(s·e^{iφ})| ≤ 1 на всьому (0, s] (φ — напрям власного числа).
 * 0 — нестійкий за будь-якого кроку (напр. явний Ейлер на уявній осі).
 */
function rayLimit(kind: ExplicitKind, dir: C): number {
  const c = POLY[kind];
  const ds = 0.002;
  let s = ds;
  const tol = 1 + 1e-12;
  if (polyAbs(c, [s * dir[0], s * dir[1]]) > tol) return 0;
  while (s < 8) {
    const s2 = s + ds;
    if (polyAbs(c, [s2 * dir[0], s2 * dir[1]]) > tol) {
      let lo = s,
        hi = s2;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (polyAbs(c, [m * dir[0], m * dir[1]]) > tol) hi = m;
        else lo = m;
      }
      return lo;
    }
    s = s2;
  }
  return 8;
}

/**
 * Межа області стійкості явного методу для h = 1 у вигляді многокутника (перший вихід із |R| ≤ 1 уздовж променів
 * з початку координат). Для кроку h точки треба поділити на h (області в площині λ: hλ ∈ S ⇔ λ ∈ S/h).
 */
export function stabilityBoundary(kind: ExplicitKind, rays = 180): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < rays; k++) {
    const phi = (2 * Math.PI * k) / rays;
    const dir: C = [Math.cos(phi), Math.sin(phi)];
    const s = rayLimit(kind, dir);
    out.push([s * dir[0], s * dir[1]]);
  }
  return out;
}

/** Межа кроку явного методу за власними числами: h < h_max для всіх λ з Re λ < 0 (чисто уявні — окремо). */
export interface StepBound {
  /** найбільший стійкий крок; Infinity — обмежень немає (усі Re λ > 0 або λ = 0); 0 — нестійкий за будь-якого h */
  h: number;
  /** яке власне число обмежує */
  limiting: Complex | null;
}

/** Відносний поріг «Re λ ≈ 0»: |Re λ| ≤ ε·|λ| вважаємо чисто уявним власним числом. */
const IMAG_EPS = 1e-9;

export function explicitStepBound(ev: Complex[], kind: ExplicitKind): StepBound {
  let h = Infinity;
  let limiting: Complex | null = null;
  const top = Math.max(0, ...ev.map((e) => Math.hypot(e.re, e.im)));
  for (const e of ev) {
    const r = Math.hypot(e.re, e.im);
    if (!(r > 1e-12 * top) || !Number.isFinite(r)) continue; // zero eigenvalue (conservation law): no restriction
    if (e.re > IMAG_EPS * r) continue; // growing mode: growth is physical, not a stability restriction
    const dir: C = e.re < -IMAG_EPS * r ? [e.re / r, e.im / r] : [0, Math.sign(e.im) || 1];
    const hk = rayLimit(kind, dir) / r;
    if (hk < h) {
      h = hk;
      limiting = e;
    }
  }
  return { h, limiting };
}

// ---------------------------------------------------------------------------------------------------------------------
// Eigenvalues at a point
// ---------------------------------------------------------------------------------------------------------------------

export interface EigenInfo {
  t: number;
  ev: Complex[];
  /** max(−Re λ) серед загасаючих мод (0, якщо таких немає) */
  maxDecay: number;
  /** max Re λ (> 0 — є нестійкі, наростаючі моди) */
  maxGrowth: number;
  /** min(−Re λ) серед загасаючих мод, що помітно відрізняються від нуля */
  minDecay: number;
  /** коефіцієнт жорсткості max(−Re λ)/min(−Re λ) (NaN, якщо загасаючих мод < 2) */
  ratio: number;
  euler: StepBound;
  rk4: StepBound;
  dopri: StepBound;
  finite: boolean;
}

export function eigenInfo(problem: Problem, t: number, y: Vec): EigenInfo {
  let J: Mat;
  try {
    J = problem.jac ? problem.jac(t, y) : numJac(problem.f, t, y);
  } catch {
    J = y.map(() => y.map(() => NaN));
  }
  const finite = J.every((r) => r.every(Number.isFinite));
  const ev = finite ? eigenvalues(J) : J.map(() => ({ re: NaN, im: 0 }));
  const top = Math.max(0, ...ev.map((e) => Math.hypot(e.re, e.im)).filter(Number.isFinite));
  const decays = ev.filter((e) => e.re < 0 && -e.re > 1e-11 * top).map((e) => -e.re);
  const maxDecay = decays.length ? Math.max(...decays) : 0;
  const minDecay = decays.length ? Math.min(...decays) : 0;
  const growth = ev.map((e) => e.re).filter(Number.isFinite);
  return {
    t,
    ev,
    maxDecay,
    minDecay,
    maxGrowth: growth.length ? Math.max(...growth) : NaN,
    ratio: decays.length >= 2 ? maxDecay / Math.max(minDecay, 1e-300) : NaN,
    euler: explicitStepBound(ev, "euler"),
    rk4: explicitStepBound(ev, "rk4"),
    dopri: explicitStepBound(ev, "dopri"),
    finite,
  };
}

/** Рівномірна вибірка ≤ count індексів розв'язку (включно з першим і останнім). */
export function sampleIndices(len: number, count: number): number[] {
  if (len <= count) return Array.from({ length: len }, (_, i) => i);
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(Math.round((k / (count - 1)) * (len - 1)));
  return out.filter((v, i, a) => i === 0 || v !== a[i - 1]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------------------------------------------------

/** Поріг відношення кроків K = DOPRI / Розенброк, з якого систему вважаємо жорсткою. */
export const K_STIFF = 3;
/** Поріг S = max(−Re λ)·(T − t₀): скільки «часів життя» найшвидшої загасаючої моди вміщає відрізок. */
export const S_STIFF = 100;
/** Відношення кроків, з якого систему вважаємо помірно жорсткою (якщо S ≥ S_STIFF). */
export const K_MODERATE = 1.5;
/** Частка кроків DOPRI, обмежених стійкістю, з якої систему вважаємо помірно жорсткою (якщо S ≥ S_STIFF). */
export const STAB_MODERATE = 0.5;
/** rtol/atol порівняльного запуску. */
export const REC_RTOL = 1e-6;
export const REC_ATOL = 1e-9;
export const REC_MAX_STEPS = 50000;
export const REC_TIME_MS = 1200;

export type Verdict = "stiff" | "moderate" | "nonstiff" | "singular" | "fail";

export interface Recommendation {
  verdict: Verdict;
  /** рекомендований метод */
  method: MethodId;
  /**
   * K = кроки DOPRI / кроки Розенброка (прийняті). Якщо хтось не дійшов до T через ліміт кроків/часу —
   * відношення «щільностей» кроків (кроків на одиницю часу), тобто оцінка для всього відрізка.
   */
  K: number;
  /** DOPRI зупинився на ліміті, а Розенброк дійшов: K ≥ Kmin напевно (Kmin = кроки DOPRI до зупинки / кроки Розенброка) */
  Klower: boolean;
  Kmin: number;
  /** K — оцінка (хтось із двох не дійшов до T) */
  Kestimated: boolean;
  dopri: RunResult;
  ros: RunResult;
  /** max по траєкторії max(−Re λ) */
  maxDecay: number;
  /** S = maxDecay·(T − t₀) */
  S: number;
  /** max по траєкторії max Re λ (> 0 — є наростаючі моди) */
  maxGrowth: number;
  /** частка (вибіркових) кроків DOPRI, де h ≥ 0.5·h_стійк(DOPRI): крок обмежує стійкість, а не точність */
  stabFrac: number;
  /** медіана h/h_стійк(DOPRI) для кроків DOPRI */
  stabMedian: number;
  /** еталонна траєкторія: запуск рекомендованого методу, якщо він дійшов до T, інакше той, що зайшов далі */
  reference: RunResult;
  /** «вартість» у еквівалентних обчисленнях f: fevals + jevals·n */
  costDopri: number;
  costRos: number;
}

export interface RecommendOptions {
  maxSteps?: number;
  timeMs?: number;
  blowup?: number;
  /** скільки точок траєкторії брати для власних чисел */
  samples?: number;
}

/** Медіана масиву (NaN для порожнього). */
function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Ліміти порівняльних запусків DOPRI і Розенброка. */
export function recLimits(problem: Problem, o: RecommendOptions = {}): RunLimits {
  return {
    h: (problem.T - (problem.t0 ?? 0)) / 1000,
    rtol: REC_RTOL,
    atol: REC_ATOL,
    maxSteps: o.maxSteps ?? REC_MAX_STEPS,
    blowup: o.blowup ?? 1e10,
    timeMs: o.timeMs ?? REC_TIME_MS,
  };
}

const reachedT = (r: RunResult) => r.status === "ok";
const stoppedByLimit = (r: RunResult) => r.status === "steps" || r.status === "time";
const stoppedBySingularity = (r: RunResult) => r.status === "blowup" || r.status === "nan" || r.status === "tiny";

/**
 * Висновок за двома ВЖЕ виконаними запусками (`dopri`, `ros` з {@link recLimits}). Правило:
 * - обидва зупинилися на одному t через вибух/NaN/«крок → 0» (або один там зупинився, а другий вичерпав ліміт, не
 *   дійшовши до цього t) → `singular` (особливість розв'язку, не методу);
 * - жоден не дійшов і причина не в лімітах → `fail`;
 * - K ≥ {@link K_STIFF} і S ≥ {@link S_STIFF} → `stiff`, рекомендація — Розенброк;
 * - (K ≥ {@link K_MODERATE} або частка кроків DOPRI на межі стійкості ≥ {@link STAB_MODERATE}) і S ≥ S_STIFF →
 *   `moderate`, рекомендація — дешевший за «вартістю» (fevals + n·jevals);
 * - інакше `nonstiff`, рекомендація — DOPRI.
 */
export function recommendFrom(problem: Problem, dopri: RunResult, ros: RunResult, o: RecommendOptions = {}): Recommendation {
  const n = problem.y0.length;
  const t0 = problem.t0 ?? 0;
  const span = problem.T - t0;
  // trajectory for the eigenvalue scan: the run that got farther (Rosenbrock on a tie)
  const scan = ros.tEnd >= dopri.tEnd ? ros : dopri;

  // eigenvalues along the trajectory
  const samples = o.samples ?? 160;
  let maxDecay = 0;
  let maxGrowth = -Infinity;
  for (const i of sampleIndices(scan.sol.t.length, samples)) {
    const e = eigenInfo(problem, scan.sol.t[i], scan.sol.y[i]);
    if (!e.finite) continue;
    maxDecay = Math.max(maxDecay, e.maxDecay);
    if (Number.isFinite(e.maxGrowth)) maxGrowth = Math.max(maxGrowth, e.maxGrowth);
  }
  const S = maxDecay * span;

  // is DOPRI limited by stability? h_k / h_stab(DOPRI) on sampled accepted steps (skip the first 10%: start-up)
  const ratios: number[] = [];
  const ds = dopri.sol;
  const from = Math.floor(ds.hs.length * 0.1);
  for (const k of sampleIndices(ds.hs.length - from, samples)) {
    const idx = from + k; // step idx goes from t[idx] to t[idx + 1] with size hs[idx]
    if (idx >= ds.hs.length) continue;
    const e = eigenInfo(problem, ds.t[idx], ds.y[idx]);
    if (!e.finite || !Number.isFinite(e.dopri.h) || e.dopri.h <= 0) continue;
    ratios.push(ds.hs[idx] / e.dopri.h);
  }
  const stabFrac = ratios.length ? ratios.filter((r) => r >= 0.5).length / ratios.length : 0;
  const stabMedian = median(ratios);

  // step ratio: plain when both reached T, otherwise ratio of step densities (steps per unit of time)
  const dens = (r: RunResult) => (r.tEnd > t0 ? r.sol.steps / (r.tEnd - t0) : NaN);
  const Kmin = ros.sol.steps > 0 ? dopri.sol.steps / ros.sol.steps : NaN;
  const Kestimated = !reachedT(dopri) || !reachedT(ros);
  const K = !Kestimated ? Kmin : dens(dopri) / dens(ros);
  const Klower = !reachedT(dopri) && stoppedByLimit(dopri) && reachedT(ros);
  const costDopri = dopri.sol.fevals + dopri.sol.jevals * n;
  const costRos = ros.sol.fevals + ros.sol.jevals * n;

  let verdict: Verdict;
  let method: MethodId;
  // a singularity of the SOLUTION (not of a method): both stop at the same t, or one stops there and the other one
  // ran out of steps/time before reaching that point
  const sing = (a: RunResult, b: RunResult) =>
    stoppedBySingularity(a) && ((stoppedBySingularity(b) && Math.abs(a.tEnd - b.tEnd) <= 0.02 * span + 1e-12) || (stoppedByLimit(b) && b.tEnd <= a.tEnd + 1e-9 * Math.max(1, Math.abs(a.tEnd))));
  if (sing(dopri, ros) || sing(ros, dopri)) {
    verdict = "singular";
    method = "ros";
  } else if (!reachedT(dopri) && !reachedT(ros) && !stoppedByLimit(dopri) && !stoppedByLimit(ros)) {
    verdict = "fail";
    method = dopri.tEnd >= ros.tEnd ? "dopri" : "ros";
  } else {
    const Keff = Number.isFinite(K) ? K : Klower ? Infinity : NaN;
    if (Keff >= K_STIFF && S >= S_STIFF) {
      verdict = "stiff";
      method = "ros";
    } else if ((Keff >= K_MODERATE || stabFrac >= STAB_MODERATE) && S >= S_STIFF) {
      verdict = "moderate";
      // compare costs per unit of time (one of the runs may be partial)
      const cd = costDopri / Math.max(dopri.tEnd - t0, 1e-300),
        cr = costRos / Math.max(ros.tEnd - t0, 1e-300);
      method = cr < cd ? "ros" : "dopri";
    } else {
      verdict = "nonstiff";
      method = "dopri";
    }
    // never recommend a method that broke down while the other one reached T
    if (method === "ros" && !reachedT(ros) && reachedT(dopri)) method = "dopri";
    if (method === "dopri" && !reachedT(dopri) && reachedT(ros)) method = "ros";
  }
  // reference trajectory for plots: the recommended method if it reached T (at rtol = 1e-6 it is the more accurate /
  // cheaper one), otherwise the run that got farther
  const recRun = method === "dopri" ? dopri : ros;
  const reference = reachedT(recRun) ? recRun : scan;
  return {
    verdict,
    method,
    K,
    Klower,
    Kmin,
    Kestimated,
    dopri,
    ros,
    maxDecay,
    S,
    maxGrowth: Number.isFinite(maxGrowth) ? maxGrowth : NaN,
    stabFrac,
    stabMedian,
    reference,
    costDopri,
    costRos,
  };
}

/** Повний цикл: запуск DOPRI і Розенброка з rtol = 10⁻⁶ (ліміти — {@link recLimits}) і {@link recommendFrom}. */
export function recommend(problem: Problem, varNames: string[], o: RecommendOptions = {}): Recommendation {
  const lim = recLimits(problem, o);
  const dopri = runMethod(problem, "dopri", lim, varNames);
  const ros = runMethod(problem, "ros", lim, varNames);
  return recommendFrom(problem, dopri, ros, o);
}
