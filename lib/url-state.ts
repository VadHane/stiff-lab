/**
 * Стан сторінки в адресі (`?h=0.002&m=euler,ieuler&eps=1e-3`), щоб посиланням можна було поділитися «тією самою
 * картиною». `useUrlState` — як `useState`, але:
 * - при першому рендері на клієнті читає значення з `window.location.search` (на сервері — `initial`);
 * - при зміні оновлює адресу через `history.replaceState` з дебаунсом ~250 мс, зберігаючи інші ключі й `#hash`,
 *   не додаючи записів в історію; значення, що дорівнює `initial`, з адреси прибирається (короткі посилання);
 * - невалідне значення в адресі тихо замінюється на `initial`.
 *
 * `useSearchParams` навмисно НЕ використовується: зі статичним експортом він вимагає `<Suspense>`, а сторінки задач
 * і так рендеряться лише на клієнті (`dynamic(…, { ssr: false })`). Якщо хук викликати в компоненті, який
 * рендериться на сервері, перший клієнтський рендер може не збігтися з серверним (hydration mismatch) — для
 * таких компонентів читайте значення в `useEffect`.
 *
 * Ключі мають бути унікальними в межах сторінки й короткими (`h`, `T`, `m`, `eps`).
 *
 * @module url-state
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { MethodId } from "./ode";

// ---------------------------------------------------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------------------------------------------------

/** Перетворення значення ⇄ рядок в адресі. `decode` повертає `undefined` для невалідного рядка. */
export interface UrlCodec<T> {
  encode(v: T): string;
  decode(s: string): T | undefined;
}

/**
 * Найкоротший запис числа без втрати точності: коротше з `String(x)` і `x.toExponential()` (обидва — найкоротші
 * round-trip представлення), без «+» в експоненті: `0.001 → "1e-3"`, `30000000 → "3e7"`, `0.55 → "0.55"`.
 */
export function encodeNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (Object.is(x, -0)) return "0";
  const a = String(x).replace("e+", "e");
  const b = x.toExponential().replace("e+", "e").replace(/e0$/, "");
  return b.length < a.length ? b : a;
}

function decodeNumber(s: string): number | undefined {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s.trim())) return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

function utf8ToBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const ALL_METHODS: readonly MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "dopri", "ros", "thetaA"];

/** Готові кодеки. */
export const codecs = {
  /** число з плаваючою комою, компактно і без втрати точності */
  number: {
    encode: encodeNumber,
    decode: decodeNumber,
  } satisfies UrlCodec<number>,

  /** ціле число */
  int: {
    encode: (v: number) => String(Math.round(v)),
    decode: (s: string) => (/^[+-]?\d+$/.test(s.trim()) ? Number.parseInt(s, 10) : undefined),
  } satisfies UrlCodec<number>,

  /** логічне значення: "1"/"0" (при читанні також "true"/"false") */
  boolean: {
    encode: (v: boolean) => (v ? "1" : "0"),
    decode: (s: string) => (s === "1" || s === "true" ? true : s === "0" || s === "false" ? false : undefined),
  } satisfies UrlCodec<boolean>,

  /** рядок як є */
  string: {
    encode: (v: string) => v,
    decode: (s: string) => s,
  } satisfies UrlCodec<string>,

  /** одне зі значень переліку (інше → недійсне) */
  enum<T extends string | number>(values: readonly T[]): UrlCodec<T> {
    return {
      encode: (v) => String(v),
      decode: (s) => values.find((v) => String(v) === s),
    };
  },

  /** масив чисел через кому: "0.1,1e-3,5" */
  numbers: {
    encode: (v: number[]) => v.map(encodeNumber).join(","),
    decode: (s: string) => {
      if (s === "") return [];
      const out = s.split(",").map(decodeNumber);
      return out.every((x) => x !== undefined) ? (out as number[]) : undefined;
    },
  } satisfies UrlCodec<number[]>,

  /**
   * Масив рядків через кому (кома в елементі екранується як %2C). `allowed` — дозволені значення: невідомі елементи
   * відкидаються, повтори теж; якщо після фільтрації нічого не лишилося, а рядок був непорожній — значення недійсне.
   */
  strings<T extends string = string>(allowed?: readonly T[]): UrlCodec<T[]> {
    return {
      encode: (v) => v.map((x) => x.replace(/%/g, "%25").replace(/,/g, "%2C")).join(","),
      decode: (s) => {
        if (s === "") return [];
        let items: string[];
        try {
          items = s.split(",").map((x) => decodeURIComponent(x));
        } catch {
          return undefined;
        }
        const out = (allowed ? items.filter((x) => (allowed as readonly string[]).includes(x)) : items).filter((x, i, a) => a.indexOf(x) === i);
        return out.length || !items.length ? (out as T[]) : undefined;
      },
    };
  },

  /** список методів (`MethodId[]`): "euler,ros"; невідомі ідентифікатори відкидаються */
  get methods(): UrlCodec<MethodId[]> {
    return codecs.strings<MethodId>(ALL_METHODS);
  },

  /**
   * Довільний JSON у base64url (UTF-8) — для складних об'єктів, напр. своєї системи рівнянь.
   * `sanitize` перевіряє розібране значення (напр. `sanitizeSpec` з problem-spec.ts) і повертає чисту копію
   * або `null`/`undefined` для недійсного.
   */
  json<T>(sanitize?: (x: unknown) => T | null | undefined): UrlCodec<T> {
    return {
      encode: (v) => utf8ToBase64Url(JSON.stringify(v)),
      decode: (s) => {
        try {
          const x: unknown = JSON.parse(base64UrlToUtf8(s));
          const r = sanitize ? sanitize(x) : (x as T);
          return r === null || r === undefined ? undefined : r;
        } catch {
          return undefined;
        }
      },
    };
  },
};

/** Кодек за типом початкового значення: number → number, boolean, string, number[] → numbers, string[] → strings, інше → json. */
export function inferCodec<T>(initial: T): UrlCodec<T> {
  let c: UrlCodec<unknown>;
  if (typeof initial === "number") c = codecs.number;
  else if (typeof initial === "boolean") c = codecs.boolean;
  else if (typeof initial === "string") c = codecs.string;
  else if (Array.isArray(initial) && initial.every((x) => typeof x === "number")) c = codecs.numbers;
  else if (Array.isArray(initial) && initial.every((x) => typeof x === "string")) c = codecs.strings();
  else c = codecs.json();
  return c as UrlCodec<T>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Address bar (batched, debounced)
// ---------------------------------------------------------------------------------------------------------------------

/** Затримка запису в адресу після останньої зміни, мс. */
export const URL_DEBOUNCE_MS = 250;

const pending = new Map<string, string | null>();
let pendingPath: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const hasWindow = () => typeof window !== "undefined";

/** Мінімальне кодування значення в query: коми й двокрапки лишаються читабельними. */
const encodeQueryPart = (s: string) => encodeURIComponent(s).replace(/%2C/gi, ",").replace(/%3A/gi, ":");

function buildUrl(params: URLSearchParams): string {
  const parts: string[] = [];
  params.forEach((v, k) => parts.push(`${encodeQueryPart(k)}=${encodeQueryPart(v)}`));
  const { pathname, hash } = window.location;
  return pathname + (parts.length ? `?${parts.join("&")}` : "") + hash;
}

function replaceUrl(url: string) {
  const { pathname, search, hash } = window.location;
  if (url === pathname + search + hash) return;
  // null state: Next.js (App Router) patches replaceState, keeps its own state and syncs the router (docs: «Native History API»)
  window.history.replaceState(null, "", url);
}

function scheduleWrite(key: string, enc: string | null) {
  if (!hasWindow()) return;
  const path = window.location.pathname;
  if (pendingPath !== null && pendingPath !== path) pending.clear();
  pendingPath = path;
  pending.set(key, enc);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushUrlState, URL_DEBOUNCE_MS);
}

/** Негайно записує відкладені зміни в адресу (викликається і з {@link currentShareUrl}). */
export function flushUrlState(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!hasWindow() || !pending.size) return;
  // the user navigated to another page before the debounce fired: those keys belong to the old page
  if (window.location.pathname !== pendingPath) {
    pending.clear();
    return;
  }
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of pending) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  pending.clear();
  replaceUrl(buildUrl(params));
}

/** Прочитати значення ключа з поточної адреси (undefined — немає або недійсне). Безпечно на сервері. */
export function readUrlValue<T>(key: string, codec: UrlCodec<T>): T | undefined {
  if (!hasWindow()) return undefined;
  const raw = new URLSearchParams(window.location.search).get(key);
  if (raw === null) return undefined;
  try {
    return codec.decode(raw);
  } catch {
    return undefined;
  }
}

/**
 * Негайно прибирає з адреси вказані ключі (типово — усі параметри запиту), не змінюючи стану React.
 * Щоб скинути і стан, використовуйте {@link useUrlStateReset}.
 */
export function clearUrlState(keys?: readonly string[]): void {
  if (!hasWindow()) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const params = new URLSearchParams(window.location.search);
  if (keys) {
    for (const k of keys) {
      params.delete(k);
      pending.delete(k);
    }
    // other pending keys are still valid: write them now
    for (const [k, v] of pending) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    pending.clear();
    replaceUrl(buildUrl(params));
  } else {
    pending.clear();
    replaceUrl(buildUrl(new URLSearchParams()));
  }
}

/** Повна адреса поточної сторінки з УСІМ станом (відкладені зміни записуються негайно). "" на сервері. */
export function currentShareUrl(): string {
  if (!hasWindow()) return "";
  flushUrlState();
  return window.location.href;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------------------------------

interface Entry {
  key: string;
  reset: () => void;
}
const registry = new Set<Entry>();

/**
 * Як `useState`, але значення живе ще й в адресі сторінки під ключем `key`.
 * @param initial  значення за замовчуванням (береться з ПЕРШОГО рендера; масиви/об'єкти можна створювати інлайн)
 * @param codec    перетворення в рядок; типово виводиться з типу `initial` ({@link inferCodec})
 * @example
 *   const [h, setH] = useUrlState("h", 0.002);
 *   const [methods, setMethods] = useUrlState<MethodId[]>("m", ["euler", "ros"], codecs.methods);
 *   const [form, setForm] = useUrlState("form", "log" as Form, codecs.enum(["orig", "log"] as const));
 */
export function useUrlState<T>(key: string, initial: T, codec?: UrlCodec<T>): [T, Dispatch<SetStateAction<T>>] {
  const codecRef = useRef<UrlCodec<T> | null>(null);
  if (!codecRef.current) codecRef.current = codec ?? inferCodec(initial);
  const c = codecRef.current;
  const initialRef = useRef(initial);
  const [value, setValue] = useState<T>(() => readUrlValue(key, c) ?? initial);

  useEffect(() => {
    let enc: string;
    let def: string;
    try {
      enc = c.encode(value);
      def = c.encode(initialRef.current);
    } catch {
      return;
    }
    scheduleWrite(key, enc === def ? null : enc);
  }, [key, value, c]);

  useEffect(() => {
    const entry: Entry = { key, reset: () => setValue(initialRef.current) };
    registry.add(entry);
    return () => {
      registry.delete(entry);
    };
  }, [key]);

  return [value, setValue];
}

/**
 * Функція, що повертає ВСІ `useUrlState` поточної сторінки до початкових значень і одразу прибирає їхні ключі
 * з адреси (кнопка «Скинути параметри»).
 */
export function useUrlStateReset(): () => void {
  return useCallback(() => {
    const keys = [...registry].map((e) => e.key);
    for (const e of registry) e.reset();
    clearUrlState(keys);
  }, []);
}
