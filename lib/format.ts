export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "—" : v > 0 ? "∞" : "−∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) {
    const [m, e] = v.toExponential(digits - 1).split("e");
    return `${m.replace("-", "−")}·10${sup(e)}`;
  }
  return Number(v.toPrecision(digits)).toString().replace("-", "−");
}

const SUP: Record<string, string> = {
  "-": "⁻",
  "+": "",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};
export function sup(s: string): string {
  return s
    .split("")
    .map((c) => SUP[c] ?? c)
    .join("");
}

export function fmtMs(ms: number): string {
  return ms < 1 ? "<1 мс" : ms < 1000 ? `${ms.toFixed(0)} мс` : `${(ms / 1000).toFixed(2)} с`;
}
