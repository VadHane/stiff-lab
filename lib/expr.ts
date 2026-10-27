/**
 * Безпечний розбір, компіляція, символьне диференціювання і друк математичних виразів
 * (правих частин ОДР). Жодного `eval` / `new Function`: вираз розбирається рекурсивним спуском
 * в AST, а «компіляція» будує дерево замикань над масивом значень.
 *
 * Граматика (від нижчого пріоритету до вищого):
 * ```
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := ('+' | '-') unary | power
 *   power   := primary ('^' unary)?          // правоасоціативний: 2^3^2 = 2^(3^2); -x^2 = -(x^2); 2^-x = 2^(-x)
 *   primary := number | name | name '(' args ')' | '(' expr ')'
 * ```
 * - числа: `2`, `0.5`, `.5`, `5.`, `1e-3`, `3E+7`;
 * - імена: Unicode-літера або `_`, далі літери, цифри (зокрема `₁`), `_` — `x`, `u1`, `k_2`, `σ`, `ε`, `ω0`;
 * - `**` — синонім `^`; `·`, `×`, `⋅` — синоніми `*`; `−` (U+2212) — синонім `-`; `÷` — синонім `/`;
 * - неявного множення немає: `2x`, `2(x+1)`, `(a)(b)`, `x y` — помилка з підказкою «пропущено *».
 *
 * Константи `pi` (також `π`) і `e` — це звичайні імена, які розв'язуються ЛИШЕ ТОДІ, коли їх немає серед
 * імен, переданих у {@link compile} / {@link evaluate}: параметр або змінна з іменем `e` має пріоритет
 * над числом Ейлера (так само `pi`).
 *
 * @module expr
 */

// ---------------------------------------------------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------------------------------------------------

/** Бінарні операції. `^` — піднесення до степеня. */
export type BinOp = "+" | "-" | "*" | "/" | "^";

/** Імена вбудованих функцій. `log` і `ln` — натуральний логарифм. */
export type FnName =
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "atan2"
  | "sinh"
  | "cosh"
  | "tanh"
  | "exp"
  | "log"
  | "ln"
  | "log10"
  | "sqrt"
  | "abs"
  | "sign"
  | "min"
  | "max"
  | "pow"
  | "floor"
  | "ceil";

/**
 * Вузол AST. `pos` — позиція першого символу вузла у вихідному рядку (лише для вузлів, отриманих з {@link parse};
 * вузли, побудовані {@link diff} чи спрощенням, позиції не мають).
 */
export type Expr =
  | { type: "num"; value: number; pos?: number }
  | { type: "sym"; name: string; pos?: number }
  | { type: "neg"; arg: Expr; pos?: number }
  | { type: "bin"; op: BinOp; left: Expr; right: Expr; pos?: number }
  | { type: "call"; fn: FnName; args: Expr[]; pos?: number };

/** Помилка розбору: повідомлення українською і діапазон символів [pos, end) для підсвічування. */
export interface ParseError {
  message: string;
  pos: number;
  end?: number;
}

export type ParseResult = { ok: true; ast: Expr } | { ok: false; error: ParseError };

interface FnInfo {
  /** мінімальна і максимальна кількість аргументів */
  arity: [number, number];
  /** обчислення (для згортання констант і `evaluate`) */
  impl: (...a: number[]) => number;
}

/**
 * Піднесення до степеня з тією самою арифметикою, що й рукописний код сторінок: `x^2 → x*x`, `x^3 → x*x*x`,
 * `x^4 → x*x*x*x` (ліва асоціативність), інакше `Math.pow`. Використовується і в {@link compile}, і при згортанні
 * констант — тож скомпільований вираз дає біт-у-біт той самий результат, що й `y[0] * y[0] * y[1]` на сторінці.
 */
export function powOp(x: number, y: number): number {
  if (y === 2) return x * x;
  if (y === 3) return x * x * x;
  if (y === 4) return x * x * x * x;
  if (y === 1) return x;
  return Math.pow(x, y);
}

const minN = (...a: number[]) => Math.min(...a);
const maxN = (...a: number[]) => Math.max(...a);

/** Таблиця вбудованих функцій: арність і реалізація. */
export const FUNCTIONS: Readonly<Record<FnName, FnInfo>> = {
  sin: { arity: [1, 1], impl: Math.sin },
  cos: { arity: [1, 1], impl: Math.cos },
  tan: { arity: [1, 1], impl: Math.tan },
  asin: { arity: [1, 1], impl: Math.asin },
  acos: { arity: [1, 1], impl: Math.acos },
  atan: { arity: [1, 1], impl: Math.atan },
  atan2: { arity: [2, 2], impl: Math.atan2 },
  sinh: { arity: [1, 1], impl: Math.sinh },
  cosh: { arity: [1, 1], impl: Math.cosh },
  tanh: { arity: [1, 1], impl: Math.tanh },
  exp: { arity: [1, 1], impl: Math.exp },
  log: { arity: [1, 1], impl: Math.log },
  ln: { arity: [1, 1], impl: Math.log },
  log10: { arity: [1, 1], impl: Math.log10 },
  sqrt: { arity: [1, 1], impl: Math.sqrt },
  abs: { arity: [1, 1], impl: Math.abs },
  sign: { arity: [1, 1], impl: Math.sign },
  min: { arity: [2, Infinity], impl: minN },
  max: { arity: [2, Infinity], impl: maxN },
  pow: { arity: [2, 2], impl: powOp },
  floor: { arity: [1, 1], impl: Math.floor },
  ceil: { arity: [1, 1], impl: Math.ceil },
};

/** Список імен функцій (для підказок у редакторі та перевірки конфліктів імен). */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as FnName[];

/** Вбудовані константи. Імена параметрів/змінних мають пріоритет над ними. */
export const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, "π": Math.PI, e: Math.E };

export const isFunctionName = (s: string): s is FnName => Object.prototype.hasOwnProperty.call(FUNCTIONS, s);
export const isConstantName = (s: string): boolean => Object.prototype.hasOwnProperty.call(CONSTANTS, s);

const ID_START = /[\p{L}_]/u;
const ID_CONT = /[\p{L}\p{M}\p{N}_]/u;
const ID_FULL = /^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u;

/** Чи є рядок допустимим ім'ям (ідентифікатором) у виразах. */
export const isIdentifier = (s: string): boolean => ID_FULL.test(s);

// ---------------------------------------------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------------------------------------------

type TokType = "num" | "id" | "op" | "(" | ")" | "," | "eof";
interface Token {
  type: TokType;
  text: string;
  value?: number;
  pos: number;
  end: number;
}

class ExprSyntaxError extends Error {
  pos: number;
  end?: number;
  constructor(message: string, pos: number, end?: number) {
    super(message);
    this.pos = pos;
    this.end = end;
  }
}

const OP_ALIASES: Record<string, string> = {
  "+": "+",
  "-": "-",
  "−": "-", // − minus sign
  "–": "-", // – en dash (often pasted from documents)
  "*": "*",
  "·": "*", // ·
  "⋅": "*", // ⋅
  "×": "*", // ×
  "/": "/",
  "÷": "/", // ÷
  "^": "^",
};

const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Код-пойнт (а не UTF-16 одиниця) у позиції i — щоб коректно обробляти літери поза BMP. */
function charAt(s: string, i: number): string {
  const cp = s.codePointAt(i);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = charAt(src, i);
    if (/\s/u.test(ch)) {
      i += ch.length;
      continue;
    }
    const start = i;
    if (/[0-9.]/.test(ch)) {
      const m = NUM_RE.exec(src.slice(i));
      if (!m) throw new ExprSyntaxError("Неправильне число: одинока крапка", i, i + 1);
      i += m[0].length;
      out.push({ type: "num", text: m[0], value: Number(m[0]), pos: start, end: i });
      const next = charAt(src, i);
      if (next && (ID_START.test(next) || next === "(")) {
        const tail = next === "(" ? "(…)" : (/^[\p{L}\p{M}\p{N}_]+/u.exec(src.slice(i))?.[0] ?? next);
        throw new ExprSyntaxError(`Пропущено знак множення «*»: напишіть «${m[0]}*${tail}» замість «${m[0]}${tail}»`, start, i + next.length);
      }
      if (next === ".") throw new ExprSyntaxError("Неправильне число: зайва крапка", i, i + 1);
      continue;
    }
    if (ID_START.test(ch)) {
      while (i < src.length) {
        const c = charAt(src, i);
        if (!ID_CONT.test(c)) break;
        i += c.length;
      }
      out.push({ type: "id", text: src.slice(start, i), pos: start, end: i });
      continue;
    }
    if (ch === "*" && src[i + 1] === "*") {
      out.push({ type: "op", text: "^", pos: start, end: i + 2 });
      i += 2;
      continue;
    }
    if (OP_ALIASES[ch]) {
      out.push({ type: "op", text: OP_ALIASES[ch], pos: start, end: i + ch.length });
      i += ch.length;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ type: ch, text: ch, pos: start, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === "[" || ch === "{") throw new ExprSyntaxError(`Квадратні й фігурні дужки не підтримуються — використовуйте «(» і «)»`, i, i + 1);
    if (ch === ";") throw new ExprSyntaxError("Крапка з комою не потрібна: кожне рівняння — окремий вираз", i, i + 1);
    if (ch === "=") throw new ExprSyntaxError("Знак «=» не потрібен: введіть лише праву частину", i, i + 1);
    throw new ExprSyntaxError(`Неочікуваний символ «${ch}»`, i, i + ch.length);
  }
  out.push({ type: "eof", text: "", pos: src.length, end: src.length });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------------------------------

class Parser {
  private k = 0;
  private toks: Token[];
  constructor(toks: Token[]) {
    this.toks = toks;
  }

  /** current token (a method, not a getter: TypeScript must not narrow it across `this.k++`) */
  private cur(): Token {
    return this.toks[this.k];
  }

  private isOp(op: string): boolean {
    return this.cur().type === "op" && this.cur().text === op;
  }

  parseAll(): Expr {
    if (this.cur().type === "eof") throw new ExprSyntaxError("Порожній вираз", 0, 0);
    const e = this.expr();
    const t = this.cur();
    if (t.type !== "eof") {
      if (t.type === ")") throw new ExprSyntaxError("Зайва закривна дужка «)»", t.pos, t.end);
      if (t.type === "," ) throw new ExprSyntaxError("Кома поза викликом функції", t.pos, t.end);
      if (t.type === "num" || t.type === "id" || t.type === "(")
        throw new ExprSyntaxError(`Пропущено оператор перед «${t.text}» (неявного множення немає — поставте «*»)`, t.pos, t.end);
      throw new ExprSyntaxError(`Неочікуваний «${t.text}»`, t.pos, t.end);
    }
    return e;
  }

  private expr(): Expr {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const t = this.cur();
      this.k++;
      const right = this.term();
      left = { type: "bin", op: t.text as BinOp, left, right, pos: left.pos };
    }
    return left;
  }

  private term(): Expr {
    let left = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const t = this.cur();
      this.k++;
      const right = this.unary();
      left = { type: "bin", op: t.text as BinOp, left, right, pos: left.pos };
    }
    return left;
  }

  private unary(): Expr {
    if (this.isOp("-")) {
      const pos = this.cur().pos;
      this.k++;
      return { type: "neg", arg: this.unary(), pos };
    }
    if (this.isOp("+")) {
      this.k++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.primary();
    if (this.isOp("^")) {
      this.k++;
      const exp = this.unary(); // right-assoc: unary → power → primary ('^' unary)
      return { type: "bin", op: "^", left: base, right: exp, pos: base.pos };
    }
    return base;
  }

  private primary(): Expr {
    const t = this.cur();
    if (t.type === "num") {
      this.k++;
      return { type: "num", value: t.value!, pos: t.pos };
    }
    if (t.type === "id") {
      this.k++;
      if (this.cur().type === "(") {
        if (!isFunctionName(t.text))
          throw new ExprSyntaxError(
            `Невідома функція «${t.text}». Доступні: ${FUNCTION_NAMES.join(", ")}. Якщо це множення, поставте «*»: «${t.text}*(…)»`,
            t.pos,
            t.end,
          );
        const open = this.cur();
        this.k++;
        const args: Expr[] = [];
        if (this.cur().type !== ")") {
          for (;;) {
            args.push(this.expr());
            if (this.cur().type === ",") {
              this.k++;
              continue;
            }
            break;
          }
        }
        if (this.cur().type !== ")") {
          if (this.cur().type === "eof") throw new ExprSyntaxError(`Не закрито дужку виклику «${t.text}(»`, open.pos, open.end);
          throw new ExprSyntaxError(`Очікувалася «,» або «)» у виклику «${t.text}»`, this.cur().pos, this.cur().end);
        }
        this.k++;
        const [lo, hi] = FUNCTIONS[t.text].arity;
        if (args.length < lo || args.length > hi) {
          const need = lo === hi ? `${lo} ${plural(lo, "аргумент", "аргументи", "аргументів")}` : `щонайменше ${lo} ${plural(lo, "аргумент", "аргументи", "аргументів")}`;
          throw new ExprSyntaxError(`Функція «${t.text}» приймає ${need}, а передано ${args.length}`, t.pos, this.toks[this.k - 1].end);
        }
        return { type: "call", fn: t.text, args, pos: t.pos };
      }
      if (isFunctionName(t.text)) throw new ExprSyntaxError(`Функції «${t.text}» потрібен аргумент у дужках: «${t.text}(x)»`, t.pos, t.end);
      if (this.cur().type === "num" || this.cur().type === "id")
        throw new ExprSyntaxError(`Пропущено оператор між «${t.text}» і «${this.cur().text}» (неявного множення немає — поставте «*»)`, this.cur().pos, this.cur().end);
      return { type: "sym", name: t.text, pos: t.pos };
    }
    if (t.type === "(") {
      this.k++;
      if (this.cur().type === ")") throw new ExprSyntaxError("Порожні дужки «()»", t.pos, this.cur().end);
      const e = this.expr();
      if (this.cur().type !== ")") {
        if (this.cur().type === "eof") throw new ExprSyntaxError("Не закрито дужку «(»", t.pos, t.end);
        throw new ExprSyntaxError(`Очікувалася «)», а знайдено «${this.cur().text}»`, this.cur().pos, this.cur().end);
      }
      this.k++;
      if (this.cur().type === "(" || this.cur().type === "num" || this.cur().type === "id")
        throw new ExprSyntaxError(`Пропущено знак множення «*» після «)»`, this.cur().pos, this.cur().end);
      return e;
    }
    if (t.type === "eof") throw new ExprSyntaxError("Вираз обірвався: очікувалося число, ім'я або «(»", t.pos, t.end);
    if (t.type === ")") throw new ExprSyntaxError("Очікувалося число, ім'я або «(», а знайдено «)»", t.pos, t.end);
    if (t.type === ",") throw new ExprSyntaxError("Кома поза викликом функції", t.pos, t.end);
    throw new ExprSyntaxError(`Очікувалося число, ім'я або «(», а знайдено «${t.text}»`, t.pos, t.end);
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10,
    m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Розбирає рядок у AST. Ніколи не кидає винятків.
 * @example parse("-k1*u1 + k2*u2*u3") // { ok: true, ast }
 * @example parse("2x") // { ok: false, error: { message: "Пропущено знак множення «*»: …", pos: 0, end: 2 } }
 */
export function parse(src: string): ParseResult {
  try {
    return { ok: true, ast: new Parser(tokenize(src)).parseAll() };
  } catch (e) {
    if (e instanceof ExprSyntaxError) return { ok: false, error: { message: e.message, pos: e.pos, end: e.end } };
    return { ok: false, error: { message: `Помилка розбору: ${(e as Error).message}`, pos: 0 } };
  }
}

/** Як {@link parse}, але кидає `Error` з українським повідомленням (для виразів, що вже пройшли перевірку). */
export function parseOrThrow(src: string): Expr {
  const r = parse(src);
  if (!r.ok) throw new Error(`${r.error.message} (позиція ${r.error.pos + 1}) у «${src}»`);
  return r.ast;
}

// ---------------------------------------------------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------------------------------------------------

/** Обхід усіх вузлів (у прямому порядку). */
export function walk(ast: Expr, visit: (n: Expr) => void): void {
  visit(ast);
  switch (ast.type) {
    case "neg":
      walk(ast.arg, visit);
      break;
    case "bin":
      walk(ast.left, visit);
      walk(ast.right, visit);
      break;
    case "call":
      for (const a of ast.args) walk(a, visit);
      break;
  }
}

/**
 * Усі імена (ідентифікатори, не функції), що трапляються у виразі, — без повторів, у порядку першої появи.
 * Константи `pi`/`e` теж повертаються: чи це константа, чи параметр, вирішує той, хто знає список імен.
 */
export function freeNames(ast: Expr): string[] {
  const seen = new Set<string>();
  walk(ast, (n) => {
    if (n.type === "sym") seen.add(n.name);
  });
  return [...seen];
}

/** Перше входження імені у вираз (вузол із позицією) — для підсвічування помилки «невідоме ім'я». */
export function findName(ast: Expr, name: string): { pos?: number } | null {
  let hit: { pos?: number } | null = null;
  walk(ast, (n) => {
    if (!hit && n.type === "sym" && n.name === name) hit = { pos: n.pos };
  });
  return hit;
}

/** Чи залежить вираз від імені. */
export function dependsOn(ast: Expr, name: string): boolean {
  switch (ast.type) {
    case "num":
      return false;
    case "sym":
      return ast.name === name;
    case "neg":
      return dependsOn(ast.arg, name);
    case "bin":
      return dependsOn(ast.left, name) || dependsOn(ast.right, name);
    case "call":
      return ast.args.some((a) => dependsOn(a, name));
  }
}

/** Структурна рівність двох AST (позиції ігноруються). */
export function astEqual(a: Expr, b: Expr): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "num":
      return Object.is(a.value, (b as typeof a).value);
    case "sym":
      return a.name === (b as typeof a).name;
    case "neg":
      return astEqual(a.arg, (b as typeof a).arg);
    case "bin": {
      const bb = b as typeof a;
      return a.op === bb.op && astEqual(a.left, bb.left) && astEqual(a.right, bb.right);
    }
    case "call": {
      const bb = b as typeof a;
      return a.fn === bb.fn && a.args.length === bb.args.length && a.args.every((x, i) => astEqual(x, bb.args[i]));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Compilation and evaluation
// ---------------------------------------------------------------------------------------------------------------------

/** Скомпільований вираз: значення імен беруться з масиву за індексом (порядок — як у `names` при компіляції). */
export type Compiled = (vals: ArrayLike<number>) => number;

/**
 * Компілює AST у замикання. `names[i]` ↔ `vals[i]`; ім'я, якого немає в `names`, шукається серед констант
 * (`pi`, `π`, `e`), інакше — `Error("Невідоме ім'я …")`. Пошуку в Map під час обчислення немає: кожен вузол
 * знає свій індекс заздалегідь. Порядок операцій той самий, що в рядку (жодних перестановок), а цілі степені 2–4
 * обчислюються множенням (див. {@link powOp}) — тож результат збігається з рукописним JS біт-у-біт.
 */
export function compile(ast: Expr, names: readonly string[]): Compiled {
  const index = new Map<string, number>();
  names.forEach((n, i) => {
    if (!index.has(n)) index.set(n, i);
  });
  /** a leaf known at compile time: value slot or constant (lets binary nodes skip one closure call per operand) */
  type Leaf = { i: number } | { c: number } | null;
  const leafOf = (n: Expr): Leaf => {
    if (n.type === "num") return { c: n.value };
    if (n.type === "sym") {
      const i = index.get(n.name);
      if (i !== undefined) return { i };
      if (isConstantName(n.name)) return { c: CONSTANTS[n.name] };
      throw new Error(`Невідоме ім'я «${n.name}»`);
    }
    return null;
  };
  const rec = (n: Expr): Compiled => {
    switch (n.type) {
      case "num":
      case "sym": {
        const l = leafOf(n)!;
        if ("i" in l) {
          const i = l.i;
          return (v) => v[i];
        }
        const c = l.c;
        return () => c;
      }
      case "neg": {
        const l = leafOf(n.arg);
        if (l && "i" in l) {
          const i = l.i;
          return (v) => -v[i];
        }
        const a = rec(n.arg);
        return (v) => -a(v);
      }
      case "bin": {
        if (n.op === "^") {
          const a = rec(n.left);
          if (n.right.type === "num") {
            const p = n.right.value;
            const l = leafOf(n.left);
            if (l && "i" in l) {
              const i = l.i;
              if (p === 2)
                return (v) => {
                  const x = v[i];
                  return x * x;
                };
              if (p === 3)
                return (v) => {
                  const x = v[i];
                  return x * x * x;
                };
            }
            if (p === 2)
              return (v) => {
                const x = a(v);
                return x * x;
              };
            if (p === 3)
              return (v) => {
                const x = a(v);
                return x * x * x;
              };
            if (p === 4)
              return (v) => {
                const x = a(v);
                return x * x * x * x;
              };
            if (p === 1) return a;
            return (v) => Math.pow(a(v), p);
          }
          const b = rec(n.right);
          return (v) => powOp(a(v), b(v));
        }
        return binary(n.op, n.left, n.right);
      }
      case "call": {
        if (n.fn === "pow") return rec({ type: "bin", op: "^", left: n.args[0], right: n.args[1] });
        const args = n.args.map(rec);
        if (n.fn === "min" || n.fn === "max") {
          const m = n.fn === "min" ? Math.min : Math.max;
          if (args.length === 2) {
            const [a, b] = args;
            return (v) => m(a(v), b(v));
          }
          return (v) => {
            let r = args[0](v);
            for (let k = 1; k < args.length; k++) r = m(r, args[k](v));
            return r;
          };
        }
        if (n.fn === "atan2") {
          const [a, b] = args;
          return (v) => Math.atan2(a(v), b(v));
        }
        const f = FUNCTIONS[n.fn].impl as (x: number) => number;
        const l = leafOf(n.args[0]);
        if (l && "i" in l) {
          const i = l.i;
          return (v) => f(v[i]);
        }
        const a = args[0];
        return (v) => f(a(v));
      }
    }
  };
  // + − × ÷ with every leaf/subtree combination: same operation (left op right), fewer closure calls
  const binary = (op: "+" | "-" | "*" | "/", left: Expr, right: Expr): Compiled => {
    const L = leafOf(left),
      R = leafOf(right);
    const F = SHAPES[op];
    if (L && "i" in L) {
      if (R && "i" in R) return F.ii(L.i, R.i);
      if (R) return F.ic(L.i, R.c);
      return F.ia(L.i, rec(right));
    }
    if (L) {
      if (R && "i" in R) return F.ci(L.c, R.i);
      if (R) {
        const c = op === "+" ? L.c + R.c : op === "-" ? L.c - R.c : op === "*" ? L.c * R.c : L.c / R.c;
        return () => c;
      }
      return F.ca(L.c, rec(right));
    }
    const a = rec(left);
    if (R && "i" in R) return F.ai(a, R.i);
    if (R) return F.ac(a, R.c);
    return F.aa(a, rec(right));
  };
  return rec(ast);
}

type V = ArrayLike<number>;
interface Shapes {
  ii(i: number, j: number): Compiled;
  ic(i: number, c: number): Compiled;
  ci(c: number, j: number): Compiled;
  ia(i: number, b: Compiled): Compiled;
  ai(a: Compiled, j: number): Compiled;
  ca(c: number, b: Compiled): Compiled;
  ac(a: Compiled, c: number): Compiled;
  aa(a: Compiled, b: Compiled): Compiled;
}
const SHAPES: Record<"+" | "-" | "*" | "/", Shapes> = {
  "+": {
    ii: (i, j) => (v: V) => v[i] + v[j],
    ic: (i, c) => (v: V) => v[i] + c,
    ci: (c, j) => (v: V) => c + v[j],
    ia: (i, b) => (v: V) => v[i] + b(v),
    ai: (a, j) => (v: V) => a(v) + v[j],
    ca: (c, b) => (v: V) => c + b(v),
    ac: (a, c) => (v: V) => a(v) + c,
    aa: (a, b) => (v: V) => a(v) + b(v),
  },
  "-": {
    ii: (i, j) => (v: V) => v[i] - v[j],
    ic: (i, c) => (v: V) => v[i] - c,
    ci: (c, j) => (v: V) => c - v[j],
    ia: (i, b) => (v: V) => v[i] - b(v),
    ai: (a, j) => (v: V) => a(v) - v[j],
    ca: (c, b) => (v: V) => c - b(v),
    ac: (a, c) => (v: V) => a(v) - c,
    aa: (a, b) => (v: V) => a(v) - b(v),
  },
  "*": {
    ii: (i, j) => (v: V) => v[i] * v[j],
    ic: (i, c) => (v: V) => v[i] * c,
    ci: (c, j) => (v: V) => c * v[j],
    ia: (i, b) => (v: V) => v[i] * b(v),
    ai: (a, j) => (v: V) => a(v) * v[j],
    ca: (c, b) => (v: V) => c * b(v),
    ac: (a, c) => (v: V) => a(v) * c,
    aa: (a, b) => (v: V) => a(v) * b(v),
  },
  "/": {
    ii: (i, j) => (v: V) => v[i] / v[j],
    ic: (i, c) => (v: V) => v[i] / c,
    ci: (c, j) => (v: V) => c / v[j],
    ia: (i, b) => (v: V) => v[i] / b(v),
    ai: (a, j) => (v: V) => a(v) / v[j],
    ca: (c, b) => (v: V) => c / b(v),
    ac: (a, c) => (v: V) => a(v) / c,
    aa: (a, b) => (v: V) => a(v) / b(v),
  },
};

/** Повільне, але просте обчислення за словником значень (для тестів і одноразових обчислень). */
export function evaluate(ast: Expr, env: Readonly<Record<string, number>>): number {
  const names = Object.keys(env);
  return compile(ast, names)(names.map((k) => env[k]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Construction helpers with basic simplification (used by diff / simplify)
// ---------------------------------------------------------------------------------------------------------------------

export const num = (value: number): Expr => ({ type: "num", value });
export const sym = (name: string): Expr => ({ type: "sym", name });
const isNum = (e: Expr, v?: number): boolean => e.type === "num" && (v === undefined || e.value === v);

/** −a з простими спрощеннями: −(число), −(−x) = x, −(a − b) = b − a. */
export function neg(a: Expr): Expr {
  if (a.type === "num") return num(-a.value);
  if (a.type === "neg") return a.arg;
  if (a.type === "bin" && a.op === "-") return { type: "bin", op: "-", left: a.right, right: a.left };
  return { type: "neg", arg: a };
}

/** a + b з простими спрощеннями (0 + x, x + 0, число + число, x + (−y) = x − y). */
export function add(a: Expr, b: Expr): Expr {
  if (isNum(a, 0)) return b;
  if (isNum(b, 0)) return a;
  if (a.type === "num" && b.type === "num") return num(a.value + b.value);
  if (b.type === "neg") return sub(a, b.arg);
  if (b.type === "num" && b.value < 0) return sub(a, num(-b.value));
  if (a.type === "neg") return sub(b, a.arg);
  if (astEqual(a, b)) return mul(num(2), a);
  return { type: "bin", op: "+", left: a, right: b };
}

/** a − b з простими спрощеннями (x − 0, 0 − x = −x, число − число, x − (−y) = x + y, x − x = 0). */
export function sub(a: Expr, b: Expr): Expr {
  if (isNum(b, 0)) return a;
  if (isNum(a, 0)) return neg(b);
  if (a.type === "num" && b.type === "num") return num(a.value - b.value);
  if (b.type === "neg") return add(a, b.arg);
  if (b.type === "num" && b.value < 0) return add(a, num(-b.value));
  if (astEqual(a, b)) return num(0);
  return { type: "bin", op: "-", left: a, right: b };
}

/** Множники добутку: (a·b)·(c·d) → [a, b, c, d]. */
function factors(e: Expr): Expr[] {
  return e.type === "bin" && e.op === "*" ? [...factors(e.left), ...factors(e.right)] : [e];
}

/**
 * a · b з простими спрощеннями: 0·x = 0, 1·x = x, числові множники збираються наперед і перемножуються,
 * знаки виносяться, добуток стає «плоским» лівоасоціативним ланцюжком: (2·v)·(2·(7·θ)) → 28·v·θ.
 * (Для похідних; порядок множень змінюється, тому для правих частин ОДР використовуйте {@link fold}.)
 */
export function mul(a: Expr, b: Expr): Expr {
  if (isNum(a, 0) || isNum(b, 0)) return num(0);
  if (isNum(a, 1)) return b;
  if (isNum(b, 1)) return a;
  if (a.type === "num" && b.type === "num") return num(a.value * b.value);
  // a·(1/b) → a/b, (1/b)·a → a/b
  if (b.type === "bin" && b.op === "/" && isNum(b.left, 1)) return div(a, b.right);
  if (a.type === "bin" && a.op === "/" && isNum(a.left, 1)) return div(b, a.right);
  let c = 1;
  const fs: Expr[] = [];
  const dens: Expr[] = []; // factors 1/y
  for (let x of [...factors(a), ...factors(b)]) {
    while (x.type === "neg") {
      c = -c;
      x = x.arg;
    }
    if (x.type === "num") c *= x.value;
    else if (x.type === "bin" && x.op === "/" && isNum(x.left, 1)) dens.push(x.right);
    else fs.push(x);
  }
  if (c === 0) return num(0);
  const chainOf = (items: Expr[]) => {
    let r = items[0];
    for (let i = 1; i < items.length; i++) r = { type: "bin", op: "*", left: r, right: items[i] };
    return r;
  };
  const k = Math.abs(c);
  const items = k === 1 && fs.length ? fs : [num(k), ...fs];
  let r = chainOf(items);
  if (dens.length) r = { type: "bin", op: "/", left: r, right: chainOf(dens) };
  return c < 0 ? { type: "neg", arg: r } : r;
}

/** a / b з простими спрощеннями (0/x = 0, x/1 = x, число/число, винесення знака). */
export function div(a: Expr, b: Expr): Expr {
  if (isNum(a, 0)) return num(0);
  if (isNum(b, 1)) return a;
  if (isNum(b, -1)) return neg(a);
  if (a.type === "num" && b.type === "num") return num(a.value / b.value);
  if (a.type === "neg") return neg(div(a.arg, b));
  if (b.type === "neg") return neg(div(a, b.arg));
  if (a.type === "num" && a.value < 0) return neg(div(num(-a.value), b));
  if (b.type === "num" && b.value < 0) return neg(div(a, num(-b.value)));
  return { type: "bin", op: "/", left: a, right: b };
}

/** a ^ b з простими спрощеннями (x^0 = 1, x^1 = x, 1^x = 1, число^число). */
export function pow(a: Expr, b: Expr): Expr {
  if (isNum(b, 0)) return num(1);
  if (isNum(b, 1)) return a;
  if (isNum(a, 1)) return num(1);
  if (a.type === "num" && b.type === "num") return num(powOp(a.value, b.value));
  return { type: "bin", op: "^", left: a, right: b };
}

/** Виклик функції (без згортання — див. {@link fold}). */
export function call(fn: FnName, ...args: Expr[]): Expr {
  return { type: "call", fn, args };
}

// ---------------------------------------------------------------------------------------------------------------------
// Substitution, folding, simplification
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Підставляє замість імен вирази або числа. Решта імен лишається. Не спрощує.
 * @example substitute(parse("a*x").ast, { a: 2 }) // 2*x
 */
export function substitute(ast: Expr, map: Readonly<Record<string, Expr | number>>): Expr {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(map, k);
  const rec = (n: Expr): Expr => {
    switch (n.type) {
      case "num":
        return n;
      case "sym": {
        if (!has(n.name)) return n;
        const r = map[n.name];
        return typeof r === "number" ? { type: "num", value: r } : r;
      }
      case "neg":
        return { type: "neg", arg: rec(n.arg), pos: n.pos };
      case "bin":
        return { type: "bin", op: n.op, left: rec(n.left), right: rec(n.right), pos: n.pos };
      case "call":
        return { type: "call", fn: n.fn, args: n.args.map(rec), pos: n.pos };
    }
  };
  return rec(ast);
}

/**
 * Згортання константних підвиразів БЕЗ алгебраїчних перетворень: кожне піддерево, всі листки якого — числа,
 * замінюється результатом тієї самої арифметики, яку виконав би {@link compile}. Тому `compile(fold(e))` дає
 * біт-у-біт той самий результат, що й `compile(e)`, лише швидше.
 * @param opts.constants — також підставити константи `pi`/`π`/`e`, крім імен із `opts.keep` (типово — ні)
 */
export function fold(ast: Expr, opts: { constants?: boolean; keep?: ReadonlySet<string> | readonly string[] } = {}): Expr {
  const keep = opts.keep ? new Set(opts.keep) : new Set<string>();
  const rec = (n: Expr): Expr => {
    switch (n.type) {
      case "num":
        return n;
      case "sym":
        if (opts.constants && !keep.has(n.name) && isConstantName(n.name)) return { type: "num", value: CONSTANTS[n.name] };
        return n;
      case "neg": {
        const a = rec(n.arg);
        return a.type === "num" ? { type: "num", value: -a.value } : { type: "neg", arg: a, pos: n.pos };
      }
      case "bin": {
        const a = rec(n.left),
          b = rec(n.right);
        if (a.type === "num" && b.type === "num") {
          const x = a.value,
            y = b.value;
          const v = n.op === "+" ? x + y : n.op === "-" ? x - y : n.op === "*" ? x * y : n.op === "/" ? x / y : powOp(x, y);
          return { type: "num", value: v };
        }
        return { type: "bin", op: n.op, left: a, right: b, pos: n.pos };
      }
      case "call": {
        const args = n.args.map(rec);
        if (args.every((x) => x.type === "num")) {
          const vals = args.map((x) => (x as { value: number }).value);
          let v: number;
          if (n.fn === "min" || n.fn === "max") {
            // same pairwise reduction as compile
            const m = n.fn === "min" ? Math.min : Math.max;
            v = vals[0];
            for (let k = 1; k < vals.length; k++) v = m(v, vals[k]);
          } else v = FUNCTIONS[n.fn].impl(...vals);
          return { type: "num", value: v };
        }
        return { type: "call", fn: n.fn, args, pos: n.pos };
      }
    }
  };
  return rec(ast);
}

/**
 * Згортання констант + базові тотожності (0·x = 0, 1·x = x, x + 0 = x, x^1 = x, x^0 = 1, −(−x) = x, …).
 * Увага: `0·x → 0` змінює поведінку на NaN/∞, тому для правих частин ОДР використовуйте {@link fold},
 * а `simplify` — для похідних і друку.
 */
export function simplify(ast: Expr): Expr {
  const rec = (n: Expr): Expr => {
    switch (n.type) {
      case "num":
      case "sym":
        return n;
      case "neg":
        return neg(rec(n.arg));
      case "bin": {
        const a = rec(n.left),
          b = rec(n.right);
        switch (n.op) {
          case "+":
            return add(a, b);
          case "-":
            return sub(a, b);
          case "*":
            return mul(a, b);
          case "/":
            return div(a, b);
          case "^":
            return pow(a, b);
        }
        throw new Error("unreachable");
      }
      case "call": {
        const args = n.args.map(rec);
        if (args.every((x) => x.type === "num")) return fold({ type: "call", fn: n.fn, args });
        if (n.fn === "pow") return pow(args[0], args[1]);
        return { type: "call", fn: n.fn, args };
      }
    }
  };
  return rec(ast);
}

// ---------------------------------------------------------------------------------------------------------------------
// Symbolic differentiation
// ---------------------------------------------------------------------------------------------------------------------

/** Індикатор H(a − b) = (1 + sign(a − b))/2: 1 при a > b, 0 при a < b, ½ при a = b. */
const heaviside = (a: Expr, b: Expr): Expr => div(add(num(1), call("sign", sub(a, b))), num(2));

/** min/max з багатьма аргументами → вкладені бінарні: min(a, b, c) = min(min(a, b), c). */
function binaryFold(fn: "min" | "max", args: Expr[]): Expr {
  let r = args[0];
  for (let k = 1; k < args.length; k++) r = call(fn, r, args[k]);
  return r;
}

/**
 * Символьна похідна ∂ast/∂name зі спрощенням. Інші імена вважаються сталими.
 *
 * Кусково-гладкі функції — похідні «майже скрізь»: `abs' = sign(a)·a'`, `sign' = floor' = ceil' = 0`,
 * `min(a, b)' = a'·(1 − H) + b'·H`, `max(a, b)' = a'·H + b'·(1 − H)`, де `H = (1 + sign(a − b))/2`
 * (у точці зламу a = b — середнє однобічних похідних).
 * @example diff(parse("x^3 + a*x").ast, "x") // 3*x^2 + a
 */
export function diff(ast: Expr, name: string): Expr {
  const d = (n: Expr): Expr => {
    if (!dependsOn(n, name)) return num(0);
    switch (n.type) {
      case "num":
        return num(0);
      case "sym":
        return num(n.name === name ? 1 : 0);
      case "neg":
        return neg(d(n.arg));
      case "bin": {
        const a = n.left,
          b = n.right;
        switch (n.op) {
          case "+":
            return add(d(a), d(b));
          case "-":
            return sub(d(a), d(b));
          case "*":
            return add(mul(d(a), b), mul(a, d(b)));
          case "/": {
            const da = d(a),
              db = d(b);
            if (isNum(db, 0)) return div(da, b);
            if (isNum(da, 0)) return neg(div(mul(a, db), pow(b, num(2))));
            return div(sub(mul(da, b), mul(a, db)), pow(b, num(2)));
          }
          case "^":
            return dPow(a, b);
        }
        throw new Error("unreachable");
      }
      case "call": {
        const [a, b] = n.args;
        const da = () => d(a);
        switch (n.fn) {
          case "sin":
            return mul(call("cos", a), da());
          case "cos":
            return neg(mul(call("sin", a), da()));
          case "tan":
            return div(da(), pow(call("cos", a), num(2)));
          case "asin":
            return div(da(), call("sqrt", sub(num(1), pow(a, num(2)))));
          case "acos":
            return neg(div(da(), call("sqrt", sub(num(1), pow(a, num(2))))));
          case "atan":
            return div(da(), add(num(1), pow(a, num(2))));
          case "atan2": {
            // atan2(y, x)' = (x·y' − y·x') / (x² + y²)
            return div(sub(mul(b, d(a)), mul(a, d(b))), add(pow(b, num(2)), pow(a, num(2))));
          }
          case "sinh":
            return mul(call("cosh", a), da());
          case "cosh":
            return mul(call("sinh", a), da());
          case "tanh":
            return div(da(), pow(call("cosh", a), num(2)));
          case "exp":
            return mul(call("exp", a), da());
          case "log":
          case "ln":
            return div(da(), a);
          case "log10":
            return div(da(), mul(a, call("log", num(10))));
          case "sqrt":
            return div(da(), mul(num(2), call("sqrt", a)));
          case "abs":
            return mul(call("sign", a), da());
          case "sign":
          case "floor":
          case "ceil":
            return num(0);
          case "pow":
            return dPow(a, b);
          case "min":
          case "max": {
            if (n.args.length > 2) return d(binaryFold(n.fn, n.args));
            const H = heaviside(a, b);
            const notH = sub(num(1), H);
            return n.fn === "max" ? add(mul(d(a), H), mul(d(b), notH)) : add(mul(d(a), notH), mul(d(b), H));
          }
        }
      }
    }
    throw new Error("unreachable");
  };
  const dPow = (a: Expr, b: Expr): Expr => {
    const aDep = dependsOn(a, name),
      bDep = dependsOn(b, name);
    if (!bDep) {
      // power rule: (a^n)' = n·a^(n−1)·a'
      return mul(mul(b, pow(a, sub(b, num(1)))), d(a));
    }
    if (!aDep) {
      // (c^b)' = c^b·ln c·b'
      return mul(mul(pow(a, b), call("log", a)), d(b));
    }
    // (a^b)' = a^b·(b'·ln a + b·a'/a)
    return mul(pow(a, b), add(mul(d(b), call("log", a)), div(mul(b, d(a)), a)));
  };
  return d(ast);
}

// ---------------------------------------------------------------------------------------------------------------------
// Printing: numbers
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Найкоротший запис числа, що точно відтворює те саме double (`Number.prototype.toString` дає найкоротше
 * round-trip представлення). Великі й дуже малі числа — в експоненційній формі без «+»: `3e7`, `8.375e-6`.
 * Нескінченності й NaN — `Infinity`, `-Infinity`, `NaN` (мовні принтери замінюють їх своїми).
 */
export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (Object.is(x, -0)) return "0";
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-4)) return x.toExponential().replace("e+", "e");
  return String(x);
}

// ---------------------------------------------------------------------------------------------------------------------
// Printing: generic precedence printer for Python / MATLAB
// ---------------------------------------------------------------------------------------------------------------------

const P_ADD = 1,
  P_MUL = 2,
  P_UNARY = 3,
  P_POW = 4,
  P_ATOM = 5;

interface Printed {
  s: string;
  prec: number;
}

interface LangPrinter {
  num(x: number): string;
  name(n: string): string;
  powOp: string;
  call(fn: FnName, args: string[], raw: Expr[]): string;
}

/** Друк з мінімальними дужками, що ЗБЕРІГАЄ порядок обчислень AST (a + (b + c) лишається з дужками). */
function printWith(ast: Expr, L: LangPrinter): string {
  const paren = (p: Printed, need: boolean) => (need ? `(${p.s})` : p.s);
  const rec = (n: Expr): Printed => {
    switch (n.type) {
      case "num": {
        const s = L.num(Math.abs(n.value));
        return n.value < 0 || Object.is(n.value, -0) ? { s: `-${s}`, prec: P_UNARY } : { s, prec: P_ATOM };
      }
      case "sym":
        return { s: L.name(n.name), prec: P_ATOM };
      case "neg": {
        const a = rec(n.arg);
        // −(a·b) is printed as −a·b: numerically identical (negation is exact), reads naturally
        return { s: `-${paren(a, a.prec < P_MUL)}`, prec: Math.min(P_UNARY, Math.max(a.prec, P_MUL)) };
      }
      case "bin": {
        // a + (−b) → a − b, a − (−b) → a + b: exact in IEEE arithmetic
        if ((n.op === "+" || n.op === "-") && (n.right.type === "neg" || (n.right.type === "num" && n.right.value < 0))) {
          const inner: Expr = n.right.type === "neg" ? n.right.arg : { type: "num", value: -n.right.value };
          return rec({ type: "bin", op: n.op === "+" ? "-" : "+", left: n.left, right: inner });
        }
        const a = rec(n.left),
          b = rec(n.right);
        if (n.op === "^") {
          const leftNeed = a.prec <= P_POW; // (a^b)^c, (−a)^b, (a*b)^c
          const rightNeed = b.prec <= P_POW; // a^(b^c) explicit for clarity; a^(−b)
          return { s: `${paren(a, leftNeed)}${L.powOp}${paren(b, rightNeed)}`, prec: P_POW };
        }
        const p = n.op === "+" || n.op === "-" ? P_ADD : P_MUL;
        const op = n.op === "*" || n.op === "/" ? n.op : ` ${n.op} `;
        return { s: `${paren(a, a.prec < p)}${op}${paren(b, b.prec <= p || (p === P_MUL && b.prec === P_UNARY))}`, prec: p };
      }
      case "call": {
        if (n.fn === "pow") return rec({ type: "bin", op: "^", left: n.args[0], right: n.args[1] });
        return { s: L.call(n.fn, n.args.map((a) => rec(a).s), n.args), prec: P_ATOM };
      }
    }
  };
  return rec(ast).s;
}

const PY_FN: Record<FnName, string> = {
  sin: "np.sin",
  cos: "np.cos",
  tan: "np.tan",
  asin: "np.arcsin",
  acos: "np.arccos",
  atan: "np.arctan",
  atan2: "np.arctan2",
  sinh: "np.sinh",
  cosh: "np.cosh",
  tanh: "np.tanh",
  exp: "np.exp",
  log: "np.log",
  ln: "np.log",
  log10: "np.log10",
  sqrt: "np.sqrt",
  abs: "np.abs",
  sign: "np.sign",
  min: "np.minimum",
  max: "np.maximum",
  pow: "np.power",
  floor: "np.floor",
  ceil: "np.ceil",
};

/** Перетворення імен виразу на імена цільової мови (див. `codegen.ts`); за замовчуванням — без змін. */
export type NameMap = (name: string) => string;

/**
 * Друк для Python/NumPy: `**`, `np.sin`, `np.log` (натуральний), `np.abs`, `np.sign`, `np.arctan2`, `np.pi`, `np.e`.
 *
 * `min`/`max` друкуються як `np.minimum`/`np.maximum` (вкладено для 3+ аргументів), а не вбудовані `min`/`max`:
 * вони, як і `Math.min` у JS, поширюють NaN (вбудований `min(nan, 1)` повертає nan або 1 залежно від порядку)
 * і працюють поелементно, якщо праву частину колись обчислять на масивах.
 *
 * Константа `pi`/`e` друкується як `np.pi`/`np.e`, лише якщо `names` її не перевизначає.
 */
export function toPython(ast: Expr, names: NameMap = (n) => n, isUserName: (n: string) => boolean = () => false): string {
  return printWith(ast, {
    num: (x) => (x === Infinity ? "np.inf" : Number.isNaN(x) ? "np.nan" : formatNumber(x)),
    name: (n) => (!isUserName(n) && (n === "pi" || n === "π") ? "np.pi" : !isUserName(n) && n === "e" ? "np.e" : names(n)),
    powOp: "**",
    call: (fn, args) => {
      if ((fn === "min" || fn === "max") && args.length > 2) {
        let r = args[0];
        for (let k = 1; k < args.length; k++) r = `${PY_FN[fn]}(${r}, ${args[k]})`;
        return r;
      }
      return `${PY_FN[fn]}(${args.join(", ")})`;
    },
  });
}

const M_FN: Record<FnName, string> = {
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "asin",
  acos: "acos",
  atan: "atan",
  atan2: "atan2",
  sinh: "sinh",
  cosh: "cosh",
  tanh: "tanh",
  exp: "exp",
  log: "log",
  ln: "log",
  log10: "log10",
  sqrt: "sqrt",
  abs: "abs",
  sign: "sign",
  min: "min",
  max: "max",
  pow: "power",
  floor: "floor",
  ceil: "ceil",
};

/**
 * Друк для MATLAB / GNU Octave (скалярні вирази): `^`, `log` (натуральний), `abs`, `min`/`max` (вкладено для 3+
 * аргументів), `atan2`, `pi`, `exp(1)` замість `e`. Степінь у степені завжди в дужках (у MATLAB `^` лівоасоціативний).
 */
export function toMatlab(ast: Expr, names: NameMap = (n) => n, isUserName: (n: string) => boolean = () => false): string {
  return printWith(ast, {
    num: (x) => (x === Infinity ? "Inf" : Number.isNaN(x) ? "NaN" : formatNumber(x)),
    name: (n) => (!isUserName(n) && (n === "pi" || n === "π") ? "pi" : !isUserName(n) && n === "e" ? "exp(1)" : names(n)),
    powOp: "^",
    call: (fn, args) => {
      if ((fn === "min" || fn === "max") && args.length > 2) {
        let r = args[0];
        for (let k = 1; k < args.length; k++) r = `${M_FN[fn]}(${r}, ${args[k]})`;
        return r;
      }
      return `${M_FN[fn]}(${args.join(", ")})`;
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Printing: TeX (KaTeX)
// ---------------------------------------------------------------------------------------------------------------------

const GREEK_UNICODE: Record<string, string> = {
  α: "\\alpha",
  β: "\\beta",
  γ: "\\gamma",
  δ: "\\delta",
  ε: "\\varepsilon",
  ϵ: "\\epsilon",
  ζ: "\\zeta",
  η: "\\eta",
  θ: "\\theta",
  ϑ: "\\vartheta",
  ι: "\\iota",
  κ: "\\kappa",
  λ: "\\lambda",
  μ: "\\mu",
  ν: "\\nu",
  ξ: "\\xi",
  ο: "o",
  π: "\\pi",
  ρ: "\\rho",
  σ: "\\sigma",
  ς: "\\varsigma",
  τ: "\\tau",
  υ: "\\upsilon",
  φ: "\\varphi",
  ϕ: "\\phi",
  χ: "\\chi",
  ψ: "\\psi",
  ω: "\\omega",
  Γ: "\\Gamma",
  Δ: "\\Delta",
  Θ: "\\Theta",
  Λ: "\\Lambda",
  Ξ: "\\Xi",
  Π: "\\Pi",
  Σ: "\\Sigma",
  Υ: "\\Upsilon",
  Φ: "\\Phi",
  Ψ: "\\Psi",
  Ω: "\\Omega",
};

const GREEK_ASCII: Record<string, string> = {
  alpha: "\\alpha",
  beta: "\\beta",
  gamma: "\\gamma",
  delta: "\\delta",
  epsilon: "\\varepsilon",
  eps: "\\varepsilon",
  zeta: "\\zeta",
  eta: "\\eta",
  theta: "\\theta",
  iota: "\\iota",
  kappa: "\\kappa",
  lambda: "\\lambda",
  lam: "\\lambda",
  mu: "\\mu",
  nu: "\\nu",
  xi: "\\xi",
  pi: "\\pi",
  rho: "\\rho",
  sigma: "\\sigma",
  tau: "\\tau",
  upsilon: "\\upsilon",
  phi: "\\varphi",
  chi: "\\chi",
  psi: "\\psi",
  omega: "\\omega",
  Gamma: "\\Gamma",
  Delta: "\\Delta",
  Theta: "\\Theta",
  Lambda: "\\Lambda",
  Xi: "\\Xi",
  Pi: "\\Pi",
  Sigma: "\\Sigma",
  Upsilon: "\\Upsilon",
  Phi: "\\Phi",
  Psi: "\\Psi",
  Omega: "\\Omega",
};

const SUBSCRIPT_DIGITS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

function texBase(s: string): string {
  if (GREEK_ASCII[s]) return GREEK_ASCII[s] + " ";
  const chars = Array.from(s);
  if (chars.length === 1) {
    const c = chars[0];
    if (GREEK_UNICODE[c]) return GREEK_UNICODE[c] + " ";
    if (/^[A-Za-z]$/.test(c)) return c;
    return `\\text{${c}}`;
  }
  if (/^[A-Za-z]+$/.test(s)) return `\\mathrm{${s}}`;
  if (chars.every((c) => GREEK_UNICODE[c] || /[A-Za-z0-9]/.test(c))) return chars.map((c) => (GREEK_UNICODE[c] ? GREEK_UNICODE[c] + " " : c)).join("");
  return `\\text{${s}}`;
}

/**
 * Ім'я змінної/параметра в TeX: `u1 → u_{1}`, `u₁ → u_{1}`, `k_f → k_{f}`, `σ → \sigma`, `eps → \varepsilon`,
 * `omega0 → \omega_{0}`, `Ca → \mathrm{Ca}`.
 */
export function nameToTex(name: string): string {
  let n = Array.from(name)
    .map((c) => SUBSCRIPT_DIGITS[c] ?? c)
    .join("");
  let sub = "";
  const us = n.indexOf("_");
  if (us > 0) {
    sub = n.slice(us + 1);
    n = n.slice(0, us);
  } else {
    const m = /^(.*?)(\d+)$/u.exec(n);
    if (m && m[1]) {
      n = m[1];
      sub = m[2];
    }
  }
  const base = texBase(n).trimEnd();
  if (!sub) return base;
  const subTex = /^\d+$/.test(sub) ? sub : sub.split("_").filter(Boolean).map((p) => texBase(p).trimEnd()).join(",");
  return `${base}_{${subTex}}`;
}

/**
 * Число для TeX без втрати точності: `3e7 → 3\cdot 10^{7}`, `1e-4 → 10^{-4}`, `0.04 → 0.04`; довгі десяткові, що
 * ТОЧНО (у double) дорівнюють простому дробу чи кратному π, — `8/3 → \frac{8}{3}`, `2π/10 → 0.2\pi`.
 */
export function numberToTex(x: number): string {
  if (x === Infinity) return "\\infty";
  if (x === -Infinity) return "-\\infty";
  if (Number.isNaN(x)) return "\\mathrm{NaN}";
  if (x < 0) return `-${numberToTex(-x)}`;
  if (formatNumber(x).replace(/^0\.|\./, "").length > 8) {
    for (let q = 2; q <= 12; q++) {
      const p = Math.round(x * q);
      if (p > 0 && p < 10000 && p / q === x) return `\\frac{${p}}{${q}}`;
    }
    const k = Number((x / Math.PI).toPrecision(10));
    if (k > 0 && k * Math.PI === x && String(k).length <= 5) return k === 1 ? "\\pi" : `${k}\\pi`;
    for (let q = 2; q <= 12; q++) {
      const p = Math.round((x / Math.PI) * q);
      if (p > 0 && p < 1000 && (p * Math.PI) / q === x) return `\\frac{${p === 1 ? "" : p}\\pi}{${q}}`;
    }
  }
  const a = Math.abs(x);
  // round big/small numbers read better as powers of ten: 10000 → 10^{4}, 0.0005 → 5·10^{-4}
  const e = x.toExponential().replace("e+", "e");
  const s = a !== 0 && (a >= 1e4 || a < 1e-3) && e.split("e")[0].replace("-", "").length <= 4 ? e : formatNumber(x);
  const m = /^(-?)([\d.]+)e(-?\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, mant, ex] = m;
  return mant === "1" ? `${sign}10^{${ex}}` : `${sign}${mant}\\cdot 10^{${ex}}`;
}

const TEX_FN: Partial<Record<FnName, string>> = {
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  asin: "\\arcsin",
  acos: "\\arccos",
  atan: "\\arctan",
  sinh: "\\sinh",
  cosh: "\\cosh",
  tanh: "\\tanh",
  log: "\\ln",
  ln: "\\ln",
  log10: "\\log_{10}",
  min: "\\min",
  max: "\\max",
  sign: "\\operatorname{sign}",
  atan2: "\\operatorname{atan2}",
};

/**
 * Друк у TeX для KaTeX: `\frac{a}{b}`, степені `x^{2}`, `e^{x}` для `exp`, `\sqrt{}`, `\left|…\right|`,
 * `\sin`, `\ln`, грецькі імена, мінімальні дужки за пріоритетом (структура AST зберігається).
 * @param texName — власне перетворення імен (за замовчуванням {@link nameToTex}); константи `pi`/`e` друкуються
 *   як `\pi`/`e`, якщо `isUserName` не каже, що це ім'я користувача.
 */
export function toTex(ast: Expr, texName: (n: string) => string = nameToTex, isUserName: (n: string) => boolean = () => false): string {
  const lr = (s: string) => (s.includes("\\frac") || s.includes("\\left") ? `\\left(${s}\\right)` : `(${s})`);
  const paren = (p: Printed, need: boolean) => (need ? lr(p.s) : p.s);
  const startsWithDigit = (s: string) => /^[\d.]/.test(s);
  const rec = (n: Expr): Printed => {
    switch (n.type) {
      case "num": {
        const s = numberToTex(Math.abs(n.value));
        return n.value < 0 ? { s: `-${s}`, prec: P_UNARY } : { s, prec: /\\cdot|\\pi|\\frac/.test(s) ? P_MUL : P_ATOM };
      }
      case "sym": {
        if (!isUserName(n.name) && (n.name === "pi" || n.name === "π")) return { s: "\\pi", prec: P_ATOM };
        if (!isUserName(n.name) && n.name === "e") return { s: "e", prec: P_ATOM };
        return { s: texName(n.name), prec: P_ATOM };
      }
      case "neg": {
        const a = rec(n.arg);
        return { s: `-${paren(a, a.prec < P_MUL)}`, prec: Math.min(P_UNARY, Math.max(a.prec, P_MUL)) };
      }
      case "bin": {
        if ((n.op === "+" || n.op === "-") && (n.right.type === "neg" || (n.right.type === "num" && n.right.value < 0))) {
          const inner: Expr = n.right.type === "neg" ? n.right.arg : { type: "num", value: -n.right.value };
          return rec({ type: "bin", op: n.op === "+" ? "-" : "+", left: n.left, right: inner });
        }
        if (n.op === "/") return { s: `\\frac{${rec(n.left).s}}{${rec(n.right).s}}`, prec: P_ATOM };
        const a = rec(n.left),
          b = rec(n.right);
        if (n.op === "^") {
          const baseIsFrac = a.s.startsWith("\\frac");
          return { s: `${paren(a, a.prec <= P_POW || baseIsFrac)}^{${b.s}}`, prec: P_POW };
        }
        if (n.op === "*") {
          const left = paren(a, a.prec < P_MUL);
          const right = paren(b, b.prec < P_MUL || b.prec === P_UNARY);
          // a space (ignored by TeX) keeps macros apart: «\sigma x»; numbers are separated by a dot: «x\cdot 2»
          const sep = startsWithDigit(right) || (/\d\}?$/.test(left) && right.startsWith("\\frac")) ? "\\cdot " : " ";
          return { s: `${left}${sep}${right}`, prec: P_MUL };
        }
        // + and −: keep explicit grouping of the right operand (a − (b + c)); a + (b + c) is shown without parentheses
        const rightNeed = n.op === "-" ? b.prec <= P_ADD : false;
        return { s: `${a.s} ${n.op} ${paren(b, rightNeed)}`, prec: P_ADD };
      }
      case "call": {
        const args = n.args.map((x) => rec(x).s);
        switch (n.fn) {
          case "exp":
            return { s: `e^{${args[0]}}`, prec: P_POW };
          case "sqrt":
            return { s: `\\sqrt{${args[0]}}`, prec: P_ATOM };
          case "abs":
            return { s: `\\left|${args[0]}\\right|`, prec: P_ATOM };
          case "floor":
            return { s: `\\left\\lfloor ${args[0]}\\right\\rfloor`, prec: P_ATOM };
          case "ceil":
            return { s: `\\left\\lceil ${args[0]}\\right\\rceil`, prec: P_ATOM };
          case "pow":
            return rec({ type: "bin", op: "^", left: n.args[0], right: n.args[1] });
          default:
            return { s: `${TEX_FN[n.fn]}\\left(${args.join(", ")}\\right)`, prec: P_ATOM };
        }
      }
    }
  };
  return rec(ast).s;
}
