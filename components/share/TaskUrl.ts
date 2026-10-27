/**
 * Кодеки `useUrlState` для сторінок задач з перевіркою меж: значення з адреси поза діапазоном слайдера вважається
 * недійсним і замінюється на типове. Так підправлене вручну посилання (`?h=1e-12`) не «повісить» сторінку
 * мільйонами кроків, а список методів містить лише ті, що є в перемикачі сторінки.
 *
 * @module TaskUrl
 */
import { useCallback, type SetStateAction } from "react";
import type { MethodId } from "@/lib/ode";
import { codecs, useUrlState, type UrlCodec } from "@/lib/url-state";
import { tidy } from "./TaskExports";

export { tidy };

/** Число з [min, max] (межі включно; невелика відносна похибка 1e-9 допускається). */
export function numIn(min: number, max: number): UrlCodec<number> {
  const slack = 1e-9 * Math.max(Math.abs(min), Math.abs(max));
  return {
    encode: codecs.number.encode,
    decode: (s) => {
      const v = codecs.number.decode(s);
      return v !== undefined && v >= min - slack && v <= max + slack ? v : undefined;
    },
  };
}

/** Ціле число з [min, max]. */
export function intIn(min: number, max: number): UrlCodec<number> {
  return {
    encode: codecs.int.encode,
    decode: (s) => {
      const v = codecs.int.decode(s);
      return v !== undefined && v >= min && v <= max ? v : undefined;
    },
  };
}

/** Одне з дозволених чисел (напр. відрізки T = 40, 4·10⁵, 10¹¹), записане компактно. */
export function numOneOf(values: readonly number[]): UrlCodec<number> {
  return {
    encode: codecs.number.encode,
    decode: (s) => {
      const v = codecs.number.decode(s);
      return v === undefined ? undefined : values.find((x) => x === v || Math.abs(x - v) <= 1e-12 * Math.abs(x));
    },
  };
}

/** Вектор чисел через кому ("2,10,0.1"): рівно `bounds.length` компонент, i-та — з [bounds[i][0], bounds[i][1]]. */
export function numsIn(bounds: readonly (readonly [number, number])[]): UrlCodec<number[]> {
  const items = bounds.map(([lo, hi]) => numIn(lo, hi));
  return {
    encode: codecs.numbers.encode,
    decode: (s) => {
      const parts = s.split(",");
      if (parts.length !== items.length) return undefined;
      const out = parts.map((p, i) => items[i].decode(p));
      return out.every((x) => x !== undefined) ? (out as number[]) : undefined;
    },
  };
}

/** Список методів сторінки ("euler,ros"): лише з перемикача сторінки, без повторів. */
export function methodsIn(allowed: readonly MethodId[]): UrlCodec<MethodId[]> {
  return codecs.strings<MethodId>(allowed);
}

/**
 * `useUrlState` для числового параметра з повзунка: значення з адреси — лише з [min, max] ({@link numIn}),
 * а нове значення проходить `tidy` (шум округлення повзунків з кроком: `Math.round(v / step) * step`), тож в адресі й у згенерованому коді `T=4.1`, а не `T=4.1000000000000005`.
 */
export function useUrlNum(key: string, initial: number, min: number, max: number): [number, (v: SetStateAction<number>) => void] {
  const [value, set] = useUrlState(key, initial, numIn(min, max));
  const setTidy = useCallback((v: SetStateAction<number>) => set(typeof v === "function" ? (p) => tidy(v(p)) : tidy(v)), [set]);
  return [value, setTidy];
}
