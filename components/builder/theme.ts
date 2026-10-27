/** Акцент сторінки конструктора і колір «вашого» методу на графіках. */
export const BUILDER_ACCENT = "#5ce1e6";

/** Нижні індекси: 12 → «₁₂». */
export function subscript(n: number | string): string {
  const map: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
  return String(n)
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
}

/** Підпис клітинки: c₂, a₃₁, b₄. */
export function cellLabel(key: string): string {
  const m = /^([abc])(\d+)$/.exec(key);
  return m ? `${m[1]}${subscript(m[2])}` : key;
}
