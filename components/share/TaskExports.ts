/**
 * Що сторінка задачі передає в «🐍 Код Python / MATLAB»: специфікація (`lib/task-specs.ts`) з урахуванням режиму
 * сторінки, значення параметрів під іменами `spec.params[].name`, вибрані методи і налаштування методів — ті самі,
 * з якими рахує сторінка (крок з урахуванням обмеження кількості кроків, rtol/atol, поріг «вибуху», ліміт кроків).
 *
 * Одна функція на сторінку; модуль чистий (без React), тож відповідність «експортований код ⇄ розрахунок сторінки»
 * перевіряється скриптом у node: `solve(m, compileSpec(spec, values), opts)` дає той самий y(T), що й сторінка.
 *
 * @module TaskExports
 */
import type { CodegenOptions } from "@/lib/codegen";
import { METHODS } from "@/lib/methods";
import type { MethodId } from "@/lib/ode";
import type { ProblemSpec, SpecValues } from "@/lib/problem-spec";
import { specById } from "@/lib/task-specs";

export interface TaskExport {
  spec: ProblemSpec;
  values?: SpecValues;
  methods: MethodId[];
  opts?: Omit<CodegenOptions, "sourceUrl">;
  /** застереження біля кнопки коду: чим код відрізняється від розрахунку сторінки */
  note?: string;
}

/**
 * Прибирає «шум» округлення: 1e-4·1e-2 = 1.0000000000000002e-6 → 1e-6, 4.1000000000000005 → 4.1 (якщо число
 * відрізняється від свого запису з 6 значущими цифрами не більше ніж на 4 ulp). Справжні значення (2π/10, 8/3) не змінює.
 */
export function tidy(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const c = Number(x.toPrecision(6));
  return Math.abs(c - x) <= 4 * Number.EPSILON * Math.abs(x) ? c : x;
}

function spec(id: string): ProblemSpec {
  const s = specById(id);
  if (!s) throw new Error(`Немає специфікації ${id}`);
  return s;
}

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
/** 1e-6 → «10⁻⁶», 2e-4 → «2·10⁻⁴» */
function sci(x: number): string {
  const [m, e] = x.toExponential().split("e");
  const pow = `10${String(Number(e)).replace(/./g, (c) => SUP[c] ?? c)}`;
  return m === "1" ? pow : `${m}·${pow}`;
}

type Tol = readonly [rtol: number, atol: number];

/**
 * Сторінки, де адаптивні методи рахують з різними допусками (DOPRI 10⁻⁶, Розенброк 10⁻⁴…), а згенерований код має
 * спільні rtol/atol: беремо допуски першого вибраного методу з `tols` (порядок ключів — пріоритет) і пояснюємо різницю.
 */
function pickTol(methods: MethodId[], tols: Partial<Record<MethodId, Tol>>): { rtol: number; atol: number; note?: string } {
  const order = Object.keys(tols) as MethodId[];
  const chosen = order.filter((m) => methods.includes(m));
  const main = chosen[0] ?? order[0];
  const [rtol, atol] = tols[main]!;
  const other = chosen.filter((m) => tols[m]![0] !== rtol || tols[m]![1] !== atol);
  const q = (m: MethodId) => `«${METHODS[m].short}»`;
  const note = other.length
    ? `На сторінці ${other.map((m) => `${q(m)} рахує з rtol = ${sci(tols[m]![0])}, atol = ${sci(tols[m]![1])}`).join("; ")}, а в коді всі адаптивні методи мають спільні допуски, як у ${q(main)}: rtol = ${sci(rtol)}, atol = ${sci(atol)}. Тому для ${other.map(q).join(", ")} числа трохи відрізнятимуться від сторінки.`
    : undefined;
  return { rtol, atol, note };
}

const join = (...notes: (string | undefined)[]) => notes.filter(Boolean).join(" ") || undefined;
const IMPLICIT_FIXED: MethodId[] = ["ieuler", "theta", "trap", "bdf2"];

// ---------------------------------------------------------------------------------------------------------------- №1–№5
/** №1: лише методи зі сталим кроком, blowup 10⁶. */
export function exportT1(s: { h: number; T: number; methods: MethodId[] }): TaskExport {
  return { spec: spec("t1"), values: { T: s.T }, methods: s.methods, opts: { h: s.h, T: s.T, blowup: 1e6 } };
}

/** №2: T = 10 (стале на сторінці). */
export function exportT2(s: { h: number; eps: number; d: number; methods: MethodId[] }): TaskExport {
  return { spec: spec("t2"), values: { params: { d: s.d, ε: s.eps }, T: 10 }, methods: s.methods, opts: { h: s.h, T: 10, blowup: 1e6 } };
}

export function exportT3(s: { h: number; T: number; methods: MethodId[] }): TaskExport {
  return { spec: spec("t3"), values: { T: s.T }, methods: s.methods, opts: { h: s.h, T: s.T, blowup: 1e6 } };
}

/** №4: T = 5, blowup 10¹² (сторінка показує вибух явних методів). */
export function exportT4(s: { lam: number; h: number; methods: MethodId[] }): TaskExport {
  return { spec: spec("t4"), values: { params: { λ: s.lam }, T: 5 }, methods: s.methods, opts: { h: s.h, T: 5, blowup: 1e12 } };
}

/** №5: явні — крок h, blowup 10⁶; DOPRI 10⁻⁶/10⁻⁹, Розенброк 10⁻⁴/10⁻⁷; порожній вибір сторінка рахує як RK4. */
export function exportT5(s: { a: number; b: number; c: number; T: number; h: number; methods: MethodId[] }): TaskExport {
  const methods = s.methods.length ? s.methods : (["rk4"] as MethodId[]);
  const tol = pickTol(methods, { dopri: [1e-6, 1e-9], ros: [1e-4, 1e-7] });
  return {
    spec: spec("t5"),
    values: { params: { a: s.a, b: s.b, c: s.c }, T: s.T },
    methods,
    opts: { h: s.h, rtol: tol.rtol, atol: tol.atol, T: s.T, blowup: 1e6, maxSteps: 200000 },
    note: tol.note,
  };
}

// ---------------------------------------------------------------------------------------------------------------- №11–№16
/** №11: `h` — крок з урахуванням обмеження T/40 000; адаптивні: atol = rtol·10⁻³, ліміт 120 000 кроків. */
export function exportT11(s: { a: number; eps: number; x0: number; T: number; h: number; tol: number; methods: MethodId[] }): TaskExport {
  return {
    spec: spec("t11"),
    values: { params: { a: s.a, ε: s.eps, x0: s.x0 }, T: s.T },
    methods: s.methods,
    opts: { h: s.h, rtol: s.tol, atol: tidy(s.tol * 1e-3), T: s.T, blowup: 1e6, maxSteps: 120000 },
  };
}

/**
 * №12: режим «[0, T], фіксований h» — t12 (перша початкова умова) або t12-ic2 (друга); «Довгий час» — t12-long
 * (з початковою умовою, вибраною на сторінці). `h` — з обмеженням T/100 000; адаптивні: atol = rtol·10⁻⁶.
 */
export function exportT12(s: { ic: number; mode: "short" | "long"; h: number; T: number; Tl: number; tol: number; mShort: MethodId[]; mLong: MethodId[] }): TaskExport {
  const long = s.mode === "long";
  const id = long ? "t12-long" : s.ic === 1 ? "t12-ic2" : "t12";
  const sp = spec(id);
  const T = long ? s.Tl : s.T;
  const y0 = s.ic === 1 ? [3.00657, 4.00151e-6, 2.99343] : [1, 0, 0];
  return {
    spec: sp,
    values: { y0, T },
    methods: long ? s.mLong : s.mShort,
    opts: { ...(long ? {} : { h: s.h }), rtol: s.tol, atol: tidy(s.tol * 1e-6), T, blowup: 1e3, maxSteps: 60000 },
  };
}

/** Поріг вибуху θ-трасувальника сторінки №13. */
const T13_BLOWUP = 1e6;
/**
 * №13: вибрана задача (Робертсон / №1 / №3 / брюсселятор / Ван дер Поль), T з її переліку, θ і rtol; atol = rtol·atolF задачі.
 * Методи — θ-адаптивний (сторінка рахує його трасувальником lib/t13-theta.ts), Розенброк і, якщо увімкнено, DOPRI.
 */
export function exportT13(s: { pid: string; T: number; rtol: number; atolF: number; theta: number; showDop: boolean }): TaskExport {
  return {
    spec: spec(`t13-${s.pid}`),
    values: { T: s.T },
    methods: s.showDop ? ["thetaA", "ros", "dopri"] : ["thetaA", "ros"],
    // ліміт кроків — як у DOPRI сторінки (50 000); θ-метод і Розенброк на задачах сторінки до нього не доходять
    opts: { rtol: s.rtol, atol: tidy(s.rtol * s.atolF), theta: s.theta, T: s.T, blowup: T13_BLOWUP, maxSteps: 50000 },
    note:
      "θ-метод на сторінці рахується власним трасувальником кроків (lib/t13-theta.ts): алгоритм той самий, що й у θ-адаптивного методу ядра, але трасувальник записує кожну спробу кроку і зупиняється після 700 000 обчислень f, щоб сторінка не зависала. Згенерований код повторює solve() ядра «Лаб», тож y(T) збігається зі сторінкою, доки трасувальник не впирається в цей ліміт.",
  };
}

/**
 * №14, частина 2 (лабораторія): μ ≥ 100 — специфікація «жорсткий режим», інакше основна (μ = 5); значення — зі сторінки.
 * Явні: крок max(h, T/100 000), blowup 10⁶; DOPRI 10⁻⁶/10⁻⁸, Розенброк 10⁻⁴/10⁻⁷, ліміт 100 000 кроків.
 * Неявні сторінка розв'язує власним повним Ньютоном (lib/newton-fixed.ts) — про це застереження.
 */
export function exportT14(s: { mu: number; w: number; T: number; h: number; methods: MethodId[] }): TaskExport {
  const tol = pickTol(s.methods, { dopri: [1e-6, 1e-8], ros: [1e-4, 1e-7] });
  const implicit = s.methods.filter((m) => IMPLICIT_FIXED.includes(m));
  return {
    spec: spec(s.mu >= 100 ? "t14-stiff" : "t14"),
    values: { params: { μ: s.mu, ω: s.w }, T: s.T },
    methods: s.methods,
    opts: { h: Math.max(s.h, s.T / 100000), rtol: tol.rtol, atol: tol.atol, T: s.T, blowup: 1e6, maxSteps: 100000 },
    note: join(
      implicit.length
        ? `${implicit.map((m) => `«${METHODS[m].short}»`).join(", ")}: на сторінці неявні рівняння розв'язуються власним повним методом Ньютона (якобіан на кожній ітерації, крок не менший за T/20 000; lib/newton-fixed.ts), а згенерований код повторює solve() ядра «Лаб» (демпфований Ньютон із запасними стратегіями). На гладкому розв'язку y(T) збігається до похибки ітерацій Ньютона, на грубих кроках і великих μ числа можуть відрізнятися.`
        : undefined,
      tol.note,
    ),
  };
}

const W_BOOK = (2 * Math.PI) / 10;
const T16_PRESETS: { id: string; mu: number; a: number; w: number }[] = [
  { id: "t16", mu: 8.5, a: 0.5, w: W_BOOK },
  { id: "t16-weak", mu: 8.53, a: 1.2, w: W_BOOK },
  { id: "t16-chaos", mu: 5, a: 5, w: 2.466 },
  { id: "t16-lock", mu: 8.5, a: 2, w: W_BOOK },
];
/** №16: пресет сторінки → своя специфікація, інакше основна з поточними μ, a, ω. Явні: крок max(h, T/200 000). */
export function exportT16(s: { mu: number; a: number; w: number; T: number; h: number; methods: MethodId[] }): TaskExport {
  const p = T16_PRESETS.find((x) => x.mu === s.mu && x.a === s.a && Math.abs(x.w - s.w) < 1e-9);
  const tol = pickTol(s.methods, { dopri: [1e-6, 1e-8], ros: [1e-4, 1e-7] });
  return {
    spec: spec(p?.id ?? "t16"),
    values: { params: { μ: s.mu, a: s.a, ω: s.w }, T: s.T },
    methods: s.methods,
    opts: { h: Math.max(s.h, s.T / 200000), rtol: tol.rtol, atol: tol.atol, T: s.T, blowup: 1e6, maxSteps: 200000 },
    note: tol.note,
  };
}

// ---------------------------------------------------------------------------------------------------------------- №18–№25
/**
 * №18: пресети «годинник» і «стрибки» — свої специфікації, решта (A = 50, B = 50/80/120 і довільні) — основна.
 * `h` — з обмеженням T/40 000; адаптивні: atol = rtol·10⁻², ліміт 60 000 кроків. Неявні зі сталим кроком сторінка
 * розв'язує власним повним Ньютоном (lib/implicit-full-newton.ts) — про це застереження.
 */
export function exportT18(s: { A: number; B: number; u10: number; u20: number; T: number; h: number; tol: number; methods: MethodId[] }): TaskExport {
  const id = s.A === 1 && s.u10 === 1 && s.u20 === 1 && s.B === 3 && s.T === 50 ? "t18-clock" : s.A === 1 && s.u10 === 1 && s.u20 === 1 && s.B === 10 && s.T === 150 ? "t18-relax" : "t18";
  const implicit = s.methods.filter((m) => IMPLICIT_FIXED.includes(m));
  return {
    spec: spec(id),
    values: { params: { A: s.A, B: s.B }, y0: [s.u10, s.u20], T: s.T },
    methods: s.methods,
    opts: { h: s.h, rtol: s.tol, atol: tidy(s.tol * 1e-2), T: s.T, blowup: 1e6, maxSteps: 60000 },
    note: implicit.length
      ? `${implicit.map((m) => `«${METHODS[m].short}»`).join(", ")}: на сторінці неявні рівняння розв'язуються власним повним методом Ньютона (якобіан на кожній ітерації, прогноз yₙ, при невдачі — поділ кроку; lib/implicit-full-newton.ts), а згенерований код повторює solve() ядра «Лаб» (демпфований Ньютон із запасними стратегіями). Де Ньютон збігається з першої спроби, y(T) однаковий до похибки ітерацій; на грубих кроках і поблизу стрибків числа можуть відрізнятися, аж до зупинки методу в коді там, де сторінка дораховує.`
      : undefined,
  };
}

/** №19: явні/неявні — крок max(h, T/100 000), blowup 10⁸; DOPRI 10⁻⁶/10⁻⁹, Розенброк 10⁻⁴/10⁻⁷. */
export function exportT19(s: { m: number; c: number; k: number; d: number; u0: number; T: number; h: number; methods: MethodId[] }): TaskExport {
  const tol = pickTol(s.methods, { dopri: [1e-6, 1e-9], ros: [1e-4, 1e-7] });
  return {
    spec: spec("t19"),
    values: { params: { m: s.m, c: s.c, k: s.k, d: s.d }, y0: [s.u0, 0], T: s.T },
    methods: s.methods,
    opts: { h: Math.max(s.h, s.T / 100000), rtol: tol.rtol, atol: tol.atol, T: s.T, blowup: 1e8, maxSteps: 200000 },
    note: tol.note,
  };
}

/** Біфуркації Хопфа ФіцХью–Нагумо при ε = 0.08, a = 0.7, b = 0.8 (як HOPF на сторінці №20). */
const T20_HOPF_LOW = (() => {
  const V = -Math.sqrt(1 - 0.08 * 0.8);
  return (V + 0.7) / 0.8 - V + (V * V * V) / 3;
})();
/**
 * №20: режим за струмом — I ≤ −1 «придушений нейрон», I нижче першої біфуркації Хопфа — «спокій», інакше «спайки».
 * `h` — з обмеженням T/40 000; адаптивні: rtol = atol, ліміт 40 000 кроків.
 */
export function exportT20(s: { I: number; T: number; V0: number; W0: number; h: number; tol: number; methods: MethodId[] }): TaskExport {
  const id = s.I <= -1 ? "t20-im3" : s.I < T20_HOPF_LOW ? "t20-i0" : "t20";
  return {
    spec: spec(id),
    values: { params: { I: s.I }, y0: [s.V0, s.W0], T: s.T },
    methods: s.methods,
    opts: { h: s.h, rtol: s.tol, atol: s.tol, T: s.T, blowup: 1e6, maxSteps: 40000 },
  };
}

/** №21: лише методи зі сталим кроком, blowup 10⁶. */
export function exportT21(s: { m: number; c: number; k: number; u0: number; T: number; h: number; methods: MethodId[] }): TaskExport {
  return {
    spec: spec("t21"),
    values: { params: { m: s.m, c: s.c, k: s.k }, y0: [s.u0, 0], T: s.T },
    methods: s.methods,
    opts: { h: s.h, T: s.T, blowup: 1e6 },
  };
}

/** №22: пресет сторінки (q(0) = 5 / 8, резонанс, перезатухання) → своя специфікація, інакше основна. Крок max(h, T/100 000); atol = rtol·10⁻². */
export function exportT22(s: { preset: string; R: number; L: number; C: number; E: number; w: number; q0: number; v0: number; T: number; h: number; tol: number; methods: MethodId[] }): TaskExport {
  const id = ({ q5: "t22", q8: "t22-q8", res: "t22-res", over: "t22-over" } as Record<string, string>)[s.preset] ?? "t22";
  return {
    spec: spec(id),
    values: { params: { R: s.R, L: s.L, C: s.C, E: s.E, ω: s.w }, y0: [s.q0, s.v0], T: s.T },
    methods: s.methods,
    opts: { h: Math.max(s.h, s.T / 100000), rtol: s.tol, atol: tidy(s.tol * 1e-2), T: s.T, blowup: 1e6, maxSteps: 100000 },
  };
}

const T23_SPECS = ["t23", "t23-sin", "t23-res", "t23-half"];
/** №23: режим ω(τ) → специфікація. Явні/неявні: крок max(h, T/200 000), blowup 10⁸; DOPRI 10⁻⁶/10⁻⁸, Розенброк 10⁻⁴/10⁻⁷, θ-адапт. 10⁻⁴/10⁻⁶. */
export function exportT23(s: { mode: number; eps: number; b: number; c: number; T: number; h: number; methods: MethodId[] }): TaskExport {
  const tol = pickTol(s.methods, { dopri: [1e-6, 1e-8], ros: [1e-4, 1e-7], thetaA: [1e-4, 1e-6] });
  return {
    spec: spec(T23_SPECS[s.mode] ?? "t23"),
    values: { params: { ε: s.eps, b: s.b, c: s.c }, T: s.T },
    methods: s.methods,
    opts: { h: Math.max(s.h, s.T / 200000), rtol: tol.rtol, atol: tol.atol, T: s.T, blowup: 1e8, maxSteps: 300000 },
    note: tol.note,
  };
}

/**
 * №24: `h` — з обмеженням T/100 000; адаптивні: atol = rtol·10⁻³, blowup 10⁸. Ліміт кроків сторінки — 200 000 для
 * Розенброка і 60 000 для DOPRI/θ-адапт.; у коді спільний 60 000: Розенброку на всьому діапазоні сторінки
 * (T ≤ 720, rtol ≥ 10⁻⁷) вистачає ≤ 36 500 кроків, а DOPRI вичерпує ліміт так само, як на сторінці.
 */
export function exportT24(s: { T: number; h: number; tol: number; methods: MethodId[] }): TaskExport {
  return {
    spec: spec("t24"),
    values: { T: s.T },
    methods: s.methods,
    opts: { h: s.h, rtol: s.tol, atol: tidy(s.tol * 1e-3), T: s.T, blowup: 1e8, maxSteps: 60000 },
  };
}

/** №25: форма запису (вихідні (u, v, θ) чи логарифмічні (ln u, ln v, θ)) → специфікація; y0 у змінних форми. atol = rtol·10⁻³. */
export function exportT25(s: { form: "orig" | "log"; eps: number; y0: number[]; T: number; h: number; tol: number; methods: MethodId[] }): TaskExport {
  const log = s.form === "log";
  return {
    spec: spec(log ? "t25-log" : "t25"),
    values: { params: { ε: s.eps }, y0: log ? [Math.log(s.y0[0]), Math.log(s.y0[1]), s.y0[2]] : s.y0.slice(), T: s.T },
    methods: s.methods,
    opts: { h: s.h, rtol: s.tol, atol: tidy(s.tol * 1e-3), T: s.T, blowup: 1e6, maxSteps: 100000 },
  };
}

// ---------------------------------------------------------------------------------------------------------------- Лоренц
/**
 * Лоренц: перемикач «як надруковано» — буквальна система методички (сторінка рахує її Розенброком rtol 10⁻⁶ і RK4/RK2
 * з кроком h до T ≤ 25, blowup 10³⁰⁰); інакше класична система зі стартом умови або (0, 1, 0).
 * Адаптивні: atol = rtol·10⁻³, ліміт 400 000 кроків; порожній вибір сторінка рахує як RK4.
 */
export function exportLorenz(s: { literal: boolean; start: number; sig: number; r: number; b: number; T: number; h: number; rtol: number; methods: MethodId[] }): TaskExport {
  const params = { σ: s.sig, r: s.r, b: s.b };
  const y0 = s.start === 1 ? [0, 1, 0] : [3.051522, 1.582542, 15.62388];
  if (s.literal) {
    const T = Math.min(s.T, 25);
    return {
      spec: spec("lorenz-literal"),
      values: { params, y0, T },
      methods: ["ros", "rk4", "rk2"],
      opts: { h: s.h, rtol: 1e-6, atol: 1e-9, T, blowup: 1e300, maxSteps: 400000 },
    };
  }
  return {
    spec: spec(s.start === 1 ? "lorenz-alt" : "lorenz"),
    values: { params, T: s.T },
    methods: s.methods.length ? s.methods : ["rk4"],
    opts: { h: s.h, rtol: s.rtol, atol: tidy(s.rtol * 1e-3), T: s.T, blowup: 1e6, maxSteps: 400000 },
  };
}
