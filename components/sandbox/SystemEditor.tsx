"use client";

import type { ReactNode } from "react";
import type { SpecError } from "@/lib/problem-spec";
import { MAX_DEFS, MAX_PARAMS, MAX_VARS, draftNames, freshName, type Draft, type NumError } from "@/lib/sandbox-spec";
import ExprField, { SmallField, type FieldError } from "./ExprField";

type SetDraft = (fn: (d: Draft) => Draft) => void;

const ADD_BTN =
  "rounded-full border border-dashed border-white/20 px-3 py-1 text-[12.5px] text-white/70 transition-colors hover:border-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const DEL_BTN = "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/40 transition-colors hover:bg-[#ff5d73]/15 hover:text-[#ff8a9a] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

function Err({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="mt-1 text-[12px] leading-snug text-[#ff8a9a]">
      {children}
    </div>
  );
}

function Group({ title, hint, children, actions }: { title: ReactNode; hint?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/50">{title}</div>
        {hint && <div className="text-[12px] text-white/40">{hint}</div>}
      </div>
      {children}
      {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
    </div>
  );
}

/**
 * Редактор системи: змінні з правими частинами й початковими умовами, ім'я часу, параметри (значення, підпис,
 * діапазон для повзунка), допоміжні величини, t₀ і T. Показує помилки `validateSpec` (з підсвіткою позиції у
 * виразі) і помилки числових полів. Помилка виразу показується, лише якщо текст поля не змінився з моменту
 * перевірки (інакше позиція була б застарілою).
 */
export default function SystemEditor({
  draft,
  setDraft,
  settled,
  specErrors,
  numErrors,
}: {
  draft: Draft;
  setDraft: SetDraft;
  /** чернетка, яку вже перевірено (після дебаунсу) */
  settled: Draft;
  specErrors: SpecError[];
  numErrors: NumError[];
}) {
  const specErr = (field: SpecError["field"], index?: number) => specErrors.filter((e) => e.field === field && e.index === index);
  const numErr = (field: NumError["field"], index?: number) => numErrors.filter((e) => e.field === field && e.index === index);
  const exprErr = (field: "rhs" | "defs", i: number, text: string, settledText: string | undefined): FieldError | null => {
    if (text !== settledText) return null;
    const e = specErr(field, i).find((x) => x.pos !== undefined) ?? (field === "rhs" ? specErr(field, i)[0] : undefined);
    return e ? { message: e.message, pos: e.pos, end: e.end } : null;
  };

  const setVar = (i: number, patch: Partial<Draft["vars"][number]>) => setDraft((d) => ({ ...d, vars: d.vars.map((v, k) => (k === i ? { ...v, ...patch } : v)) }));
  const setParam = (i: number, patch: Partial<Draft["params"][number]>) => setDraft((d) => ({ ...d, params: d.params.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const setDef = (i: number, patch: Partial<Draft["defs"][number]>) => setDraft((d) => ({ ...d, defs: d.defs.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));

  // errors that no field shows (e.g. «потрібна хоча б одна змінна»)
  const general = specErrors.filter(
    (e) =>
      !(
        (e.index !== undefined && ["rhs", "defs", "vars", "params", "y0"].includes(e.field)) ||
        e.field === "t" ||
        e.field === "t0" ||
        e.field === "T"
      ),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-56">
          <span className="mb-1 block text-[12px] text-white/50">Назва (для коду й посилання)</span>
          <SmallField value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} label="Назва системи" mono={false} className="w-full" />
        </label>
        <label className="shrink-0">
          <span className="mb-1 block text-[12px] text-white/50">Ім&apos;я часу</span>
          <SmallField value={draft.t} onChange={(v) => setDraft((d) => ({ ...d, t: v }))} label="Ім'я незалежної змінної (часу)" invalid={specErr("t").length > 0} className="w-20" />
        </label>
      </div>
      {specErr("t").map((e, k) => (
        <Err key={k}>{e.message}</Err>
      ))}

      <Group
        title="Рівняння"
        hint={`до ${MAX_VARS} змінних · праворуч — початкова умова`}
        actions={
          <button
            type="button"
            className={ADD_BTN}
            disabled={draft.vars.length >= MAX_VARS}
            onClick={() =>
              setDraft((d) => {
                const name = freshName(draftNames(d));
                return { ...d, vars: [...d.vars, { name, rhs: `-${name}`, y0: "1" }] };
              })
            }
          >
            + змінна{draft.vars.length >= MAX_VARS ? ` (максимум ${MAX_VARS})` : ""}
          </button>
        }
      >
        {draft.vars.map((v, i) => {
          const nameErrs = specErr("vars", i);
          const y0Errs = [...numErr("y0", i), ...specErr("y0", i)];
          return (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                <SmallField value={v.name} onChange={(x) => setVar(i, { name: x })} label={`Ім'я змінної №${i + 1}`} invalid={nameErrs.length > 0} className="w-[4.75rem] shrink-0" />
                <span className="shrink-0 pt-1.5 font-mono text-[14px] text-white/70">′ =</span>
                <ExprField
                  className="min-w-[11rem] flex-1 basis-[16rem]"
                  value={v.rhs}
                  onChange={(x) => setVar(i, { rhs: x })}
                  label={`Права частина рівняння для ${v.name || `змінної №${i + 1}`}′`}
                  placeholder="напр. a*x - b*x*y"
                  error={exprErr("rhs", i, v.rhs, settled.vars[i]?.rhs)}
                />
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="font-mono text-[13px] text-white/55">
                    {v.name || "?"}({draft.t || "t"}₀) =
                  </span>
                  <SmallField value={v.y0} onChange={(x) => setVar(i, { y0: x })} label={`Початкова умова ${v.name}(t₀)`} invalid={y0Errs.length > 0} className="w-24" />
                  <button
                    type="button"
                    className={DEL_BTN}
                    aria-label={`Видалити змінну ${v.name}`}
                    title={draft.vars.length <= 1 ? "Потрібна хоча б одна змінна" : `Видалити змінну ${v.name}`}
                    disabled={draft.vars.length <= 1}
                    onClick={() => setDraft((d) => ({ ...d, vars: d.vars.filter((_, k) => k !== i) }))}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {[...nameErrs, ...y0Errs].map((e, k) => (
                <Err key={k}>{e.message}</Err>
              ))}
            </div>
          );
        })}
      </Group>

      <Group
        title="Параметри"
        hint="значення обов'язкове; підпис і діапазон — для повзунка в лабораторії"
        actions={
          <button
            type="button"
            className={ADD_BTN}
            disabled={draft.params.length >= MAX_PARAMS}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                params: [...d.params, { name: freshName(draftNames(d), ["a", "b", "c", "k", "μ", "ε", "λ", "ω"], "k"), value: "1", label: "", min: "", max: "", log: false }],
              }))
            }
          >
            + параметр
          </button>
        }
      >
        {draft.params.length === 0 && <div className="text-[13px] text-white/40">Параметрів немає — числа можна писати прямо в рівняннях.</div>}
        {draft.params.map((p, i) => {
          const errs = [...specErr("params", i), ...numErr("param", i), ...numErr("paramMin", i), ...numErr("paramMax", i)];
          const rangeBad = numErr("paramMin", i).length + numErr("paramMax", i).length > 0 || specErr("params", i).some((e) => /діапазон/.test(e.message));
          return (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <SmallField value={p.name} onChange={(x) => setParam(i, { name: x })} label={`Ім'я параметра №${i + 1}`} invalid={specErr("params", i).some((e) => /ім'я|Ім'я|Порожнє/.test(e.message))} className="w-[4.75rem] shrink-0" />
                <span className="font-mono text-white/55">=</span>
                <SmallField value={p.value} onChange={(x) => setParam(i, { value: x })} label={`Значення параметра ${p.name}`} invalid={numErr("param", i).length > 0 || specErr("params", i).some((e) => /значення/.test(e.message))} className="w-28 shrink-0" />
                <SmallField value={p.label} onChange={(x) => setParam(i, { label: x })} label={`Підпис параметра ${p.name}`} placeholder="підпис (необов'язково)" mono={false} className="min-w-[8rem] flex-1 basis-40" />
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[12px] text-white/45">від</span>
                  <SmallField value={p.min} onChange={(x) => setParam(i, { min: x })} label={`Мінімум діапазону ${p.name}`} placeholder="мін" invalid={rangeBad} className="w-20" />
                  <span className="text-[12px] text-white/45">до</span>
                  <SmallField value={p.max} onChange={(x) => setParam(i, { max: x })} label={`Максимум діапазону ${p.name}`} placeholder="макс" invalid={rangeBad} className="w-20" />
                  <label className="flex items-center gap-1 text-[12px] text-white/55" title="Логарифмічна шкала повзунка (діапазон > 0)">
                    <input type="checkbox" checked={p.log} onChange={(e) => setParam(i, { log: e.target.checked })} className="accent-[var(--accent)]" />
                    log
                  </label>
                  <button type="button" className={DEL_BTN} aria-label={`Видалити параметр ${p.name}`} onClick={() => setDraft((d) => ({ ...d, params: d.params.filter((_, k) => k !== i) }))}>
                    ✕
                  </button>
                </div>
              </div>
              {errs.map((e, k) => (
                <Err key={k}>{e.message}</Err>
              ))}
            </div>
          );
        })}
      </Group>

      <Group
        title="Допоміжні величини"
        hint="необов'язково: позначення для підвиразів, напр. r = sqrt(x^2 + y^2); можна використовувати нижче й у рівняннях"
        actions={
          <button
            type="button"
            className={ADD_BTN}
            disabled={draft.defs.length >= MAX_DEFS}
            onClick={() => setDraft((d) => ({ ...d, defs: [...d.defs, { name: freshName(draftNames(d), ["r", "s", "w", "g", "F"], "d"), expr: "0" }] }))}
          >
            + допоміжна величина
          </button>
        }
      >
        {draft.defs.map((x, i) => {
          const errs = specErr("defs", i);
          const exprE = exprErr("defs", i, x.expr, settled.defs[i]?.expr);
          const nameE = errs.filter((e) => e.pos === undefined);
          return (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                <SmallField value={x.name} onChange={(v) => setDef(i, { name: v })} label={`Ім'я допоміжної величини №${i + 1}`} invalid={nameE.length > 0} className="w-[4.75rem] shrink-0" />
                <span className="shrink-0 pt-1.5 font-mono text-white/55">=</span>
                <ExprField className="min-w-[11rem] flex-1 basis-[16rem]" value={x.expr} onChange={(v) => setDef(i, { expr: v })} label={`Вираз допоміжної величини ${x.name}`} error={exprE} />
                <button type="button" className={DEL_BTN} aria-label={`Видалити величину ${x.name}`} onClick={() => setDraft((d) => ({ ...d, defs: d.defs.filter((_, k) => k !== i) }))}>
                  ✕
                </button>
              </div>
              {nameE
                .filter((e) => !exprE || e.message !== exprE.message)
                .map((e, k) => (
                  <Err key={k}>{e.message}</Err>
                ))}
            </div>
          );
        })}
      </Group>

      <Group title="Відрізок інтегрування">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[13px] text-white/60">{draft.t || "t"}₀ =</span>
            <SmallField value={draft.t0} onChange={(v) => setDraft((d) => ({ ...d, t0: v }))} label="Початок відрізка t₀" invalid={numErr("t0").length + specErr("t0").length > 0} className="w-28" />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[13px] text-white/60">T =</span>
            <SmallField value={draft.T} onChange={(v) => setDraft((d) => ({ ...d, T: v }))} label="Кінець відрізка T" invalid={numErr("T").length + specErr("T").length > 0} className="w-28" />
          </label>
        </div>
        {[...numErr("t0"), ...specErr("t0"), ...numErr("T"), ...specErr("T")].map((e, k) => (
          <Err key={k}>{e.message}</Err>
        ))}
      </Group>

      {general.length > 0 && (
        <div className="space-y-1 rounded-xl border border-[#ff5d73]/30 bg-[#ff5d73]/[0.07] p-3">
          {general.map((e, k) => (
            <div key={k} className="text-[13px] text-[#ff8a9a]">
              {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
