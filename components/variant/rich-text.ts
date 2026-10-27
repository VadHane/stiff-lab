/** Текст питання з формулами в `$…$`: розбиття на звичайний текст і TeX (для React і для друку). */
export interface RichPart {
  tex: boolean;
  v: string;
}

export function splitTex(s: string): RichPart[] {
  const out: RichPart[] = [];
  const re = /\$([^$]+)\$/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > i) out.push({ tex: false, v: s.slice(i, m.index) });
    out.push({ tex: true, v: m[1] });
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push({ tex: false, v: s.slice(i) });
  return out;
}

/** Текст без формул (для CSV і підказок): `$u_{2}(T)$` → `u_{2}(T)`. */
export const plainTex = (s: string) => s.replace(/\$([^$]+)\$/g, "$1");
