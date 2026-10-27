/**
 * Експорт задачі ({@link ProblemSpec}) у самодостатні скрипти Python (NumPy/SciPy/Matplotlib) і MATLAB/GNU Octave.
 *
 * Методи зі сталим кроком (euler, rk2, rk3, rk4, ieuler, theta, trap, bdf2), Розенброк 2(3) (`ros`, у Python)
 * і адаптивний θ-метод (`thetaA`) записано ВРУЧНУ рядок у рядок як у `lib/ode.ts`: ті самі формули, той самий
 * порядок операцій, той самий демпфований Ньютон з повним якобіаном і запасними стратегіями, той самий
 * регулятор кроку — тож числа збігаються з «Лаб» (до похибки округлення: LU у NumPy/MATLAB інший).
 * `dopri` → `scipy.integrate.solve_ivp(method="RK45")` / `ode45` (та сама пара Дорманда–Принса, інше керування
 * кроком), `ros` у MATLAB → `ode23s` (та сама схема Розенброка 2(3) Шемпайна–Райхельта).
 *
 * @module codegen
 */
import { formatNumber, freeNames, toMatlab, toPython, type Expr } from "./expr";
import { METHODS } from "./methods";
import type { MethodId } from "./ode";
import { parseSpec, resolveValues, specNames, timeName, type ProblemSpec, type SpecValues } from "./problem-spec";
import { taskById } from "./tasks";

/** Налаштування методів у згенерованому коді (типові — з `spec.defaults`, далі — типові значення ядра). */
export interface CodegenOptions {
  /** крок методів зі сталим кроком; типово spec.defaults.h або (T − t0)/1000 */
  h?: number;
  /** відносна точність адаптивних методів; типово spec.defaults.rtol або 1e-3 */
  rtol?: number;
  /** абсолютна точність; типово spec.defaults.atol або 1e-6 */
  atol?: number;
  /** кінець відрізка (перекриває values.T і spec.T) */
  T?: number;
  /** параметр θ-методів (theta, thetaA); типово 0.55 */
  theta?: number;
  /** поріг «вибуху» |y_i|; типово 1e10, як у ядрі */
  blowup?: number;
  /** ліміт кроків адаптивних методів; типово 200000, як у ядрі */
  maxSteps?: number;
  /** посилання на сторінку «Лаб» з тими самими параметрами (вставляється в шапку) */
  sourceUrl?: string;
}

export type CodeLang = "python" | "matlab";

const FIXED: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];
const IMPLICIT_FIXED: MethodId[] = ["ieuler", "theta", "trap", "bdf2"];

/** Ім'я файлу: `lab_t12_ic2.py` / `lab_t12_ic2.m` (для MATLAB ім'я файлу = ім'я головної функції). */
export function scriptFileName(spec: ProblemSpec, lang: CodeLang): string {
  return `${matlabFunctionName(spec)}.${lang === "python" ? "py" : "m"}`;
}

function matlabFunctionName(spec: ProblemSpec): string {
  const base = `lab_${spec.id}`.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  return base.slice(0, 60);
}

// ---------------------------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------------------------

const TRANSLIT: Record<string, string> = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  ε: "eps",
  ϵ: "eps",
  ζ: "zeta",
  η: "eta",
  θ: "theta",
  ϑ: "theta",
  ι: "iota",
  κ: "kappa",
  λ: "lam",
  μ: "mu",
  ν: "nu",
  ξ: "xi",
  ο: "o",
  π: "pi",
  ρ: "rho",
  σ: "sigma",
  ς: "sigma",
  τ: "tau",
  υ: "ups",
  φ: "phi",
  ϕ: "phi",
  χ: "chi",
  ψ: "psi",
  ω: "omega",
  Γ: "Gamma",
  Δ: "Delta",
  Θ: "Theta",
  Λ: "Lambda",
  Ξ: "Xi",
  Π: "Pi",
  Σ: "Sigma",
  Υ: "Upsilon",
  Φ: "Phi",
  Ψ: "Psi",
  Ω: "Omega",
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
};

/** ASCII-ідентифікатор: грецькі літери транслітеруються (σ → sigma, ε → eps, λ → lam), решта — `_`. */
function asciiName(name: string): string {
  let s = "";
  for (const ch of Array.from(name)) {
    if (/[A-Za-z0-9_]/.test(ch)) s += ch;
    else if (TRANSLIT[ch]) s += TRANSLIT[ch];
    else s += `x${ch.codePointAt(0)!.toString(16)}`;
  }
  if (!/^[A-Za-z]/.test(s)) s = `v${s}`;
  return s;
}

const PY_RESERVED = new Set([
  // keywords and literals
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except",
  "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
  "while", "with", "yield", "match", "case",
  // builtins the script relies on
  "print", "range", "len", "max", "min", "abs", "round", "int", "float", "list", "dict", "tuple", "str", "zip", "enumerate", "isinstance",
  // module-level names of the generated script
  "np", "plt", "solve_ivp", "f", "jac", "main", "EPS", "TITLE", "NAMES", "T0", "T_END", "Y0", "H", "RTOL", "ATOL", "THETA", "BLOWUP",
  "MAX_STEPS", "js_round", "is_bad", "err_norm", "initial_step", "newton_implicit", "substep_guess", "continuation_solve",
  "multi_start_solve", "fixed_step", "rosenbrock23", "theta_adaptive", "lu_factor", "lu_solve",
]);

const M_RESERVED = new Set([
  "break", "case", "catch", "classdef", "continue", "else", "elseif", "end", "for", "function", "global", "if", "otherwise", "parfor",
  "persistent", "return", "spmd", "switch", "try", "while",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10", "sqrt", "abs", "sign", "min", "max",
  "power", "floor", "ceil", "pi", "eps", "Inf", "inf", "NaN", "nan", "i", "j", "true", "false", "eye", "numel", "zeros",
  // built-in functions that a parameter name would shadow (legal, but confusing)
  "ans", "gamma", "beta", "alpha", "psi", "zeta", "erf", "erfc", "mod", "rem", "sum", "prod", "fix", "round", "real", "imag", "angle",
  "norm", "inv", "det", "lu", "qr", "length", "size", "any", "all", "isnan", "isfinite", "isempty", "find", "disp", "error", "line",
  "plot", "figure", "subplot", "legend", "xlabel", "ylabel", "title", "grid", "hold", "ode45", "ode23s", "odeset", "struct", "cell",
  // local names of rhs/jacobian
  "P", "dy", "Jm",
]);

interface Namer {
  /** spec name → target identifier */
  map: (n: string) => string;
  /** name of the time argument in f / jac */
  t: string;
  /** name of the state-vector argument in f / jac */
  y: string;
  isUser: (n: string) => boolean;
}

function makeNamer(spec: ProblemSpec, reserved: Set<string>): Namer {
  const user = specNames(spec);
  const userSet = new Set(user);
  const used = new Set<string>();
  const m = new Map<string, string>();
  for (const n of user) {
    let a = asciiName(n);
    while (reserved.has(a) || used.has(a)) a += "_";
    used.add(a);
    m.set(n, a);
  }
  const yName = ["y", "Y", "state", "state_"].find((c) => !used.has(c) && !reserved.has(c)) ?? "y__";
  return { map: (n) => m.get(n) ?? asciiName(n), t: m.get(timeName(spec))!, y: yName, isUser: (n) => userSet.has(n) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared preparation
// ---------------------------------------------------------------------------------------------------------------------

interface Prepared {
  spec: ProblemSpec;
  title: string;
  taskLabel: string;
  n: number;
  t0: number;
  T: number;
  y0: number[];
  params: Record<string, number>;
  h: number;
  rtol: number;
  atol: number;
  theta: number;
  blowup: number;
  maxSteps: number;
  methods: MethodId[];
  rhs: Expr[];
  jac: Expr[][];
  defs: { name: string; ast: Expr }[];
  sourceUrl?: string;
}

function prepare(spec: ProblemSpec, values: SpecValues | undefined, methods: MethodId[], opts: CodegenOptions): Prepared {
  const parsed = parseSpec(spec);
  const v = resolveValues(spec, values);
  const T = opts.T ?? v.T;
  const uniq = methods.filter((m, i) => methods.indexOf(m) === i && m in METHODS);
  const task = spec.taskId ? taskById(spec.taskId) : undefined;
  return {
    spec,
    title: spec.variant ? `${spec.title} — ${spec.variant}` : spec.title,
    taskLabel: task ? (task.label ?? `№${task.num}`) : "",
    n: spec.vars.length,
    t0: v.t0,
    T,
    y0: v.y0,
    params: v.params,
    h: opts.h ?? spec.defaults?.h ?? (T - v.t0) / 1000,
    rtol: opts.rtol ?? spec.defaults?.rtol ?? 1e-3,
    atol: opts.atol ?? spec.defaults?.atol ?? 1e-6,
    theta: opts.theta ?? 0.55,
    blowup: opts.blowup ?? 1e10,
    maxSteps: opts.maxSteps ?? 200000,
    methods: uniq.length ? uniq : ["rk4"],
    rhs: parsed.rhs,
    jac: parsed.jac,
    defs: parsed.defs,
    sourceUrl: opts.sourceUrl,
  };
}

/** defs, потрібні виразам (транзитивно), у порядку оголошення. */
function neededDefs(exprs: Expr[], defs: { name: string; ast: Expr }[]): { name: string; ast: Expr }[] {
  const need = new Set<string>();
  const byName = new Map(defs.map((d) => [d.name, d.ast]));
  const visit = (e: Expr) => {
    for (const n of freeNames(e))
      if (byName.has(n) && !need.has(n)) {
        need.add(n);
        visit(byName.get(n)!);
      }
  };
  exprs.forEach(visit);
  return defs.filter((d) => need.has(d.name));
}

const num = formatNumber;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");
const methodName = (m: MethodId) => METHODS[m].name;

function settingsOf(p: Prepared, m: MethodId): string {
  if (FIXED.includes(m)) return `сталий крок h = ${num(p.h)}${m === "theta" ? `, θ = ${num(p.theta)}` : ""}`;
  return `rtol = ${num(p.rtol)}, atol = ${num(p.atol)}${m === "thetaA" ? `, θ = ${num(p.theta)}` : ""}`;
}

/** Розбиває довгий текст на рядки ≤ width символів (для коментарів). */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (!w) continue;
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

function headerLines(p: Prepared, lang: CodeLang): string[] {
  const L = headerLinesRaw(p, lang);
  return L.flatMap((l) => l.split(/\r?\n/));
}

function headerLinesRaw(p: Prepared, lang: CodeLang): string[] {
  const s = p.spec;
  const L: string[] = [];
  L.push(p.title);
  L.push("");
  L.push(`Згенеровано з «Лаб» — інтерактивної лабораторії жорстких ОДР${p.taskLabel ? ` (задача ${p.taskLabel})` : ""}.`);
  if (p.sourceUrl) L.push(`Сторінка з тими самими параметрами: ${p.sourceUrl}`);
  L.push("Алгоритми методів повторюють ядро «Лаб» (lib/ode.ts) рядок у рядок, тож числа збігаються з");
  L.push("застосунком (до похибки округлення).");
  L.push("");
  L.push("Система:");
  s.vars.forEach((x, i) => L.push(`    ${x}' = ${s.rhs[i]}`));
  if (p.defs.length) {
    L.push("де");
    (s.defs ?? []).forEach((d) => L.push(`    ${d.name} = ${d.expr}${d.label ? `   (${d.label})` : ""}`));
  }
  L.push(`Відрізок: ${timeName(s)} ∈ [${num(p.t0)}, ${num(p.T)}], початкові умови: ${s.vars.map((x, i) => `${x}(${num(p.t0)}) = ${num(p.y0[i])}`).join(", ")}`);
  if (s.params.length) L.push(`Параметри: ${s.params.map((q) => `${q.name} = ${num(p.params[q.name])}`).join(", ")}`);
  L.push("");
  L.push("Методи:");
  for (const m of p.methods) {
    const how =
      m === "dopri"
        ? lang === "python"
          ? "SciPy solve_ivp(RK45)"
          : "ode45"
        : m === "ros"
          ? lang === "python"
            ? "вручну, як у «Лаб»"
            : "ode23s"
          : "вручну, як у «Лаб»";
    L.push(`    ${methodName(m)} — ${settingsOf(p, m)} (${how})`);
  }
  if (s.note) {
    L.push("");
    L.push(...wrap(`Примітка: ${s.note}`, 100));
  }
  return L;
}

// ---------------------------------------------------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------------------------------------------------

function pyList(xs: number[]): string {
  return `[${xs.map(num).join(", ")}]`;
}

/** Рядок Python у подвійних лапках. */
const pyStr = (s: string) => JSON.stringify(s);

/**
 * Повний скрипт Python 3.8+ (numpy, matplotlib; scipy — лише для DOPRI45). Друкує y(T) кожного методу
 * (17 значущих цифр) і будує графіки компонент.
 * @param values  значення параметрів/початкових умов (типово — зі специфікації)
 * @param methods методи в порядку виводу (повтори відкидаються; порожній список → RK4)
 */
export function toPythonScript(spec: ProblemSpec, values: SpecValues | undefined, methods: MethodId[], opts: CodegenOptions = {}): string {
  const p = prepare(spec, values, methods, opts);
  const N = makeNamer(spec, PY_RESERVED);
  const ex = (e: Expr) => toPython(e, N.map, N.isUser);
  const vars = spec.vars.map(N.map);
  const has = (m: MethodId) => p.methods.includes(m);
  const anyFixed = p.methods.some((m) => FIXED.includes(m));
  const anyImplicitFixed = p.methods.some((m) => IMPLICIT_FIXED.includes(m));
  const needNewton = anyImplicitFixed || has("thetaA");
  const needInit = has("ros") || has("thetaA");
  const L: string[] = [];
  const push = (...xs: string[]) => L.push(...xs);
  const unpack = vars.length === 1 ? `    ${vars[0]} = ${N.y}[0]` : `    ${vars.join(", ")} = ${N.y}`;
  const defLines = (exprs: Expr[]) => neededDefs(exprs, p.defs).map((d) => `    ${N.map(d.name)} = ${ex(d.ast)}`);

  push("# -*- coding: utf-8 -*-", '"""');
  // docstring-safe: no backslash escapes, no closing triple quotes
  push(...headerLines(p, "python").map((l) => l.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')));
  push("", `Запуск: python3 ${scriptFileName(spec, "python")}   (потрібні numpy, matplotlib${has("dopri") ? ", scipy" : ""})`, '"""');
  push("import numpy as np", "import matplotlib.pyplot as plt");
  if (has("dopri")) push("from scipy.integrate import solve_ivp");
  push("");
  push(`TITLE = ${pyStr(p.title)}`);
  push(`NAMES = [${(spec.varLabels ?? spec.vars).map(pyStr).join(", ")}]`);
  push("");
  if (spec.params.length) {
    push("# ------------------------------------------------------------------ параметри задачі");
    for (const q of spec.params) push(`${N.map(q.name)} = ${num(p.params[q.name])}${q.label ? `  # ${oneLine(q.label)}` : ""}`);
    push("");
  }
  push("# ------------------------------------------------------- відрізок, початкові умови, методи");
  push(`T0 = ${num(p.t0)}`, `T_END = ${num(p.T)}`, `Y0 = np.array(${pyList(p.y0)}, dtype=float)`);
  if (anyFixed) push(`H = ${num(p.h)}  # крок методів зі сталим кроком`);
  if (p.methods.some((m) => !FIXED.includes(m))) push(`RTOL = ${num(p.rtol)}  # відносна точність адаптивних методів`, `ATOL = ${num(p.atol)}  # абсолютна точність`);
  if (has("theta") || has("thetaA")) push(`THETA = ${num(p.theta)}  # параметр θ-методу`);
  push(`BLOWUP = ${num(p.blowup)}  # «вибух»: зупинка, якщо якась |y_i| перевищить це значення`);
  if (has("ros") || has("thetaA")) push(`MAX_STEPS = ${p.maxSteps}  # ліміт кроків адаптивних методів (прийняті + відкинуті)`);
  push("EPS = 2.220446049250313e-16  # машинний епсилон double", "");
  push("");
  push(`def f(${N.t}, ${N.y}):`, '    """Права частина y\' = f(t, y)."""', unpack, ...defLines(p.rhs), "    return np.array([");
  p.rhs.forEach((e, i) => push(`        ${ex(e)},  # ${spec.vars[i]}'`));
  push("    ], dtype=float)", "", "");
  const jacExprs = p.jac.flat();
  push(`def jac(${N.t}, ${N.y}):`, '    """Аналітичний якобіан ∂f/∂y (символьне диференціювання в «Лаб»)."""', unpack, ...defLines(jacExprs), "    return np.array([");
  p.jac.forEach((row) => push(`        [${row.map(ex).join(", ")}],`));
  push("    ], dtype=float)", "", "");
  push("def is_bad(y, limit):", '    """Як bad() у lib/ode.ts: нескінченність/NaN або |y_i| > limit."""', "    return not np.all(np.isfinite(y)) or np.max(np.abs(y)) > limit", "", "");

  if (anyFixed)
    push(
      "def js_round(x):",
      '    """Округлення як Math.round у JavaScript (половинки — вгору; вбудований round() у Python — банківський)."""',
      "    return int(np.floor(x + 0.5))",
      "",
      "",
    );

  if (needNewton || has("ros")) {
    push(
      "def lu_factor(A):",
      '    """LU з МАСШТАБОВАНИМ частковим вибором головного елемента — як luFactor у lib/linalg.ts.',
      "    Головний елемент максимізує |a_ik| / s_i, де s_i — найбільший модуль у вихідному рядку i. Тому рядки дуже різного",
      "    масштабу (популяція ~1e-80 поруч зі змінними ~1) не змішуються, і малі компоненти лишаються відносно точними —",
      "    від цього залежить критерій збіжності Ньютона. np.linalg.solve (LAPACK) рядків не масштабує.\"\"\"",
      "    n = len(A)",
      "    lu = [[float(v) for v in row] for row in A]",
      "    piv = list(range(n))",
      "    row_scale = [1.0 if any(v != v for v in row) else (max(abs(v) for v in row) or 1.0) for row in lu]",
      "    singular = False",
      "    for k in range(n):",
      "        p = k",
      "        best = abs(lu[k][k]) / row_scale[piv[k]]",
      "        for i in range(k + 1, n):",
      "            v = abs(lu[i][k]) / row_scale[piv[i]]",
      "            if v > best:",
      "                best, p = v, i",
      "        if best == 0 or not np.isfinite(best):",
      "            singular = True",
      "            continue",
      "        if p != k:",
      "            lu[p], lu[k] = lu[k], lu[p]",
      "            piv[p], piv[k] = piv[k], piv[p]",
      "        for i in range(k + 1, n):",
      "            lu[i][k] /= lu[k][k]",
      "            m = lu[i][k]",
      "            for j in range(k + 1, n):",
      "                lu[i][j] -= m * lu[k][j]",
      "    return lu, piv, singular",
      "",
      "",
      "def lu_solve(lu, piv, b):",
      '    """Розв\'язок LU·x = b[piv] прямою і зворотною підстановкою (luSolve у lib/linalg.ts)."""',
      "    n = len(lu)",
      "    x = [float(b[p]) for p in piv]",
      "    for i in range(n):",
      "        for j in range(i):",
      "            x[i] -= lu[i][j] * x[j]",
      "    for i in range(n - 1, -1, -1):",
      "        for j in range(i + 1, n):",
      "            x[i] -= lu[i][j] * x[j]",
      "        x[i] /= lu[i][i]",
      "    return np.array(x)",
      "",
      "",
    );
  }
  if (needNewton) {
    push(
      "def newton_implicit(t1, guess, c, hb, J0):",
      '    """Розв\'язує z = c + hb·f(t1, z) демпфованим методом Ньютона з повним якобіаном (newtonImplicit у lib/ode.ts).',
      "    Повертає None, якщо Ньютон не збігся.\"\"\"",
      "    I = np.eye(len(c))",
      "    scale = 1 + np.abs(c)  # відносна шкала для великих компонент, абсолютна (1e-12) для малих",
      "    z = guess.copy()",
      "    fz = f(t1, z)",
      "    r = np.max(np.abs(z - c - hb * fz) / scale)",
      "    rel_step = np.inf  # відносний розмір останнього приросту (малі компоненти теж мають збігтися відносно)",
      "    J = J0",
      "    J_is_J0 = True",
      "    for it in range(80):",
      "        if it > 0 and r < 1e-12 and rel_step < 1e-10:",
      "            return z",
      "        lu, piv, singular = lu_factor(I - hb * J)",
      "        if singular:",
      "            return None",
      "        dz = lu_solve(lu, piv, z - c - hb * fz)",
      "        lam = 1.0",
      "        decreased = False",
      "        for _ in range(16):  # демпфування: півкроки, доки нев'язка не зменшиться",
      "            zn = z - lam * dz",
      "            fn = f(t1, zn)",
      "            rn = np.max(np.abs(zn - c - hb * fn) / scale)",
      "            if np.isfinite(rn) and (rn < r or (lam == 1 and r < 1e-12)):",
      "                decreased = True",
      "                break",
      "            lam /= 2",
      "        if not decreased:",
      "            if J_is_J0 and it == 0:  # застарілий якобіан: оновлюємо один раз",
      "                J = jac(t1, z)",
      "                continue",
      "            return z if r < 1e-8 else None",
      "        step = np.max(lam * np.abs(dz) / scale)",
      "        rel_step = np.max(lam * np.abs(dz) / (np.abs(zn) + 1e-200))",
      "        z, fz, r = zn, fn, rn",
      "        if lam == 1 and step < 1e-11 and rel_step < 1e-10:",
      "            return z",
      "        J = jac(t1, z)",
      "        J_is_J0 = False",
      "    return z if r < 1e-8 else None",
      "",
      "",
    );
  }
  if (anyImplicitFixed) {
    push(
      "def substep_guess(t, y, h, depth=0):",
      '    """Початкове наближення для важкого неявного кроку: неявний Ейлер на t → t+h з рекурсивним діленням кроку."""',
      "    z = newton_implicit(t + h, y, y, h, jac(t, y))",
      "    if z is not None:",
      "        return z",
      "    if depth >= 10:",
      "        return None",
      "    mid = substep_guess(t, y, h / 2, depth + 1)",
      "    return substep_guess(t + h / 2, mid, h / 2, depth + 1) if mid is not None else None",
      "",
      "",
      "def continuation_solve(t1, c, hb):",
      '    """Гомотопія за неявною вагою: від z = c (точний корінь при hb = 0) поступово до повного hb."""',
      "    z = c.copy()",
      "    s, ds, guard = 0.0, 0.25, 0",
      "    while s < 1 and guard < 60:",
      "        guard += 1",
      "        sn = min(1.0, s + ds)",
      "        zn = newton_implicit(t1, z, c, hb * sn, jac(t1, z))",
      "        if zn is not None:",
      "            z, s = zn, sn",
      "            ds = min(ds * 2, (1 - s) or 1)",
      "        else:",
      "            ds /= 2",
      "            if ds < 1e-4:",
      "                return None",
      "    return z if s >= 1 else None",
      "",
      "",
      "def multi_start_solve(t1, c, hb):",
      '    """Кілька стартів уздовж векторного поля — корінь може лежати на іншій гілці повільного многовиду."""',
      "    fc = f(t1, c)",
      "    for k in (1, 2, 4, 8, 16, 32, 64):",
      "        z0 = c + k * hb * fc",
      "        if not np.all(np.isfinite(z0)):",
      "            break",
      "        z = newton_implicit(t1, z0, c, hb, jac(t1, z0))",
      "        if z is not None:",
      "            return z",
      "    return None",
      "",
      "",
    );
  }
  if (anyFixed) {
    const fixedSel = p.methods.filter((m) => FIXED.includes(m));
    push(
      "def fixed_step(method, h0, th=" + (has("theta") ? "THETA" : "0.55") + "):",
      '    """Методи зі сталим кроком — ті самі формули, що й fixedStep у lib/ode.ts. Повертає (t, y, кроків, збій)."""',
      "    N = max(1, js_round((T_END - T0) / h0))",
      "    h = (T_END - T0) / N",
      '    if method == "trap":',
      "        th = 0.5",
      '    elif method == "ieuler":',
      "        th = 1.0",
      '    implicit = method in ("ieuler", "theta", "trap", "bdf2")',
      "    t, y, y_prev = T0, Y0.copy(), None",
      "    ts, ys = [t], [y]",
      "    failed = None",
      "    rescues = 0",
      "    for n in range(N):",
      "        t1 = T0 + (n + 1) * h",
      "        yn = None",
    );
    let first = true;
    const br = (cond: string) => {
      push(`        ${first ? "if" : "elif"} ${cond}:`);
      first = false;
    };
    if (fixedSel.includes("euler")) {
      br('method == "euler"');
      push("            yn = y + h * f(t, y)");
    }
    if (fixedSel.includes("rk2")) {
      br('method == "rk2"');
      push("            # середня точка: k2 — нахил у півкроку", "            k1 = f(t, y)", "            k2 = f(t + h / 2, y + h / 2 * k1)", "            yn = y + h * k2");
    }
    if (fixedSel.includes("rk3")) {
      br('method == "rk3"');
      push(
        "            # третій порядок Кутти: ваги 1/6, 2/3, 1/6",
        "            k1 = f(t, y)",
        "            k2 = f(t + h / 2, y + h / 2 * k1)",
        "            k3 = f(t + h, y + h * (2 * k2 - k1))",
        "            yn = y + h / 6 * (k1 + 4 * k2 + k3)",
      );
    }
    if (fixedSel.includes("rk4")) {
      br('method == "rk4"');
      push(
        "            k1 = f(t, y)",
        "            k2 = f(t + h / 2, y + h / 2 * k1)",
        "            k3 = f(t + h / 2, y + h / 2 * k2)",
        "            k4 = f(t + h, y + h * k3)",
        "            yn = y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)",
      );
    }
    const thetaFam = fixedSel.filter((m) => m === "ieuler" || m === "theta" || m === "trap");
    if (thetaFam.length) {
      br(thetaFam.length === 1 ? `method == "${thetaFam[0]}"` : `method in (${thetaFam.map((m) => `"${m}"`).join(", ")})`);
      push(
        "            # y_{n+1} = y_n + h((1 − θ) f_n + θ f_{n+1}): θ = 1 — неявний Ейлер, 0.5 — трапеції",
        "            fy = f(t, y)",
        "            c = y + h * (1 - th) * fy",
        "            yn = newton_implicit(t1, y, c, h * th, jac(t, y))",
      );
    }
    if (fixedSel.includes("bdf2")) {
      br('method == "bdf2"');
      push(
        "            # Гір (BDF2): 3/2·y_{n+1} − 2y_n + 1/2·y_{n−1} = h f_{n+1}; перший крок — неявний Ейлер",
        "            J = jac(t, y)",
        "            if y_prev is None:",
        "                yn = newton_implicit(t1, y, y, h, J)",
        "            else:",
        "                yn = newton_implicit(t1, y, 4 / 3 * y - 1 / 3 * y_prev, 2 / 3 * h, J)",
      );
    }
    if (anyImplicitFixed) {
      push(
        "        if yn is None and implicit:",
        "            if rescues >= 25:  # запасні стратегії дорогі: якщо потрібні надто часто — здаємося",
        '                failed = f"Метод Ньютона не збігся (рівняння кроку не розв\'язується вже 25 разів) при t ≈ {t:.4g}"',
        "                break",
        "            rescues += 1",
        "            if method == \"bdf2\" and y_prev is not None:",
        "                c, hb = 4 / 3 * y - 1 / 3 * y_prev, 2 / 3 * h",
        '            elif method == "bdf2":',
        "                c, hb = y, h",
        "            else:",
        "                c, hb = y + h * (1 - th) * f(t, y), h * th",
        "            g = substep_guess(t, y, h)  # 1) кращий старт: неявний Ейлер дрібними підкроками",
        "            if g is not None:",
        "                yn = newton_implicit(t1, g, c, hb, jac(t1, g))",
        "            if yn is None:  # 2) гомотопія за вагою, 3) кілька стартів",
        "                yn = continuation_solve(t1, c, hb)",
        "                if yn is None:",
        "                    yn = multi_start_solve(t1, c, hb)",
        "        if yn is None:",
        '            failed = f"Метод Ньютона не збігся при t ≈ {t:.4g}"',
        "            break",
      );
    }
    push(
      "        y_prev, y, t = y, yn, t1",
      "        ts.append(t)",
      "        ys.append(y)",
      "        if is_bad(y, BLOWUP):",
      '            failed = f"Розв\'язок «вибухнув» при t ≈ {t:.4g}"',
      "            break",
      "    return np.array(ts), np.array(ys), len(ts) - 1, failed",
      "",
      "",
    );
  }
  if (needInit) {
    push(
      "def err_norm(err, y0, y1, rtol, atol):",
      "    return np.max(np.abs(err) / (atol + rtol * np.maximum(np.abs(y0), np.abs(y1))))",
      "",
      "",
      "def initial_step(order, rtol, atol):",
      '    """Початковий крок адаптивних методів (initialStep у lib/ode.ts)."""',
      "    f0 = f(T0, Y0)",
      "    sc = atol + rtol * np.abs(Y0)",
      "    d0 = np.max(np.abs(Y0) / sc)",
      "    d1 = np.max(np.abs(f0) / sc)",
      "    h = 1e-6 if (d0 < 1e-5 or d1 < 1e-5) else 0.01 * d0 / d1",
      "    h = min(h, (T_END - T0) / 10)",
      "    return max(h * 0.5 ** (order - 1), 1e-12)",
      "",
      "",
    );
  }
  if (has("ros")) {
    push(
      "def rosenbrock23(rtol, atol):",
      '    """Адаптивний Розенброк 2(3) Шемпайна–Райхельта (схема MATLAB ode23s), як rosenbrock() у lib/ode.ts.',
      "    У SciPy такого методу немає, тому він записаний тут вручну.\"\"\"",
      "    d = 1 / (2 + np.sqrt(2))",
      "    e32 = 6 + np.sqrt(2)",
      "    I = np.eye(len(Y0))",
      "    t, y = T0, Y0.copy()",
      "    h = initial_step(2, rtol, atol)",
      "    F0 = f(t, y)",
      "    ts, ys = [t], [y]",
      "    steps = rejected = 0",
      "    failed = None",
      "    while t < T_END and steps + rejected < MAX_STEPS:",
      "        h = min(h, T_END - t)",
      "        J = jac(t, y)",
      "        dtt = np.sqrt(EPS) * max(abs(t), 1e-3)  # ∂f/∂t скінченною різницею",
      "        Tt = (f(t + dtt, y) - F0) / dtt",
      "        lu, piv, singular = lu_factor(I - h * d * J)  # W = I − h·d·J, одна LU на три розв'язки",
      "        accepted = False",
      "        if not singular:",
      "            k1 = lu_solve(lu, piv, F0 + h * d * Tt)",
      "            F1 = f(t + 0.5 * h, y + 0.5 * h * k1)",
      "            k2 = lu_solve(lu, piv, F1 - k1) + k1",
      "            yn = y + h * k2",
      "            F2 = f(t + h, yn)",
      "            k3 = lu_solve(lu, piv, F2 - e32 * (k2 - F1) - 2 * (k1 - F0) + h * d * Tt)",
      "            err = h / 6 * (k1 - 2 * k2 + k3)  # оцінка похибки 3-го порядку",
      "            en = err_norm(err, y, yn, rtol, atol)",
      "            if en <= 1 and np.isfinite(en):",
      "                accepted = True",
      "                t, y, F0 = t + h, yn, F2",
      "                ts.append(t)",
      "                ys.append(y)",
      "                steps += 1",
      "                if is_bad(y, BLOWUP):",
      '                    failed = f"Розв\'язок «вибухнув» при t ≈ {t:.4g}"',
      "                    break",
      "            fac = 0.1 if not np.isfinite(en) else 5.0 if en == 0 else min(5.0, max(0.2, 0.8 * en ** (-1 / 3)))",
      "            h *= fac if accepted else min(fac, 0.5)",
      "        else:  # вироджена матриця W",
      "            h *= 0.25",
      "        if not accepted:",
      "            rejected += 1",
      "        if t < T_END and h < 1e-14 * max(1, abs(t)):",
      '            failed = f"Крок став надто малим при t ≈ {t:.4g}"',
      "            break",
      "    if t < T_END and failed is None:",
      '        failed = f"Вичерпано ліміт кроків ({MAX_STEPS}) при t ≈ {t:.4g}"',
      "    return np.array(ts), np.array(ys), steps, failed",
      "",
      "",
    );
  }
  if (has("thetaA")) {
    push(
      "def theta_adaptive(rtol, atol, th=THETA):",
      '    """θ-метод зі змінним кроком і контролем похибки подвоєнням кроку (thetaAdaptive у lib/ode.ts)."""',
      "    q = 2 if abs(th - 0.5) < 1e-12 else 1  # порядок методу",
      "    t, y = T0, Y0.copy()",
      "    h = initial_step(1, rtol, atol)",
      "    ts, ys = [t], [y]",
      "    steps = rejected = 0",
      "    failed = None",
      "",
      "    def step(t0, y0, f0, J, hh):",
      "        return newton_implicit(t0 + hh, y0, y0 + hh * (1 - th) * f0, hh * th, J)",
      "",
      "    while t < T_END and steps + rejected < MAX_STEPS:",
      "        h = min(h, T_END - t)",
      "        f0 = f(t, y)",
      "        J = jac(t, y)",
      "        big = step(t, y, f0, J, h)  # один крок h",
      "        half = step(t, y, f0, J, h / 2)  # два кроки h/2",
      "        two = step(t + h / 2, half, f(t + h / 2, half), J, h / 2) if half is not None else None",
      "        if big is None or two is None:",
      "            rejected += 1",
      "            h *= 0.25",
      "        else:",
      "            err = (two - big) / (2.0 ** q - 1)  # оцінка Річардсона",
      "            en = err_norm(err, y, two, rtol, atol)",
      "            if en <= 1:",
      "                t, y = t + h, two",
      "                ts.append(t)",
      "                ys.append(y)",
      "                steps += 1",
      "                if is_bad(y, BLOWUP):",
      '                    failed = f"Розв\'язок «вибухнув» при t ≈ {t:.4g}"',
      "                    break",
      "            else:",
      "                rejected += 1",
      "            fac = 4.0 if en == 0 else np.minimum(4.0, np.maximum(0.2, 0.9 * en ** (-1 / (q + 1))))",
      "            h *= fac",
      "        if t < T_END and h < 1e-14 * max(1, abs(t)):",
      '            failed = f"Крок став надто малим при t ≈ {t:.4g}"',
      "            break",
      "    if t < T_END and failed is None:",
      '        failed = f"Вичерпано ліміт кроків ({MAX_STEPS}) при t ≈ {t:.4g}"',
      "    return np.array(ts), np.array(ys), steps, failed",
      "",
      "",
    );
  }

  // ---- main
  push("def main():", "    results = []  # (ключ, назва методу, t, y [кількість точок × n], кроків, збій)");
  for (const m of p.methods) {
    const name = pyStr(methodName(m));
    push("");
    if (FIXED.includes(m)) {
      push(`    # ${methodName(m)}: ${settingsOf(p, m)}`, `    t, y, steps, failed = fixed_step("${m}", H)`, `    results.append(("${m}", ${name}, t, y, steps, failed))`);
    } else if (m === "dopri") {
      push(
        "    # Дорманд–Принс 5(4): SciPy RK45 — та сама пара DP5(4), але керування кроком і норма похибки",
        "    # (середньоквадратична замість максимуму) інші, тож кроки й y(T) збігаються з «Лаб» лише в межах допуску",
        "    sol = solve_ivp(f, (T0, T_END), Y0, method=\"RK45\", rtol=RTOL, atol=ATOL)",
        `    results.append(("dopri", ${pyStr(`${methodName(m)} (SciPy RK45)`)}, sol.t, sol.y.T, len(sol.t) - 1, None if sol.success else sol.message))`,
      );
    } else if (m === "ros") {
      push(`    # ${methodName(m)}: ${settingsOf(p, m)}`, "    t, y, steps, failed = rosenbrock23(RTOL, ATOL)", `    results.append(("ros", ${name}, t, y, steps, failed))`);
    } else if (m === "thetaA") {
      push(`    # ${methodName(m)}: ${settingsOf(p, m)}`, "    t, y, steps, failed = theta_adaptive(RTOL, ATOL)", `    results.append(("thetaA", ${name}, t, y, steps, failed))`);
    }
  }
  push(
    "",
    "    print(TITLE)",
    '    print("y(T) для кожного методу:")',
    "    for key, name, t, y, steps, failed in results:",
    '        values = "  ".join(f"{v:.17g}" for v in y[-1])',
    '        note = f"   ⚠ {failed}" if failed else ""',
    '        print(f"{key:<7} {name:<34} t = {t[-1]:.10g}   y = [{values}]   кроків: {steps}{note}")',
    "",
    "    n = len(NAMES)",
    "    fig, axes = plt.subplots(n, 1, sharex=True, figsize=(9, 2.4 * n + 1), squeeze=False)",
    "    for i in range(n):",
    "        ax = axes[i, 0]",
    "        for key, name, t, y, steps, failed in results:",
    "            ax.plot(t, y[:, i], label=name, lw=1.2)",
    "        ax.set_ylabel(NAMES[i])",
    "        ax.grid(alpha=0.3)",
    "        # ax.set_xscale(\"symlog\")  # для дуже довгих відрізків (напр. Робертсон до 4·10⁵)",
    '    axes[0, 0].legend(loc="best", fontsize=8)',
    `    axes[-1, 0].set_xlabel(${pyStr(timeName(spec))})`,
    "    fig.suptitle(TITLE)",
    "    fig.tight_layout()",
    "    plt.show()",
    "",
    "",
    'if __name__ == "__main__":',
    "    main()",
    "",
  );
  return L.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// MATLAB / GNU Octave
// ---------------------------------------------------------------------------------------------------------------------

/** Рядок MATLAB в одинарних лапках (переноси рядків — пробілами). */
const mStr = (s: string) => `'${s.replace(/[\r\n]+/g, " ").replace(/'/g, "''")}'`;

/**
 * Повний `.m`-файл: головна функція `lab_<id>` + локальні функції в кінці (працює в MATLAB R2016b+ і GNU Octave 7+:
 * файл-функція, без `arguments`-блоків і рядків `"…"`). Друкує y(T) і будує графіки.
 */
export function toMatlabScript(spec: ProblemSpec, values: SpecValues | undefined, methods: MethodId[], opts: CodegenOptions = {}): string {
  const p = prepare(spec, values, methods, opts);
  const N = makeNamer(spec, M_RESERVED);
  const ex = (e: Expr) => toMatlab(e, N.map, N.isUser);
  const vars = spec.vars.map(N.map);
  const has = (m: MethodId) => p.methods.includes(m);
  const anyFixed = p.methods.some((m) => FIXED.includes(m));
  const anyImplicitFixed = p.methods.some((m) => IMPLICIT_FIXED.includes(m));
  const needNewton = anyImplicitFixed || has("thetaA");
  const fname = matlabFunctionName(spec);
  const L: string[] = [];
  const push = (...xs: string[]) => L.push(...xs);
  const paramUnpack = spec.params.map((q) => `${N.map(q.name)} = P.${N.map(q.name)};`).join(" ");
  const stateUnpack = vars.map((x, i) => `${x} = ${N.y}(${i + 1});`).join(" ");
  const defLines = (exprs: Expr[]) => neededDefs(exprs, p.defs).map((d) => `${N.map(d.name)} = ${ex(d.ast)};`);

  push(`function ${fname}()`);
  const hdr = headerLines(p, "matlab");
  push(`%${fname.toUpperCase()}  ${hdr[0]}`);
  for (const l of hdr.slice(1)) push(l ? `%   ${l}` : "%");
  push("%", `%   Запуск: збережіть файл як ${fname}.m і виконайте ${fname} у MATLAB (R2016b+) або GNU Octave (7+).`);
  push("%   Файл у кодуванні UTF-8 (у MATLAB до R2020a кирилиця в коментарях може відображатися неправильно).", "");
  if (spec.params.length) {
    push("% ------------------------------------------------------------------ параметри задачі");
    for (const q of spec.params) push(`P.${N.map(q.name)} = ${num(p.params[q.name])};${q.label ? `  % ${oneLine(q.label)}` : ""}`);
  } else push("P = struct();  % параметрів немає");
  push("", "% ------------------------------------------------------- відрізок, початкові умови, методи");
  push(`t0 = ${num(p.t0)};`, `T = ${num(p.T)};`, `y0 = [${p.y0.map(num).join("; ")}];`);
  push(`names = {${(spec.varLabels ?? spec.vars).map(mStr).join(", ")}};`);
  push(`h = ${num(p.h)};  % крок методів зі сталим кроком`);
  push(`rtol = ${num(p.rtol)};  % відносна точність адаптивних методів`, `atol = ${num(p.atol)};  % абсолютна точність`);
  push(`theta = ${num(p.theta)};  % параметр θ-методу`, `blowup = ${num(p.blowup)};  % «вибух»: зупинка, якщо якась |y_i| перевищить це значення`);
  push(`max_steps = ${p.maxSteps};  % ліміт кроків адаптивних методів`);
  push("", "f = @(t, y) rhs(t, y, P);", "J = @(t, y) jacobian(t, y, P);", "", "res = cell(0, 6);  % {ключ, назва, t (рядок), y (n × точок), кроків, збій}");
  for (const m of p.methods) {
    push("");
    if (FIXED.includes(m)) {
      push(`% ${methodName(m)}: ${settingsOf(p, m)}`, `[tt, yy, steps, failed] = fixed_step(${mStr(m)}, f, J, t0, T, y0, h, theta, blowup);`, `res(end + 1, :) = {${mStr(m)}, ${mStr(methodName(m))}, tt, yy, steps, failed};`);
    } else if (m === "dopri") {
      push(
        "% Дорманд–Принс 5(4): ode45 — та сама пара DP5(4), але керування кроком інше,",
        "% тож кроки й y(T) збігаються з «Лаб» лише в межах допуску",
        "opts = odeset('RelTol', rtol, 'AbsTol', atol);",
        "[tt, yy] = ode45(f, [t0 T], y0, opts);",
        `res(end + 1, :) = {'dopri', ${mStr(`${methodName(m)} (ode45)`)}, tt.', yy.', numel(tt) - 1, ''};`,
      );
    } else if (m === "ros") {
      push(
        "% Розенброк 2(3): ode23s — та сама L-стійка схема Розенброка 2(3) Шемпайна–Райхельта, що й у ядрі «Лаб»;",
        "% регулятор кроку MATLAB трохи інший, тож кількість кроків може відрізнятися",
        "opts = odeset('RelTol', rtol, 'AbsTol', atol, 'Jacobian', J);",
        "[tt, yy] = ode23s(f, [t0 T], y0, opts);",
        `res(end + 1, :) = {'ros', ${mStr(`${methodName(m)} (ode23s)`)}, tt.', yy.', numel(tt) - 1, ''};`,
      );
    } else if (m === "thetaA") {
      push(
        `% ${methodName(m)}: ${settingsOf(p, m)} (вручну, як у «Лаб»)`,
        "[tt, yy, steps, failed] = theta_adaptive(f, J, t0, T, y0, rtol, atol, theta, blowup, max_steps);",
        `res(end + 1, :) = {'thetaA', ${mStr(methodName(m))}, tt, yy, steps, failed};`,
      );
    }
  }
  push(
    "",
    `fprintf('%s\\n', ${mStr(p.title)});`,
    "fprintf('y(T) для кожного методу:\\n');",
    "for k = 1:size(res, 1)",
    "  tt = res{k, 3}; yy = res{k, 4};",
    "  fprintf('%-7s %-34s t = %.10g   y = [%s]   кроків: %d', res{k, 1}, res{k, 2}, tt(end), strtrim(sprintf('%.17g  ', yy(:, end))), res{k, 5});",
    "  if ~isempty(res{k, 6}), fprintf('   ! %s', res{k, 6}); end",
    "  fprintf('\\n');",
    "end",
    "",
    "n = numel(y0);",
    `figure('Name', ${mStr(p.title)});`,
    "for i = 1:n",
    "  subplot(n, 1, i); hold on; grid on;",
    "  for k = 1:size(res, 1)",
    "    yy = res{k, 4};",
    "    plot(res{k, 3}, yy(i, :), 'DisplayName', res{k, 2});",
    "  end",
    "  ylabel(names{i});",
    "  if i == 1, legend('show', 'Location', 'best'); end",
    "end",
    `xlabel(${mStr(timeName(spec))});`,
    "end",
    "",
    "% =====================================================================================================",
    "",
  );
  // rhs / jacobian
  push(`function dy = rhs(${N.t}, ${N.y}, P) %#ok<INUSL>`, "% Права частина y' = f(t, y).");
  if (paramUnpack) push(paramUnpack);
  push(stateUnpack, ...defLines(p.rhs), "dy = [");
  p.rhs.forEach((e, i) => push(`  ${ex(e)};  % ${spec.vars[i]}'`));
  push("];", "end", "");
  push(`function Jm = jacobian(${N.t}, ${N.y}, P) %#ok<INUSL>`, "% Аналітичний якобіан df/dy (символьне диференціювання в «Лаб»).");
  if (paramUnpack) push(paramUnpack);
  push(stateUnpack, ...defLines(p.jac.flat()), "Jm = [");
  p.jac.forEach((row) => push(`  ${row.map(ex).join(", ")};`));
  push("];", "end", "");
  push(
    "function m = maxjs(v)",
    "% Максимум, що (як Math.max у JavaScript) повертає NaN, якщо є NaN (вбудований max NaN ігнорує).",
    "if any(isnan(v)), m = NaN; else, m = max(v); end",
    "end",
    "",
    "function b = is_bad(y, limit)",
    "b = any(~isfinite(y)) || maxjs(abs(y)) > limit;",
    "end",
    "",
  );
  if (needNewton) {
    push(
      "function [LU, piv, singular] = lu_factor(A)",
      "% LU з МАСШТАБОВАНИМ частковим вибором головного елемента (luFactor у lib/linalg.ts): головний елемент",
      "% максимізує |a_ik|/s_i, s_i — найбільший модуль вихідного рядка i. Рядки дуже різного масштабу не змішуються,",
      "% і малі компоненти лишаються відносно точними (від цього залежить критерій збіжності Ньютона); оператор \\",
      "% рядків не масштабує.",
      "n = size(A, 1);",
      "LU = A; piv = 1:n; singular = false;",
      "s = max(abs(A), [], 2); s(s == 0 | isnan(s)) = 1;",
      "for k = 1:n",
      "  p = k; best = abs(LU(k, k)) / s(piv(k));",
      "  for i = k + 1:n",
      "    v = abs(LU(i, k)) / s(piv(i));",
      "    if v > best, best = v; p = i; end",
      "  end",
      "  if best == 0 || ~isfinite(best), singular = true; continue; end",
      "  if p ~= k",
      "    LU([p k], :) = LU([k p], :);",
      "    piv([p k]) = piv([k p]);",
      "  end",
      "  for i = k + 1:n",
      "    LU(i, k) = LU(i, k) / LU(k, k);",
      "    LU(i, k + 1:n) = LU(i, k + 1:n) - LU(i, k) * LU(k, k + 1:n);",
      "  end",
      "end",
      "end",
      "",
      "function x = lu_solve(LU, piv, b)",
      "% Пряма і зворотна підстановка (luSolve у lib/linalg.ts).",
      "n = size(LU, 1);",
      "x = b(piv);",
      "x = x(:);",
      "for i = 1:n",
      "  for j = 1:i - 1, x(i) = x(i) - LU(i, j) * x(j); end",
      "end",
      "for i = n:-1:1",
      "  for j = i + 1:n, x(i) = x(i) - LU(i, j) * x(j); end",
      "  x(i) = x(i) / LU(i, i);",
      "end",
      "end",
      "",
      "function z = newton_implicit(f, J, t1, guess, c, hb, J0)",
      "% Розв'язує z = c + hb*f(t1, z) демпфованим методом Ньютона з повним якобіаном (newtonImplicit у lib/ode.ts).",
      "% Повертає [], якщо Ньютон не збігся.",
      "I = eye(numel(c));",
      "scale = 1 + abs(c);  % відносна шкала для великих компонент, абсолютна для малих",
      "z = guess;",
      "fz = f(t1, z);",
      "r = maxjs(abs(z - c - hb * fz) ./ scale);",
      "rel_step = Inf;",
      "Jk = J0;",
      "is_J0 = true;",
      "for it = 0:79",
      "  if it > 0 && r < 1e-12 && rel_step < 1e-10, return; end",
      "  [LU, piv, singular] = lu_factor(I - hb * Jk);",
      "  if singular, z = []; return; end",
      "  dz = lu_solve(LU, piv, z - c - hb * fz);",
      "  lam = 1;",
      "  decreased = false;",
      "  for k = 1:16  % демпфування: півкроки, доки нев'язка не зменшиться",
      "    zn = z - lam * dz;",
      "    fn = f(t1, zn);",
      "    rn = maxjs(abs(zn - c - hb * fn) ./ scale);",
      "    if isfinite(rn) && (rn < r || (lam == 1 && r < 1e-12)), decreased = true; break; end",
      "    lam = lam / 2;",
      "  end",
      "  if ~decreased",
      "    if is_J0 && it == 0  % застарілий якобіан: оновлюємо один раз",
      "      Jk = J(t1, z);",
      "      continue;",
      "    end",
      "    if r >= 1e-8, z = []; end",
      "    return;",
      "  end",
      "  step = maxjs(lam * abs(dz) ./ scale);",
      "  rel_step = maxjs(lam * abs(dz) ./ (abs(zn) + 1e-200));",
      "  z = zn; fz = fn; r = rn;",
      "  if lam == 1 && step < 1e-11 && rel_step < 1e-10, return; end",
      "  Jk = J(t1, z);",
      "  is_J0 = false;",
      "end",
      "if r >= 1e-8, z = []; end",
      "end",
      "",
    );
  }
  if (anyImplicitFixed) {
    push(
      "function z = substep_guess(f, J, t, y, h, depth)",
      "% Початкове наближення для важкого неявного кроку: неявний Ейлер з рекурсивним діленням кроку.",
      "z = newton_implicit(f, J, t + h, y, y, h, J(t, y));",
      "if ~isempty(z) || depth >= 10, return; end",
      "mid = substep_guess(f, J, t, y, h / 2, depth + 1);",
      "if isempty(mid), z = []; return; end",
      "z = substep_guess(f, J, t + h / 2, mid, h / 2, depth + 1);",
      "end",
      "",
      "function z = continuation_solve(f, J, t1, c, hb)",
      "% Гомотопія за неявною вагою: від z = c (корінь при hb = 0) поступово до повного hb.",
      "z = c; s = 0; ds = 0.25; guard = 0;",
      "while s < 1 && guard < 60",
      "  guard = guard + 1;",
      "  sn = min(1, s + ds);",
      "  zn = newton_implicit(f, J, t1, z, c, hb * sn, J(t1, z));",
      "  if ~isempty(zn)",
      "    z = zn; s = sn;",
      "    rest = 1 - s; if rest == 0, rest = 1; end",
      "    ds = min(ds * 2, rest);",
      "  else",
      "    ds = ds / 2;",
      "    if ds < 1e-4, z = []; return; end",
      "  end",
      "end",
      "if s < 1, z = []; end",
      "end",
      "",
      "function z = multi_start_solve(f, J, t1, c, hb)",
      "% Кілька стартів уздовж векторного поля — корінь може лежати на іншій гілці повільного многовиду.",
      "fc = f(t1, c);",
      "z = [];",
      "for k = [1 2 4 8 16 32 64]",
      "  z0 = c + k * hb * fc;",
      "  if any(~isfinite(z0)), break; end",
      "  z = newton_implicit(f, J, t1, z0, c, hb, J(t1, z0));",
      "  if ~isempty(z), return; end",
      "end",
      "end",
      "",
    );
  }
  if (anyFixed) {
    const sel = p.methods.filter((m) => FIXED.includes(m));
    push(
      "function [ts, ys, steps, failed] = fixed_step(method, f, J, t0, T, y0, h0, theta, blowup)",
      "% Методи зі сталим кроком — ті самі формули, що й fixedStep у lib/ode.ts.",
      "N = max(1, round((T - t0) / h0));",
      "h = (T - t0) / N;",
      "th = theta;",
      "if strcmp(method, 'trap'), th = 0.5; elseif strcmp(method, 'ieuler'), th = 1; end",
      "implicit = any(strcmp(method, {'ieuler', 'theta', 'trap', 'bdf2'}));",
      "ts = zeros(1, N + 1); ys = zeros(numel(y0), N + 1);",
      "ts(1) = t0; ys(:, 1) = y0;",
      "t = t0; y = y0; y_prev = [];",
      "failed = ''; rescues = 0; steps = 0;",
      "for n = 0:N - 1",
      "  t1 = t0 + (n + 1) * h;",
      "  yn = [];",
      "  switch method",
    );
    if (sel.includes("euler")) push("    case 'euler'", "      yn = y + h * f(t, y);");
    if (sel.includes("rk2")) push("    case 'rk2'  % середня точка", "      k1 = f(t, y);", "      k2 = f(t + h / 2, y + h / 2 * k1);", "      yn = y + h * k2;");
    if (sel.includes("rk3"))
      push(
        "    case 'rk3'  % третій порядок Кутти",
        "      k1 = f(t, y);",
        "      k2 = f(t + h / 2, y + h / 2 * k1);",
        "      k3 = f(t + h, y + h * (2 * k2 - k1));",
        "      yn = y + h / 6 * (k1 + 4 * k2 + k3);",
      );
    if (sel.includes("rk4"))
      push(
        "    case 'rk4'",
        "      k1 = f(t, y);",
        "      k2 = f(t + h / 2, y + h / 2 * k1);",
        "      k3 = f(t + h / 2, y + h / 2 * k2);",
        "      k4 = f(t + h, y + h * k3);",
        "      yn = y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4);",
      );
    const fam = sel.filter((m) => m === "ieuler" || m === "theta" || m === "trap");
    if (fam.length)
      push(
        `    case {${fam.map(mStr).join(", ")}}  % y_{n+1} = y_n + h((1 - th) f_n + th f_{n+1})`,
        "      c = y + h * (1 - th) * f(t, y);",
        "      yn = newton_implicit(f, J, t1, y, c, h * th, J(t, y));",
      );
    if (sel.includes("bdf2"))
      push(
        "    case 'bdf2'  % Гір (BDF2); перший крок — неявний Ейлер",
        "      Jn = J(t, y);",
        "      if isempty(y_prev)",
        "        yn = newton_implicit(f, J, t1, y, y, h, Jn);",
        "      else",
        "        yn = newton_implicit(f, J, t1, y, 4 / 3 * y - 1 / 3 * y_prev, 2 / 3 * h, Jn);",
        "      end",
      );
    push("  end");
    if (anyImplicitFixed)
      push(
        "  if isempty(yn) && implicit",
        "    if rescues >= 25",
        "      failed = sprintf('Метод Ньютона не збігся (рівняння кроку не розв''язується вже 25 разів) при t ≈ %.4g', t);",
        "      break;",
        "    end",
        "    rescues = rescues + 1;",
        "    if strcmp(method, 'bdf2') && ~isempty(y_prev)",
        "      c = 4 / 3 * y - 1 / 3 * y_prev; hb = 2 / 3 * h;",
        "    elseif strcmp(method, 'bdf2')",
        "      c = y; hb = h;",
        "    else",
        "      c = y + h * (1 - th) * f(t, y); hb = h * th;",
        "    end",
        "    g = substep_guess(f, J, t, y, h, 0);",
        "    if ~isempty(g), yn = newton_implicit(f, J, t1, g, c, hb, J(t1, g)); end",
        "    if isempty(yn), yn = continuation_solve(f, J, t1, c, hb); end",
        "    if isempty(yn), yn = multi_start_solve(f, J, t1, c, hb); end",
        "  end",
        "  if isempty(yn)",
        "    failed = sprintf('Метод Ньютона не збігся при t ≈ %.4g', t);",
        "    break;",
        "  end",
      );
    push(
      "  y_prev = y; y = yn; t = t1;",
      "  steps = steps + 1;",
      "  ts(steps + 1) = t; ys(:, steps + 1) = y;",
      "  if is_bad(y, blowup)",
      "    failed = sprintf('Розв''язок «вибухнув» при t ≈ %.4g', t);",
      "    break;",
      "  end",
      "end",
      "ts = ts(1:steps + 1); ys = ys(:, 1:steps + 1);",
      "end",
      "",
    );
  }
  if (has("thetaA")) {
    push(
      "function [ts, ys, steps, failed] = theta_adaptive(f, J, t0, T, y0, rtol, atol, th, blowup, max_steps)",
      "% θ-метод зі змінним кроком і контролем похибки подвоєнням кроку (thetaAdaptive у lib/ode.ts).",
      "if abs(th - 0.5) < 1e-12, q = 2; else, q = 1; end  % порядок методу",
      "t = t0; y = y0;",
      "% початковий крок (initialStep у lib/ode.ts, порядок 1)",
      "f0 = f(t0, y0); sc = atol + rtol * abs(y0);",
      "d0 = maxjs(abs(y0) ./ sc); d1 = maxjs(abs(f0) ./ sc);",
      "if d0 < 1e-5 || d1 < 1e-5, h = 1e-6; else, h = 0.01 * d0 / d1; end",
      "h = max(min(h, (T - t0) / 10), 1e-12);",
      "ts = t0; ys = y0; steps = 0; rejected = 0; failed = '';",
      "while t < T && steps + rejected < max_steps",
      "  h = min(h, T - t);",
      "  f0 = f(t, y); Jn = J(t, y);",
      "  big = newton_implicit(f, J, t + h, y, y + h * (1 - th) * f0, h * th, Jn);",
      "  half = newton_implicit(f, J, t + h / 2, y, y + h / 2 * (1 - th) * f0, h / 2 * th, Jn);",
      "  two = [];",
      "  if ~isempty(half)",
      "    fh = f(t + h / 2, half);",
      "    two = newton_implicit(f, J, (t + h / 2) + h / 2, half, half + h / 2 * (1 - th) * fh, h / 2 * th, Jn);",
      "  end",
      "  if isempty(big) || isempty(two)",
      "    rejected = rejected + 1; h = h * 0.25;",
      "  else",
      "    err = (two - big) / (2 ^ q - 1);  % оцінка Річардсона",
      "    en = maxjs(abs(err) ./ (atol + rtol * max(abs(y), abs(two))));",
      "    if en <= 1",
      "      t = t + h; y = two; steps = steps + 1;",
      "      ts(end + 1) = t; ys(:, end + 1) = y; %#ok<AGROW>",
      "      if is_bad(y, blowup), failed = sprintf('Розв''язок «вибухнув» при t ≈ %.4g', t); break; end",
      "    else",
      "      rejected = rejected + 1;",
      "    end",
      "    if en == 0, fac = 4; else, fac = min(4, max(0.2, 0.9 * en ^ (-1 / (q + 1)))); end",
      "    h = h * fac;",
      "  end",
      "  if t < T && h < 1e-14 * max(1, abs(t)), failed = sprintf('Крок став надто малим при t ≈ %.4g', t); break; end",
      "end",
      "if t < T && isempty(failed), failed = sprintf('Вичерпано ліміт кроків (%d) при t ≈ %.4g', max_steps, t); end",
      "end",
      "",
    );
  }
  return L.join("\n");
}
