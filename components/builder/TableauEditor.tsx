"use client";

import { useState } from "react";
import { Say } from "@/components/mode/Mode";
import { copyText } from "@/components/share/clipboard";
import { Tex } from "@/components/ui/Tex";
import {
  BUTCHER_PRESETS,
  KIND_LABEL,
  asFraction,
  MAX_STAGES,
  cellKey,
  emptySrc,
  resizeSrc,
  sameSrc,
  tableauTex,
  type CellRef,
  type ParsedTableau,
  type TableauKind,
  type TableauSrc,
} from "@/lib/butcher";
import { fmt } from "@/lib/format";
import { cellLabel, subscript } from "./theme";

const PLAIN_NUMBER = /^\s*[+\-−]?(\d+\.?\d*|\.\d+)(e[+\-]?\d+)?\s*$/i;

function setCell(src: TableauSrc, ref: CellRef, v: string): TableauSrc {
  const next: TableauSrc = { s: src.s, c: src.c.slice(), b: src.b.slice(), A: src.A.map((r) => r.slice()) };
  if (ref.kind === "c") next.c[ref.i] = v;
  else if (ref.kind === "b") next.b[ref.j] = v;
  else next.A[ref.i][ref.j] = v;
  return next;
}

function Cell({
  refCell,
  text,
  parsed,
  onChange,
  zone,
  warn,
}: {
  refCell: CellRef;
  text: string;
  parsed: ParsedTableau;
  onChange: (v: string) => void;
  /** cell on/above the diagonal: must be 0 for an explicit method */
  zone?: boolean;
  warn?: string;
}) {
  const key = cellKey(refCell);
  const r = parsed.cells[key];
  const bad = r && !r.ok;
  const val = r && r.ok ? r.value : NaN;
  const nonzeroInZone = zone && r?.ok && val !== 0;
  const showVal = r?.ok && text.trim() !== "" && !PLAIN_NUMBER.test(text);
  const ring = bad
    ? "border-[#ff5d73] bg-[#ff5d73]/10 text-white"
    : warn
      ? "border-[#ffb547]/80 bg-[#ffb547]/10 text-white"
      : nonzeroInZone
        ? "border-[#b18cff]/70 bg-[#b18cff]/10 text-white"
        : zone
          ? "border-dashed border-white/15 text-white/70"
          : "border-white/15 bg-white/[0.04] text-white";
  const title = bad
    ? r.error.message
    : warn
      ? warn
      : nonzeroInZone
        ? `${cellLabel(key)} ≠ 0 на діагоналі чи над нею — метод неявний`
        : zone
          ? `${cellLabel(key)}: для явного методу тут має бути 0`
          : `${cellLabel(key)}${r?.ok ? ` = ${val}` : ""}`;
  return (
    <td className="px-0.5 py-1 align-top">
      <input
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-label={cellLabel(key)}
        aria-invalid={bad || undefined}
        title={title}
        placeholder="0"
        className={`w-[5.6rem] rounded-lg border px-1.5 py-1 text-center font-mono text-[12.5px] outline-none transition-colors placeholder:text-white/25 focus:border-[var(--accent)] sm:w-[6.4rem] ${ring}`}
        style={zone && !nonzeroInZone && !bad ? { backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 6px, transparent 6px 12px)" } : undefined}
      />
      <div className="h-3.5 text-center font-mono text-[10px] leading-3.5 text-white/40">{showVal ? `≈ ${fmt(val, 6)}` : ""}</div>
    </td>
  );
}

export default function TableauEditor({
  src,
  onChange,
  parsed,
  kind,
}: {
  src: TableauSrc;
  onChange: (s: TableauSrc) => void;
  parsed: ParsedTableau;
  kind: TableauKind | null;
}) {
  const [showTex, setShowTex] = useState(false);
  const [copied, setCopied] = useState(false);
  const s = src.s;
  const mismatch = new Map(parsed.rowSumMismatch.map((m) => [m.i, m]));
  const active = BUTCHER_PRESETS.find((p) => sameSrc(p.src, src));
  const tex = tableauTex(src);

  /** c_i := Σ_j a_ij — as a simple fraction when it is one, otherwise the full-precision number */
  const fillC = () => {
    const t = parsed.tableau;
    if (!t) return;
    const next: TableauSrc = { ...src, c: src.c.slice() };
    for (let i = 0; i < s; i++) {
      const nz = t.A[i].map((v, j) => (v !== 0 ? j : -1)).filter((j) => j >= 0);
      const sum = t.A[i].reduce((a, v) => a + v, 0);
      const fr = asFraction(sum, 1000);
      // a single nonzero entry: copy its expression as is (keeps sqrt(3)/6 readable)
      if (nz.length === 1) next.c[i] = src.A[i][nz[0]].trim();
      else if (fr) next.c[i] = fr[1] === 1 ? String(fr[0]) : `${fr[0]}/${fr[1]}`;
      else next.c[i] = String(sum);
    }
    onChange(next);
  };

  const groups: { title: string; ids: string[] }[] = [
    { title: "Явні", ids: BUTCHER_PRESETS.filter((p) => p.group === "explicit").map((p) => p.id) },
    { title: "Неявні", ids: BUTCHER_PRESETS.filter((p) => p.group === "implicit").map((p) => p.id) },
    { title: "Свій", ids: BUTCHER_PRESETS.filter((p) => p.group === "empty").map((p) => p.id) },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-[12px] uppercase tracking-wider text-white/40">{g.title}</span>
            {g.ids.map((id) => {
              const p = BUTCHER_PRESETS.find((x) => x.id === id)!;
              const on = active?.id === id;
              return (
                <button
                  key={id}
                  title={`${p.name}${p.about ? ` — ${p.about}` : ""}`}
                  onClick={() => onChange(structuredClone(p.src))}
                  className={`rounded-full border px-3 py-1 text-[12.5px] transition-all ${
                    on
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white shadow-[0_0_18px_-6px_var(--accent)]"
                      : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {p.short}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-white/70">Стадій s:</span>
          {Array.from({ length: MAX_STAGES }, (_, k) => k + 1).map((k) => (
            <button
              key={k}
              onClick={() => k !== s && onChange(resizeSrc(src, k))}
              className={`h-7 w-7 rounded-full border font-mono text-[12.5px] transition-all ${
                k === s ? "border-[var(--accent)] bg-[var(--accent)]/20 text-white" : "border-white/10 text-white/55 hover:border-white/30 hover:text-white"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          <button
            onClick={() => setShowTex((v) => !v)}
            title="Показати таблицю KaTeX-масивом і скопіювати TeX-код"
            className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[12.5px] text-white/80 hover:border-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            {showTex ? "Сховати TeX" : "∑ Транспонувати в TeX"}
          </button>
          <button
            onClick={fillC}
            disabled={!parsed.tableau}
            title="Записати в c_i суму рядка A (умова c = A·1)"
            className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[12.5px] text-white/80 hover:border-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            c = A·1
          </button>
          <button
            onClick={() => onChange(emptySrc(s))}
            className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[12.5px] text-white/80 hover:border-[#ff5d73] hover:bg-[#ff5d73]/10"
          >
            Очистити
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25 p-2 sm:p-3">
        <table className="mx-auto border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] text-white/40">
              <th className="px-1 pb-1 font-normal">c</th>
              <th className="w-2" />
              {Array.from({ length: s }, (_, j) => (
                <th key={j} className="px-1 pb-1 font-normal">
                  j = {j + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: s }, (_, i) => (
              <tr key={i}>
                <Cell
                  refCell={{ kind: "c", i }}
                  text={src.c[i]}
                  parsed={parsed}
                  onChange={(v) => onChange(setCell(src, { kind: "c", i }, v))}
                  warn={mismatch.has(i) ? `c${subscript(i + 1)} ≠ Σⱼ a${subscript(i + 1)}ⱼ = ${fmt(mismatch.get(i)!.rowSum, 8)}` : undefined}
                />
                <td className="border-r-2 border-white/40" />
                {Array.from({ length: s }, (_, j) => (
                  <Cell
                    key={j}
                    refCell={{ kind: "A", i, j }}
                    text={src.A[i][j]}
                    parsed={parsed}
                    zone={j >= i}
                    onChange={(v) => onChange(setCell(src, { kind: "A", i, j }, v))}
                  />
                ))}
              </tr>
            ))}
            <tr>
              <td colSpan={s + 2} className="border-t-2 border-white/40 p-0" />
            </tr>
            <tr>
              <td className="px-1 text-center text-[11px] text-white/40">b</td>
              <td className="border-r-2 border-white/40" />
              {Array.from({ length: s }, (_, j) => (
                <Cell key={j} refCell={{ kind: "b", j }} text={src.b[j]} parsed={parsed} onChange={(v) => onChange(setCell(src, { kind: "b", j }, v))} />
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-white/50">
        <span>
          <span className="mr-1 inline-block h-2.5 w-4 rounded-sm border border-dashed border-white/30 align-middle" /> на діагоналі й вище: 0 для явного методу
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-4 rounded-sm border border-[#b18cff]/70 bg-[#b18cff]/20 align-middle" /> ненуль там — метод неявний
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-4 rounded-sm border border-[#ffb547]/80 bg-[#ffb547]/20 align-middle" /> c ≠ A·1
        </span>
        <span>Порожня клітинка = 0. Можна писати 1/3, sqrt(3)/6, 1 - 1/sqrt(2), 0.5, pi/4.</span>
      </div>

      {kind && !parsed.errors.length && (
        <div className="text-[13px] text-white/70">
          Тип: <b className="text-white">{s === 1 && kind !== "explicit" ? "неявний (одна стадія)" : KIND_LABEL[kind]}</b>
          {active ? (
            <>
              {" "}
              · пресет «{active.name}»
            </>
          ) : null}
        </div>
      )}

      {parsed.errors.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-[#ff5d73]/40 bg-[#ff5d73]/[0.07] p-3 text-[13px]" role="alert">
          <div className="font-semibold text-white">
            Помилки в клітинках ({parsed.errors.length}) — аналіз нижче показує останню коректну таблицю
          </div>
          {parsed.errors.map((e) => {
            const text = e.ref.kind === "c" ? src.c[e.ref.i] : e.ref.kind === "b" ? src.b[e.ref.j] : src.A[e.ref.i][e.ref.j];
            const a = Math.max(0, Math.min(e.error.pos, text.length));
            const b = Math.max(a + 1, Math.min(e.error.end ?? a + 1, text.length));
            return (
              <div key={e.key} className="flex flex-wrap items-baseline gap-x-2 text-white/80">
                <b className="font-mono text-[#ff9aa8]">{cellLabel(e.key)}</b>
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12px]">
                  {text.slice(0, a)}
                  <mark className="rounded-sm bg-[#ff5d73]/60 text-white">{text.slice(a, b) || " "}</mark>
                  {text.slice(b)}
                </code>
                <span>
                  {e.error.message} (позиція {e.error.pos + 1})
                </span>
              </div>
            );
          })}
        </div>
      )}

      {parsed.rowSumMismatch.length > 0 && (
        <div className="rounded-xl border border-[#ffb547]/35 bg-[#ffb547]/[0.07] p-3 text-[13px] text-white/80">
          <Say
            simple={
              <>
                ⚠️ Моменти c не збігаються із сумами рядків A ({parsed.rowSumMismatch.map((m) => `c${subscript(m.i + 1)} = ${fmt(m.c, 5)}, сума = ${fmt(m.rowSum, 5)}`).join("; ")}). Для
                задач, де f залежить від t, «розвідка» робиться не в той момент — порядок може впасти. Кнопка «c = A·1» виправить.
              </>
            }
          >
            ⚠️ Порушено <Tex>{"c_i=\\sum_j a_{ij}"}</Tex>: {parsed.rowSumMismatch.map((m) => `c${subscript(m.i + 1)} = ${fmt(m.c, 6)} ≠ ${fmt(m.rowSum, 6)}`).join("; ")}. Це попередження, не
            помилка: для автономних задач порядок визначають лише A і b, а для неавтономних додаються умови з «часовими» листками (c замість A·1) — паспорт
            перевіряє обидва варіанти.
          </Say>
        </div>
      )}

      {showTex && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Tex block>{tex}</Tex>
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-2 font-mono text-[11.5px] text-white/75">{tex}</pre>
            <button
              onClick={async () => {
                const ok = await copyText(tex);
                setCopied(ok);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/80 hover:bg-white/10"
            >
              {copied ? "✓ Скопійовано" : "Копіювати"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
