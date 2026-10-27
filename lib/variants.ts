/**
 * Індивідуальні варіанти лабораторної для викладача (`/teacher`) і самоперевірка студента (`/variant`).
 *
 * Код варіанта `K7M3-Q9XA-2BTC-07` однозначно відтворює варіант на будь-якому комп'ютері: 11 знаків Крокфорда
 * (base32 без I, L, O, U) несуть 55 біт — версію генератора, рівень допуску, набір шаблонів питань, набір задач і
 * 25-бітний хеш «солі» групи; останній з 12 знаків — контрольний (Luhn mod 32 по номеру і всіх знаках), далі —
 * номер варіанта. Біти «перемішано» маскою, що залежить від номера, тож коди сусідніх варіантів не схожі.
 *
 * Параметри задачі беруться з ЗАМОРОЖЕНОЇ копії діапазонів `lib/task-specs.ts` (таблиця {@link V1_PLANS}):
 * якщо діапазони на сторінках колись звузять чи розширять, варіанти з кодом версії 1 не зміняться. Нова логіка —
 * нова версія (поле версії в коді), а стара лишається в цьому файлі.
 *
 * Еталонні відповіді рахуються тут же, у браузері: власний 4-стадійний метод Розенброка 4-го порядку (ROS4, параметри
 * Шемпайна), rtol = 1e-10, і незалежна перевірка — DOPRI5 (rtol = 1e-11) для нежорстких задач або ROS4 з rtol = 1e-8
 * для жорстких; якщо вони розходяться більше ніж на 1e-6 (відносно), питання для варіанта не генерується.
 * (2-го порядку `ros` з lib/ode.ts при rtol = 1e-10 має відносну похибку до ~1e-6 і вдвічі повільніший — тому ROS4.)
 *
 * Шаблони питань: «а» — y_i(T) точного розв'язку (допуск 1e-2…1e-5); «б» — y_i(T) заданим методом зі сталим кроком
 * (1e-6; крок добирається так, щоб метод не «вибухав» і відрізнявся від точного на 0.2–80 %, а відповідь не залежала від
 * варіанта Ньютона й порядку арифметичних дій); «в» — межа стійкості явного Ейлера в (t0, y0) (1e-3); «г» — коефіцієнт
 * жорсткості в (t0, y0) (1e-2); «ґ» — максимум/мінімум компоненти, період граничного циклу або момент «відродження» №25.
 * Важкі обчислення — генератори, що поступаються браузеру кожні ~12 мс ({@link computeVariants}).
 *
 * @module variants
 */
import { nameToTex, numberToTex } from "./expr";
import { eigenvalues, luFactor, luSolve, type Complex, type Mat, type Vec } from "./linalg";
import { METHODS } from "./methods";
import { solve, type MethodId, type Problem } from "./ode";
import { compileSpec, resolveValues, timeName, type ProblemSpec, type ResolvedValues } from "./problem-spec";
import { specById } from "./task-specs";

// =====================================================================================================================
// 1. Seeded PRNG and hashing (no Math.random anywhere in this module)
// =====================================================================================================================

/** 32-бітний FNV-1a по кодових одиницях UTF-16. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** xmur3: рядок → генератор 32-бітних зерен. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32: 32-бітне зерно → рівномірні числа з [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Детермінований генератор: однаковий рядок-зерно → однакова послідовність на будь-якому комп'ютері. */
export class Rng {
  private readonly r: () => number;
  constructor(seed: string) {
    this.r = mulberry32(xmur3(seed)());
  }
  next(): number {
    return this.r();
  }
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.r();
  }
  /** ціле з 0 … n − 1 */
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.r() * n));
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)];
  }
  shuffle<T>(a: readonly T[]): T[] {
    const out = a.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

// =====================================================================================================================
// 2. Configuration and the variant code
// =====================================================================================================================

/** Поточна версія генератора (записується в код варіанта). */
export const GENERATOR_VERSION = 1;

/** Шаблони питань: а — точне значення, б — заданий метод, в — межа стійкості, г — жорсткість, ґ — задачне питання. */
export type TemplateId = "a" | "b" | "c" | "d" | "e";
export const TEMPLATE_IDS: readonly TemplateId[] = ["a", "b", "c", "d", "e"];

export interface TemplateMeta {
  id: TemplateId;
  /** українська літера шаблону */
  letter: string;
  title: string;
  about: string;
  /** відносний допуск (для «а» і «ґ» — з рівня допуску варіанта) */
  tol?: number;
}

export const TEMPLATES: Record<TemplateId, TemplateMeta> = {
  a: { id: "a", letter: "а", title: "Точне значення y(T)", about: "компонента точного розв'язку в момент T; студент рахує будь-яким методом із заданою точністю" },
  b: { id: "b", letter: "б", title: "Заданий метод, сталий крок", about: "y(T), отримане конкретним методом зі сталим кроком h: відтворення алгоритму", tol: 1e-6 },
  c: { id: "c", letter: "в", title: "Межа стійкості явного Ейлера", about: "h* = max{h : |1 + hλₖ| ≤ 1} за власними числами якобіана в початковій точці", tol: 1e-3 },
  d: { id: "d", letter: "г", title: "Коефіцієнт жорсткості", about: "max|Re λ| / min|Re λ| за власними числами з Re λ < 0 у початковій точці", tol: 1e-2 },
  e: { id: "e", letter: "ґ", title: "Задачне питання", about: "природна величина задачі: максимум компоненти, період циклу, момент «відродження»" },
};

/** Рівні відносного допуску для питань «а» і «ґ» (індекс — 2 біти коду). */
export const TOL_LEVELS: readonly number[] = [1e-3, 1e-2, 1e-4, 1e-5];

/** Порядок задач у масці коду версії 1 (заморожено: нові задачі — лише в нових версіях). */
export const V1_TASK_ORDER: readonly string[] = ["1", "2", "3", "4", "5", "11", "12", "13", "14", "16", "18", "19", "20", "21", "22", "23", "24", "25", "lorenz"];

/** Найбільший номер варіанта, який уміщує код. */
export const MAX_VARIANT = 99;

/** Набір варіантів однієї групи (усе, крім номера). */
export interface VariantSet {
  version: number;
  /** 25-бітний хеш «солі» групи */
  salt: number;
  /** id задач у порядку {@link V1_TASK_ORDER} */
  tasks: string[];
  /** шаблони питань у порядку {@link TEMPLATE_IDS} */
  templates: TemplateId[];
  /** індекс у {@link TOL_LEVELS} */
  tolLevel: number;
}

export interface VariantConfig extends VariantSet {
  /** номер варіанта 1 … 99 */
  n: number;
}

/** Нормалізована «сіль»: без зайвих пробілів, без регістру, однакові апострофи. */
export function normalizeSalt(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[’ʼ`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 25-бітний хеш «солі» групи (той самий для «КН-31 весна 2027» і «кн-31  Весна 2027»). */
export function saltHash(salt: string): number {
  return fnv1a32(`lab-salt|${normalizeSalt(salt)}`) >>> 7;
}

/** Канонічний набір (задачі й шаблони в порядку версії, без повторів і невідомих). */
export function makeSet(input: { salt: string | number; tasks: readonly string[]; templates: readonly TemplateId[]; tolLevel?: number }): VariantSet {
  return {
    version: GENERATOR_VERSION,
    salt: typeof input.salt === "number" ? input.salt >>> 0 : saltHash(input.salt),
    tasks: V1_TASK_ORDER.filter((t) => input.tasks.includes(t)),
    templates: TEMPLATE_IDS.filter((t) => input.templates.includes(t)),
    tolLevel: input.tolLevel ?? 0,
  };
}

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAYLOAD_CHARS = 11;
const PAYLOAD_BITS = PAYLOAD_CHARS * 5; // 55 = 4 + 2 + 5 + 19 + 25

function pushBits(out: number[], value: number, width: number) {
  for (let b = width - 1; b >= 0; b--) out.push(Math.floor(value / 2 ** b) % 2);
}
function readBits(bits: number[], from: number, width: number): number {
  let v = 0;
  for (let i = 0; i < width; i++) v = v * 2 + bits[from + i];
  return v;
}
/** маска, що «перемішує» біти коду залежно від номера варіанта */
function maskBits(n: number): number[] {
  const r = new Rng(`lab-code-mask|${n}`);
  return Array.from({ length: PAYLOAD_BITS }, () => r.int(2));
}

/** Luhn mod 32: контрольне значення для послідовності значень 0…31 (перевіряється разом з ним як останнім). */
function luhnCheck(values: number[]): number {
  let factor = 2;
  let sum = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    let addend = factor * values[i];
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return (32 - (sum % 32)) % 32;
}
function luhnValid(values: number[]): boolean {
  let factor = 1;
  let sum = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    let addend = factor * values[i];
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return sum % 32 === 0;
}
/** номер варіанта як дві цифри (07): «0» → «1» у номері — теж одинична заміна, яку ловить контроль */
const digitsOf = (n: number) => String(n).padStart(2, "0").split("").map(Number);

/** Код варіанта: `XXXX-XXXX-XXXC-NN`. */
export function encodeVariantCode(cfg: VariantConfig): string {
  if (cfg.version !== 1) throw new Error(`Невідома версія генератора ${cfg.version}`);
  if (!(Number.isInteger(cfg.n) && cfg.n >= 1 && cfg.n <= MAX_VARIANT)) throw new Error(`Номер варіанта має бути від 1 до ${MAX_VARIANT}`);
  const bits: number[] = [];
  pushBits(bits, cfg.version, 4);
  pushBits(bits, cfg.tolLevel, 2);
  for (const t of TEMPLATE_IDS) bits.push(cfg.templates.includes(t) ? 1 : 0);
  for (const t of V1_TASK_ORDER) bits.push(cfg.tasks.includes(t) ? 1 : 0);
  pushBits(bits, cfg.salt % 2 ** 25, 25);
  const mask = maskBits(cfg.n);
  const sym: number[] = [];
  for (let c = 0; c < PAYLOAD_CHARS; c++) sym.push(readBits(bits.map((b, i) => b ^ mask[i]), c * 5, 5));
  // Luhn over [номер, 11 знаків]: контрольний знак стоїть одразу після знаків, як і в записаному коді
  const check = luhnCheck([...digitsOf(cfg.n), ...sym]);
  const chars = [...sym, check].map((v) => ALPHABET[v]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${String(cfg.n).padStart(2, "0")}`;
}

/** Кирилиця, схожа на латиницю, і знаки, які легко сплутати: О → 0, I/L → 1, З → 3, Б → 6. */
const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "0", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", І: "1", Ї: "1", З: "3", Б: "6",
  O: "0", I: "1", L: "1",
};

/** Приводить введений рядок до знаків коду (верхній регістр, без пробілів і дефісів, схожі знаки замінено). */
export function normalizeCodeInput(s: string): string {
  return Array.from(s.toUpperCase())
    .map((c) => HOMOGLYPHS[c] ?? c)
    .join("")
    .replace(/[\s\-‐‑‒–—_.·/]+/g, "");
}

export type DecodeResult =
  | { ok: true; cfg: VariantConfig; code: string }
  | { ok: false; kind: "empty" | "format" | "check" | "version" | "content"; error: string };

/** Розбирає код варіанта (з описками регістру, без дефісів, з кириличними двійниками літер). */
export function decodeVariantCode(input: string): DecodeResult {
  const s = normalizeCodeInput(input ?? "");
  if (!s) return { ok: false, kind: "empty", error: "Введіть код варіанта — його дає викладач (вигляд XXXX-XXXX-XXXX-NN)." };
  const shape = "Код має вигляд XXXX-XXXX-XXXX-NN: 12 знаків (цифри й латинські літери) і номер варіанта.";
  if (s.length < 13 || s.length > 14) return { ok: false, kind: "format", error: `${shape} Зараз знаків: ${s.length}.` };
  const head = s.slice(0, 12);
  const tail = s.slice(12);
  const bad = Array.from(head).find((c) => !ALPHABET.includes(c));
  if (bad) return { ok: false, kind: "format", error: `Знак «${bad}» не може бути в коді (у кодах немає літер U, а O, I, L читаються як 0 і 1). ${shape}` };
  if (!/^\d{1,2}$/.test(tail)) return { ok: false, kind: "format", error: `Наприкінці коду має стояти номер варіанта (1–2 цифри). ${shape}` };
  const n = Number(tail);
  if (n < 1 || n > MAX_VARIANT) return { ok: false, kind: "format", error: `Номер варіанта має бути від 1 до ${MAX_VARIANT}.` };
  const vals = Array.from(head).map((c) => ALPHABET.indexOf(c));
  if (!luhnValid([...digitsOf(n), ...vals]))
    return {
      ok: false,
      kind: "check",
      error: "Схоже, в коді описка: контрольний знак не збігається. Звірте кожен знак і номер варіанта з аркушем (0 і O, 1 та I тут однакові).",
    };
  const mask = maskBits(n);
  const bits: number[] = [];
  for (let c = 0; c < PAYLOAD_CHARS; c++) pushBits(bits, vals[c], 5);
  const plain = bits.map((b, i) => b ^ mask[i]);
  const version = readBits(plain, 0, 4);
  if (version === 0 || version > GENERATOR_VERSION)
    return {
      ok: false,
      kind: "version",
      error:
        version > GENERATOR_VERSION
          ? `Цей код створено новішою версією генератора (v${version}). Оновіть сторінку (Ctrl+F5) — можливо, сайт уже оновився.`
          : "Код пошкоджений: невідома версія генератора.",
    };
  const tolLevel = readBits(plain, 4, 2);
  const templates = TEMPLATE_IDS.filter((_, i) => plain[6 + i] === 1);
  const tasks = V1_TASK_ORDER.filter((_, i) => plain[11 + i] === 1);
  const salt = readBits(plain, 30, 25);
  if (!templates.length || !tasks.length) return { ok: false, kind: "content", error: "Код пошкоджений: у ньому немає жодної задачі чи жодного питання." };
  const cfg: VariantConfig = { version, salt, tasks, templates, tolLevel, n };
  return { ok: true, cfg, code: encodeVariantCode(cfg) };
}

/** Конфігурації варіантів 1 … count однієї групи. */
export function variantConfigs(set: VariantSet, count: number): VariantConfig[] {
  const k = Math.max(1, Math.min(MAX_VARIANT, Math.floor(count)));
  return Array.from({ length: k }, (_, i) => ({ ...set, n: i + 1 }));
}

// =====================================================================================================================
// 3. «Human» numbers
// =====================================================================================================================

const roundSig = (x: number, s: number) => (x === 0 ? 0 : Number(x.toPrecision(s)));
function floorSig(x: number, s: number): number {
  if (x === 0) return 0;
  const e = Math.floor(Math.log10(Math.abs(x))) - s + 1;
  const q = 10 ** e;
  return Number((Math.floor(x / q) * q).toPrecision(s));
}

/**
 * Випадкове «людське» значення з [lo, hi]: лог-рівномірно → 2 значущі цифри (3 для вузьких діапазонів),
 * рівномірно → крок 10^⌊lg((hi − lo)/20)⌋ (≈ 20+ різних значень), ціле → ціле.
 */
export function sampleNice(rng: Rng, lo: number, hi: number, o: { log?: boolean; integer?: boolean } = {}): number {
  if (!(hi > lo)) return lo;
  let v: number;
  if (o.integer) v = Math.floor(rng.uniform(Math.ceil(lo), Math.floor(hi) + 1));
  else if (o.log && lo > 0) {
    v = roundSig(Math.exp(rng.uniform(Math.log(lo), Math.log(hi))), hi / lo < 4 ? 3 : 2);
  } else {
    const step = 10 ** Math.floor(Math.log10((hi - lo) / 20));
    const dec = Math.max(0, -Math.round(Math.log10(step)));
    v = Number((Math.round(rng.uniform(lo, hi) / step) * step).toFixed(dec));
    if (Object.is(v, -0)) v = 0;
  }
  if (v < lo) v = lo;
  if (v > hi) v = hi < 0 ? -floorSig(-hi, 3) : floorSig(hi, 3) <= hi ? floorSig(hi, 3) : hi;
  return v;
}

// =====================================================================================================================
// 4. Frozen plans of generator version 1
// =====================================================================================================================

interface ParamPlan {
  name: string;
  range: [number, number];
  log?: boolean;
  integer?: boolean;
}

type ExtraPlan =
  | { kind: "max" | "min"; comp: number }
  /** період усталених коливань: перетини рівня (середини розмаху) компоненти `comp` знизу вгору */
  | { kind: "period"; comp: number; tMax: (v: ResolvedValues) => number }
  /** №25: перший момент після провалу u < 10⁻³, коли u знову дорівнює 1 */
  | { kind: "revival" };

interface TaskPlan {
  taskId: string;
  /** специфікація з lib/task-specs.ts, яку бачить студент */
  specId: string;
  /** заморожена копія діапазонів параметрів (v1) */
  params: ParamPlan[];
  /** діапазони початкових умов (null — як у специфікації) */
  y0?: [number, number][];
  /** діапазон T (підмножина TRange специфікації); cap — верхня межа, що залежить від параметрів */
  T: { range: [number, number]; log?: boolean; cap?: (p: Record<string, number>) => number };
  /** методи для питання «б» */
  methods: MethodId[];
  extra?: ExtraPlan;
  /** еталон рахувати в рівносильних змінних (№25: w = ln u, z = ln v — точність крихітних популяцій) */
  ref?: { specId: string; to: (y: Vec) => Vec; from: (y: Vec) => Vec };
  /** найменше |y_i(T)| відносно max|y_i| для питань «а»/«б» (типово 10⁻⁶) */
  minRel?: number;
  /** найбільше N для неявних методів у «б» (типово 5000) */
  implicitCap?: number;
  /**
   * момент для питання «а», якщо в T розв'язок уже «встановився» на рівновазі, яку легко вгадати
   * (№18 — рівновага (A, B/A); №25 — після «відродження»); округлюється до 2 значущих цифр
   */
  aAt?: (v: ResolvedValues) => number;
}

const FIXED_METHODS: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];
const K_PARAMS: ParamPlan[] = [
  { name: "k1", range: [0.02, 0.08], log: true },
  { name: "k2", range: [5e3, 2e4], log: true },
  { name: "k3", range: [1e7, 1e8], log: true },
];

/** Оцінка періоду Ван дер Поля u″ − μ(1 − u²)u′ + ω²u = 0 (як на сторінці №14). */
const vdpPeriodGuess = (mu: number, w: number) => {
  const m = mu / w;
  const airy = 3 * 2.33811 * Math.pow(m, -1 / 3) * ((m * m) / (m * m + 60));
  return (Math.hypot(2 * Math.PI, (3 - 2 * Math.log(2)) * m) + airy) / w;
};

/**
 * Плани версії 1. Діапазони параметрів і початкових умов — копія `range`/`y0Range` з `lib/task-specs.ts` на момент
 * створення версії; T — підмножина `TRange`, звужена там, де інакше питання «а» втрачає сенс (розв'язок згас нижче
 * 10⁻⁶ від свого максимуму, вийшов на рівновагу, яку можна вгадати, хаос «з'їдає» точність еталона, або еталон надто
 * дорогий для браузера).
 */
export const V1_PLANS: Record<string, TaskPlan> = {
  "1": { taskId: "1", specId: "t1", params: [], y0: [[-1, 2], [-1, 2]], T: { range: [1, 3] }, methods: FIXED_METHODS },
  "2": {
    taskId: "2",
    specId: "t2",
    params: [
      { name: "d", range: [-2, -0.1] },
      { name: "ε", range: [0.001, 0.05], log: true },
    ],
    y0: [[0.5, 2], [0.5, 2]],
    T: { range: [5, 20], cap: (p) => 12 / Math.abs(p.d) },
    methods: FIXED_METHODS,
  },
  "3": { taskId: "3", specId: "t3", params: [], y0: [[-2, 2], [-2, 2]], T: { range: [0.1, 10] }, methods: FIXED_METHODS },
  "4": {
    taskId: "4",
    specId: "t4",
    params: [{ name: "λ", range: [-20, -1] }],
    y0: [[0.5, 2]],
    T: { range: [1, 10], cap: (p) => 12 / Math.abs(p.λ) },
    methods: FIXED_METHODS,
    // u(T) = u₀e^{λT} is known in closed form, so a value down to 10⁻⁹ of u₀ is still a fair question
    minRel: 1e-9,
  },
  "5": { taskId: "5", specId: "t5", params: [{ name: "c", range: [8.2, 8.8] }], T: { range: [20, 60] }, methods: FIXED_METHODS, extra: { kind: "max", comp: 2 } },
  "11": {
    taskId: "11",
    specId: "t11",
    params: [
      { name: "a", range: [4, 10] },
      { name: "ε", range: [0.02, 0.1], log: true },
      { name: "x0", range: [0.5, 1.1] },
    ],
    T: { range: [5, 60] },
    methods: FIXED_METHODS,
    extra: { kind: "period", comp: 0, tMax: () => 75 },
  },
  "12": { taskId: "12", specId: "t12", params: K_PARAMS, y0: [[0.5, 2], [0, 0], [0, 0]], T: { range: [0.5, 40] }, methods: FIXED_METHODS, extra: { kind: "max", comp: 1 } },
  "13": { taskId: "13", specId: "t13-rob", params: K_PARAMS, T: { range: [40, 1e11], log: true }, methods: ["theta", "ieuler", "trap", "bdf2"] },
  "14": {
    taskId: "14",
    specId: "t14",
    params: [
      { name: "μ", range: [0.5, 10], log: true },
      { name: "ω", range: [0.4, 1] },
    ],
    T: { range: [10, 40] },
    methods: FIXED_METHODS,
    extra: { kind: "period", comp: 0, tMax: (v) => 14 * vdpPeriodGuess(v.params.μ, v.params.ω) },
  },
  "16": { taskId: "16", specId: "t16", params: [], T: { range: [20, 100] }, methods: FIXED_METHODS, extra: { kind: "max", comp: 0 } },
  "18": {
    taskId: "18",
    specId: "t18",
    params: [
      { name: "A", range: [30, 60] },
      { name: "B", range: [10, 150] },
    ],
    y0: [[10, 100], [10, 150]],
    T: { range: [5, 8] },
    methods: FIXED_METHODS,
    aAt: (v) => v.T / 4,
  },
  "19": {
    taskId: "19",
    specId: "t19",
    params: [
      { name: "m", range: [0.005, 0.05], log: true },
      { name: "c", range: [0.05, 0.5] },
      { name: "k", range: [1, 5] },
      { name: "d", range: [1, 5] },
    ],
    y0: [[5, 15], [0, 0]],
    T: { range: [1, 10], cap: (p) => (20 * p.m) / p.c },
    methods: FIXED_METHODS,
    extra: { kind: "min", comp: 0 },
  },
  "20": {
    taskId: "20",
    specId: "t20",
    params: [
      { name: "I", range: [0.45, 1.3] },
      { name: "ε", range: [0.06, 0.1] },
    ],
    y0: [[-2, 2], [-1, 2]],
    T: { range: [20, 100] },
    methods: FIXED_METHODS,
    extra: { kind: "period", comp: 0, tMax: () => 600 },
  },
  "21": {
    taskId: "21",
    specId: "t21",
    params: [
      { name: "m", range: [0.5, 5], log: true },
      { name: "c", range: [2, 30], log: true },
      { name: "k", range: [500, 5000], log: true },
    ],
    y0: [[0.05, 1], [0, 0]],
    T: { range: [0.5, 10], cap: (p) => (20 * p.m) / p.c },
    methods: FIXED_METHODS,
    extra: { kind: "min", comp: 0 },
  },
  "22": {
    taskId: "22",
    specId: "t22",
    params: [
      { name: "R", range: [8e4, 1.25e5], log: true },
      { name: "E", range: [1, 50] },
      { name: "ω", range: [0.5, 2] },
    ],
    y0: [[-10, 10], [-1, 1]],
    T: { range: [5, 40] },
    methods: FIXED_METHODS,
    extra: { kind: "max", comp: 0 },
  },
  "23": {
    taskId: "23",
    specId: "t23",
    params: [
      { name: "ε", range: [0.01, 0.1], log: true },
      { name: "b", range: [0.5, 3] },
      { name: "c", range: [0, 1] },
    ],
    y0: [[0.5, 2], [0, 2 * Math.PI]],
    T: { range: [2, 40], cap: (p) => 400 * p.ε },
    methods: FIXED_METHODS,
  },
  "24": {
    taskId: "24",
    specId: "t24",
    params: [
      { name: "s", range: [70, 85] },
      { name: "q", range: [5e-6, 1.2e-5], log: true },
      { name: "w", range: [0.14, 0.18] },
    ],
    T: { range: [100, 200] },
    methods: FIXED_METHODS,
    extra: { kind: "max", comp: 0 },
    // plain Newton from y_n fails on the first steps for h ≥ 0.02 (the page shows the same): smaller steps are needed
    implicitCap: 20000,
  },
  "25": {
    taskId: "25",
    specId: "t25",
    params: [{ name: "ε", range: [0.005, 0.05], log: true }],
    y0: [[0.5, 4], [1, 20], [0.05, 0.5]],
    T: { range: [50, 300] },
    methods: ["bdf2", "ieuler", "theta", "trap"],
    extra: { kind: "revival" },
    aAt: (v) => v.T / 5,
    ref: { specId: "t25-log", to: (y) => [Math.log(y[0]), Math.log(y[1]), y[2]], from: (y) => [Math.exp(y[0]), Math.exp(y[1]), y[2]] },
  },
  lorenz: {
    taskId: "lorenz",
    specId: "lorenz",
    params: [
      { name: "σ", range: [9, 11] },
      { name: "r", range: [27, 32] },
      { name: "b", range: [2.4, 2.9] },
    ],
    T: { range: [5, 8] },
    methods: ["euler", "rk2", "rk3", "rk4"],
    extra: { kind: "max", comp: 2 },
  },
};

/** Задачі, доступні генератору версії 1 (у порядку коду). */
export const VARIANT_TASKS: readonly string[] = V1_TASK_ORDER.filter((t) => V1_PLANS[t]);

/** Варіант однієї задачі: специфікація і значення (параметри, y₀, T). */
export interface TaskVariant {
  taskId: string;
  spec: ProblemSpec;
  values: ResolvedValues;
}

const taskSeed = (cfg: VariantConfig, taskId: string) => `lab|v${cfg.version}|${cfg.salt}|${cfg.n}|${taskId}`;

/** Параметри варіанта для задачі (дешево, без інтегрування). */
export function taskVariant(cfg: VariantConfig, taskId: string): TaskVariant {
  const plan = V1_PLANS[taskId];
  if (!plan) throw new Error(`Задача ${taskId} не підтримується генератором`);
  const spec = specById(plan.specId);
  if (!spec) throw new Error(`Немає специфікації ${plan.specId}`);
  const rng = new Rng(taskSeed(cfg, taskId));
  const params: Record<string, number> = {};
  for (const p of plan.params) params[p.name] = sampleNice(rng, p.range[0], p.range[1], p);
  const y0 = plan.y0?.map((r) => sampleNice(rng, r[0], r[1]));
  const full = resolveValues(spec, { params });
  const hiCap = plan.T.cap ? Math.min(plan.T.range[1], Math.max(plan.T.range[0], plan.T.cap(full.params))) : plan.T.range[1];
  const T = sampleNice(rng, plan.T.range[0], hiCap, { log: plan.T.log });
  return { taskId, spec, values: resolveValues(spec, { params, y0, T }) };
}

// =====================================================================================================================
// 5. Reference solutions
// =====================================================================================================================

/**
 * Кооперативне виконання: важкі цикли — генератори, що «поступаються» (yield), коли вичерпано квант часу.
 * Синхронно (`runSync`, node-скрипти) квант нескінченний; `computeVariants` віддає керування браузеру між квантами.
 */
export type Work<T> = Generator<void, T, unknown>;
/** тривалість одного кванта обчислень у браузері, мс */
const SLICE_MS = 12;
let sliceDeadline = Infinity;
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const shouldYield = () => sliceDeadline !== Infinity && nowMs() > sliceDeadline;

/** Виконати генератор до кінця без пауз. */
export function runSync<T>(w: Work<T>): T {
  const saved = sliceDeadline;
  sliceDeadline = Infinity;
  try {
    let r = w.next();
    while (!r.done) r = w.next();
    return r.value;
  } finally {
    sliceDeadline = saved;
  }
}

interface Traj {
  t: number[];
  y: Vec[];
  ok: boolean;
  steps: number;
}

// Shampine's ROS4 parameter set (Kaps–Rentrop form; Numerical Recipes «stiff»): order 4 with an embedded order-3
// error estimate, 3 function evaluations and 1 LU factorization per step. Checked: global error ratio 16 per step halving.
const GAM = 1 / 2,
  A21 = 2,
  A31 = 48 / 25,
  A32 = 6 / 25,
  C21 = -8,
  C31 = 372 / 25,
  C32 = 12 / 5,
  C41 = -112 / 125,
  C42 = -54 / 125,
  C43 = -2 / 5,
  B1 = 19 / 9,
  B2 = 1 / 2,
  B3 = 25 / 108,
  B4 = 125 / 108,
  E1 = 17 / 54,
  E2 = 7 / 36,
  E4 = 125 / 108,
  C1X = 1 / 2,
  C2X = -3 / 2,
  C3X = 121 / 50,
  C4X = 29 / 250,
  A2X = 1,
  A3X = 3 / 5;

/**
 * Адаптивний метод Розенброка 4-го порядку (ROS4) з аналітичним якобіаном. Зберігає всі вузли.
 * `stop(t, y)` — дострокова зупинка після прийнятого кроку.
 */
export function ros4(p: Problem, rtol: number, o: Ros4Options = {}): Traj {
  return runSync(ros4G(p, rtol, o));
}
type Ros4Options = { atol?: number; maxSteps?: number; stop?: (t: number, y: Vec) => boolean };

/** {@link ros4} як генератор, що поступається кожні {@link SLICE_MS} мс. */
export function* ros4G(p: Problem, rtol: number, o: Ros4Options = {}): Work<Traj> {
  const n = p.y0.length;
  const f = p.f;
  const jac = p.jac!;
  const t0 = p.t0 ?? 0;
  const T = p.T;
  const atol = o.atol ?? rtol * 1e-12 * Math.max(1, ...p.y0.map(Math.abs));
  const maxSteps = o.maxSteps ?? 400000;
  let t = t0;
  let y = p.y0.slice();
  let fy = f(t, y);
  const tr: Traj = { t: [t], y: [y], ok: false, steps: 0 };
  // initial step from the scale of f
  let d0 = 0,
    d1 = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.abs(y[i]);
    d0 = Math.max(d0, Math.abs(y[i]) / sc);
    d1 = Math.max(d1, Math.abs(fy[i]) / sc);
  }
  let h = Math.min((T - t0) / 100, d0 < 1e-5 || d1 < 1e-5 ? 1e-6 * (T - t0) : (0.01 * d0) / d1);
  h = Math.max(h, 1e-14 * Math.max(1, Math.abs(t0)));
  let tries = 0;
  const g1 = new Array<number>(n),
    g2 = new Array<number>(n),
    rhs = new Array<number>(n);
  while (t < T && tries++ < maxSteps) {
    if ((tries & 31) === 0 && shouldYield()) yield;
    if (t + h > T) h = T - t;
    const J = jac(t, y);
    const dt = 1.4901161193847656e-8 * Math.max(Math.abs(t), 1e-3);
    const ft = f(t + dt, y);
    const A: Mat = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n);
      for (let j = 0; j < n; j++) row[j] = (i === j ? 1 / (GAM * h) : 0) - J[i][j];
      A.push(row);
    }
    const lu = luFactor(A);
    if (lu.singular) {
      h *= 0.25;
      continue;
    }
    const dfdt = new Array<number>(n);
    for (let i = 0; i < n; i++) dfdt[i] = (ft[i] - fy[i]) / dt;
    for (let i = 0; i < n; i++) rhs[i] = fy[i] + h * C1X * dfdt[i];
    const k1 = luSolve(lu, rhs);
    for (let i = 0; i < n; i++) g1[i] = y[i] + A21 * k1[i];
    let d = f(t + A2X * h, g1);
    for (let i = 0; i < n; i++) rhs[i] = d[i] + h * C2X * dfdt[i] + (C21 * k1[i]) / h;
    const k2 = luSolve(lu, rhs);
    for (let i = 0; i < n; i++) g2[i] = y[i] + A31 * k1[i] + A32 * k2[i];
    d = f(t + A3X * h, g2);
    for (let i = 0; i < n; i++) rhs[i] = d[i] + h * C3X * dfdt[i] + (C31 * k1[i] + C32 * k2[i]) / h;
    const k3 = luSolve(lu, rhs);
    for (let i = 0; i < n; i++) rhs[i] = d[i] + h * C4X * dfdt[i] + (C41 * k1[i] + C42 * k2[i] + C43 * k3[i]) / h;
    const k4 = luSolve(lu, rhs);
    const yn = new Array<number>(n);
    let en = 0;
    for (let i = 0; i < n; i++) {
      yn[i] = y[i] + B1 * k1[i] + B2 * k2[i] + B3 * k3[i] + B4 * k4[i];
      const e = E1 * k1[i] + E2 * k2[i] + E4 * k4[i];
      en = Math.max(en, Math.abs(e) / (atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i]))));
    }
    if (en <= 1 && Number.isFinite(en)) {
      t = t + h >= T ? T : t + h;
      y = yn;
      fy = f(t, y);
      tr.t.push(t);
      tr.y.push(y);
      tr.steps++;
      if (o.stop && o.stop(t, y)) {
        tr.ok = true;
        return tr;
      }
    }
    h *= !Number.isFinite(en) ? 0.2 : en === 0 ? 4 : Math.min(4, Math.max(0.2, 0.9 * Math.pow(en, -0.25)));
    if (t < T && h < 1e-14 * Math.max(1, Math.abs(t))) break;
  }
  tr.ok = t >= T || (o.stop !== undefined && tr.ok);
  return tr;
}

type RefKind = "ros4" | "dopri";

/** Траєкторія еталонним методом: ROS4 або DOPRI5 (lib/ode). */
function refRun(kind: RefKind, p: Problem, rtol: number): Traj {
  return runSync(refRunG(kind, p, rtol));
}
function* refRunG(kind: RefKind, p: Problem, rtol: number, stop?: (t: number, y: Vec) => boolean): Work<Traj> {
  if (kind === "ros4") return yield* ros4G(p, rtol, { stop });
  const atol = rtol * 1e-12 * Math.max(1, ...p.y0.map(Math.abs));
  const s = solve("dopri", p, { rtol, atol, maxSteps: 400000, blowup: 1e150 });
  return { t: s.t, y: s.y, ok: !s.failed, steps: s.steps };
}

/** y(τ) точно: інтегрування від вузла (t_k, y_k) до τ тим самим методом із жорсткішим допуском. */
function advance(kind: RefKind, p: Problem, tk: number, yk: Vec, tau: number, rtol: number): Vec {
  if (tau <= tk) return yk.slice();
  const q: Problem = { f: p.f, jac: p.jac, t0: tk, y0: yk, T: tau };
  const r = refRun(kind, q, rtol);
  return r.y[r.y.length - 1];
}

/** Індекс вузла k: t_k ≤ τ < t_{k+1}. */
function nodeBefore(ts: number[], tau: number): number {
  let lo = 0,
    hi = ts.length - 1;
  if (tau <= ts[0]) return 0;
  if (tau >= ts[hi]) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= tau) lo = m;
    else hi = m;
  }
  return lo;
}

/** Корінь неперервної g на [a, b] (a < b, g(a)·g(b) < 0): метод хорд з модифікацією Іллінойс. */
function findRoot(g: (x: number) => number, a: number, b: number, ga: number, gb: number, xtol: number): number {
  let side = 0;
  let prev = NaN;
  for (let it = 0; it < 100; it++) {
    let x = (a * gb - b * ga) / (gb - ga);
    if (!(x > a && x < b)) x = 0.5 * (a + b);
    const gx = g(x);
    if (gx === 0 || Math.abs(x - prev) < xtol) return x;
    prev = x;
    if (gx > 0 === ga > 0) {
      a = x;
      ga = gx;
      if (side === -1) gb /= 2;
      side = -1;
    } else {
      b = x;
      gb = gx;
      if (side === 1) ga /= 2;
      side = 1;
    }
    if (b - a < xtol) return 0.5 * (a + b);
  }
  return 0.5 * (a + b);
}

/** Еталон варіанта задачі на [t0, T] (у змінних студента; для №25 рахується через логарифми). */
interface RefPair {
  r1: Traj;
  r2: Traj;
  kind2: RefKind;
  /** задача в змінних еталона і перетворення назад */
  pref: Problem;
  from: (y: Vec) => Vec;
}

const R1_RTOL = 1e-10;
const R2_RTOL_DOPRI = 1e-11;
const R2_RTOL_ROS4 = 1e-8;
/** найбільше відносне розходження двох еталонів, при якому питання ще генерується */
export const REF_AGREEMENT = 1e-6;

// =====================================================================================================================
// 6. Fixed-step methods as a student writes them (for question «б»)
// =====================================================================================================================

/** Ньютон для z = c + hb·f(t1, z) з початкового наближення guess; null — не збігся. */
function newtonStep(p: Problem, t1: number, guess: Vec, c: Vec, hb: number): Vec | null {
  const n = guess.length;
  const z = guess.slice();
  let prev = Infinity;
  for (let it = 0; it < 60; it++) {
    const fz = p.f(t1, z);
    const J = p.jac!(t1, z);
    const G = new Array<number>(n);
    const A: Mat = [];
    for (let i = 0; i < n; i++) {
      G[i] = z[i] - c[i] - hb * fz[i];
      const row = new Array<number>(n);
      for (let j = 0; j < n; j++) row[j] = (i === j ? 1 : 0) - hb * J[i][j];
      A.push(row);
    }
    const lu = luFactor(A);
    if (lu.singular) return null;
    const dz = luSolve(lu, G);
    let rel = 0;
    let zmax = 0;
    for (let i = 0; i < n; i++) zmax = Math.max(zmax, Math.abs(z[i]));
    for (let i = 0; i < n; i++) {
      z[i] -= dz[i];
      if (!Number.isFinite(z[i])) return null;
      rel = Math.max(rel, Math.abs(dz[i]) / (Math.abs(z[i]) + 1e-30 * (1 + zmax)));
    }
    if (rel <= 1e-13) return z;
    // stagnation at round-off level
    if (it >= 3 && rel <= 1e-10 && rel >= 0.5 * prev) return z;
    prev = rel;
  }
  return null;
}

/** Гаус зі звичайним (немасштабованим) вибором головного елемента — як numpy.linalg.solve / LAPACK. */
function gaussPartial(A: Mat, b: Vec): Vec | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let q = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[q][c])) q = r;
    if (M[q][c] === 0 || !Number.isFinite(M[q][c])) return null;
    [M[c], M[q]] = [M[q], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let acc = M[r][n];
    for (let k = r + 1; k < n; k++) acc -= M[r][k] * x[k];
    x[r] = acc / M[r][r];
  }
  return x;
}

/**
 * Те саме рівняння кроку «як у студента з numpy»: якобіан — центральні різниці, лінійна система — Гаус зі звичайним
 * вибором головного елемента (без масштабування рядків).
 */
function newtonStepFD(p: Problem, t1: number, guess: Vec, c: Vec, hb: number): Vec | null {
  const n = guess.length;
  const z = guess.slice();
  let prev = Infinity;
  for (let it = 0; it < 100; it++) {
    const fz = p.f(t1, z);
    const A: Mat = [];
    for (let i = 0; i < n; i++) A.push(new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      const d = 1e-7 * Math.max(Math.abs(z[j]), 1e-8);
      const zp = z.slice(),
        zm = z.slice();
      zp[j] += d;
      zm[j] -= d;
      const fp = p.f(t1, zp),
        fm = p.f(t1, zm);
      for (let i = 0; i < n; i++) A[i][j] = (i === j ? 1 : 0) - (hb * (fp[i] - fm[i])) / (2 * d);
    }
    const G = z.map((zi, i) => zi - c[i] - hb * fz[i]);
    const dz = gaussPartial(A, G);
    if (!dz) return null;
    let rel = 0;
    let zmax = 0;
    for (let i = 0; i < n; i++) zmax = Math.max(zmax, Math.abs(z[i]));
    for (let i = 0; i < n; i++) {
      z[i] -= dz[i];
      if (!Number.isFinite(z[i])) return null;
      rel = Math.max(rel, Math.abs(dz[i]) / (Math.abs(z[i]) + 1e-30 * (1 + zmax)));
    }
    if (rel <= 1e-13) return z;
    if (it >= 3 && rel <= 1e-10 && rel >= 0.5 * prev) return z;
    prev = rel;
  }
  return null;
}

/** Відносна різниця двох векторів (малі компоненти — відносно max|z|·10⁻¹²). */
function vecRelDiff(a: Vec, z: Vec): number {
  const zmax = Math.max(...z.map(Math.abs));
  let d = 0;
  for (let i = 0; i < z.length; i++) d = Math.max(d, Math.abs(a[i] - z[i]) / Math.max(Math.abs(z[i]), 1e-12 * zmax, 1e-300));
  return d;
}

interface FixedRun {
  ok: boolean;
  y: Vec;
  /** найбільші |y_i| за всі кроки */
  maxAbs: number[];
  reason?: string;
}

/**
 * Метод зі сталим кроком: N кроків від t0 до T, h = (T − t0)/N, t_{n+1} = t0 + (n+1)h (як у lib/ode.ts).
 * Неявні: Ньютон до збіжності з початковим наближенням y_n; BDF2 стартує неявним Ейлером. `bound` — межі |y_i|
 * («вибух»). `strict` — на кожному кроці той самий корінь мають дати Ньютон з різницевим якобіаном і Гаусом без
 * масштабування (як з numpy) та Ньютон з інших початкових наближень (явний Ейлер, лінійна екстраполяція).
 */
export function runFixed(method: MethodId, p: Problem, N: number, o: FixedOptions = {}): FixedRun {
  return runSync(runFixedG(method, p, N, o));
}
type FixedOptions = { bound?: number[]; y0?: Vec; theta?: number; strict?: boolean };

function* runFixedG(method: MethodId, p: Problem, N: number, o: FixedOptions = {}): Work<FixedRun> {
  const t0 = p.t0 ?? 0;
  const h = (p.T - t0) / N;
  const n = p.y0.length;
  let y = (o.y0 ?? p.y0).slice();
  let yPrev: Vec | null = null;
  const maxAbs = y.map(Math.abs);
  const theta = method === "trap" ? 0.5 : method === "ieuler" ? 1 : (o.theta ?? 0.55);
  let t = t0;
  for (let k = 0; k < N; k++) {
    if ((k & 15) === 0 && shouldYield()) yield;
    const t1 = t0 + (k + 1) * h;
    let yn: Vec | null;
    switch (method) {
      case "euler": {
        const k1 = p.f(t, y);
        yn = y.map((v, i) => v + h * k1[i]);
        break;
      }
      case "rk2": {
        const k1 = p.f(t, y);
        const k2 = p.f(t + h / 2, y.map((v, i) => v + (h / 2) * k1[i]));
        yn = y.map((v, i) => v + h * k2[i]);
        break;
      }
      case "rk3": {
        const k1 = p.f(t, y);
        const k2 = p.f(t + h / 2, y.map((v, i) => v + (h / 2) * k1[i]));
        const k3 = p.f(t + h, y.map((v, i) => v + h * (2 * k2[i] - k1[i])));
        yn = y.map((v, i) => v + (h / 6) * (k1[i] + 4 * k2[i] + k3[i]));
        break;
      }
      case "rk4": {
        const k1 = p.f(t, y);
        const k2 = p.f(t + h / 2, y.map((v, i) => v + (h / 2) * k1[i]));
        const k3 = p.f(t + h / 2, y.map((v, i) => v + (h / 2) * k2[i]));
        const k4 = p.f(t + h, y.map((v, i) => v + h * k3[i]));
        yn = y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
        break;
      }
      case "ieuler":
      case "trap":
      case "theta":
      case "bdf2": {
        const yp = yPrev;
        const fy = p.f(t, y);
        let c: Vec, hb: number;
        if (method === "bdf2") {
          c = yp ? y.map((v, i) => (4 / 3) * v - (1 / 3) * yp[i]) : y;
          hb = yp ? (2 / 3) * h : h;
        } else {
          c = y.map((v, i) => v + h * (1 - theta) * fy[i]);
          hb = h * theta;
        }
        const euler = y.map((v, i) => v + h * fy[i]);
        yn = newtonStep(p, t1, y, c, hb);
        if (yn && o.strict) {
          // the root must not depend on how Newton is run: other starting points and a finite-difference Jacobian
          const fd = newtonStepFD(p, t1, y, c, hb);
          if (!fd || vecRelDiff(fd, yn) > 1e-8) return { ok: false, y, maxAbs, reason: `крок ${k + 1}: Ньютон з різницевим якобіаном ${fd ? "дає інший корінь" : "не збігся"}` };
          for (const g of [euler, yp ? y.map((v, i) => 2 * v - yp[i]) : null]) {
            if (!g) continue;
            const alt = newtonStep(p, t1, g, c, hb);
            if (alt && vecRelDiff(alt, yn) > 1e-8) return { ok: false, y, maxAbs, reason: `крок ${k + 1}: рівняння кроку має кілька коренів` };
          }
        }
        break;
      }
      default:
        return { ok: false, y, maxAbs, reason: `метод ${method} не зі сталим кроком` };
    }
    if (!yn) return { ok: false, y, maxAbs, reason: `Ньютон не збігся на кроці ${k + 1}` };
    for (let i = 0; i < n; i++) {
      const a = Math.abs(yn[i]);
      if (!Number.isFinite(a) || (o.bound && a > o.bound[i])) return { ok: false, y: yn, maxAbs, reason: `«вибух» на кроці ${k + 1}` };
      if (a > maxAbs[i]) maxAbs[i] = a;
    }
    yPrev = y;
    y = yn;
    t = t1;
  }
  return { ok: true, y, maxAbs };
}

/** Кількості кроків, з яких добирається h (від великого кроку до малого). */
const N_LIST = [4, 5, 8, 10, 16, 20, 25, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12500, 16000, 20000];
const N_CAP_EXPLICIT = 20000;
const N_CAP_IMPLICIT = 5000;
/** «з характером»: відносна різниця з точним розв'язком у цих межах */
const CHAR_MIN = 2e-3;
const CHAR_MAX = 0.8;

/** 1 крок, 2–4 кроки, 5+ кроків (11–14 — кроків) */
const stepsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "крок" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "кроки" : "кроків");

const isExplicitMethod = (m: MethodId) => m === "euler" || m === "rk2" || m === "rk3" || m === "rk4";

/** h = span/N — «людське» число (≤ 3 значущі цифри)? Повертає це число або null. */
function niceStep(span: number, N: number): number | null {
  const h = span / N;
  const r = roundSig(h, 3);
  return Math.abs(r - h) <= 1e-12 * h ? r : null;
}

// =====================================================================================================================
// 7. Questions
// =====================================================================================================================

export interface Question {
  /** `${taskId}:${template}` */
  key: string;
  taskId: string;
  template: TemplateId;
  /** короткий заголовок: «Точне значення u₂(T)» (TeX у $…$) */
  title: string;
  /** умова (TeX у $…$) */
  text: string;
  /** пояснення для режиму «Просто» */
  simple?: string;
  /** формули/уточнення для режиму «Науково» */
  sci?: string;
  /** формула методу (TeX, показується в обох режимах) */
  formula?: string;
  /** еталонна відповідь */
  answer: number;
  /** відносний допуск */
  tol: number;
  /** формат відповіді для студента */
  format: string;
  /** порада після 3 невдалих спроб */
  hint: string;
  /** для ключа: метод, крок, власні числа, розходження еталонів… */
  details: string[];
  /** для «б»: метод, крок і кількість кроків; компонента для «а»/«б» */
  meta?: { method?: MethodId; h?: number; N?: number; comp?: number; t?: number };
}

export interface TaskOutcome {
  taskId: string;
  specId: string;
  values: ResolvedValues;
  questions: Question[];
  /** шаблони, для яких питання не згенеровано, і чому */
  skipped: { template: TemplateId; reason: string }[];
  /** час обчислення, мс */
  ms: number;
}

const tex = (x: number) => numberToTex(x);
const tolTex = (tol: number) => {
  const e = Math.round(Math.log10(tol));
  return Math.abs(10 ** e - tol) < 1e-15 ? `10^{${e}}` : numberToTex(tol);
};
/** 7 значущих цифр для ключа */
export const keyNumber = (x: number) => (x === 0 ? "0" : Math.abs(x) >= 1e6 || Math.abs(x) < 1e-4 ? x.toExponential(6) : String(Number(x.toPrecision(7))));
const sig = (x: number, s = 3) => (x === 0 ? "0" : Math.abs(x) >= 1e5 || Math.abs(x) < 1e-3 ? x.toExponential(s - 1) : String(Number(x.toPrecision(s))));
const complexStr = (z: Complex) => (Math.abs(z.im) < 1e-12 * Math.abs(z.re) || z.im === 0 ? sig(z.re, 6) : `${sig(z.re, 6)} ${z.im < 0 ? "−" : "+"} ${sig(Math.abs(z.im), 6)}i`);

const FORMAT_NUMBER = "число: 0,8414 або 0.8414; можна 1,62e-5 чи 1.62·10^-5";

const METHOD_FORMULA: Record<string, string> = {
  euler: "y_{n+1} = y_n + h\\,f(t_n, y_n)",
  rk2: "k_1 = f(t_n, y_n),\\ k_2 = f\\!\\left(t_n + \\tfrac h2,\\ y_n + \\tfrac h2 k_1\\right),\\ y_{n+1} = y_n + h\\,k_2",
  rk3: "k_1 = f(t_n, y_n),\\ k_2 = f\\!\\left(t_n + \\tfrac h2,\\ y_n + \\tfrac h2 k_1\\right),\\ k_3 = f(t_n + h,\\ y_n - h k_1 + 2h k_2),\\ y_{n+1} = y_n + \\tfrac h6 (k_1 + 4k_2 + k_3)",
  rk4: "k_1 = f(t_n, y_n),\\ k_2 = f\\!\\left(t_n + \\tfrac h2, y_n + \\tfrac h2 k_1\\right),\\ k_3 = f\\!\\left(t_n + \\tfrac h2, y_n + \\tfrac h2 k_2\\right),\\ k_4 = f(t_n + h, y_n + h k_3),\\ y_{n+1} = y_n + \\tfrac h6 (k_1 + 2k_2 + 2k_3 + k_4)",
  ieuler: "y_{n+1} = y_n + h\\,f(t_{n+1}, y_{n+1})",
  theta: "y_{n+1} = y_n + h\\left[0.45\\,f(t_n, y_n) + 0.55\\,f(t_{n+1}, y_{n+1})\\right]",
  trap: "y_{n+1} = y_n + \\tfrac h2\\left[f(t_n, y_n) + f(t_{n+1}, y_{n+1})\\right]",
  bdf2: "y_{n+1} = \\tfrac43 y_n - \\tfrac13 y_{n-1} + \\tfrac23 h\\,f(t_{n+1}, y_{n+1})",
};

/** Одна задача варіанта: параметри, еталон (лінива), компільовані задачі. */
class TaskContext {
  readonly cfg: VariantConfig;
  readonly tv: TaskVariant;
  readonly plan: TaskPlan;
  readonly p: Problem;
  readonly tol: number;
  private ref?: RefPair | null;
  private refWhy = "";
  constructor(cfg: VariantConfig, taskId: string) {
    this.cfg = cfg;
    this.tv = taskVariant(cfg, taskId);
    this.plan = V1_PLANS[taskId];
    this.p = compileSpec(this.tv.spec, this.tv.values);
    this.tol = TOL_LEVELS[cfg.tolLevel] ?? 1e-3;
  }
  get spec() {
    return this.tv.spec;
  }
  get t0() {
    return this.tv.values.t0;
  }
  get T() {
    return this.tv.values.T;
  }
  varTex(i: number) {
    return nameToTex(this.spec.vars[i]);
  }
  get tTex() {
    return nameToTex(timeName(this.spec));
  }
  /** задача в змінних еталона */
  refProblem(T?: number): { p: Problem; from: (y: Vec) => Vec } {
    const v = this.tv.values;
    if (this.plan.ref) {
      const rs = specById(this.plan.ref.specId)!;
      const p = compileSpec(rs, { params: v.params, y0: this.plan.ref.to(v.y0), t0: v.t0, T: T ?? v.T });
      return { p, from: this.plan.ref.from };
    }
    return { p: T === undefined ? this.p : { ...this.p, T }, from: (y) => y };
  }
  /** еталонна пара на [t0, T] або null (з причиною) */
  *reference(): Work<RefPair | null> {
    if (this.ref !== undefined) return this.ref;
    const { p: pref, from } = this.refProblem();
    const r1 = yield* refRunG("ros4", pref, R1_RTOL);
    if (!r1.ok) {
      this.refWhy = "еталонний розв'язок (ROS4) не дійшов до T";
      return (this.ref = null);
    }
    let kind2: RefKind = this.spec.stiff ? "ros4" : "dopri";
    let r2 = yield* refRunG(kind2, pref, kind2 === "ros4" ? R2_RTOL_ROS4 : R2_RTOL_DOPRI);
    if (!r2.ok && kind2 === "dopri") {
      kind2 = "ros4";
      r2 = yield* refRunG(kind2, pref, R2_RTOL_ROS4);
    }
    if (!r2.ok) {
      this.refWhy = "перевірний розв'язок не дійшов до T";
      return (this.ref = null);
    }
    return (this.ref = { r1, r2, kind2, pref, from });
  }
  get referenceFailure() {
    return this.refWhy;
  }
}

type Built = { q: Question } | { skip: string };
const qSeed = (ctx: TaskContext, t: TemplateId) => `${taskSeed(ctx.cfg, ctx.tv.taskId)}|q|${t}`;

/** «а»: значення компоненти точного розв'язку в T (або в моменті plan.aAt). */
function* buildExact(ctx: TaskContext): Work<Built> {
  const ref = yield* ctx.reference();
  if (!ref) return { skip: ctx.referenceFailure };
  const tol = ctx.tol;
  const tq = ctx.plan.aAt ? roundSig(ctx.plan.aAt(ctx.tv.values), 2) : ctx.T;
  const atT = tq === ctx.T;
  const at = (tr: Traj, kind: RefKind, rtol: number, tau: number) => {
    const j = nodeBefore(tr.t, tau);
    return ref.from(tr.t[j] === tau ? tr.y[j] : advance(kind, ref.pref, tr.t[j], tr.y[j], tau, rtol));
  };
  const rtol2 = ref.kind2 === "ros4" ? R2_RTOL_ROS4 : R2_RTOL_DOPRI;
  const yq = at(ref.r1, "ros4", R1_RTOL, tq);
  const yq2 = at(ref.r2, ref.kind2, rtol2, tq);
  const n = yq.length;
  const span = tq - ctx.t0;
  const fq = ctx.p.f(tq, yq);
  const minRel = ctx.plan.minRel ?? 1e-6;
  // values at tq − 2d and tq − d (d = 0.1·span) for an Aitken estimate of the limit: is y_i(tq) already «settled»?
  const yA = at(ref.r1, "ros4", R1_RTOL, tq - 0.2 * span),
    yB = at(ref.r1, "ros4", R1_RTOL, tq - 0.1 * span);
  const ys = ref.r1.y.map(ref.from);
  const reasons: string[] = [];
  const good: number[] = [];
  const tLabel = atT ? "T" : tex(tq);
  for (let i = 0; i < n; i++) {
    const v = yq[i];
    let A = Math.abs(v),
      L = Math.abs(v);
    const tw = tq - 0.1 * span;
    for (let k = 0; k < ys.length && ref.r1.t[k] <= tq; k++) {
      const a = Math.abs(ys[k][i]);
      if (a > A) A = a;
      if (ref.r1.t[k] >= tw && a > L) L = a;
    }
    const av = Math.abs(v);
    const kappa = (Math.abs(fq[i]) * span) / av;
    const name = `${ctx.spec.vars[i]}(${atT ? "T" : tq})`;
    const d0 = yB[i] - yA[i],
      d1 = v - yB[i];
    const r = d1 / d0;
    const settled = Math.abs(d1) <= 0.1 * tol * av || (d0 * d1 > 0 && r < 0.98 && Math.abs((d1 * r) / (1 - r)) < 3 * tol * av);
    if (!(av > 1e-250) || av < minRel * A) reasons.push(`${name} згасла нижче ${sig(minRel, 1)} від максимуму`);
    else if (av < 0.05 * L) reasons.push(`${name} біля нуля коливання`);
    else if (settled) reasons.push(`${name} вже майже на граничному значенні (легко вгадати)`);
    else if (kappa > 1e7 * tol) reasons.push(`${name} на різкому фронті`);
    else if (Math.abs(v - ctx.tv.values.y0[i]) < 10 * tol * av) reasons.push(`${name} майже дорівнює початковому`);
    else if (Math.abs(yq2[i] - v) > REF_AGREEMENT * av) reasons.push(`еталони для ${name} розходяться на ${sig(Math.abs(yq2[i] - v) / av, 2)}`);
    else good.push(i);
  }
  if (!good.length) return { skip: reasons.join("; ") };
  const rng = new Rng(qSeed(ctx, "a"));
  const i = rng.pick(good);
  const vt = ctx.varTex(i);
  const when = atT ? `в момент $T = ${tex(ctx.T)}$` : `в момент $${ctx.tTex} = ${tLabel}$ (раніше за $T$)`;
  return {
    q: {
      key: `${ctx.tv.taskId}:a`,
      taskId: ctx.tv.taskId,
      template: "a",
      title: `Точне значення $${vt}(${tLabel})$`,
      text: `Знайдіть значення $${vt}(${tLabel})$ точного розв'язку задачі ${when} з відносною похибкою не більше $${tolTex(tol)}$.`,
      simple: "Метод і крок — на ваш вибір. Порахуйте, потім зменште крок (або допуск адаптивного методу) удвічі: якщо потрібні цифри не змінилися — відповідь готова.",
      sci: `Зараховується $x$ з $|x - ${vt}(${tLabel})| \\le ${tolTex(tol)}\\,|${vt}(${tLabel})|$. Для жорсткої задачі явні методи потребують кроку в межах області стійкості; зручніше — неявний чи адаптивний метод (ode15s/ode23s, solve_ivp з Radau/BDF/LSODA) з малими rtol і atol.`,
      answer: yq[i],
      tol,
      format: FORMAT_NUMBER,
      hint: `Перевірте: значення саме в момент ${atT ? "T" : tLabel} (а не в найближчому вузлі сітки); компонента та, що треба; крок/допуск достатньо малі — зменште їх у 10 разів і порівняйте; для жорсткої задачі atol має бути набагато меншим за саме значення.`,
      details: [
        `компонента ${ctx.spec.vars[i]}, момент ${atT ? `T = ${ctx.T}` : tq}`,
        `ROS4 rtol 1e-10 vs ${ref.kind2 === "dopri" ? "DOPRI5 rtol 1e-11" : "ROS4 rtol 1e-8"}: розходження ${sig(Math.abs(yq2[i] - yq[i]) / Math.abs(yq[i]), 2)}`,
      ],
      meta: { comp: i, t: tq },
    },
  };
}
/** «б»: y(T) заданим методом зі сталим кроком. */
function* buildMethod(ctx: TaskContext): Work<Built> {
  const ref = yield* ctx.reference();
  if (!ref) return { skip: ctx.referenceFailure };
  const ys = ref.r1.y.map(ref.from);
  const yT = ys[ys.length - 1];
  const n = yT.length;
  const A = new Array<number>(n).fill(0);
  for (const y of ys) for (let i = 0; i < n; i++) A[i] = Math.max(A[i], Math.abs(y[i]));
  const Amax = Math.max(...A);
  const bound = A.map((a) => 10 * a + 1e-12 * Amax);
  const rng = new Rng(qSeed(ctx, "b"));
  const methods = rng.shuffle(ctx.plan.methods);
  const compOrder = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  const span = ctx.T - ctx.t0;
  const tried: string[] = [];
  const minRel = ctx.plan.minRel ?? 1e-6;
  for (const m of methods) {
    const cap = isExplicitMethod(m) ? N_CAP_EXPLICIT : (ctx.plan.implicitCap ?? N_CAP_IMPLICIT);
    const cands: { N: number; h: number; run: FixedRun; comps: number[] }[] = [];
    for (const N of N_LIST) {
      if (N > cap) break;
      const h = niceStep(span, N);
      if (h === null) continue;
      const run = yield* runFixedG(m, ctx.p, N, { bound });
      if (!run.ok) continue;
      const comps: number[] = [];
      let allSmall = true;
      for (const i of compOrder) {
        const r = Math.abs(yT[i]);
        if (!(r > 1e-250) || r < minRel * A[i]) continue;
        const delta = Math.abs(run.y[i] - yT[i]) / r;
        if (delta >= CHAR_MIN) allSmall = false;
        if (delta >= CHAR_MIN && delta <= CHAR_MAX && Math.abs(run.y[i]) > 1e-250) comps.push(i);
      }
      if (comps.length) cands.push({ N, h, run, comps });
      if (allSmall) break;
    }
    if (!cands.length) {
      tried.push(METHODS[m].short);
      continue;
    }
    // try candidates in a seeded order until one passes the robustness checks
    for (const c of rng.shuffle(cands)) {
      const i = c.comps[0];
      const yi = c.run.y[i];
      // conditioning of the discrete map: «round-off» of 1e-13 in every evaluation of f (≈ 1000× the real one) and in
      // y0 must not move the answer by more than 1e-7 — then a different order of operations changes it by ≲ 1e-10
      let k = 0;
      const noisy: Problem = { ...ctx.p, f: (tt, yy) => ctx.p.f(tt, yy).map((v) => v * (1 + 1e-13 * (((k = (k * 1103515245 + 12345) % 2147483648) & 1024) ? 1 : -1))) };
      const pert = yield* runFixedG(m, noisy, c.N, { bound, y0: ctx.p.y0.map((v) => v * (1 + 1e-13)) });
      if (!pert.ok || Math.abs(pert.y[i] - yi) > 1e-7 * Math.abs(yi)) continue;
      // implicit: the root of every step must not depend on the Newton variant (start, Jacobian)
      if (!isExplicitMethod(m)) {
        const strict = yield* runFixedG(m, ctx.p, c.N, { bound, strict: true });
        if (!strict.ok || Math.abs(strict.y[i] - yi) > 1e-9 * Math.abs(yi)) continue;
      }
      // the site's own integrator (lib/ode.ts: damped Newton with fallbacks) must give the same number
      yield;
      const lib = solve(m, ctx.p, { h: span / c.N, blowup: 1e300 });
      if (lib.failed || Math.abs(lib.y[lib.y.length - 1][i] - yi) > 1e-9 * Math.abs(yi)) continue;
      const vt = ctx.varTex(i);
      const meta = METHODS[m];
      const implicit = !isExplicitMethod(m);
      const delta = (yi - yT[i]) / Math.abs(yT[i]);
      const extra = implicit
        ? ` Рівняння кожного кроку розв'язуйте методом Ньютона до збіжності (початкове наближення — $y_n$).${m === "bdf2" ? " Перший крок ($y_1$) — неявним методом Ейлера." : ""}`
        : "";
      return {
        q: {
          key: `${ctx.tv.taskId}:b`,
          taskId: ctx.tv.taskId,
          template: "b",
          title: `${meta.name}, $h = ${tex(c.h)}$`,
          text: `Розв'яжіть задачу методом «${meta.name}» зі сталим кроком $h = ${tex(c.h)}$ ($N = ${c.N}$ ${stepsWord(c.N)} від $${ctx.tTex}_0 = ${tex(ctx.t0)}$ до $T = ${tex(ctx.T)}$) і вкажіть отримане чисельне значення $${vt}$ у момент $T$ (тобто $${vt}$ після $N$-го кроку).${extra}`,
          simple: "Тут потрібне саме те число, яке дає цей метод з цим кроком, — воно навмисно помітно відрізняється від точного розв'язку. Запрограмуйте метод за формулою нижче і зробіть рівно N кроків.",
          sci: "Допуск відносний $10^{-6}$: досить точно відтворити алгоритм — інший порядок арифметичних дій дає розбіжність лише ~$10^{-12}$.",
          formula: METHOD_FORMULA[m] + (m === "theta" ? ",\\quad \\theta = 0.55" : ""),
          answer: yi,
          tol: TEMPLATES.b.tol!,
          format: FORMAT_NUMBER,
          hint: `Перевірте: зроблено рівно $N = ${c.N}$ ${stepsWord(c.N)} з $h = ${tex(c.h)}$; формулу методу — ${implicit ? "$f$ у неявній частині береться в новій точці $(t_{n+1}, y_{n+1})$, Ньютон доведено до збіжності на кожному кроці" : "проміжні точки ($t_n + h/2$, $t_n + h$) і ваги"}${m === "bdf2" ? "; перший крок BDF2 — неявним Ейлером" : ""}; порядок змінних і праві частини (знаки, дужки, значення параметрів).`,
          details: [`${meta.name}, h = ${c.h}, N = ${c.N}, компонента ${ctx.spec.vars[i]}`, `відхилення від точного ${(delta * 100).toFixed(2)} %`],
          meta: { method: m, h: c.h, N: c.N, comp: i },
        },
      };
    }
    tried.push(METHODS[m].short);
  }
  return { skip: `жоден метод (${tried.join(", ")}) не дав стійкого результату, помітно відмінного від точного, з N ≤ ${N_CAP_EXPLICIT}` };
}

/** Власні числа якобіана в початковій точці; null, якщо якобіан не залежить від варіанта (питання було б спільним). */
function initialEigen(ctx: TaskContext): { ev: Complex[]; J: Mat } | { skip: string } {
  const v = ctx.tv.values;
  const J = ctx.p.jac!(v.t0, v.y0);
  const d = resolveValues(ctx.spec);
  const Jd = compileSpec(ctx.spec, d).jac!(d.t0, d.y0);
  if (J.every((row, i) => row.every((x, j) => x === Jd[i][j]))) return { skip: "якобіан у початковій точці однаковий для всіх варіантів — відповідь не була б індивідуальною" };
  const ev = eigenvalues(J);
  if (ev.some((z) => !Number.isFinite(z.re) || !Number.isFinite(z.im))) return { skip: "власні числа не обчислюються" };
  return { ev, J };
}

/** Ненульові власні числа (нулі від законів збереження — до 1e-11·max|λ| — відкидаються). */
const nonzero = (ev: Complex[]) => {
  const top = Math.max(...ev.map((z) => Math.hypot(z.re, z.im)));
  return ev.filter((z) => Math.hypot(z.re, z.im) > 1e-11 * top);
};

/** «в»: межа стійкості явного Ейлера в початковій точці. */
function buildStability(ctx: TaskContext): Built {
  const e = initialEigen(ctx);
  if ("skip" in e) return e;
  const ev = nonzero(e.ev);
  if (!ev.length) return { skip: "усі власні числа нульові" };
  if (ev.some((z) => !(z.re < -1e-9 * Math.hypot(z.re, z.im)))) return { skip: "є власне число з Re λ ≥ 0 — явний Ейлер нестійкий за будь-якого h > 0" };
  const hs = Math.min(...ev.map((z) => (-2 * z.re) / (z.re * z.re + z.im * z.im)));
  const t0 = tex(ctx.t0);
  return {
    q: {
      key: `${ctx.tv.taskId}:c`,
      taskId: ctx.tv.taskId,
      template: "c",
      title: "Межа стійкості явного Ейлера",
      text: `Обчисліть межу стійкості явного методу Ейлера в початковій точці: $h^{*} = \\max\\{h > 0 : |1 + h\\lambda_k| \\le 1\\ \\text{для всіх}\\ k\\}$, де $\\lambda_k$ — власні числа якобіана $J = \\partial f/\\partial y$ у точці $(${ctx.tTex}_0, y_0)$, тобто при $${ctx.tTex} = ${t0}$ і початкових умовах варіанта.`,
      simple: "Якобіан — матриця частинних похідних правих частин. Порахуйте її в початковій точці, знайдіть власні числа і найбільший крок, з яким явний Ейлер ще не «розгойдується».",
      sci: "Для дійсних $\\lambda_k < 0$: $h^{*} = 2/\\max_k|\\lambda_k|$; для комплексних — $h^{*} = \\min_k \\left(-2\\,\\mathrm{Re}\\,\\lambda_k/|\\lambda_k|^2\\right)$. Нульові власні числа (закони збереження) межі не обмежують.",
      answer: hs,
      tol: TEMPLATES.c.tol!,
      format: FORMAT_NUMBER,
      hint: "Перевірте частинні похідні (кожен рядок — одне рівняння, кожен стовпчик — одна змінна), підставте саме початкові значення і параметри варіанта; для комплексних λ межа — −2·Re λ/|λ|², а не 2/|λ|.",
      details: [`λ: ${e.ev.map(complexStr).join("; ")}`],
    },
  };
}

/** «г»: коефіцієнт жорсткості в початковій точці. */
function buildStiffness(ctx: TaskContext): Built {
  const e = initialEigen(ctx);
  if ("skip" in e) return e;
  const neg = nonzero(e.ev)
    .filter((z) => z.re < -1e-9 * Math.hypot(z.re, z.im))
    .map((z) => -z.re);
  if (neg.length < 2) return { skip: "менше двох власних чисел з Re λ < 0" };
  const S = Math.max(...neg) / Math.min(...neg);
  if (!(S > 1 + 1e-6)) return { skip: "усі Re λ однакові (комплексна пара) — коефіцієнт тривіальний (1)" };
  const t0 = tex(ctx.t0);
  return {
    q: {
      key: `${ctx.tv.taskId}:d`,
      taskId: ctx.tv.taskId,
      template: "d",
      title: "Коефіцієнт жорсткості",
      text: `Обчисліть коефіцієнт жорсткості в початковій точці $(${ctx.tTex}_0, y_0)$ (при $${ctx.tTex} = ${t0}$ і початкових умовах варіанта): $S = \\max_k|\\mathrm{Re}\\,\\lambda_k| \\,/\\, \\min_k|\\mathrm{Re}\\,\\lambda_k|$ за власними числами $\\lambda_k$ якобіана з $\\mathrm{Re}\\,\\lambda_k < 0$.`,
      simple: "Це відношення «найшвидшого» темпу згасання до «найповільнішого». Чим воно більше, тим жорсткіша задача.",
      sci: "Власні числа з $\\mathrm{Re}\\,\\lambda \\ge 0$ і нульові (закони збереження) не враховуються.",
      answer: S,
      tol: TEMPLATES.d.tol!,
      format: FORMAT_NUMBER,
      hint: "Беріть лише власні числа з від'ємною дійсною частиною; ділиться найбільший |Re λ| на найменший. Перевірте якобіан і значення параметрів.",
      details: [`λ: ${e.ev.map(complexStr).join("; ")}`],
    },
  };
}

/**
 * Екстремум компоненти на [t0, T]: усі локальні екстремуми у вузлах, не гірші за найкращий більш ніж на 10⁻³ розмаху,
 * уточнюються золотим перерізом (значення між вузлами — інтегруванням від вузла), береться найкращий.
 */
function* refinedExtremum(
  kind: "max" | "min",
  comp: number,
  tr: Traj,
  rk: RefKind,
  rtol: number,
  pref: Problem,
  from: (y: Vec) => Vec,
): Work<{ value: number; t: number } | { skip: string }> {
  const sgn = kind === "max" ? 1 : -1;
  const ys = tr.y.map(from);
  const v = (j: number) => sgn * ys[j][comp];
  let best = 0,
    lo = Infinity,
    hi = -Infinity;
  for (let j = 0; j < ys.length; j++) {
    if (v(j) > v(best)) best = j;
    lo = Math.min(lo, ys[j][comp]);
    hi = Math.max(hi, ys[j][comp]);
  }
  const word = kind === "max" ? "максимум" : "мінімум";
  if (best === 0) return { skip: `${word} на початку відрізка` };
  if (best === ys.length - 1) return { skip: `${word} у кінці відрізка` };
  const margin = 1e-3 * Math.max(hi - lo, Math.abs(ys[best][comp]));
  const cands: number[] = [];
  for (let j = 1; j + 1 < ys.length; j++) if (v(j) >= v(j - 1) && v(j) >= v(j + 1) && v(j) >= v(best) - margin) cands.push(j);
  cands.sort((a, b) => v(b) - v(a));
  const valueAt = (tau: number): number => {
    const j = nodeBefore(tr.t, tau);
    return sgn * from(advance(rk, pref, tr.t[j], tr.y[j], tau, rtol * 0.01))[comp];
  };
  let bestVal = -Infinity,
    bestT = tr.t[best];
  for (const k of cands.slice(0, 20)) {
    // golden-section search on [t_{k-1}, t_{k+1}] (the extremum is flat: ~1e-8 in t is plenty)
    let a = tr.t[k - 1],
      b = tr.t[k + 1];
    const gr = (Math.sqrt(5) - 1) / 2;
    let x1 = b - gr * (b - a),
      x2 = a + gr * (b - a);
    let f1 = valueAt(x1),
      f2 = valueAt(x2);
    for (let it = 0; it < 60 && b - a > 1e-10 * Math.max(1, Math.abs(b)); it++) {
      if (shouldYield()) yield;
      if (f1 > f2) {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = b - gr * (b - a);
        f1 = valueAt(x1);
      } else {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = a + gr * (b - a);
        f2 = valueAt(x2);
      }
    }
    const val = Math.max(f1, f2, v(k));
    if (val > bestVal) {
      bestVal = val;
      bestT = (a + b) / 2;
    }
  }
  return { value: sgn * bestVal, t: bestT };
}

/** Моменти перетину рівня L знизу вгору компонентою comp (уточнені). */
function* upCrossings(tr: Traj, comp: number, L: number, rk: RefKind, rtol: number, pref: Problem, from: (y: Vec) => Vec, after = -Infinity): Work<number[]> {
  const out: number[] = [];
  const ys = tr.y.map(from);
  for (let k = 0; k + 1 < ys.length; k++) {
    if (tr.t[k] < after) continue;
    const a = ys[k][comp] - L,
      b = ys[k + 1][comp] - L;
    if (a < 0 && b >= 0) {
      if (shouldYield()) yield;
      const g = (tau: number) => from(advance(rk, pref, tr.t[k], tr.y[k], tau, rtol * 0.01))[comp] - L;
      out.push(findRoot(g, tr.t[k], tr.t[k + 1], a, b, 1e-12 * Math.max(1, Math.abs(tr.t[k + 1]))));
    }
  }
  return out;
}

/** Період усталених коливань за однією траєкторією; null — не встановився. */
function* periodOf(tr: Traj, comp: number, rk: RefKind, rtol: number, pref: Problem, from: (y: Vec) => Vec): Work<{ P: number; L: number } | { skip: string }> {
  const ys = tr.y.map(from);
  const tEnd = tr.t[tr.t.length - 1];
  const half = tr.t[0] + 0.3 * (tEnd - tr.t[0]);
  let mn = Infinity,
    mx = -Infinity;
  for (let k = 0; k < ys.length; k++)
    if (tr.t[k] >= half) {
      mn = Math.min(mn, ys[k][comp]);
      mx = Math.max(mx, ys[k][comp]);
    }
  if (!(mx - mn > 1e-6 * Math.max(Math.abs(mx), Math.abs(mn), 1e-300))) return { skip: "коливань немає — розв'язок прямує до рівноваги" };
  const L = (mn + mx) / 2;
  const cr = yield* upCrossings(tr, comp, L, rk, rtol, pref, from, half);
  if (cr.length < 3) return { skip: "замало періодів для виміру" };
  const P1 = cr[cr.length - 1] - cr[cr.length - 2];
  const P0 = cr[cr.length - 2] - cr[cr.length - 3];
  if (Math.abs(P1 - P0) > 1e-7 * P1) return { skip: "цикл не встановився" };
  return { P: P1, L };
}

/** «ґ»: задачне питання. */
function* buildExtra(ctx: TaskContext): Work<Built> {
  const ex = ctx.plan.extra;
  if (!ex) return { skip: "для цієї задачі задачного питання немає" };
  const tol = ctx.tol;
  if (ex.kind === "max" || ex.kind === "min") {
    const ref = yield* ctx.reference();
    if (!ref) return { skip: ctx.referenceFailure };
    // the planned extremum at an end of the interval (e.g. the start value is the largest) → ask for the opposite one
    let kind: "max" | "min" = ex.kind;
    let a = yield* refinedExtremum(kind, ex.comp, ref.r1, "ros4", R1_RTOL, ref.pref, ref.from);
    if ("skip" in a) {
      kind = kind === "max" ? "min" : "max";
      const a2 = yield* refinedExtremum(kind, ex.comp, ref.r1, "ros4", R1_RTOL, ref.pref, ref.from);
      if ("skip" in a2) return { skip: `${a.skip}; ${a2.skip}` };
      a = a2;
    }
    const b = yield* refinedExtremum(kind, ex.comp, ref.r2, ref.kind2, ref.kind2 === "ros4" ? R2_RTOL_ROS4 : R2_RTOL_DOPRI, ref.pref, ref.from);
    if ("skip" in b) return b;
    if (Math.abs(a.value - b.value) > REF_AGREEMENT * Math.abs(a.value)) return { skip: `еталони екстремуму розходяться на ${sig(Math.abs(a.value - b.value) / Math.abs(a.value), 2)}` };
    if (!(Math.abs(a.value) > 1e-250)) return { skip: "екстремум нульовий" };
    const vt = ctx.varTex(ex.comp);
    const word = kind === "max" ? "найбільше" : "найменше";
    return {
      q: {
        key: `${ctx.tv.taskId}:e`,
        taskId: ctx.tv.taskId,
        template: "e",
        title: `${kind === "max" ? "Максимум" : "Мінімум"} $${vt}$ на $[${ctx.tTex}_0, T]$`,
        text: `Знайдіть ${word} значення $${vt}(${ctx.tTex})$ точного розв'язку на відрізку $[${tex(ctx.t0)},\\ ${tex(ctx.T)}]$ з відносною похибкою не більше $${tolTex(tol)}$.`,
        simple: `Пройдіть розв'язок дрібним кроком і знайдіть ${word} значення. Між вузлами сітки ${kind === "max" ? "пік" : "дно"} може «сховатися» — зменшуйте крок, доки цифри не перестануть змінюватися.`,
        sci: `У точці екстремуму $${vt}' = 0$; значення нечутливе до похибки моменту, тож досить знайти вузол з ${kind === "max" ? "найбільшим" : "найменшим"} значенням на густій сітці або уточнити його інтерполяцією.`,
        answer: a.value,
        tol,
        format: FORMAT_NUMBER,
        hint: `Перевірте: шукаєте ${word} значення саме компоненти $${vt}$ на всьому відрізку (не лише у вузлах грубої сітки); точність розв'язку достатня; знак числа.`,
        details: [`екстремум при ${ctx.spec.t ?? "t"} ≈ ${sig(a.t, 6)}`, `розходження еталонів ${sig(Math.abs(a.value - b.value) / Math.abs(a.value), 2)}`],
        meta: { comp: ex.comp, t: a.t },
      },
    };
  }
  if (ex.kind === "period") {
    const tMax = ex.tMax(ctx.tv.values);
    const { p: pref, from } = ctx.refProblem(tMax);
    const r1 = yield* refRunG("ros4", pref, R1_RTOL);
    if (!r1.ok) return { skip: "еталон для періоду не дійшов до кінця" };
    const a = yield* periodOf(r1, ex.comp, "ros4", R1_RTOL, pref, from);
    if ("skip" in a) return a;
    let kind2: RefKind = ctx.spec.stiff ? "ros4" : "dopri";
    let r2 = yield* refRunG(kind2, pref, kind2 === "ros4" ? R2_RTOL_ROS4 : R2_RTOL_DOPRI);
    if (!r2.ok && kind2 === "dopri") {
      kind2 = "ros4";
      r2 = yield* refRunG(kind2, pref, R2_RTOL_ROS4);
    }
    if (!r2.ok) return { skip: "перевірний розв'язок для періоду не дійшов до кінця" };
    const b = yield* periodOf(r2, ex.comp, kind2, kind2 === "ros4" ? R2_RTOL_ROS4 : R2_RTOL_DOPRI, pref, from);
    if ("skip" in b) return b;
    if (Math.abs(a.P - b.P) > REF_AGREEMENT * a.P) return { skip: `еталони періоду розходяться на ${sig(Math.abs(a.P - b.P) / a.P, 2)}` };
    const vt = ctx.varTex(ex.comp);
    return {
      q: {
        key: `${ctx.tv.taskId}:e`,
        taskId: ctx.tv.taskId,
        template: "e",
        title: "Період граничного циклу",
        text: `Розв'язок виходить на граничний цикл (усталені коливання). Знайдіть його період — час між двома послідовними проходженнями $${vt}$ через одне й те саме значення в одному напрямку, коли перехідний процес уже скінчився. Відносна похибка — не більше $${tolTex(tol)}$.`,
        simple: "Проінтегруйте задачу на довгому відрізку (значно довшому за T), відкиньте початок і виміряйте час між двома сусідніми «однаковими» моментами циклу, наприклад між двома перетинами середнього рівня знизу вгору.",
        sci: `Наприклад, за моментами перетину рівня $${vt} = ${sig(a.L, 4)}$ знизу вгору (з лінійною інтерполяцією між вузлами густої сітки). Перевірте, що два останні виміряні періоди збігаються.`,
        answer: a.P,
        tol,
        format: FORMAT_NUMBER,
        hint: "Перевірте: перехідний процес відкинуто (порівняйте кілька останніх періодів); моменти перетину інтерпольовано між вузлами; відрізок інтегрування достатньо довгий; крок дрібний на різких фронтах.",
        details: [`рівень ${ctx.spec.vars[ex.comp]} = ${sig(a.L, 6)}, інтегрування до ${sig(tMax, 4)}`, `розходження еталонів ${sig(Math.abs(a.P - b.P) / a.P, 2)}`],
      },
    };
  }
  // revival (№25), in the logarithmic variables w = ln u
  const LOW = Math.log(1e-3);
  const v = ctx.tv.values;
  const rs = specById("t25-log")!;
  const tMax = 5000;
  const pref = compileSpec(rs, { params: v.params, y0: [Math.log(v.y0[0]), Math.log(v.y0[1]), v.y0[2]], t0: v.t0, T: tMax });
  const findRev = (tr: Traj, rk: RefKind, rtol: number): number | null => {
    let low = -1;
    for (let k = 0; k < tr.y.length; k++) {
      if (low < 0 && tr.y[k][0] < LOW) low = k;
      if (low >= 0 && k > low && tr.y[k - 1][0] < 0 && tr.y[k][0] >= 0) {
        const g = (tau: number) => advance(rk, pref, tr.t[k - 1], tr.y[k - 1], tau, rtol * 0.01)[0];
        return findRoot(g, tr.t[k - 1], tr.t[k], tr.y[k - 1][0], tr.y[k][0], 1e-12 * tr.t[k]);
      }
    }
    return null;
  };
  let lowSeen = false;
  const r1 = yield* ros4G(pref, R1_RTOL, {
    stop: (_t, y) => {
      if (y[0] < LOW) lowSeen = true;
      return lowSeen && y[0] >= 0;
    },
  });
  const t1 = r1.ok ? findRev(r1, "ros4", R1_RTOL) : null;
  if (t1 === null) return { skip: lowSeen ? "кролики не відроджуються до t = 5000" : "кролики не вимирають нижче 10⁻³ — відродження немає" };
  yield;
  const r2 = refRun("dopri", { ...pref, T: t1 * 1.05 }, R2_RTOL_DOPRI);
  const t2 = r2.ok ? findRev(r2, "dopri", R2_RTOL_DOPRI) : null;
  if (t2 === null) return { skip: "перевірний розв'язок не знайшов відродження" };
  if (Math.abs(t1 - t2) > REF_AGREEMENT * t1) return { skip: `еталони моменту відродження розходяться на ${sig(Math.abs(t1 - t2) / t1, 2)}` };
  return {
    q: {
      key: `${ctx.tv.taskId}:e`,
      taskId: ctx.tv.taskId,
      template: "e",
      title: "Момент «відродження» $t^{*}$",
      text: `Популяція $u$ спершу падає нижче $10^{-3}$, а згодом «відроджується». Знайдіть момент відродження $t^{*}$ — перший момент після провалу, коли $u(t^{*}) = 1$. Відносна похибка — не більше $${tolTex(tol)}$.`,
      simple: "Провал дуже глибокий (на десятки порядків), тож у звичайних змінних похибка легко «з'їдає» популяцію. Надійніше рахувати в логарифмах w = ln u, z = ln v — як на сторінці задачі.",
      sci: "У змінних $w = \\ln u$, $z = \\ln v$: $t^{*}$ — перший після провалу $w < \\ln 10^{-3}$ корінь $w(t) = 0$; момент варто уточнити інтерполяцією між вузлами. Момент може бути пізнішим за $T$ — інтегруйте далі.",
      answer: t1,
      tol,
      format: "число (момент часу), напр. 345,2",
      hint: "Перевірте: рахуєте в логарифмах (або з дуже малим atol); момент — ПЕРШИЙ підйом u до 1 після провалу; інтерполюєте між вузлами; інтегруєте достатньо далеко (t* може бути більшим за T).",
      details: [`ROS4 vs DOPRI5 (у змінних ln u, ln v): розходження ${sig(Math.abs(t1 - t2) / t1, 2)}`],
    },
  };
}

const BUILDERS: Record<TemplateId, (ctx: TaskContext) => Work<Built>> = {
  a: buildExact,
  b: buildMethod,
  // eslint-disable-next-line require-yield
  c: function* (ctx) {
    return buildStability(ctx);
  },
  // eslint-disable-next-line require-yield
  d: function* (ctx) {
    return buildStiffness(ctx);
  },
  e: buildExtra,
};

const outcomeCache = new Map<string, TaskOutcome>();
const outcomeKey = (cfg: VariantConfig, taskId: string) => `${taskSeed(cfg, taskId)}|${cfg.templates.join("")}|${cfg.tolLevel}`;

/** Питання варіанта для однієї задачі (важко: інтегрування). Результат кешується. */
export function computeTaskOutcome(cfg: VariantConfig, taskId: string): TaskOutcome {
  return runSync(taskOutcomeG(cfg, taskId));
}

/** {@link computeTaskOutcome} як генератор (для обчислення квантами). `ms` — чистий час обчислення. */
export function* taskOutcomeG(cfg: VariantConfig, taskId: string): Work<TaskOutcome> {
  const key = outcomeKey(cfg, taskId);
  const hit = outcomeCache.get(key);
  if (hit) return hit;
  let busy = 0;
  let mark = nowMs();
  const ctx = new TaskContext(cfg, taskId);
  const questions: Question[] = [];
  const skipped: TaskOutcome["skipped"] = [];
  for (const t of TEMPLATE_IDS) {
    if (!cfg.templates.includes(t)) continue;
    let r: Built;
    try {
      const g = BUILDERS[t](ctx);
      let step = g.next();
      while (!step.done) {
        busy += nowMs() - mark;
        yield;
        mark = nowMs();
        step = g.next();
      }
      r = step.value;
    } catch (e) {
      r = { skip: `помилка обчислення: ${(e as Error).message}` };
    }
    if ("q" in r) questions.push(r.q);
    else skipped.push({ template: t, reason: r.skip });
  }
  const out: TaskOutcome = {
    taskId,
    specId: ctx.spec.id,
    values: ctx.tv.values,
    questions,
    skipped,
    ms: busy + nowMs() - mark,
  };
  if (outcomeCache.size > 2000) outcomeCache.clear();
  outcomeCache.set(key, out);
  return out;
}

// =====================================================================================================================
// 8. Asynchronous generation in portions
// =====================================================================================================================

/** Віддати керування браузеру (MessageChannel — без 4-мс затримки setTimeout). */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

export interface VariantOutcome {
  cfg: VariantConfig;
  code: string;
  tasks: TaskOutcome[];
}

/**
 * Обчислює варіанти порціями (одна задача одного варіанта за раз), між порціями віддає керування браузеру.
 * `onProgress(done, total)`; `signal.aborted` — припинити (повертає те, що встигло).
 */
export async function computeVariants(
  cfgs: VariantConfig[],
  o: { onProgress?: (done: number, total: number) => void; signal?: { aborted: boolean } } = {},
): Promise<VariantOutcome[]> {
  const total = cfgs.reduce((s, c) => s + c.tasks.length, 0);
  let done = 0;
  const out: VariantOutcome[] = [];
  let last = nowMs();
  for (const cfg of cfgs) {
    const tasks: TaskOutcome[] = [];
    for (const t of cfg.tasks) {
      if (o.signal?.aborted) return out;
      // one task of one variant, in slices of SLICE_MS: the page stays responsive even for long references
      const g = taskOutcomeG(cfg, t);
      sliceDeadline = nowMs() + SLICE_MS;
      let r = g.next();
      while (!r.done) {
        sliceDeadline = Infinity;
        await yieldToMain();
        if (o.signal?.aborted) return out;
        sliceDeadline = nowMs() + SLICE_MS;
        r = g.next();
      }
      sliceDeadline = Infinity;
      tasks.push(r.value);
      done++;
      if (nowMs() - last > 30) {
        o.onProgress?.(done, total);
        await yieldToMain();
        last = nowMs();
      }
    }
    out.push({ cfg, code: encodeVariantCode(cfg), tasks });
  }
  o.onProgress?.(done, total);
  return out;
}

// =====================================================================================================================
// 9. Student answers
// =====================================================================================================================

const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };

/**
 * Розбір числа, як його вводять люди: кома або крапка, `1,23e-4`, `1.23E+4`, `1.23·10^-4`, `1.23*10^(-4)`,
 * `1.23×10⁻⁴`, `10^-3`, юнікодний мінус «−», пробіли (у т.ч. нерозривні) між групами цифр.
 */
export function parseAnswer(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  let s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "Порожньо — введіть число." };
  s = s
    .replace(/[\u2212\u2012\u2013\u2014]/g, "-")
    .replace(/[\s\u00a0\u2009\u202f]+/g, "")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => "^" + Array.from(m).map((c) => SUPERSCRIPTS[c]).join(""))
    .replace(/,/g, ".");
  const plain = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  if (plain.test(s)) {
    const v = Number(s);
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, error: "Число завелике." };
  }
  // 1.23·10^-4, 1.23*10^(-4), 1.23×10^-4, 1.23x10^-4, 10^-3, −10^-3
  const pow = /^([+-]?)((?:\d+\.?\d*|\.\d+)[*·×xх])?10\^\(?([+-]?\d+)\)?$/i.exec(s);
  if (pow) {
    const mant = pow[2] ? pow[2].slice(0, -1) : "1";
    const v = Number(`${pow[1]}${mant}e${pow[3]}`);
    if (Number.isFinite(v)) return { ok: true, value: v };
    return { ok: false, error: "Число завелике." };
  }
  if ((s.match(/\./g) ?? []).length > 1) return { ok: false, error: "Забагато десяткових роздільників: пишіть 1234,5 без розділення тисяч." };
  return { ok: false, error: "Не схоже на число. Приклади: 0,8414 · −2.5 · 1,62e-5 · 1.62·10^-5" };
}

export interface CheckResult {
  correct: boolean;
  /** |x − a| / |a| */
  relDev: number;
  /** x менше / більше за правильне */
  direction: "low" | "high" | "ok";
}

export function checkAnswer(q: Pick<Question, "answer" | "tol">, x: number): CheckResult {
  const a = q.answer;
  const relDev = Math.abs(x - a) / Math.abs(a);
  const correct = relDev <= q.tol * (1 + 1e-9);
  return { correct, relDev, direction: correct ? "ok" : x < a ? "low" : "high" };
}

/** Відхилення округлено до 1 значущої цифри (щоб воно підказувало напрям роботи, а не саму відповідь). */
export function roughDeviation(d: number): string {
  if (!Number.isFinite(d)) return "дуже велике";
  if (d === 0) return "0";
  if (d < 1e-15) return "< 10^-15";
  if (d >= 1e4) return `≈ 10^${Math.round(Math.log10(d))} разів`;
  if (d >= 10) return `≈ у ${sig(d, 1)} разів`;
  if (d >= 0.01) return `≈ ${sig(d * 100, 1)} %`;
  const e = Math.floor(Math.log10(d));
  const mnt = Math.round(d / 10 ** e);
  return mnt >= 10 ? `≈ 10^${e + 1}` : `≈ ${mnt}·10^${e}`;
}

// =====================================================================================================================
// 10. Helpers for the pages
// =====================================================================================================================

/** Компактне число для підписів: 0.038, 5.3e7, 1.2e-5. */
export const shortNumber = (x: number) => {
  if (x === 0) return "0";
  const r = Number(x.toPrecision(4));
  return Math.abs(r) >= 1e5 || Math.abs(r) < 1e-3 ? r.toExponential().replace("e+", "e") : String(r);
};

/** Короткий рядок параметрів варіанта для таблиць/CSV: «k1 = 0.031, k2 = 1.2e4, k3 = 5.3e7 · u1(0) = 1.3, … · T = 12». */
export function valuesSummary(spec: ProblemSpec, v: ResolvedValues, plan = V1_PLANS[spec.taskId]): string {
  const groups: string[] = [];
  const names = new Set((plan?.params ?? []).map((p) => p.name));
  const ps = spec.params.filter((p) => names.has(p.name)).map((p) => `${p.name} = ${shortNumber(v.params[p.name])}`);
  if (ps.length) groups.push(ps.join(", "));
  if (plan?.y0) groups.push(spec.vars.map((x, i) => `${x}(0) = ${shortNumber(v.y0[i])}`).join(", "));
  groups.push(`T = ${shortNumber(v.T)}`);
  return groups.join(" · ");
}

/** Методи і крок для «стартового коду» (без відповіді: крок і методи не ті, що в питанні «б»). */
export function starterCodeOptions(spec: ProblemSpec, v: ResolvedValues, questions: Question[]): { methods: MethodId[]; h: number; rtol: number; atol: number } {
  let h = spec.defaults?.h ?? (v.T - v.t0) / 1000;
  const b = questions.find((q) => q.template === "b");
  if (b?.meta?.h !== undefined && Math.abs(b.meta.h - h) <= 1e-12 * h) h /= 2;
  return { methods: ["euler", "rk4"], h, rtol: 1e-6, atol: 1e-9 };
}
