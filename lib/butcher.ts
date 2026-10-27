/**
 * Методи Рунге–Кутти, задані таблицею Батчера (c, A, b):
 * - розбір клітинок (вирази `lib/expr`: `1/3`, `sqrt(3)/6`, `1 - 1/sqrt(2)`, константи `pi`, `e`; змінних немає);
 * - класифікація: явний / DIRK / SDIRK / ESDIRK / повністю неявний; перевірка `c_i = Σ_j a_ij`;
 * - умови порядку до 5-го включно (17 кореневих дерев), порядок p, стадійний порядок q (умови C(q));
 * - функція стійкості R(z) = P(z)/Q(z) (точні коефіцієнти), R(∞), A- і L-стійкість, межі стійкості на осях;
 * - розв'язувач зі сталим кроком для довільної таблиці (явний — пряме обчислення стадій, неявний — метод Ньютона
 *   для повної системи стадій розміру s·n), що повертає `Solution`-сумісний об'єкт.
 *
 * @module butcher
 */
import { evaluate, findName, freeNames, isConstantName, parse, toTex, type Expr } from "./expr";
import { eigenvalues, luFactor, luSolve, type Mat, type Vec } from "./linalg";
import { denseOutput, numJac, type Problem, type RHS, type Solution } from "./ode";

/** Найбільша кількість стадій (DOPRI5 має 7). */
export const MAX_STAGES = 7;

// ---------------------------------------------------------------------------------------------------------------------
// Types and parsing
// ---------------------------------------------------------------------------------------------------------------------

/** Таблиця як рядки (те, що вводить студент і що зберігається в адресі). Порожній рядок = 0. */
export interface TableauSrc {
  s: number;
  c: string[];
  A: string[][];
  b: string[];
}

/** Числова таблиця. */
export interface Tableau {
  s: number;
  c: number[];
  A: number[][];
  b: number[];
}

export interface CellError {
  message: string;
  pos: number;
  end?: number;
}

export type CellResult = { ok: true; value: number; ast: Expr | null } | { ok: false; error: CellError };

export type CellRef = { kind: "c"; i: number } | { kind: "A"; i: number; j: number } | { kind: "b"; j: number };

/** Ключ клітинки: "c1", "a21", "b3" (індекси з 1). */
export const cellKey = (r: CellRef): string => (r.kind === "c" ? `c${r.i + 1}` : r.kind === "b" ? `b${r.j + 1}` : `a${r.i + 1}${r.j + 1}`);

/** Розбір однієї клітинки: число або вираз без змінних. Порожня клітинка — 0. */
export function parseCell(src: string): CellResult {
  if (src.trim() === "") return { ok: true, value: 0, ast: null };
  if (src.length > 80) return { ok: false, error: { message: "Задовгий вираз (більше 80 символів)", pos: 80, end: src.length } };
  const r = parse(src);
  if (!r.ok) return { ok: false, error: r.error };
  for (const name of freeNames(r.ast)) {
    if (!isConstantName(name)) {
      const pos = findName(r.ast, name)?.pos ?? 0;
      return {
        ok: false,
        error: { message: `Невідоме ім'я «${name}»: у таблиці лише числа, константи pi, e і функції (sqrt, exp, …)`, pos, end: pos + name.length },
      };
    }
  }
  let v: number;
  try {
    v = evaluate(r.ast, {});
  } catch (e) {
    return { ok: false, error: { message: (e as Error).message, pos: 0, end: src.length } };
  }
  if (!Number.isFinite(v)) return { ok: false, error: { message: "Значення не скінченне (ділення на нуль?)", pos: 0, end: src.length } };
  return { ok: true, value: v, ast: r.ast };
}

export interface ParsedTableau {
  /** null, якщо є хоча б одна помилка */
  tableau: Tableau | null;
  /** результат розбору кожної клітинки за ключем `cellKey` */
  cells: Record<string, CellResult>;
  errors: { ref: CellRef; key: string; error: CellError }[];
  /** c_i ≠ Σ_j a_ij (попередження, не помилка): індекс і сума рядка */
  rowSumMismatch: { i: number; c: number; rowSum: number }[];
}

export function parseTableau(src: TableauSrc): ParsedTableau {
  const s = src.s;
  const cells: Record<string, CellResult> = {};
  const errors: ParsedTableau["errors"] = [];
  const get = (ref: CellRef, text: string): number => {
    const key = cellKey(ref);
    const r = parseCell(text ?? "");
    cells[key] = r;
    if (!r.ok) {
      errors.push({ ref, key, error: r.error });
      return NaN;
    }
    return r.value;
  };
  const c: number[] = [];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < s; i++) {
    c.push(get({ kind: "c", i }, src.c[i]));
    const row: number[] = [];
    for (let j = 0; j < s; j++) row.push(get({ kind: "A", i, j }, src.A[i]?.[j]));
    A.push(row);
  }
  for (let j = 0; j < s; j++) b.push(get({ kind: "b", j }, src.b[j]));
  const rowSumMismatch: ParsedTableau["rowSumMismatch"] = [];
  if (!errors.length)
    for (let i = 0; i < s; i++) {
      const rs = A[i].reduce((a, v) => a + v, 0);
      if (Math.abs(rs - c[i]) > 1e-12 * Math.max(1, Math.abs(rs))) rowSumMismatch.push({ i, c: c[i], rowSum: rs });
    }
  return { tableau: errors.length ? null : { s, c, A, b }, cells, errors, rowSumMismatch };
}

/** Порожня таблиця з s стадій. */
export function emptySrc(s: number): TableauSrc {
  return { s, c: Array(s).fill(""), A: Array.from({ length: s }, () => Array(s).fill("")), b: Array(s).fill("") };
}

/** Змінити кількість стадій, зберігши наявні клітинки (лівий верхній кут). */
export function resizeSrc(src: TableauSrc, s: number): TableauSrc {
  const out = emptySrc(s);
  for (let i = 0; i < Math.min(s, src.s); i++) {
    out.c[i] = src.c[i] ?? "";
    out.b[i] = src.b[i] ?? "";
    for (let j = 0; j < Math.min(s, src.s); j++) out.A[i][j] = src.A[i]?.[j] ?? "";
  }
  return out;
}

/** Перевірка структури невідомого значення (напр. з адреси сторінки): чиста копія або null. */
export function sanitizeTableauSrc(x: unknown): TableauSrc | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const s = o.s;
  if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > MAX_STAGES) return null;
  const strs = (v: unknown, n: number): string[] | null =>
    Array.isArray(v) && v.length === n && v.every((e) => typeof e === "string" && e.length <= 80) ? (v as string[]).slice() : null;
  const c = strs(o.c, s);
  const b = strs(o.b, s);
  if (!c || !b || !Array.isArray(o.A) || o.A.length !== s) return null;
  const A: string[][] = [];
  for (const row of o.A) {
    const r = strs(row, s);
    if (!r) return null;
    A.push(r);
  }
  return { s, c, A, b };
}

export function sameSrc(a: TableauSrc, b: TableauSrc): boolean {
  const norm = (v: string) => v.replace(/\s+/g, "");
  if (a.s !== b.s) return false;
  for (let i = 0; i < a.s; i++) {
    if (norm(a.c[i]) !== norm(b.c[i]) || norm(a.b[i]) !== norm(b.b[i])) return false;
    for (let j = 0; j < a.s; j++) if (norm(a.A[i][j]) !== norm(b.A[i][j])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------------------------------

export type TableauKind = "explicit" | "dirk" | "sdirk" | "esdirk" | "implicit";

export const KIND_LABEL: Record<TableauKind, string> = {
  explicit: "явний",
  dirk: "діагонально-неявний (DIRK)",
  sdirk: "SDIRK (однакова діагональ)",
  esdirk: "ESDIRK (явна 1-а стадія, далі однакова діагональ)",
  implicit: "повністю неявний",
};

export function classify(t: Tableau): TableauKind {
  const { s, A } = t;
  for (let i = 0; i < s; i++) for (let j = i + 1; j < s; j++) if (A[i][j] !== 0) return "implicit";
  const d = A.map((r, i) => r[i]);
  if (d.every((v) => v === 0)) return "explicit";
  const eq = (x: number, y: number) => Math.abs(x - y) <= 1e-14 * Math.max(1, Math.abs(x));
  if (d.every((v) => v !== 0 && eq(v, d[0]))) return "sdirk";
  if (s >= 2 && d[0] === 0 && d.slice(1).every((v) => v !== 0 && eq(v, d[1]))) return "esdirk";
  return "dirk";
}

/** Чи метод жорстко точний: b_j = a_sj (тоді y₍ₙ₊₁₎ = останній стадії). */
export function isStifflyAccurate(t: Tableau): boolean {
  const last = t.A[t.s - 1];
  return t.b.every((v, j) => Math.abs(v - last[j]) <= 1e-14 * Math.max(1, Math.abs(v)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Order conditions (rooted trees up to order 5)
// ---------------------------------------------------------------------------------------------------------------------

/** Кореневе дерево: список піддерев-дітей; лист — порожній масив. */
export type Tree = Tree[];

const L: Tree = [];
const T = (...ch: Tree[]): Tree => ch;

export interface TreeInfo {
  tree: Tree;
  order: number;
  /** γ(τ): права частина умови 1/γ */
  gamma: number;
  /** умова в TeX (ліва частина) */
  tex: string;
}

const size = (t: Tree): number => 1 + t.reduce((a, ch) => a + size(ch), 0);
const gammaOf = (t: Tree): number => size(t) * t.reduce((a, ch) => a * gammaOf(ch), 1);

/** Усі 17 кореневих дерев порядку ≤ 5 з умовами в стандартному записі (c_i = Σ_j a_ij). */
export const TREES: TreeInfo[] = (
  [
    [L, "\\sum_i b_i"],
    [T(L), "\\sum_i b_i c_i"],
    [T(L, L), "\\sum_i b_i c_i^2"],
    [T(T(L)), "\\sum_{i,j} b_i a_{ij} c_j"],
    [T(L, L, L), "\\sum_i b_i c_i^3"],
    [T(L, T(L)), "\\sum_{i,j} b_i c_i a_{ij} c_j"],
    [T(T(L, L)), "\\sum_{i,j} b_i a_{ij} c_j^2"],
    [T(T(T(L))), "\\sum_{i,j,k} b_i a_{ij} a_{jk} c_k"],
    [T(L, L, L, L), "\\sum_i b_i c_i^4"],
    [T(L, L, T(L)), "\\sum_{i,j} b_i c_i^2 a_{ij} c_j"],
    [T(L, T(L, L)), "\\sum_{i,j} b_i c_i a_{ij} c_j^2"],
    [T(L, T(T(L))), "\\sum_{i,j,k} b_i c_i a_{ij} a_{jk} c_k"],
    [T(T(L), T(L)), "\\sum_{i} b_i \\big(\\textstyle\\sum_j a_{ij} c_j\\big)^2"],
    [T(T(L, L, L)), "\\sum_{i,j} b_i a_{ij} c_j^3"],
    [T(T(L, T(L))), "\\sum_{i,j,k} b_i a_{ij} c_j a_{jk} c_k"],
    [T(T(T(L, L))), "\\sum_{i,j,k} b_i a_{ij} a_{jk} c_k^2"],
    [T(T(T(T(L)))), "\\sum_{i,j,k,l} b_i a_{ij} a_{jk} a_{kl} c_l"],
  ] as [Tree, string][]
).map(([tree, tex]) => ({ tree, order: size(tree), gamma: gammaOf(tree), tex }));

/** Кількість умов для порядку p (накопичено): 1, 2, 4, 8, 17. */
export const CONDITIONS_UP_TO = [0, 1, 2, 4, 8, 17];

const matVec = (A: Mat, v: Vec): Vec => A.map((r) => r.reduce((a, x, j) => a + x * v[j], 0));
const dot = (a: Vec, b: Vec): number => a.reduce((acc, x, i) => acc + x * b[i], 0);

/**
 * Варіанти вектора g(τ)_i = Π_дітей (A·g(дитина))_i. Для листа A·g(лист) = A·1; якщо задане c відрізняється від A·1,
 * лист може бути й «часовим» (c) — це умови для неавтономних задач (двоколірні дерева з «часовими» листками).
 */
function gVariants(t: Tree, A: Mat, leafVecs: Vec[]): Vec[] {
  const s = A.length;
  let acc: Vec[] = [Array(s).fill(1)];
  for (const ch of t) {
    const opts: Vec[] = ch.length === 0 ? leafVecs : gVariants(ch, A, leafVecs).map((v) => matVec(A, v));
    const next: Vec[] = [];
    for (const a of acc) for (const o of opts) next.push(a.map((x, i) => x * o[i]));
    acc = next;
  }
  return acc;
}

export interface OrderCondition extends TreeInfo {
  /** Φ(τ) з c = A·1 */
  value: number;
  /** max |Φ − 1/γ| з усіх варіантів (A·1 і задане c) */
  residual: number;
  /** нев'язка лише для автономних задач (c = A·1) */
  residualAut: number;
  ok: boolean;
}

export const ORDER_TOL = 1e-12;

export interface OrderInfo {
  conditions: OrderCondition[];
  /** порядок (усі умови до p ≤ 1e-12); 5 означає «≥ 5» */
  p: number;
  /** порядок лише для автономних задач (c = A·1) */
  pAut: number;
  /** перевірено до 5-го включно: p = 5 означає «принаймні 5» */
  atLeast: boolean;
  /** стадійний порядок q: найбільше q, для якого виконано B(q) і C(q) */
  q: number;
  /** чи c = A·1 */
  rowSumsOk: boolean;
}

export function orderInfo(t: Tableau): OrderInfo {
  const { A, b, c } = t;
  const A1 = A.map((r) => r.reduce((a, v) => a + v, 0));
  const rowSumsOk = c.every((v, i) => Math.abs(v - A1[i]) <= 1e-12 * Math.max(1, Math.abs(v)));
  const leafAll = rowSumsOk ? [A1] : [A1, c];
  const conditions: OrderCondition[] = TREES.map((ti) => {
    const target = 1 / ti.gamma;
    const aut = gVariants(ti.tree, A, [A1]).map((g) => dot(b, g));
    const all = rowSumsOk ? aut : gVariants(ti.tree, A, leafAll).map((g) => dot(b, g));
    const residualAut = Math.max(...aut.map((v) => Math.abs(v - target)));
    const residual = Math.max(...all.map((v) => Math.abs(v - target)));
    return { ...ti, value: aut[0], residual, residualAut, ok: residual <= ORDER_TOL };
  });
  const orderOf = (key: "residual" | "residualAut") => {
    let p = 0;
    for (let k = 1; k <= 5; k++) {
      if (conditions.filter((x) => x.order === k).every((x) => x[key] <= ORDER_TOL)) p = k;
      else break;
    }
    return p;
  };
  const p = orderOf("residual");
  const pAut = orderOf("residualAut");
  // stage order (Hairer–Wanner IV.15): the largest q with B(q) and C(q):
  //   B(k): Σ_i b_i c_i^{k−1} = 1/k,   C(k): Σ_j a_ij c_j^{k−1} = c_i^k / k for all i
  let q = 0;
  for (let k = 1; k <= Math.min(2 * t.s, 10); k++) {
    const B = Math.abs(b.reduce((a, v, i) => a + v * Math.pow(c[i], k - 1), 0) - 1 / k) <= ORDER_TOL;
    const Ck = A.every((row, i) => {
      const lhs = row.reduce((a, v, j) => a + v * Math.pow(c[j], k - 1), 0);
      return Math.abs(lhs - Math.pow(c[i], k) / k) <= ORDER_TOL;
    });
    if (B && Ck) q = k;
    else break;
  }
  return { conditions, p, pAut, atLeast: p === 5, q, rowSumsOk };
}

// ---------------------------------------------------------------------------------------------------------------------
// Polynomials
// ---------------------------------------------------------------------------------------------------------------------

/** Многочлен: коефіцієнти від молодшого степеня. */
export type Poly = number[];

export type Cx = [number, number];

export function polyEval(p: Poly, x: number): number {
  let r = 0;
  for (let k = p.length - 1; k >= 0; k--) r = r * x + p[k];
  return r;
}

export function polyEvalC(p: Poly, z: Cx): Cx {
  let re = 0,
    im = 0;
  for (let k = p.length - 1; k >= 0; k--) {
    const nr = re * z[0] - im * z[1] + p[k];
    im = re * z[1] + im * z[0];
    re = nr;
  }
  return [re, im];
}

function polyMul(a: Poly, b: Poly): Poly {
  const out = Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

const polySub = (a: Poly, b: Poly): Poly => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) - (b[i] ?? 0));

/** Обрізати старші нульові коефіцієнти (|x| ≤ tol·max|коеф|). */
function trim(p: Poly, rel = 1e-13): Poly {
  const m = Math.max(...p.map(Math.abs), 0);
  const out = p.map((v) => (Math.abs(v) <= rel * m ? 0 : v));
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

const degree = (p: Poly) => p.length - 1;

/** Визначник малої матриці (Гаусс із вибором головного елемента). */
function det(M: Mat): number {
  const n = M.length;
  if (n === 0) return 1;
  const a = M.map((r) => r.slice());
  let d = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[p][k])) p = i;
    if (a[p][k] === 0) return 0;
    if (p !== k) {
      [a[p], a[k]] = [a[k], a[p]];
      d = -d;
    }
    d *= a[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = a[i][k] / a[k][k];
      if (f !== 0) for (let j = k; j < n; j++) a[i][j] -= f * a[k][j];
    }
  }
  return d;
}

/** Суми головних мінорів порядку k (k = 0…n): det(I + tM) = Σ_k E_k t^k. */
function principalMinorSums(M: Mat): number[] {
  const n = M.length;
  const E = Array(n + 1).fill(0);
  for (let mask = 0; mask < 1 << n; mask++) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i);
    E[idx.length] += det(idx.map((i) => idx.map((j) => M[i][j])));
  }
  return E;
}

/** det(I − zM) як многочлен від z. */
export function detIminusZ(M: Mat): Poly {
  return principalMinorSums(M).map((e, k) => (k % 2 ? -e : e));
}

/** Корені многочлена (через власні числа супровідної матриці). */
export function polyRoots(p: Poly): Cx[] {
  const q = trim(p, 1e-15);
  const d = degree(q);
  if (d < 1) return [];
  const lead = q[d];
  const C: Mat = Array.from({ length: d }, () => Array(d).fill(0));
  for (let j = 0; j < d; j++) C[0][j] = -q[d - 1 - j] / lead;
  for (let i = 1; i < d; i++) C[i][i - 1] = 1;
  try {
    return eigenvalues(C).map((e) => [e.re, e.im] as Cx);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stability function
// ---------------------------------------------------------------------------------------------------------------------

/** Невід'ємність многочлена на (0, ∞): перша точка, де він стає від'ємним (null — ніде). */
function firstNegative(F: Poly): { nonNeg: boolean; first: number | null } {
  const f = trim(F, 1e-12);
  if (f.every((v) => v === 0)) return { nonNeg: true, first: null };
  // lowest nonzero coefficient decides the sign near 0
  const low = f.findIndex((v) => v !== 0);
  if (f[low] < 0) return { nonNeg: false, first: 0 };
  const scale = (x: number) => f.reduce((a, v, k) => a + Math.abs(v) * Math.pow(x, k), 0);
  const neg = (x: number) => polyEval(f, x) < -1e-12 * scale(x);
  const pts: number[] = [];
  for (let k = 0; k <= 2400; k++) pts.push(Math.pow(10, -8 + (20 * k) / 2400));
  for (const [re, im] of polyRoots(f)) {
    if (re > 0 && Math.abs(im) <= 1e-6 * (1 + Math.abs(re))) pts.push(re * (1 - 1e-6), re * (1 + 1e-6), re * (1 - 1e-3), re * (1 + 1e-3));
  }
  pts.sort((a, b) => a - b);
  let prev = 0;
  for (const x of pts) {
    if (neg(x)) {
      // bisect between the last non-negative point and x
      let lo = prev,
        hi = x;
      for (let it = 0; it < 200 && hi - lo > 1e-15 * hi; it++) {
        const m = (lo + hi) / 2;
        if (neg(m)) hi = m;
        else lo = m;
      }
      return { nonNeg: false, first: lo };
    }
    prev = x;
  }
  // beyond the sampled range: the leading coefficient decides
  if (f[f.length - 1] < 0) return { nonNeg: false, first: pts[pts.length - 1] };
  return { nonNeg: true, first: null };
}

export interface StabilityInfo {
  /** R(z) = P(z)/Q(z), коефіцієнти від молодшого степеня */
  P: Poly;
  Q: Poly;
  /** R(∞): Infinity для многочлена степеня ≥ 1 */
  rInf: number;
  /** 1 − bᵀA⁻¹1, якщо A невироджена (перевірка R(∞)) */
  rInfFormula: number | null;
  /** полюси R (корені Q, без скорочених із P) */
  poles: Cx[];
  /** скорочені спільні корені P і Q */
  removable: Cx[];
  polesRight: boolean;
  /** E(y) = |Q(iy)|² − |P(iy)|² як многочлен від x = y² */
  E: Poly;
  /** E(x) ≥ 0 для всіх x ≥ 0 (аналітично: корені + знак на проміжках) */
  imagOk: boolean;
  /** max |R(iy)| на щільній сітці */
  imagMaxNumeric: number;
  aStable: boolean;
  lStable: boolean;
  /** межа на дійсній від'ємній півосі: |R(x)| ≤ 1 для x ∈ [−realBound, 0] */
  realBound: number;
  /** межа на уявній осі: |R(iy)| ≤ 1 для |y| ≤ imagBound */
  imagBound: number;
  /** R — многочлен (явний метод) */
  polynomial: boolean;
}

export function stabilityInfo(t: Tableau): StabilityInfo {
  const { s, A, b } = t;
  // Q(z) = det(I − zA) from sums of principal minors of A
  const Qraw = detIminusZ(A);
  // R(z) = 1 + z bᵀ(I − zA)⁻¹1 = 1 + Σ_{k≥1} (bᵀA^{k−1}1) z^k; P = Q·R is a polynomial of degree ≤ s, so the
  // product of the series truncated at degree s is exact
  const r: number[] = [1];
  let v: Vec = Array(s).fill(1);
  for (let k = 1; k <= s; k++) {
    r.push(dot(b, v));
    v = matVec(A, v);
  }
  const Praw: Poly = [];
  for (let m = 0; m <= s; m++) {
    let acc = 0;
    for (let k = 0; k <= m; k++) acc += Qraw[k] * r[m - k];
    Praw.push(acc);
  }
  const P = trim(Praw);
  const Q = trim(Qraw);
  const polynomial = degree(Q) === 0;
  // R(∞)
  let rInf: number;
  if (degree(P) > degree(Q)) rInf = Infinity * Math.sign(P[P.length - 1] / Q[Q.length - 1]);
  else if (degree(P) === degree(Q)) rInf = P[P.length - 1] / Q[Q.length - 1];
  else rInf = 0;
  let rInfFormula: number | null = null;
  const lu = luFactor(A);
  if (!lu.singular && Math.min(...lu.lu.map((row, i) => Math.abs(row[i]))) > 1e-12) {
    const x = luSolve(lu, Array(s).fill(1));
    rInfFormula = 1 - dot(b, x);
  }
  // poles: z = 1/λ for nonzero eigenvalues λ of A (Q(z) = Π(1 − zλ))
  const lower = A.every((row, i) => row.every((x, j) => j <= i || x === 0));
  const ev: Cx[] = lower ? A.map((row, i) => [row[i], 0] as Cx) : eigenvalues(A).map((e) => [e.re, e.im] as Cx);
  const poles: Cx[] = [];
  const removable: Cx[] = [];
  for (const [re, im] of ev) {
    const m2 = re * re + im * im;
    if (m2 <= 1e-24) continue;
    const z: Cx = [re / m2, -im / m2];
    const pz = polyEvalC(P, z);
    const sc = P.reduce((a, c, k) => a + Math.abs(c) * Math.pow(Math.hypot(z[0], z[1]), k), 0);
    if (Math.hypot(pz[0], pz[1]) <= 1e-9 * sc) removable.push(z);
    else poles.push(z);
  }
  const polesRight = poles.every(([re, im]) => re > 1e-12 * Math.hypot(re, im));
  // E(x), x = y²: e_n = (−1)^n Σ_{j+k=2n} (−1)^k (q_j q_k − p_j p_k)
  const d = Math.max(P.length, Q.length);
  const E: Poly = [];
  for (let n = 0; 2 * n <= 2 * (d - 1); n++) {
    let acc = 0,
      sc = 0;
    for (let j = 0; j <= 2 * n; j++) {
      const k = 2 * n - j;
      const qq = (Q[j] ?? 0) * (Q[k] ?? 0),
        pp = (P[j] ?? 0) * (P[k] ?? 0);
      acc += (k % 2 ? -1 : 1) * (qq - pp);
      sc += Math.abs(qq) + Math.abs(pp);
    }
    acc *= n % 2 ? -1 : 1;
    E.push(Math.abs(acc) <= 1e-12 * sc ? 0 : acc);
  }
  const imag = firstNegative(E);
  const imagBound = imag.nonNeg ? Infinity : Math.sqrt(imag.first ?? 0);
  // numeric check on a dense grid of the imaginary axis
  let imagMaxNumeric = 0;
  for (let k = 0; k <= 4000; k++) {
    const y = Math.pow(10, -4 + (8 * k) / 4000);
    imagMaxNumeric = Math.max(imagMaxNumeric, absR(P, Q, [0, y]));
  }
  // real negative axis: H(u) = Q(−u)² − P(−u)² ≥ 0 for u > 0
  const neg = (p: Poly) => p.map((c, k) => (k % 2 ? -c : c));
  const H = polySub(polyMul(neg(Q), neg(Q)), polyMul(neg(P), neg(P)));
  const real = firstNegative(H);
  const realBound = real.nonNeg ? Infinity : (real.first ?? 0);
  // a constant R (degenerate «method») is A-stable iff |R| ≤ 1; a non-constant polynomial never is
  const constant = degree(P) === 0 && degree(Q) === 0;
  const aStable = constant ? Math.abs(P[0] / Q[0]) <= 1 : !polynomial && polesRight && imag.nonNeg;
  const lStable = aStable && rInf === 0;
  return { P, Q, rInf, rInfFormula, poles, removable, polesRight, E, imagOk: imag.nonNeg, imagMaxNumeric, aStable, lStable, realBound, imagBound, polynomial };
}

/** |R(z)| для комплексного z. */
export function absR(P: Poly, Q: Poly, z: Cx): number {
  const p = polyEvalC(P, z),
    q = polyEvalC(Q, z);
  return Math.hypot(p[0], p[1]) / Math.hypot(q[0], q[1]);
}

/** R(x) для дійсного x. */
export function realR(P: Poly, Q: Poly, x: number): number {
  return polyEval(P, x) / polyEval(Q, x);
}

// ---------------------------------------------------------------------------------------------------------------------
// TeX
// ---------------------------------------------------------------------------------------------------------------------

/** Найпростіший дріб p/q (q ≤ maxDen), що дорівнює x з точністю 1e-12 відносно; null — немає. */
export function asFraction(x: number, maxDen = 100000): [number, number] | null {
  if (!Number.isFinite(x)) return null;
  if (Number.isInteger(x)) return [x, 1];
  const sgn = Math.sign(x);
  const a = Math.abs(x);
  let h0 = 0,
    h1 = 1,
    k0 = 1,
    k1 = 0,
    y = a;
  for (let it = 0; it < 40; it++) {
    const ai = Math.floor(y);
    const h2 = ai * h1 + h0,
      k2 = ai * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(a - h1 / k1) <= 1e-12 * Math.max(1, a)) return [sgn * h1, k1];
    const frac = y - ai;
    if (frac < 1e-15) break;
    y = 1 / frac;
  }
  return null;
}

/** Число для TeX: дріб, якщо він простий, інакше 6 значущих цифр. */
export function numTex(x: number): string {
  const fr = asFraction(x, 20000);
  if (fr) {
    const [p, q] = fr;
    if (q === 1) return String(p);
    return `${p < 0 ? "-" : ""}\\tfrac{${Math.abs(p)}}{${q}}`;
  }
  const s = Number(x.toPrecision(6)).toString();
  const m = /^(-?[\d.]+)e([+-]\d+)$/.exec(s);
  return m ? `${m[1]}\\cdot 10^{${Number(m[2])}}` : s;
}

/** Многочлен у TeX: `1 + z + \tfrac{z^{2}}{2}`. */
export function polyTex(p: Poly, v = "z"): string {
  const terms: string[] = [];
  p.forEach((c, k) => {
    if (c === 0) return;
    const pw = k === 0 ? "" : k === 1 ? v : `${v}^{${k}}`;
    const neg = c < 0;
    const a = Math.abs(c);
    let body: string;
    if (k === 0) body = numTex(a);
    else if (Math.abs(a - 1) <= 1e-14) body = pw;
    else {
      const fr = asFraction(a, 20000);
      body = fr && fr[0] === 1 ? `\\tfrac{${pw}}{${fr[1]}}` : `${numTex(a)}\\,${pw}`;
    }
    terms.push(`${neg ? "-" : "+"} ${body}`);
  });
  if (!terms.length) return "0";
  const s = terms.join(" ");
  return s.startsWith("+ ") ? s.slice(2) : s.replace(/^- /, "-");
}

export function stabilityTex(st: Pick<StabilityInfo, "P" | "Q">): string {
  const P = polyTex(st.P),
    Q = polyTex(st.Q);
  return st.Q.length === 1 && st.Q[0] === 1 ? `R(z) = ${P}` : `R(z) = \\dfrac{${P}}{${Q}}`;
}

/** Таблиця Батчера як KaTeX-масив (з виразів клітинок, а не з чисел). */
export function tableauTex(src: TableauSrc): string {
  const cell = (text: string) => {
    const r = parseCell(text ?? "");
    if (!r.ok) return "\\color{red}{?}";
    return r.ast ? toTex(r.ast) : "0";
  };
  const s = src.s;
  const rows: string[] = [];
  for (let i = 0; i < s; i++) rows.push([cell(src.c[i]), ...src.A[i].map(cell)].join(" & "));
  const body = rows.join(" \\\\[2pt] ");
  return `\\begin{array}{c|${"c".repeat(s)}} ${body} \\\\[2pt] \\hline & ${src.b.map(cell).join(" & ")} \\end{array}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixed-step solver
// ---------------------------------------------------------------------------------------------------------------------

export interface ButcherSolveOptions {
  h: number;
  /** поріг «вибуху» |y_i| (за замовчуванням 1e10, як у ядрі) */
  blowup?: number;
  /** найбільша кількість кроків (відмова, якщо N більше) */
  maxSteps?: number;
  /** бюджет обчислень f для неявної таблиці (за замовчуванням 600 000): далі — зупинка, щоб сторінка не зависала */
  maxFevals?: number;
}

export interface ButcherSolution extends Omit<Solution, "method"> {
  method: "butcher";
  implicit: boolean;
  /** усього ітерацій Ньютона */
  newtonIters: number;
  /** кількість LU-розкладів матриці sn × sn */
  lus: number;
  /** кроків, де Ньютон стартував продовженням за параметром (звичайні початкові наближення не спрацювали) */
  newtonRescues: number;
  /** Ньютон не збігся (чесна відмова) */
  newtonFailed?: boolean;
  blewUp?: boolean;
}

/** Як `denseOutput` з ядра (кубічна інтерполяція Ерміта) для розв'язку конструктора. */
export function butcherDense(sol: ButcherSolution, f: RHS): (t: number) => Vec {
  return denseOutput(sol as unknown as Solution, f);
}

class Counter {
  fe = 0;
  je = 0;
  private p: Problem;
  constructor(p: Problem) {
    this.p = p;
  }
  f = (t: number, y: Vec): Vec => {
    this.fe++;
    return this.p.f(t, y);
  };
  J = (t: number, y: Vec): Mat => {
    this.je++;
    if (this.p.jac) return this.p.jac(t, y);
    this.fe += y.length + 1;
    return numJac(this.p.f, t, y);
  };
}

const finiteVec = (v: Vec) => v.every((x) => Number.isFinite(x));

/**
 * Розв'язує задачу методом Рунге–Кутти з таблиці зі сталим кроком h = (T − t0)/N, N = round((T − t0)/h).
 * Явна таблиця — стадії обчислюються по черзі (непотрібні стадії з b_i = 0, від яких ніхто не залежить, пропускаються).
 * Неявна — метод Ньютона для повної системи стадій Z = h(A ⊗ I)F(y + Z) розміру s·n: матриця I − h(A ⊗ J) з блоками
 * δᵢⱼI − h aᵢⱼ J(tₙ + cⱼh, Yⱼ) у початковому наближенні (Yᵢ = yₙ, потім — прирости попереднього кроку), заморожена, поки ітерації швидко
 * збігаються (спрощений Ньютон), і оновлювана щоітерації із загасанням кроку, коли ні (повний Ньютон); якщо обидва
 * старти не вдалися — продовження за параметром σ (σh замість h, σ: 0 → 1) і кілька стартів уздовж поля
 * Zᵢ = k·cᵢh·f(tₙ, yₙ) (як у ядрі для «складок» релаксаційних коливань). Розв'язуються ті самі рівняння стадій,
 * змінюється лише початкове наближення. Якщо Ньютон так і не збігся — чесна відмова (`failed`, `newtonFailed`),
 * без підміни методу і без дроблення кроку.
 */
export function solveButcher(tab: Tableau, p: Problem, o: ButcherSolveOptions): ButcherSolution {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const t0 = p.t0 ?? 0;
  const N = Math.max(1, Math.round((p.T - t0) / o.h));
  const h = (p.T - t0) / N;
  const limit = o.blowup ?? 1e10;
  const kind = classify(tab);
  const implicit = kind !== "explicit";
  const sol: ButcherSolution = {
    method: "butcher",
    t: [t0],
    y: [p.y0.slice()],
    hs: [],
    steps: 0,
    rejected: 0,
    fevals: 0,
    jevals: 0,
    ms: 0,
    implicit,
    newtonIters: 0,
    lus: 0,
    newtonRescues: 0,
  };
  const done = () => {
    sol.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
    return sol;
  };
  if (o.maxSteps && N > o.maxSteps) {
    sol.failed = `Забагато кроків: N = ${N} > ${o.maxSteps} — збільште h`;
    return done();
  }
  const C = new Counter(p);
  const { s, A, b, c } = tab;
  const n = p.y0.length;
  let y = p.y0.slice();
  let t = t0;

  if (!implicit) {
    // stages that matter: b_i ≠ 0 or used by a later needed stage
    const need = Array(s).fill(false);
    for (let i = s - 1; i >= 0; i--) {
      if (b[i] !== 0) need[i] = true;
      else for (let k = i + 1; k < s; k++) if (need[k] && A[k][i] !== 0) need[i] = true;
    }
    for (let step = 0; step < N; step++) {
      const K: Vec[] = [];
      for (let i = 0; i < s; i++) {
        if (!need[i]) {
          K.push(Array(n).fill(0));
          continue;
        }
        const Y = y.slice();
        for (let j = 0; j < i; j++) {
          const a = A[i][j];
          if (a !== 0) for (let k = 0; k < n; k++) Y[k] += h * a * K[j][k];
        }
        K.push(C.f(t + c[i] * h, Y));
      }
      const yn = y.slice();
      for (let i = 0; i < s; i++) if (b[i] !== 0) for (let k = 0; k < n; k++) yn[k] += h * b[i] * K[i][k];
      y = yn;
      t = t0 + (step + 1) * h;
      sol.t.push(t);
      sol.y.push(y);
      sol.hs.push(h);
      sol.steps++;
      if (y.some((v) => !Number.isFinite(v) || Math.abs(v) > limit)) {
        sol.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
        sol.blewUp = true;
        break;
      }
    }
    sol.fevals = C.fe;
    sol.jevals = C.je;
    return done();
  }

  // ---------------- implicit: Newton for the full stage system
  const S = s * n;
  const stiffAcc = isStifflyAccurate(tab);
  let dvec: Vec | null = null;
  if (!stiffAcc) {
    // dᵀ = bᵀA⁻¹ ⇒ y₍ₙ₊₁₎ = yₙ + Σ dᵢ Zᵢ (no extra f-evaluations, no amplification of Newton errors)
    const At = A[0].map((_, j) => A.map((r) => r[j]));
    const lu = luFactor(At);
    if (!lu.singular && Math.min(...lu.lu.map((row, i) => Math.abs(row[i]))) > 1e-12) dvec = luSolve(lu, b);
  }
  let Zprev: Vec | null = null;
  // the continuation start-up is expensive; a run that needs it on many steps is hopeless — give up early
  const MAX_RESCUES = 10;
  let rescues = 0;
  const stageF = (tt: number, yy: Vec, Z: Vec): Vec[] => {
    const F: Vec[] = [];
    for (let i = 0; i < s; i++) {
      const Y = yy.map((v, k) => v + Z[i * n + k]);
      F.push(C.f(tt + c[i] * h, Y));
    }
    return F;
  };
  /** G(Z) = Z − σh(A ⊗ I)F; σ = 1 is the method itself, σ < 1 is used only by the continuation start-up */
  const resid = (Z: Vec, F: Vec[], sig: number): Vec => {
    const G = Z.slice();
    for (let i = 0; i < s; i++)
      for (let j = 0; j < s; j++) {
        const a = A[i][j];
        if (a !== 0) for (let k = 0; k < n; k++) G[i * n + k] -= sig * h * a * F[j][k];
      }
    return G;
  };

  /**
   * One Newton solve of G(Z) = Z − h(A ⊗ I)F(y + Z) = 0 from the guess Z0; null when it fails.
   * Residual in the fixed weights 1 + |y_k| (RMS norm), steps accepted only when they decrease it
   * (the full steps are damped); converged when the increment is < 1e-10 relative to every stage component and
   * < 1e-11 in the weights — the same test as the core's Newton for the implicit Euler / trapezoidal steps.
   */
  const newton = (tt: number, yy: Vec, Z0: Vec, sig = 1): { Z: Vec; F: Vec[] } | null => {
    let Z = Z0.slice();
    let F = stageF(tt, yy, Z);
    if (!F.every(finiteVec)) return null;
    let G = resid(Z, F, sig);
    const W = Array.from({ length: S }, (_, i) => 1 + Math.abs(yy[i % n]));
    // weighted RMS norm: the Newton direction is a descent direction for it (for the max-norm it need not be,
    // and the damped iteration could stall at a «corner» of the max-norm level set)
    const rnorm = (Gv: Vec) => Math.sqrt(Gv.reduce((m, g, i) => m + (g / W[i]) * (g / W[i]), 0) / S);
    let r = rnorm(G);
    const build = (Js: Mat[]): Mat => {
      const M: Mat = Array.from({ length: S }, () => Array(S).fill(0));
      for (let i = 0; i < s; i++)
        for (let j = 0; j < s; j++) {
          const a = A[i][j];
          const Jj = Js[j];
          for (let k = 0; k < n; k++) {
            for (let l = 0; l < n; l++) M[i * n + k][j * n + l] = (i === j && k === l ? 1 : 0) - (a !== 0 ? sig * h * a * Jj[k][l] : 0);
          }
        }
      return M;
    };
    const stageJ = (Zc: Vec) => Array.from({ length: s }, (_, j) => C.J(tt + c[j] * h, yy.map((v, k) => v + Zc[j * n + k])));
    // Newton matrix with blocks δᵢⱼI − σh aᵢⱼ J(tₙ + cⱼh, Yⱼ) at the initial guess; it is kept frozen (simplified Newton)
    // while the iteration contracts fast and refreshed every iteration (full Newton, damped) otherwise.
    // (J at (tₙ, yₙ) alone is not enough: e.g. for y′ = −2t·y² it vanishes at t = 0, and the very first step of the
    // implicit Euler with h = 1 jumps straight onto the spurious root of the stage equation.)
    let full = false;
    let lu = luFactor(build(stageJ(Z)));
    sol.lus++;
    let prevRel = Infinity;
    for (let it = 0; it < 60; it++) {
      if (lu.singular) {
        if (full) return null;
        full = true;
        lu = luFactor(build(stageJ(Z)));
        sol.lus++;
        continue;
      }
      const dz = luSolve(lu, G.map((g) => -g));
      if (!finiteVec(dz)) return null;
      let lam = 1;
      let Zt: Vec = Z,
        Ft: Vec[] = F,
        Gt: Vec = G,
        rt = Infinity;
      let accepted = false;
      for (let k = 0; k < (full ? 24 : 1); k++) {
        Zt = Z.map((v, i) => v + lam * dz[i]);
        Ft = stageF(tt, yy, Zt);
        if (Ft.every(finiteVec)) {
          Gt = resid(Zt, Ft, sig);
          rt = rnorm(Gt);
          // at round-off level the residual can no longer measure progress: take the full step
          if (Number.isFinite(rt) && (rt < r || (lam === 1 && r < 1e-12))) {
            accepted = true;
            break;
          }
        }
        lam /= 2;
      }
      sol.newtonIters++;
      if (!accepted) {
        if (!full) {
          // the simplified step does not decrease the residual (wrong direction, other branch of the root):
          // switch to the damped full Newton from the old iterate
          full = true;
          lu = luFactor(build(stageJ(Z)));
          sol.lus++;
          continue;
        }
        return null;
      }
      let dAbs = 0,
        dRel = 0;
      for (let i = 0; i < S; i++) {
        const d = lam * Math.abs(dz[i]);
        dAbs = Math.max(dAbs, d / W[i]);
        dRel = Math.max(dRel, d / (Math.abs(yy[i % n] + Zt[i]) + 1e-200));
      }
      Z = Zt;
      F = Ft;
      G = Gt;
      r = rt;
      if (lam === 1 && dAbs < 1e-11 && dRel < 1e-10) return { Z, F };
      // round-off floor: the residual is at noise level and the increment stopped shrinking
      if (full && lam === 1 && r < 1e-12 && dAbs < 1e-11 && dRel >= 0.5 * prevRel) return { Z, F };
      // tiny components (≪ 1e-12 of the state) can stay noisy relative to themselves for ever: once the residual and
      // the absolute increment are at round-off level and the relative one stopped shrinking, accept
      if (lam === 1 && r < 1e-13 && dAbs < 1e-14 && dRel >= 0.5 * prevRel && it >= 3) return { Z, F };
      const theta = dRel / prevRel;
      prevRel = dRel;
      if (!full && (theta > 0.3 || it >= 8)) full = true;
      if (full) {
        lu = luFactor(build(stageJ(Z)));
        sol.lus++;
      }
    }
    return r < 1e-8 ? { Z, F } : null;
  };

  /**
   * Start-up by continuation in the weight σ: Z = 0 solves the system for σ = 0; σ is increased to 1 step by step,
   * each solution seeding the next Newton solve. Only the INITIAL GUESS changes — the equations at σ = 1 are the
   * method's own (as the core seeds hard implicit steps with sub-steps).
   */
  const continuation = (tt: number, yy: Vec): { Z: Vec; F: Vec[] } | null => {
    let Z: Vec = Array(S).fill(0);
    let sg = 0,
      ds = 0.25;
    for (let guard = 0; guard < 30 && sg < 1; guard++) {
      const sn = Math.min(1, sg + ds);
      const r = newton(tt, yy, Z, sn);
      if (r) {
        Z = r.Z;
        sg = sn;
        if (sg >= 1) return r;
        ds = Math.min(2 * ds, 1 - sg);
      } else {
        ds /= 2;
        if (ds < 1 / 256) return null;
      }
    }
    return null;
  };

  for (let step = 0; step < N; step++) {
    // first guess Yᵢ = yₙ (Z = 0), as the core does; extrapolating the previous increments is a worse default: for an
    // oscillating (non-L-stable) solution it can point to another root of the stage equations (e.g. negative u₂ in Robertson)
    let res = newton(t, y, Array(S).fill(0));
    if (!res && Zprev) res = newton(t, y, Zprev);
    if (!res && rescues < MAX_RESCUES) {
      rescues++;
      sol.newtonRescues++;
      res = continuation(t, y);
      // multi-start along the vector field: when the root sits on another branch of a slow manifold (fold of a
      // relaxation oscillation), nearby guesses get stuck — try Zᵢ = k·cᵢh·f(tₙ, yₙ), k = 1, 2, 4, …, 64 (as the core does)
      if (!res) {
        const f0 = C.f(t, y);
        for (let k = 1; k <= 64 && !res; k *= 2) {
          const Z0: Vec = [];
          for (let i = 0; i < s; i++) for (let l = 0; l < n; l++) Z0.push(k * c[i] * h * f0[l]);
          if (!finiteVec(Z0)) break;
          res = newton(t, y, Z0);
        }
      }
    }
    if (!res) {
      sol.failed = `Метод Ньютона не збігся при t ≈ ${t.toPrecision(4)} (крок h = ${h.toPrecision(3)})`;
      sol.newtonFailed = true;
      break;
    }
    if (C.fe > (o.maxFevals ?? 600000)) {
      sol.failed = `Метод Ньютона збігається надто повільно (понад ${o.maxFevals ?? 600000} обчислень f) — зупинено при t ≈ ${t.toPrecision(4)}`;
      sol.newtonFailed = true;
      break;
    }
    const { Z, F } = res;
    let yn: Vec;
    if (stiffAcc) yn = y.map((v, k) => v + Z[(s - 1) * n + k]);
    else if (dvec) {
      const d = dvec;
      yn = y.map((v, k) => {
        let acc = v;
        for (let i = 0; i < s; i++) if (d[i] !== 0) acc += d[i] * Z[i * n + k];
        return acc;
      });
    } else
      yn = y.map((v, k) => {
        let acc = v;
        for (let i = 0; i < s; i++) if (b[i] !== 0) acc += h * b[i] * F[i][k];
        return acc;
      });
    Zprev = Z;
    y = yn;
    t = t0 + (step + 1) * h;
    sol.t.push(t);
    sol.y.push(y);
    sol.hs.push(h);
    sol.steps++;
    if (y.some((v) => !Number.isFinite(v) || Math.abs(v) > limit)) {
      sol.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
      sol.blewUp = true;
      break;
    }
  }
  sol.fevals = C.fe;
  sol.jevals = C.je;
  return done();
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------------------------------

export interface ButcherPreset {
  id: string;
  name: string;
  short: string;
  group: "explicit" | "implicit" | "empty";
  src: TableauSrc;
  /** теоретичні значення (для перевірки й підказок) */
  theory?: { p: number | string; q: number; aStable: boolean; lStable: boolean; rInf: string };
  about?: string;
}

const tb = (c: string[], A: string[][], b: string[]): TableauSrc => ({ s: c.length, c, A, b });

const GL3 = {
  c: ["1/2 - sqrt(15)/10", "1/2", "1/2 + sqrt(15)/10"],
  A: [
    ["5/36", "2/9 - sqrt(15)/15", "5/36 - sqrt(15)/30"],
    ["5/36 + sqrt(15)/24", "2/9", "5/36 - sqrt(15)/24"],
    ["5/36 + sqrt(15)/30", "2/9 + sqrt(15)/15", "5/36"],
  ],
  b: ["5/18", "4/9", "5/18"],
};

const RADAU3 = {
  c: ["(4 - sqrt(6))/10", "(4 + sqrt(6))/10", "1"],
  A: [
    ["(88 - 7*sqrt(6))/360", "(296 - 169*sqrt(6))/1800", "(-2 + 3*sqrt(6))/225"],
    ["(296 + 169*sqrt(6))/1800", "(88 + 7*sqrt(6))/360", "(-2 - 3*sqrt(6))/225"],
    ["(16 - sqrt(6))/36", "(16 + sqrt(6))/36", "1/9"],
  ],
  b: ["(16 - sqrt(6))/36", "(16 + sqrt(6))/36", "1/9"],
};

export const BUTCHER_PRESETS: ButcherPreset[] = [
  {
    id: "euler",
    name: "Явний Ейлер",
    short: "Ейлер",
    group: "explicit",
    src: tb(["0"], [[""]], ["1"]),
    theory: { p: 1, q: 1, aStable: false, lStable: false, rInf: "∞" },
    about: "Одна «розвідка» на початку кроку.",
  },
  {
    id: "midpoint",
    name: "Середня точка (RK2)",
    short: "RK2",
    group: "explicit",
    src: tb(["0", "1/2"], [["", ""], ["1/2", ""]], ["0", "1"]),
    theory: { p: 2, q: 1, aStable: false, lStable: false, rInf: "∞" },
    about: "Той самий RK2, що й на сторінках задач: нахил у середині кроку.",
  },
  {
    id: "heun",
    name: "Хойн (явні трапеції)",
    short: "Хойн",
    group: "explicit",
    src: tb(["0", "1"], [["", ""], ["1", ""]], ["1/2", "1/2"]),
    theory: { p: 2, q: 1, aStable: false, lStable: false, rInf: "∞" },
    about: "Ейлер-прогноз + середнє нахилів на кінцях.",
  },
  {
    id: "kutta3",
    name: "Кутта-3 (RK3)",
    short: "RK3",
    group: "explicit",
    src: tb(["0", "1/2", "1"], [["", "", ""], ["1/2", "", ""], ["-1", "2", ""]], ["1/6", "2/3", "1/6"]),
    theory: { p: 3, q: 1, aStable: false, lStable: false, rInf: "∞" },
    about: "Той самий RK3, що й на сторінках задач (ваги 1/6, 2/3, 1/6).",
  },
  {
    id: "rk4",
    name: "Класичний RK4",
    short: "RK4",
    group: "explicit",
    src: tb(
      ["0", "1/2", "1/2", "1"],
      [
        ["", "", "", ""],
        ["1/2", "", "", ""],
        ["0", "1/2", "", ""],
        ["0", "0", "1", ""],
      ],
      ["1/6", "1/3", "1/3", "1/6"],
    ),
    theory: { p: 4, q: 1, aStable: false, lStable: false, rInf: "∞" },
  },
  {
    id: "rk38",
    name: "Правило 3/8",
    short: "3/8",
    group: "explicit",
    src: tb(
      ["0", "1/3", "2/3", "1"],
      [
        ["", "", "", ""],
        ["1/3", "", "", ""],
        ["-1/3", "1", "", ""],
        ["1", "-1", "1", ""],
      ],
      ["1/8", "3/8", "3/8", "1/8"],
    ),
    theory: { p: 4, q: 1, aStable: false, lStable: false, rInf: "∞" },
    about: "Інші коефіцієнти, ніж у RK4, — але та сама R(z) і той самий порядок.",
  },
  {
    id: "dopri5",
    name: "Дорманд–Принс 5 (DOPRI5)",
    short: "DOPRI5",
    group: "explicit",
    src: tb(
      ["0", "1/5", "3/10", "4/5", "8/9", "1", "1"],
      [
        ["", "", "", "", "", "", ""],
        ["1/5", "", "", "", "", "", ""],
        ["3/40", "9/40", "", "", "", "", ""],
        ["44/45", "-56/15", "32/9", "", "", "", ""],
        ["19372/6561", "-25360/2187", "64448/6561", "-212/729", "", "", ""],
        ["9017/3168", "-355/33", "46732/5247", "49/176", "-5103/18656", "", ""],
        ["35/384", "0", "500/1113", "125/192", "-2187/6784", "11/84", ""],
      ],
      ["35/384", "0", "500/1113", "125/192", "-2187/6784", "11/84", "0"],
    ),
    theory: { p: 5, q: 1, aStable: false, lStable: false, rInf: "∞" },
    about: "Таблиця 5-го порядку з ode45 / DOPRI45 (7-а стадія потрібна лише для оцінки похибки, тут b₇ = 0).",
  },
  {
    id: "ieuler",
    name: "Неявний Ейлер",
    short: "Неявн. Ейлер",
    group: "implicit",
    src: tb(["1"], [["1"]], ["1"]),
    theory: { p: 1, q: 1, aStable: true, lStable: true, rInf: "0" },
  },
  {
    id: "imidpoint",
    name: "Неявна середня точка",
    short: "Неявн. сер. т.",
    group: "implicit",
    src: tb(["1/2"], [["1/2"]], ["1"]),
    theory: { p: 2, q: 1, aStable: true, lStable: false, rInf: "−1" },
    about: "Гаусс–Лежандр з однією стадією.",
  },
  {
    id: "trap",
    name: "Трапеції (Лобатто IIIA, s = 2)",
    short: "Трапеції",
    group: "implicit",
    src: tb(["0", "1"], [["0", "0"], ["1/2", "1/2"]], ["1/2", "1/2"]),
    theory: { p: 2, q: 2, aStable: true, lStable: false, rInf: "−1" },
    about: "Перша стадія явна; y₍ₙ₊₁₎ = друга стадія.",
  },
  {
    id: "gauss2",
    name: "Гаусс–Лежандр, s = 2",
    short: "Гаусс-2",
    group: "implicit",
    src: tb(["1/2 - sqrt(3)/6", "1/2 + sqrt(3)/6"], [["1/4", "1/4 - sqrt(3)/6"], ["1/4 + sqrt(3)/6", "1/4"]], ["1/2", "1/2"]),
    theory: { p: 4, q: 2, aStable: true, lStable: false, rInf: "1" },
  },
  {
    id: "gauss3",
    name: "Гаусс–Лежандр, s = 3",
    short: "Гаусс-3",
    group: "implicit",
    src: tb(GL3.c, GL3.A, GL3.b),
    theory: { p: "6 (тут видно ≥ 5)", q: 3, aStable: true, lStable: false, rInf: "−1" },
  },
  {
    id: "radau2",
    name: "Радо IIA, s = 2",
    short: "Радо-2",
    group: "implicit",
    src: tb(["1/3", "1"], [["5/12", "-1/12"], ["3/4", "1/4"]], ["3/4", "1/4"]),
    theory: { p: 3, q: 2, aStable: true, lStable: true, rInf: "0" },
  },
  {
    id: "radau3",
    name: "Радо IIA, s = 3 (RADAU5)",
    short: "Радо-3",
    group: "implicit",
    src: tb(RADAU3.c, RADAU3.A, RADAU3.b),
    theory: { p: 5, q: 3, aStable: true, lStable: true, rInf: "0" },
    about: "Основа відомого розв'язувача RADAU5 Гайрера–Ваннера.",
  },
  {
    id: "sdirk2",
    name: "SDIRK2 (γ = 1 − 1/√2)",
    short: "SDIRK2",
    group: "implicit",
    src: tb(["1 - 1/sqrt(2)", "1"], [["1 - 1/sqrt(2)", "0"], ["1/sqrt(2)", "1 - 1/sqrt(2)"]], ["1/sqrt(2)", "1 - 1/sqrt(2)"]),
    theory: { p: 2, q: 1, aStable: true, lStable: true, rInf: "0" },
    about: "Дві однакові «неявні» стадії: один LU-розклад n × n на крок замість sn × sn.",
  },
  {
    id: "sdirk3",
    name: "SDIRK3 Крузе (2 стадії)",
    short: "SDIRK3",
    group: "implicit",
    src: tb(["1/2 + sqrt(3)/6", "1/2 - sqrt(3)/6"], [["1/2 + sqrt(3)/6", "0"], ["-sqrt(3)/3", "1/2 + sqrt(3)/6"]], ["1/2", "1/2"]),
    theory: { p: 3, q: 1, aStable: true, lStable: false, rInf: "1 − √3 ≈ −0.732" },
    about: "Крузе (Crouzeix, 1975): 3-й порядок з двох SDIRK-стадій, A-стійкий.",
  },
  {
    id: "empty3",
    name: "Порожній 3-стадійний",
    short: "Порожній",
    group: "empty",
    src: emptySrc(3),
    about: "Заповніть самі: напр., «метод 3-го порядку з 3 стадій».",
  },
];

export const presetById = (id: string) => BUTCHER_PRESETS.find((p) => p.id === id);

// ---------------------------------------------------------------------------------------------------------------------
// Convergence test problems (exact solutions known)
// ---------------------------------------------------------------------------------------------------------------------

export interface ConvergenceProblem {
  id: string;
  name: string;
  tex: string;
  note: string;
  problem: Problem;
  exact: (t: number) => Vec;
}

/** Задачі для перевірки порядку: точний розв'язок відомий, тож похибку видно до ~1e-13. */
export const CONVERGENCE_PROBLEMS: ConvergenceProblem[] = [
  {
    id: "riccati",
    name: "Нелінійна неавтономна y′ = −2t·y²",
    tex: String.raw`y' = -2t\,y^{2},\quad y(0) = 1,\quad t\in[0, 5],\qquad y(t) = \frac{1}{1+t^{2}}`,
    note: "Нелінійна і залежить від t: «бачить» умови порядку з A і з c. Нахили виходять чистими вже з N ≈ 20.",
    problem: { f: (t, y) => [-2 * t * y[0] * y[0]], jac: (t, y) => [[-4 * t * y[0]]], y0: [1], t0: 0, T: 5 },
    exact: (t) => [1 / (1 + t * t)],
  },
  {
    id: "circle",
    name: "Система 2×2 з граничним циклом",
    tex: String.raw`\begin{cases} u' = \omega(t)\,\big(-v + u\,(1-u^2-v^2)\big), \\ v' = \omega(t)\,\big(u + v\,(1-u^2-v^2)\big), \end{cases}\ \ \omega(t) = 1 + \tfrac12\cos t,\ \ u(0)=1,\ v(0)=0,\ t\in[0,5]`,
    note: "Точний розв'язок u = cos θ(t), v = sin θ(t), θ = t + ½ sin t. Нелінійна система: тут на великих кроках нахил може «гуляти», асимптотика видна при малих h.",
    problem: {
      f: (t, y) => {
        const w = 1 + 0.5 * Math.cos(t);
        const q = 1 - y[0] * y[0] - y[1] * y[1];
        return [w * (-y[1] + y[0] * q), w * (y[0] + y[1] * q)];
      },
      jac: (t, y) => {
        const w = 1 + 0.5 * Math.cos(t);
        const q = 1 - y[0] * y[0] - y[1] * y[1];
        return [
          [w * (q - 2 * y[0] * y[0]), w * (-1 - 2 * y[0] * y[1])],
          [w * (1 - 2 * y[0] * y[1]), w * (q - 2 * y[1] * y[1])],
        ];
      },
      y0: [1, 0],
      t0: 0,
      T: 5,
    },
    exact: (t) => {
      const th = t + 0.5 * Math.sin(t);
      return [Math.cos(th), Math.sin(th)];
    },
  },
  {
    id: "linear",
    name: "Лінійна y′ = −y + cos t",
    tex: String.raw`y' = -y + \cos t,\quad y(0) = 1,\qquad y(t) = \tfrac12\left(\cos t + \sin t + e^{-t}\right)`,
    note: "Лінійна задача перевіряє лише частину умов порядку (R(z) і квадратурні умови): метод може мати тут вищий порядок, ніж на нелінійних задачах.",
    problem: { f: (t, y) => [-y[0] + Math.cos(t)], jac: () => [[-1]], y0: [1], t0: 0, T: 10 },
    exact: (t) => [0.5 * (Math.cos(t) + Math.sin(t) + Math.exp(-t))],
  },
  {
    id: "pr",
    name: "Жорстка Протеро–Робінсон (λ = −10⁴)",
    tex: String.raw`y' = \lambda\,(y - \sin t) + \cos t,\quad \lambda = -10^{4},\quad y(0) = 0,\qquad y(t) = \sin t`,
    note: "Жорстка задача: при h|λ| ≫ 1 неявні методи часто втрачають порядок до стадійного q (або q + 1) — «зниження порядку».",
    problem: { f: (t, y) => [-1e4 * (y[0] - Math.sin(t)) + Math.cos(t)], jac: () => [[-1e4]], y0: [0], t0: 0, T: 10 },
    exact: (t) => [Math.sin(t)],
  },
];

export interface ConvergencePoint {
  N: number;
  h: number;
  /** max_k |y_k(T) − exact_k(T)|; NaN — вибух/відмова */
  err: number;
  failed?: string;
  fevals: number;
}

/** Похибка в кінці відрізка для послідовності кроків h = T/N. */
export function convergenceRun(tab: Tableau, cp: ConvergenceProblem, Ns: number[]): ConvergencePoint[] {
  const T = cp.problem.T - (cp.problem.t0 ?? 0);
  const ex = cp.exact(cp.problem.T);
  return Ns.map((N) => {
    const sol = solveButcher(tab, cp.problem, { h: T / N, blowup: 1e8 });
    const y = sol.y[sol.y.length - 1];
    const err = sol.failed ? NaN : Math.max(...y.map((v, i) => Math.abs(v - ex[i])));
    return { N, h: T / N, err, failed: sol.failed, fevals: sol.fevals };
  });
}

/** Межі «асимптотичної» зони похибок для оцінки порядку: вище — ще не асимптотика, нижче — округлення. */
export const ORDER_WINDOW: [number, number] = [1e-13, 1e-2];

/**
 * Спостережений порядок: МЕДІАНА локальних нахилів log(e_k/e_{k+1}) / log(h_k/h_{k+1}) за парами сусідніх точок,
 * обидві похибки яких у зоні {@link ORDER_WINDOW}. Медіана стійка до поодиноких «викидів» (передасимптотичний
 * великий крок, випадкове скорочення похибки, округлення), на відміну від МНК за всіма точками.
 */
export function observedOrder(pts: ConvergencePoint[]): { slope: number | null; local: (number | null)[]; used: number[] } {
  const [lo, hi] = ORDER_WINDOW;
  const inWin = (e: number) => Number.isFinite(e) && e > lo && e < hi;
  const local = pts.map((p, i) => {
    const q = pts[i + 1];
    if (!q || !(p.err > 0) || !(q.err > 0) || !Number.isFinite(p.err) || !Number.isFinite(q.err)) return null;
    return Math.log(p.err / q.err) / Math.log(p.h / q.h);
  });
  const slopes: number[] = [];
  const usedSet = new Set<number>();
  local.forEach((v, i) => {
    if (v !== null && inWin(pts[i].err) && inWin(pts[i + 1].err)) {
      slopes.push(v);
      usedSet.add(i);
      usedSet.add(i + 1);
    }
  });
  if (!slopes.length) return { slope: null, local, used: [] };
  slopes.sort((x, y) => x - y);
  const m = slopes.length >> 1;
  const slope = slopes.length % 2 ? slopes[m] : (slopes[m - 1] + slopes[m]) / 2;
  return { slope, local, used: [...usedSet].sort((x, y) => x - y) };
}
