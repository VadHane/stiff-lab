/**
 * Маленький підсвічувач коду Python / MATLAB без залежностей: коментарі, рядки, числа, ключові слова.
 * Повертає токени; рендер — у компоненті (span з класом).
 */
export type TokKind = "plain" | "comment" | "string" | "number" | "keyword" | "builtin";
export interface Tok {
  kind: TokKind;
  text: string;
}

const PY_KW = new Set([
  "def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "None", "True", "False", "import", "from",
  "as", "try", "except", "finally", "break", "continue", "pass", "lambda", "with", "raise", "class", "global", "nonlocal", "yield",
]);
const PY_BUILTIN = new Set(["np", "plt", "solve_ivp", "print", "range", "len", "max", "min", "abs", "list", "float", "int", "any", "all"]);
const M_KW = new Set([
  "function", "end", "if", "elseif", "else", "for", "while", "switch", "case", "otherwise", "return", "break", "continue", "try",
  "catch", "true", "false",
]);
const M_BUILTIN = new Set([
  "ode45", "ode23s", "odeset", "fprintf", "sprintf", "strtrim", "figure", "subplot", "plot", "hold", "grid", "legend", "xlabel",
  "ylabel", "zeros", "eye", "numel", "size", "isempty", "isfinite", "isnan", "any", "strcmp", "max", "min", "abs", "round", "struct", "cell",
]);

const NUM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

export function highlight(code: string, lang: "python" | "matlab"): Tok[] {
  const out: Tok[] = [];
  const push = (kind: TokKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  const n = code.length;
  // MATLAB: a quote right after an identifier, number, closing bracket, dot or another quote (no space) is a transpose
  while (i < n) {
    const ch = code[i];
    const rest = code.slice(i, i + 400);
    if (lang === "python" && ch === "#") {
      const e = code.indexOf("\n", i);
      const end = e < 0 ? n : e;
      push("comment", code.slice(i, end));
      i = end;
      continue;
    }
    if (lang === "matlab" && ch === "%") {
      const e = code.indexOf("\n", i);
      const end = e < 0 ? n : e;
      push("comment", code.slice(i, end));
      i = end;
      continue;
    }
    if (lang === "python" && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const q = code.slice(i, i + 3);
      const e = code.indexOf(q, i + 3);
      const end = e < 0 ? n : e + 3;
      push("string", code.slice(i, end));
      i = end;
      continue;
    }
    if (lang === "python" && (ch === '"' || ch === "'" || ((ch === "f" || ch === "r") && (code[i + 1] === '"' || code[i + 1] === "'")))) {
      const start = i;
      if (ch === "f" || ch === "r") i++;
      const q = code[i];
      i++;
      while (i < n && code[i] !== q && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
      i = Math.min(n, i + 1);
      push("string", code.slice(start, i));
      continue;
    }
    if (lang === "matlab" && ch === "'") {
      const isTranspose = i > 0 && /[A-Za-z0-9_)\]}.']/.test(code[i - 1]);
      if (isTranspose) {
        push("plain", ch);
        i++;
        continue;
      }
      const start = i;
      i++;
      while (i < n && code[i] !== "\n") {
        if (code[i] === "'" && code[i + 1] === "'") i += 2;
        else if (code[i] === "'") {
          i++;
          break;
        } else i++;
      }
      push("string", code.slice(start, i));
      continue;
    }
    const num = /[0-9.]/.test(ch) && !/[A-Za-z_0-9]/.test(code[i - 1] ?? "") ? NUM.exec(rest) : null;
    if (num && num[0] !== ".") {
      push("number", num[0]);
      i += num[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      const w = id[0];
      const kw = lang === "python" ? PY_KW : M_KW;
      const bi = lang === "python" ? PY_BUILTIN : M_BUILTIN;
      push(kw.has(w) ? "keyword" : bi.has(w) ? "builtin" : "plain", w);
      i += w.length;
      continue;
    }
    push("plain", ch);
    i++;
  }
  return out;
}

/** Класи Tailwind для токенів (темне тло). */
export const TOKEN_CLASS: Record<TokKind, string> = {
  plain: "",
  comment: "text-white/40 italic",
  string: "text-[#ffd58a]",
  number: "text-[#7cf2c8]",
  keyword: "text-[#c9a7ff]",
  builtin: "text-[#7cc8ff]",
};
