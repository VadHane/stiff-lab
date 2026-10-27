"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import SpecTex from "@/components/math/SpecTex";
import { ModeToggle, Say } from "@/components/mode/Mode";
import CodeExportButton from "@/components/share/CodeExportButton";
import ShareButton, { HEADER_BUTTON_CLASS } from "@/components/share/ShareButton";
import { Card, Insight, Lab, Section } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider, Toggle } from "@/components/ui/controls";
import { formatNumber } from "@/lib/expr";
import { fmt } from "@/lib/format";
import type { MethodId } from "@/lib/ode";
import { sanitizeSpec, validateSpec, type ProblemSpec } from "@/lib/problem-spec";
import { canonSpec, draftFromSpec, fromTaskSpec, parseNumberField, specFromDraft, specKey, type Draft } from "@/lib/sandbox-spec";
import { classicById, type SandboxTemplate } from "@/lib/sandbox-templates";
import { codecs, useUrlState, useUrlStateReset } from "@/lib/url-state";
import Cheatsheet from "./Cheatsheet";
import LabResults from "./LabResults";
import StiffnessSection from "./StiffnessSection";
import SystemEditor from "./SystemEditor";
import Templates from "./Templates";
import { RUN_TIME_MS, useSandboxRuns } from "./useSandboxRuns";

const ACCENT = "#a78bfa";
const ALL_METHODS: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "dopri", "ros", "thetaA"];
const DEFAULT_TPL = classicById("lotka")!;
const DEFAULT_SPEC = canonSpec(DEFAULT_TPL.spec);
const DEFAULT_METHODS: MethodId[] = ["dopri", "ros"];
const DEFAULT_H = DEFAULT_TPL.h;
const DEFAULT_RTOL = DEFAULT_TPL.rtol;
const DEFAULT_MAX_STEPS = 100000;
const DEFAULT_BLOWUP = 1e10;
const EDIT_DEBOUNCE_MS = 400;

/** Адреса → опис: структура (`sanitizeSpec`) і канонічна форма; семантику перевіряє `validateSpec` на сторінці. */
const SPEC_CODEC = codecs.json<ProblemSpec>((x) => {
  const s = sanitizeSpec(x);
  return s ? canonSpec(s) : null;
});

const BLANK_SPEC: ProblemSpec = canonSpec({
  id: "custom",
  taskId: "",
  title: "Своя система",
  vars: ["x"],
  params: [{ name: "k", value: 1, label: "Швидкість згасання k", range: [0.1, 10] }],
  rhs: ["-k*x"],
  y0: [1],
  T: 10,
});

/** «Кругле» значення кроку: 1, 2 або 5 × 10ᵏ, не більше x. */
function niceStep(x: number): number {
  const e = Math.floor(Math.log10(x));
  const m = x / Math.pow(10, e);
  const d = m >= 5 ? 5 : m >= 2 ? 2 : 1;
  return Number((d * Math.pow(10, e)).toPrecision(1));
}

const isValid = (s: ProblemSpec) => validateSpec(s).errors.length === 0;

interface Snapshot {
  spec: ProblemSpec;
  src: string;
  methods: MethodId[];
  h: number;
  rtol: number;
}

/** Поле для числа з підтвердженням по Enter / втраті фокусу (h). */
function NumberInput({ value, onCommit, label, min }: { value: number; onCommit: (v: number) => void; label: string; min?: number }) {
  const [text, setText] = useState(formatNumber(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : formatNumber(value);
  const parsed = parseNumberField(text);
  const bad = focused && !(typeof parsed === "number" && (min === undefined || parsed > min));
  const commit = () => {
    if (typeof parsed === "number" && (min === undefined || parsed > min)) onCommit(parsed);
    else setText(formatNumber(value));
  };
  return (
    <input
      aria-label={label}
      value={shown}
      onFocus={() => {
        setText(formatNumber(value));
        setFocused(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        commit();
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`w-24 rounded-lg border bg-black/30 px-2 py-1 font-mono text-[13px] text-white outline-none focus:border-[var(--accent)] ${bad ? "border-[#ff5d73]/70" : "border-white/12"}`}
    />
  );
}

/** Сторінка «Своя система»: редактор, лабораторія, аналіз жорсткості. Увесь стан — в адресі (`useUrlState`). */
export default function SandboxLab() {
  // ------------------------------------------------------------------------------------------------ URL state
  const [spec, setSpec] = useUrlState<ProblemSpec>("sys", DEFAULT_SPEC, SPEC_CODEC);
  const [src, setSrc] = useUrlState("src", DEFAULT_TPL.id, codecs.string);
  const [methods, setMethods] = useUrlState<MethodId[]>("m", DEFAULT_METHODS, codecs.methods);
  const [hRaw, setH] = useUrlState("h", DEFAULT_H);
  const [rtolRaw, setRtol] = useUrlState("tol", DEFAULT_RTOL);
  const [msRaw, setMaxSteps] = useUrlState("ms", DEFAULT_MAX_STEPS, codecs.int);
  const [buRaw, setBlowup] = useUrlState("bu", DEFAULT_BLOWUP);
  const [logT, setLogT] = useUrlState("lt", false);
  const [logY, setLogY] = useUrlState("ly", false);
  const [phaseRaw, setPhaseRaw] = useUrlState("ph", [0, 1], codecs.numbers);
  const [tripleRaw, setTripleRaw] = useUrlState("p3", [0, 1, 2], codecs.numbers);
  const resetUrl = useUrlStateReset();
  // values from the address are checked here (codecs accept any finite number)
  const h = hRaw > 0 && Number.isFinite(hRaw) ? hRaw : DEFAULT_H;
  const rtol = rtolRaw > 0 && rtolRaw < 1 ? rtolRaw : DEFAULT_RTOL;
  const maxSteps = Math.min(1e6, Math.max(100, Number.isFinite(msRaw) ? msRaw : DEFAULT_MAX_STEPS));
  const blowup = buRaw > 0 && Number.isFinite(buRaw) ? buRaw : DEFAULT_BLOWUP;

  // ------------------------------------------------------------------------------------------------ editor
  const [draft, setDraftState] = useState<Draft>(() => draftFromSpec(spec));
  const [settled, setSettled] = useState<Draft>(draft);
  const setDraft = useCallback((fn: (d: Draft) => Draft) => setDraftState((d) => fn(d)), []);
  useEffect(() => {
    if (draft === settled) return;
    const id = setTimeout(() => setSettled(draft), EDIT_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [draft, settled]);
  const built = useMemo(() => specFromDraft(settled), [settled]);
  const specErrors = useMemo(() => (built.spec ? validateSpec(built.spec).errors : []), [built]);
  useEffect(() => {
    if (built.spec && specKey(built.spec) !== specKey(spec)) setSpec(built.spec);
    // only a NEW settled draft is committed; external loads set draft, settled and spec together
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);
  const typing = draft !== settled;

  // last valid system drives the computations
  const specOk = useMemo(() => isValid(spec), [spec]);
  const [validSpec, setValidSpec] = useState<ProblemSpec | null>(() => (specOk ? spec : null));
  useEffect(() => {
    if (specOk) setValidSpec(spec);
  }, [spec, specOk]);
  const runSpec = useDeferredValue(validSpec);

  const settings = useMemo(() => ({ h, rtol, maxSteps, blowup }), [h, rtol, maxSteps, blowup]);
  const { problem, compileError, startError, state } = useSandboxRuns(runSpec, methods, settings);

  // ------------------------------------------------------------------------------------------------ loading
  const [undo, setUndo] = useState<Snapshot | null>(null);
  const applySpec = (s: ProblemSpec) => {
    const c = canonSpec(s);
    const d = draftFromSpec(c);
    setSpec(c);
    setDraftState(d);
    setSettled(d);
  };
  const load = (s: ProblemSpec, o: { src: string; methods?: MethodId[]; h?: number; rtol?: number }) => {
    if (specKey(s) !== specKey(spec)) setUndo({ spec, src, methods, h, rtol });
    applySpec(s);
    setSrc(o.src);
    if (o.methods) setMethods(o.methods.length ? o.methods : DEFAULT_METHODS);
    if (o.h) setH(o.h);
    if (o.rtol) setRtol(o.rtol);
    setPhaseRaw([0, 1]);
    setTripleRaw([0, 1, 2]);
  };
  const loadClassic = (t: SandboxTemplate) => load(t.spec, { src: t.id, methods: t.methods, h: t.h, rtol: t.rtol });
  const loadCourse = (s: ProblemSpec) => {
    const span = s.T - (s.t0 ?? 0);
    load(fromTaskSpec(s), { src: s.id, methods: s.defaults?.methods ?? DEFAULT_METHODS, h: s.defaults?.h ?? niceStep(span / 1000), rtol: s.defaults?.rtol ?? 1e-4 });
  };
  const doUndo = () => {
    if (!undo) return;
    applySpec(undo.spec);
    setSrc(undo.src);
    setMethods(undo.methods);
    setH(undo.h);
    setRtol(undo.rtol);
    setUndo(null);
  };
  const doReset = () => {
    resetUrl();
    const d = draftFromSpec(DEFAULT_SPEC);
    setDraftState(d);
    setSettled(d);
    setUndo(null);
  };
  /** Повзунок параметра: змінює чернетку і одразу систему (без дебаунсу). */
  const setParamValue = (name: string, v: number, range: [number, number]) => {
    const i = draft.params.findIndex((p) => p.name.trim() === name);
    if (i < 0) return;
    // 4 significant digits: the slider has ~1000 positions, more digits are noise (3.3000000000000003)
    const r = Math.min(range[1], Math.max(range[0], Number(v.toPrecision(4))));
    const nd: Draft = { ...draft, params: draft.params.map((p, k) => (k === i ? { ...p, value: formatNumber(r) } : p)) };
    setDraftState(nd);
    setSettled(nd);
  };
  /** Перед «Поділитися» / «Код»: зафіксувати недописану чернетку негайно. */
  const flushDraft = () => {
    if (draft !== settled) setSettled(draft);
  };

  // ------------------------------------------------------------------------------------------------ derived
  const shown = runSpec;
  const n = shown?.vars.length ?? 0;
  const tName = shown?.t ?? "t";
  const t0 = shown?.t0 ?? 0;
  const T = shown?.T ?? 10;
  const span = T - t0;
  const idx = (i: number | undefined, fb: number) => (i !== undefined && Number.isInteger(i) && i >= 0 && i < n ? i : Math.min(fb, Math.max(0, n - 1)));
  let phase: [number, number] = [idx(phaseRaw[0], 0), idx(phaseRaw[1], 1)];
  if (n >= 2 && phase[0] === phase[1]) phase = [phase[0], phase[0] === 0 ? 1 : 0];
  const triple: [number, number, number] = [idx(tripleRaw[0], 0), idx(tripleRaw[1], 1), idx(tripleRaw[2], 2)];
  const stepsForH = Math.round(span / h);
  const ranged = (validSpec?.params ?? []).filter((p) => p.range && p.range[1] > p.range[0]);
  const previewSpec = built.spec && specErrors.length === 0 ? built.spec : null;
  const [jacNum, setJacNum] = useState(false);
  const hasFixed = methods.some((m) => !["dopri", "ros", "thetaA"].includes(m));
  const hasAdaptive = methods.some((m) => ["dopri", "ros", "thetaA"].includes(m));

  return (
    <div style={{ ["--accent" as string]: ACCENT }} className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">
      {/* ------------------------------------------------------------------------------------------ header */}
      <div className="fade-up pt-10 sm:pt-14">
        <Link href="/" className="text-[13px] text-white/45 hover:text-white">
          ← на головну
        </Link>
        <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-3xl border border-white/10 bg-white/[0.04] text-5xl shadow-[0_0_60px_-20px_var(--accent)]">
            <span className="animate-float">🧪</span>
          </div>
          <div className="min-w-0">
            <h1 className="font-display glow-text text-3xl leading-tight text-white sm:text-[44px]">Своя система</h1>
            <p className="mt-2 max-w-3xl text-[16px] text-white/65">
              <Say simple="Впишіть будь-яку систему рівнянь — зі своєї лаби, з іншого курсу чи з підручника. Сайт розв'яже її різними методами, намалює графіки, перевірить, чи вона жорстка, порадить метод і дасть готовий код.">
                Довільна задача Коші y′ = f(t, y) формулами: усі 11 методів платформи, графіки, власні числа якобіана вздовж траєкторії, рекомендація методу за відношенням кроків DOPRI / Розенброк
                і експорт у Python / MATLAB.
              </Say>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ModeToggle />
              <span onPointerDownCapture={flushDraft} onKeyDownCapture={flushDraft}>
                <ShareButton />
              </span>
              {validSpec && specOk ? (
                <span onPointerDownCapture={flushDraft}>
                  <CodeExportButton spec={validSpec} methods={methods} opts={{ h, rtol, atol: rtol * 1e-3, maxSteps, blowup }} />
                </span>
              ) : (
                <button type="button" disabled className={`${HEADER_BUTTON_CLASS} cursor-not-allowed opacity-50`} title="Спершу виправте помилки в системі">
                  🐍 Код Python / MATLAB
                </button>
              )}
              <button type="button" onClick={doReset} className={HEADER_BUTTON_CLASS} title="Повернути систему й налаштування за замовчуванням (Лотки–Вольтерри, DOPRI + Розенброк)">
                ↺ Скинути
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------------------------------ system */}
      <Section kicker="Крок 1" title="Система рівнянь" simpleTitle="Яку систему розв'язуємо?" report={false}>
        <Templates src={src} current={spec} onClassic={loadClassic} onCourse={loadCourse} onBlank={() => load(BLANK_SPEC, { src: "", methods: DEFAULT_METHODS, h: 0.01, rtol: 1e-6 })} canUndo={!!undo} onUndo={doUndo} />
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card title="Редактор" icon="✍️" right={typing ? <span className="text-[12px] text-white/45">перевіряємо…</span> : undefined}>
            <div className="space-y-5">
              <SystemEditor draft={draft} setDraft={setDraft} settled={settled} specErrors={specErrors} numErrors={built.numErrors} />
              <Cheatsheet />
            </div>
          </Card>
          <Card title="Як це записано в математиці" icon="∑">
            {previewSpec ? (
              <div className="min-w-0 space-y-3">
                <SpecTex spec={previewSpec} show={{ system: true, defs: true, params: true, initial: true }} />
                <div className="border-t border-white/[0.06] pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[13px] text-white/70">
                      <Say simple="Якобіан — таблиця «як кожна права частина реагує на кожну змінну»">Якобіан J = ∂f/∂y (символьне диференціювання)</Say>
                    </div>
                    <Chips
                      options={[
                        { value: "sym", label: "символьний" },
                        { value: "num", label: "з числами" },
                      ]}
                      value={jacNum ? "num" : "sym"}
                      onChange={(v) => setJacNum(v === "num")}
                    />
                  </div>
                  <SpecTex spec={previewSpec} substitute={jacNum} show={{ system: false, jacobian: true }} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#ff5d73]/30 bg-[#ff5d73]/[0.07] px-3 py-2 text-[13px] text-white/80">
                  {built.numErrors.length + specErrors.length > 0
                    ? `У системі ${built.numErrors.length + specErrors.length === 1 ? "є помилка" : "є помилки"} — її підсвічено в редакторі.`
                    : "Перевіряємо систему…"}
                  {validSpec && " Графіки нижче — для останньої правильної версії."}
                </div>
                {validSpec && (
                  <div className="opacity-50">
                    <SpecTex spec={validSpec} show={{ system: true, defs: true, params: false, initial: false }} />
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </Section>

      {/* ------------------------------------------------------------------------------------------ lab */}
      <Section kicker="Крок 2" title="Лабораторія" simpleTitle="Розв'язуємо різними методами" report={false}>
        <Lab
          controls={
            <>
              <MethodPicker methods={ALL_METHODS} value={methods} onChange={setMethods} label="Методи (кожен рахується окремо)" />
              <div className={hasFixed ? "" : "opacity-60"}>
                <Slider
                  label={
                    <span>
                      Крок h <span className="text-white/40">(сталий крок)</span>
                    </span>
                  }
                  value={h}
                  onChange={setH}
                  min={span * 1e-6}
                  max={span / 5}
                  log
                  format={(v) => fmt(v, 3)}
                  hint={
                    <span className={stepsForH > maxSteps ? "text-[#ffd59a]" : undefined}>
                      {stepsForH.toLocaleString("uk-UA")} кроків на [{fmt(t0, 3)}, {fmt(T, 3)}]
                      {stepsForH > maxSteps ? ` — більше ліміту, порахуємо лише перші ${maxSteps.toLocaleString("uk-UA")}` : ""}
                    </span>
                  }
                />
                <div className="mt-1.5 flex items-center gap-2 text-[12px] text-white/50">
                  точно: <NumberInput value={h} onCommit={setH} label="Крок h" min={0} />
                </div>
              </div>
              <div className={hasAdaptive ? "" : "opacity-60"}>
                <Slider
                  label={
                    <span>
                      Точність rtol <span className="text-white/40">(адаптивні)</span>
                    </span>
                  }
                  value={rtol}
                  onChange={setRtol}
                  min={1e-10}
                  max={1e-1}
                  log
                  format={(v) => fmt(v, 2)}
                  hint="atol = rtol·10⁻³ — як у коді Python/MATLAB"
                />
              </div>
              {ranged.length > 0 && (
                <div className="space-y-4 border-t border-white/[0.06] pt-4">
                  {ranged.map((p) => (
                    <Slider
                      key={p.name}
                      label={p.label ? `${p.label} (${p.name})` : p.name}
                      value={p.value}
                      onChange={(v) => setParamValue(p.name, v, p.range!)}
                      min={p.range![0]}
                      max={p.range![1]}
                      log={!!p.log && p.range![0] > 0}
                      format={(v) => fmt(v, 4)}
                    />
                  ))}
                </div>
              )}
              {validSpec && validSpec.params.length > ranged.length && (
                <div className="text-[11.5px] text-white/40">Щоб параметр отримав повзунок, задайте йому діапазон у редакторі.</div>
              )}
              <div className="space-y-3 border-t border-white/[0.06] pt-4">
                <Chips
                  label="Ліміт кроків на метод"
                  options={[
                    { value: 20000, label: "20 тис." },
                    { value: 100000, label: "100 тис." },
                    { value: 300000, label: "300 тис." },
                  ]}
                  value={maxSteps}
                  onChange={setMaxSteps}
                />
                <Chips
                  label="Поріг «вибуху» |y|"
                  options={[
                    { value: 1e6, label: "10⁶" },
                    { value: 1e10, label: "10¹⁰" },
                    { value: 1e30, label: "10³⁰" },
                  ]}
                  value={blowup}
                  onChange={setBlowup}
                />
                <div className="text-[11.5px] text-white/40">Ліміт часу — {RUN_TIME_MS / 1000} с на метод: сторінка не зависне навіть на дуже важкій системі.</div>
              </div>
              <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
                <Toggle label="Лог-шкала часу" value={logT} onChange={setLogT} />
                <Toggle label="Лог-шкала значень (для додатних компонент)" value={logY} onChange={setLogY} />
              </div>
            </>
          }
        >
          {state.pending > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white/70" role="status">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
              Рахуємо… {state.total > 0 ? `${state.total - state.pending} із ${state.total} задач` : ""}
              {state.stale && <span className="text-white/45"> · показано попередній результат</span>}
            </div>
          )}
          {!specOk && validSpec && (
            <Insight tone="warn" title="У системі є помилки">
              Показано розв&apos;язок останньої правильної версії системи. Виправте підсвічене в редакторі.
            </Insight>
          )}
          {!validSpec && (
            <Insight tone="bad" title="Систему ще не можна розв'язати">
              Виправте помилки в редакторі (вони підсвічені червоним) — і тут з&apos;являться графіки.
            </Insight>
          )}
          {compileError && <Insight tone="bad" title="Не вдалося скомпілювати систему">{compileError}</Insight>}
          {startError && (
            <Insight tone="bad" title="Проблема вже в початковій точці">
              {startError}
            </Insight>
          )}
          {shown && problem && !startError && (
            <LabResults
              vars={shown.vars}
              tName={tName}
              t0={t0}
              T={T}
              methods={methods}
              runs={state.runs}
              rec={state.rec}
              logT={logT}
              logY={logY}
              phase={phase}
              setPhase={(p) => setPhaseRaw(p)}
              triple={triple}
              setTriple={(p) => setTripleRaw(p)}
              stale={state.stale}
            />
          )}
        </Lab>
      </Section>

      {/* ------------------------------------------------------------------------------------------ stiffness */}
      <Section kicker="Крок 3" title="Жорсткість і вибір методу" simpleTitle="Яким методом краще рахувати?" report={false}>
        {shown && problem && !startError ? (
          <StiffnessSection
            problem={problem}
            vars={shown.vars}
            tName={tName}
            rec={state.rec}
            h={h}
            methods={methods}
            onAddMethod={(m) => setMethods(methods.includes(m) ? methods : [...methods, m])}
            logT={logT}
            stale={state.stale}
          />
        ) : (
          <div className="grid h-32 place-items-center rounded-2xl border border-white/10 text-[14px] text-white/45">Аналіз з&apos;явиться, щойно систему можна буде розв&apos;язати.</div>
        )}
      </Section>
    </div>
  );
}
