"use client";

import { useDeferredValue, useMemo, useState } from "react";
import SpecTex from "@/components/math/SpecTex";
import { Say } from "@/components/mode/Mode";
import Plot, { type Series } from "@/components/plot/Plot";
import { Card, Insight, Lab, Stat } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { absR, solveButcher, type Tableau } from "@/lib/butcher";
import { fmt, fmtMs } from "@/lib/format";
import { eigenvalues, type Vec } from "@/lib/linalg";
import { METHODS } from "@/lib/methods";
import { denseOutput, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import { compileSpec } from "@/lib/problem-spec";
import type { Analysis } from "./Passport";
import { orderLabel } from "./Passport";
import { BUILTIN, MAIN_SPECS, defaultBuiltins, specLabel } from "./problems";
import { BUILDER_ACCENT } from "./theme";

interface RefSol {
  sol: Solution;
  label: string;
  dense: (t: number) => Vec;
  scale: number[];
  ms: number;
}

/** Еталон: DOPRI5(4) з rtol 1e-10 (і hMax = T/4000 для точної щільної видачі); якщо не впорався — Розенброк 2(3). */
function reference(p: Problem): RefSol {
  const T = p.T - (p.t0 ?? 0);
  const t0 = performance.now();
  let sol = solve("dopri", p, { rtol: 1e-10, atol: 1e-12, hMax: T / 4000, maxSteps: 40000 });
  let label = "DOPRI5(4), rtol = 10⁻¹⁰";
  if (sol.failed) {
    sol = solve("ros", p, { rtol: 1e-10, atol: 1e-12, hMax: T / 4000, maxSteps: 600000 });
    label = "Розенброк 2(3), rtol = 10⁻¹⁰";
  }
  const n = p.y0.length;
  const scale = Array.from({ length: n }, (_, k) => Math.max(1e-300, ...sol.y.map((v) => Math.abs(v[k]))));
  return { sol, label, dense: denseOutput(sol, p.f), scale, ms: performance.now() - t0 };
}

interface Run {
  key: string;
  label: string;
  color: string;
  t: number[];
  y: Vec[];
  steps: number;
  fevals: number;
  jevals: number;
  newton?: string;
  failed?: string;
  errMax: number;
  errT: number;
  ms: number;
}

function measure(t: number[], y: Vec[], ref: RefSol, T: number): { errMax: number; errT: number } {
  let errMax = 0;
  for (let k = 0; k < t.length; k++) {
    const r = ref.dense(t[k]);
    for (let i = 0; i < r.length; i++) {
      const e = Math.abs(y[k][i] - r[i]) / ref.scale[i];
      if (!(e <= errMax)) errMax = e;
    }
  }
  const last = t.length - 1;
  const reached = Math.abs(t[last] - T) <= 1e-9 * Math.max(1, Math.abs(T));
  let errT = NaN;
  if (reached) {
    const yT = ref.sol.y[ref.sol.y.length - 1];
    errT = Math.max(...yT.map((v, i) => Math.abs(y[last][i] - v) / ref.scale[i]));
  }
  return { errMax, errT };
}

export default function RunPanel({
  tab,
  a,
  name,
  pr,
  setPr,
  h,
  setH,
  cmp,
  setCmp,
}: {
  tab: Tableau;
  a: Analysis;
  name: string;
  pr: string;
  setPr: (v: string) => void;
  h: number;
  setH: (v: number) => void;
  cmp: MethodId[] | null;
  setCmp: (v: MethodId[] | null) => void;
}) {
  const spec = MAIN_SPECS.find((s) => s.id === pr) ?? MAIN_SPECS[0];
  const problem = useMemo(() => compileSpec(spec), [spec]);
  const T = problem.T;
  const t0 = problem.t0 ?? 0;
  const implicit = a.kind !== "explicit";
  const s = tab.s;
  const Nmax = implicit ? Math.floor(8000 / s) : Math.floor(120000 / s);
  const hMin = Number(((T - t0) / Nmax).toPrecision(3));
  const hMax = Number(((T - t0) / 5).toPrecision(3));
  const hDef = Math.min(hMax, Math.max(hMin, spec.defaults?.h ?? (T - t0) / 1000));
  const hUse = h > 0 ? Math.min(hMax, Math.max(hMin, h)) : hDef;
  const methods = cmp ?? defaultBuiltins(a.order.p, implicit);
  const [comp, setComp] = useState(0);
  const n = problem.y0.length;
  const ci = Math.min(comp, n - 1);

  const dSpec = useDeferredValue(spec);
  const dProblem = useMemo(() => compileSpec(dSpec), [dSpec]);
  const ref = useMemo(() => reference(dProblem), [dProblem]);
  const dTab = useDeferredValue(tab);
  const dH = useDeferredValue(hUse);
  const dMethods = useDeferredValue(methods);

  const runs: Run[] = useMemo(() => {
    const out: Run[] = [];
    const cs = solveButcher(dTab, dProblem, { h: dH, blowup: 1e10, maxSteps: Nmax + 1 });
    const e = cs.steps > 0 ? measure(cs.t, cs.y, ref, dProblem.T) : { errMax: NaN, errT: NaN };
    out.push({
      key: "custom",
      // «· таблиця» keeps the legend label distinct from the built-in method of the same name (RK3 vs RK3)
      label: `${name} · таблиця`,
      color: BUILDER_ACCENT,
      t: cs.t,
      y: cs.y,
      steps: cs.steps,
      fevals: cs.fevals,
      jevals: cs.jevals,
      newton: cs.implicit ? `${cs.newtonIters} іт. · ${cs.lus} LU${cs.newtonRescues ? ` · ${cs.newtonRescues} продовж.` : ""}` : "—",
      failed: cs.failed,
      ms: cs.ms,
      ...e,
    });
    for (const m of dMethods) {
      const sl = solve(m, dProblem, { h: dH, blowup: 1e10 });
      const em = sl.steps > 0 ? measure(sl.t, sl.y, ref, dProblem.T) : { errMax: NaN, errT: NaN };
      out.push({
        key: m,
        label: METHODS[m].short,
        color: METHODS[m].color,
        t: sl.t,
        y: sl.y,
        steps: sl.steps,
        fevals: sl.fevals,
        jevals: sl.jevals,
        newton: "—",
        failed: sl.failed,
        ms: sl.ms,
        ...em,
      });
    }
    return out;
  }, [dTab, dProblem, dH, dMethods, ref, name, Nmax]);

  // stiffness at the start: where z = hλ lands relative to the stability region
  const startEig = useMemo(() => {
    const J = problem.jac ? problem.jac(t0, problem.y0) : null;
    if (!J) return null;
    try {
      const ev = eigenvalues(J).filter((e) => Number.isFinite(e.re));
      if (!ev.length) return null;
      const big = ev.reduce((m, e) => (Math.hypot(e.re, e.im) > Math.hypot(m.re, m.im) ? e : m));
      return big;
    } catch {
      return null;
    }
  }, [problem, t0]);
  const zStart: [number, number] | null = startEig ? [hUse * startEig.re, hUse * startEig.im] : null;
  const ampStart = zStart ? absR(a.stab.P, a.stab.Q, zStart) : NaN;

  // plot range from the reference so that a blow-up does not squash the picture
  const yRange = useMemo(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const v of ref.sol.y) {
      lo = Math.min(lo, v[ci]);
      hi = Math.max(hi, v[ci]);
    }
    const pad = Math.max((hi - lo) * 0.25, Math.abs(hi) * 0.05, 1e-12);
    return [lo - pad, hi + pad] as [number, number];
  }, [ref, ci]);

  const series: Series[] = [
    { x: ref.sol.t, y: ref.sol.y.map((v) => v[ci]), color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
    ...runs
      .slice()
      .reverse()
      .map((r) => ({ x: r.t, y: r.y.map((v) => v[ci]), color: r.color, label: r.label, width: r.key === "custom" ? 2.2 : 1.4, opacity: r.key === "custom" ? 1 : 0.85, noRange: true })),
  ];

  const own = runs[0];
  const varName = (spec.varLabels?.[ci] ?? spec.vars[ci]) || `y${ci + 1}`;
  const status = (r: Run) =>
    r.failed
      ? r.failed.includes("Ньютон")
        ? "✖ Ньютон"
        : r.failed.includes("вибух")
          ? "💥 вибух"
          : "⚠️ стоп"
      : r.errMax > 1
        ? "⚠️ розбігся"
        : r.errMax > 0.1
          ? "~ грубо"
          : "✓";

  return (
    <Lab
      controls={
        <>
          <label className="block">
            <div className="mb-1.5 text-[13px] text-white/75" data-param-label="">
              Задача курсу
            </div>
            <select
              value={spec.id}
              onChange={(e) => {
                setPr(e.target.value);
                setH(0);
              }}
              className="w-full rounded-lg border border-white/15 bg-[#0d1024] px-2 py-1.5 text-[13px] text-white outline-none focus:border-[var(--accent)]"
            >
              {MAIN_SPECS.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {specLabel(sp)}
                  {sp.stiff ? " · жорстка" : ""}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label="Крок h"
            value={hUse}
            onChange={setH}
            min={hMin}
            max={hMax}
            log
            format={(v) => `${fmt(v, 3)} (N = ${Math.max(1, Math.round((T - t0) / v))})`}
            hint={`Сталий крок h = T/N; до ${Nmax} кроків для цієї таблиці. За замовчуванням — крок сторінки задачі (${fmt(hDef, 3)}).`}
          />
          <MethodPicker methods={BUILTIN} value={methods} onChange={(v) => setCmp(v)} label="Порівняти з вбудованими" />
          {n > 1 && (
            <Chips
              label="Компонента на графіку"
              value={ci}
              onChange={setComp}
              options={spec.vars.map((v, i) => ({ value: i, label: spec.varLabels?.[i] ?? v }))}
            />
          )}
          <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
            Ваш метод: <b className="text-white">{name}</b>, p = {orderLabel(a.order)}, {a.stab.aStable ? "A-стійкий" : "не A-стійкий"}. Еталон: {ref.label} ({ref.sol.steps}{" "}
            кроків, {fmtMs(ref.ms)}).
          </div>
        </>
      }
    >
      <Card>
        <SpecTex spec={spec} substitute show={{ system: true, defs: true, params: false, initial: true }} className="mb-2 text-[13px]" />
        <Plot title={`${varName}(t), h = ${fmt(dH, 3)}`} xLabel="t" yDomain={yRange} series={series} height={320} />
      </Card>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Ваш метод: похибка max" value={own.steps ? fmt(own.errMax, 3) : "—"} sub="відносно розмаху компоненти" tone={own.failed ? "bad" : own.errMax < 1e-3 ? "good" : own.errMax < 0.1 ? "warn" : "bad"} />
        <Stat label="Похибка в T" value={Number.isNaN(own.errT) ? "—" : fmt(own.errT, 3)} sub={own.failed ? status(own) : "y(T) проти еталона"} tone={own.failed ? "bad" : "default"} />
        <Stat label="f-обчислень" value={own.fevals} sub={implicit ? `J: ${own.jevals}` : `${s} на крок`} />
        <Stat
          label="Старт: z = hλ"
          value={zStart ? `${fmt(zStart[0], 3)}${Math.abs(zStart[1]) > 1e-12 ? ` ${zStart[1] >= 0 ? "+" : "−"} ${fmt(Math.abs(zStart[1]), 3)}i` : ""}` : "—"}
          sub={zStart ? `|R(z)| = ${fmt(ampStart, 4)} ${ampStart <= 1 + 1e-12 ? "🛡️" : "💥"}` : "найбільше за модулем λ якобіана"}
          tone={zStart ? (ampStart <= 1 + 1e-12 ? "good" : "bad") : "default"}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/8" data-report-table="">
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-white/[0.04] text-white/55">
            <tr>
              {["Метод", "Кроків", "f", "J", "Ньютон", "Похибка max", "Похибка в T", "Стан", "Час"].map((x) => (
                <th key={x} className="whitespace-nowrap px-3 py-2 font-medium">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.key} className="border-t border-white/[0.06]" title={r.failed}>
                <td className="whitespace-nowrap px-3 py-1.5 text-white">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
                  {r.label}
                </td>
                <td className="px-3 py-1.5 font-mono text-white/85">{r.steps}</td>
                <td className="px-3 py-1.5 font-mono text-white/85">{r.fevals}</td>
                <td className="px-3 py-1.5 font-mono text-white/85">{r.jevals}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-white/60">{r.newton}</td>
                <td className={`px-3 py-1.5 font-mono ${r.errMax < 1e-3 ? "text-[#3ee6a8]" : r.errMax < 0.1 ? "text-[#ffb547]" : "text-[#ff5d73]"}`}>{r.steps ? fmt(r.errMax, 3) : "—"}</td>
                <td className="px-3 py-1.5 font-mono text-white/85">{Number.isNaN(r.errT) ? "—" : fmt(r.errT, 3)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{status(r)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-white/55">{fmtMs(r.ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {own.failed?.includes("Ньютон") && (
        <Insight tone="bad" title="Відмова методу Ньютона" simple={<>Рівняння кроку для вашої таблиці не вдалося розв&apos;язати: {own.failed}. Спробуйте менший крок.</>}>
          {own.failed}. Розв&apos;язувач чесно зупиняється: не підміняє метод і не дробить крок (спершу спрощений Ньютон, потім повний із загасанням, далі продовження за
          параметром σ·h). Зменште h або оберіть метод з кращою стійкістю.
        </Insight>
      )}
      {own.failed?.includes("вибух") && zStart && ampStart > 1 && (
        <Insight
          tone="bad"
          title="Розв'язок «вибухнув»: z = hλ поза областю стійкості"
          simple={
            <>
              На старті найшвидший процес має λ ≈ {fmt(startEig!.re, 4)}
              {Math.abs(startEig!.im) > 1e-9 ? ` ± ${fmt(Math.abs(startEig!.im), 3)}i` : ""}. З кроком h = {fmt(dH, 3)} множник методу |R(hλ)| = {fmt(ampStart, 4)} &gt; 1 — помилка
              росте щокроку. Зменште крок так, щоб hλ потрапило в зафарбовану область на карті вище
              {Number.isFinite(a.stab.realBound) && startEig!.re < 0 ? ` (для дійсного λ: h < ${fmt(a.stab.realBound / -startEig!.re, 3)})` : ""}.
            </>
          }
        >
          Найбільше за модулем власне число якобіана в t₀ ≈ {fmt(startEig!.re, 4)}
          {Math.abs(startEig!.im) > 1e-9 ? ` ± ${fmt(Math.abs(startEig!.im), 3)}i` : ""}; z = hλ дає |R(z)| = {fmt(ampStart, 4)} &gt; 1.
          {Number.isFinite(a.stab.realBound) && startEig!.re < 0 ? ` Межа на дійсній осі −${fmt(a.stab.realBound, 4)} ⇒ h < ${fmt(a.stab.realBound / -startEig!.re, 3)}.` : ""}
        </Insight>
      )}
      {!own.failed && a.stab.aStable && !a.stab.lStable && spec.stiff && Math.abs(a.stab.rInf) > 0.9 && zStart && Math.hypot(...zStart) > 50 && (
        <Insight tone="warn" title={`Жорстка задача, R(∞) = ${fmt(a.stab.rInf, 3)}`} simple={<>Метод не вибухає, але швидкі процеси при такому кроці не гасить — подивіться, чи не «дзвенить» графік.</>}>
          Метод A-стійкий, але |R(z)| ≈ {fmt(ampStart, 4)} при |z| ≈ {fmt(Math.hypot(...zStart), 3)}: жорсткі моди майже не згасають і перекидають знак щокроку —
          звідси можливі осциляції на графіку.
        </Insight>
      )}
      <Say
        simple={
          <p className="text-[12.5px] text-white/50">
            Похибка — найбільше відхилення від еталона (дуже точного розв&apos;язку), поділене на розмах компоненти. Вбудовані методи рахує ядро сайту з тим самим кроком.
          </p>
        }
      >
        <p className="text-[12.5px] text-white/50">
          Похибка: <span className="font-mono">max over tₙ, k |yₙ,ₖ − y_ref,ₖ(tₙ)| / max_t |y_ref,ₖ|</span> (еталон — кубічна ермітова щільна видача). Вбудовані методи — <span className="font-mono">solve()</span> ядра
          з тим самим h; їхні неявні кроки ядро рятує дробленням/продовженням, лічильники f і J включають ці спроби.
        </p>
      </Say>
    </Lab>
  );
}
