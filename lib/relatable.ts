// Turn huge numbers into everyday comparisons (Ukrainian).

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.floor(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

function roundNum(v: number): number {
  if (v >= 10) return Math.round(v);
  return Math.round(v * 10) / 10;
}

function fmtNum(v: number): string {
  return v >= 100 ? v.toLocaleString("uk-UA") : String(v).replace(".", ",");
}

/** number + correctly declined unit; `frac` is the form used after a fractional number */
function qty(v: number, forms: [string, string, string], frac: string): string {
  const r = roundNum(v);
  const word = Number.isInteger(r) ? plural(r, forms) : frac;
  return `${fmtNum(r)} ${word}`;
}

/** Human-readable duration for a number of seconds. */
export function duration(sec: number): string {
  if (!Number.isFinite(sec)) return "нескінченність";
  if (sec < 1e-3) return "менше мілісекунди";
  if (sec < 1) return `${fmtNum(roundNum(sec * 1000))} мс`;
  if (sec < 60) return qty(sec, ["секунда", "секунди", "секунд"], "секунди");
  const min = sec / 60;
  if (min < 60) return qty(min, ["хвилина", "хвилини", "хвилин"], "хвилини");
  const h = min / 60;
  if (h < 24) return qty(h, ["година", "години", "годин"], "години");
  const d = h / 24;
  if (d < 365) return qty(d, ["день", "дні", "днів"], "дня");
  const y = d / 365.25;
  if (y < 1e4) return qty(y, ["рік", "роки", "років"], "року");
  if (y < 1e6) return `${fmtNum(roundNum(y / 1000))} тис. років`;
  if (y < 1e9) return `${fmtNum(roundNum(y / 1e6))} млн років`;
  return `${fmtNum(roundNum(y / 1e9))} млрд років`;
}

function epochHint(sec: number): string {
  const y = sec / 3.15576e7;
  if (y > 1.38e10) return " — довше, ніж існує Всесвіт";
  if (y > 4.5e9) return " — довше, ніж існує Земля";
  if (y > 6.6e7) return " — з часів динозаврів";
  if (y > 3e5) return " — довше, ніж існує людство";
  if (y > 1e4) return " — довше, ніж існує цивілізація";
  if (y > 80) return " — довше за людське життя";
  return "";
}

/** "If you did one step per second…" */
export function relatableSteps(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 120) {
    const k = Math.max(1, Math.round(n));
    return `${k} ${plural(k, ["крок", "кроки", "кроків"])} — можна порахувати вручну за кілька хвилин`;
  }
  const human = duration(n);
  const pc = n / 1e8;
  const pcStr = pc < 1 ? "миттєво" : `за ${duration(pc)}`;
  return `якщо робити один крок щосекунди — ${human}${epochHint(n)}; комп'ютер (~10⁸ кроків/с) впорається ${pcStr}`;
}

/** Stiffness ratio as "fastest process lasts 1 s, slowest lasts …". */
export function relatableRatio(r: number): string {
  if (!Number.isFinite(r) || r <= 1) return "";
  return `якби найшвидший процес тривав 1 секунду, найповільніший тривав би ${duration(r)}${epochHint(r)}`;
}

/** Growth factor after n steps, e.g. an error multiplied by R^n. */
export function relatableGrowth(factor: number): string {
  if (!Number.isFinite(factor)) return "нескінченно — число не влазить у комп'ютер";
  if (factor < 1) return `похибка зменшилась у ${qty(1 / factor, ["раз", "рази", "разів"], "раза")}`;
  if (factor < 1e3) return `похибка зросла в ${qty(factor, ["раз", "рази", "разів"], "раза")}`;
  const e = Math.floor(Math.log10(factor));
  const things: [number, string][] = [
    [80, "більше, ніж атомів у видимому Всесвіті (~10⁸⁰)"],
    [50, "більше, ніж атомів у всій Землі (~10⁵⁰)"],
    [23, "більше, ніж молекул у ложці води (~10²³)"],
    [18, "більше, ніж піщинок на всіх пляжах Землі (~10¹⁸)"],
    [13, "більше, ніж клітин у тілі людини (~3·10¹³)"],
    [10, "більше, ніж людей на Землі (~8·10⁹)"],
    [9, "мільярди"],
    [6, "мільйони"],
    [3, "тисячі"],
  ];
  const hit = things.find(([k]) => e >= k);
  return `похибка зросла приблизно в 10^${e} разів${hit ? ` — це ${hit[1]}` : ""}`;
}
