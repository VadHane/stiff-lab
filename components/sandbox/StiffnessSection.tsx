"use client";

import { useMemo } from "react";
import Plot, { type Series, type Transform } from "@/components/plot/Plot";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import { Card, Grid, Stat } from "@/components/ui/blocks";
import { Say, useMode } from "@/components/mode/Mode";
import { fmt } from "@/lib/format";
import type { Complex } from "@/lib/linalg";
import { METHODS } from "@/lib/methods";
import { isExplicit, type MethodId, type Problem } from "@/lib/ode";
import {
  K_MODERATE,
  K_STIFF,
  REC_MAX_STEPS,
  S_STIFF,
  STAB_MODERATE,
  eigenInfo,
  stabilityBoundary,
  type EigenInfo,
  type Recommendation,
  type StepBound,
} from "@/lib/sandbox-analysis";
import { StatusBadge } from "./LabResults";
import { RUN_TIME_MS } from "./useSandboxRuns";

const C_T0 = "#5cc8ff";
const C_T1 = "#ff7ad9";

let BOUNDS: { euler: [number, number][]; rk4: [number, number][] } | null = null;
const bounds = () => (BOUNDS ??= { euler: stabilityBoundary("euler", 120), rk4: stabilityBoundary("rk4", 240) });

/** «−0.15 ± 3.13i», «−1000» — власні числа, спряжені пари разом, від найшвидших. */
export function formatEigen(ev: Complex[]): string[] {
  const top = Math.max(1e-300, ...ev.map((e) => Math.hypot(e.re, e.im)).filter(Number.isFinite));
  const out: string[] = [];
  const sorted = ev.slice().sort((a, b) => a.re - b.re || b.im - a.im);
  for (const e of sorted) {
    if (!Number.isFinite(e.re)) {
      out.push("NaN");
      continue;
    }
    const im = Math.abs(e.im) > 1e-12 * top ? Math.abs(e.im) : 0;
    if (im && e.im < 0) continue; // printed with its conjugate
    const re = Math.abs(e.re) > 1e-12 * top ? e.re : 0;
    out.push(im ? `${fmt(re, 4)} ± ${fmt(im, 4)}i` : fmt(re, 4));
  }
  return out;
}

const boundText = (b: StepBound) => (b.h === Infinity ? "без обмеження" : b.h === 0 ? "нестійкий за будь-якого h" : `h < ${fmt(b.h, 3)}`);

function EigenPlane({ e0, e1, h }: { e0: EigenInfo; e1: EigenInfo | null; h: number }) {
  const { series, xDomain, yDomain } = useMemo(() => {
    const all = [...e0.ev, ...(e1?.ev ?? [])].filter((e) => Number.isFinite(e.re) && Number.isFinite(e.im));
    const R = Math.max(...all.map((e) => Math.hypot(e.re, e.im)), 0) || 1;
    const maxRe = Math.max(0, ...all.map((e) => e.re));
    const maxIm = Math.max(0, ...all.map((e) => Math.abs(e.im)));
    const s: Series[] = [{ x: e0.ev.map((e) => e.re), y: e0.ev.map((e) => e.im), color: C_T0, dots: true, dotSize: 4.5, label: "λ у t₀" }];
    if (e1) s.push({ x: e1.ev.map((e) => e.re), y: e1.ev.map((e) => e.im), color: C_T1, dots: true, dotSize: 3.5, label: `λ у t = ${fmt(e1.t, 4)}` });
    const X: [number, number] = [-1.15 * R, Math.max(0.15 * R, maxRe * 1.25)];
    const Y = Math.max(maxIm * 1.25, 0.45 * R);
    return { series: s, xDomain: X, yDomain: [-Y, Y] as [number, number] };
  }, [e0, e1]);
  const underlay = (ctx: CanvasRenderingContext2D, tr: Transform) => {
    if (!(h > 0) || !Number.isFinite(h)) return;
    const draw = (pts: [number, number][], color: string) => {
      ctx.beginPath();
      pts.forEach(([x, y], k) => {
        const px = tr.X(x / h),
          py = tr.Y(y / h);
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = `${color}12`;
      ctx.fill();
      ctx.strokeStyle = `${color}aa`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };
    draw(bounds().rk4, "#ffb547");
    draw(bounds().euler, "#ff5d73");
  };
  return (
    <div>
      <Plot height={300} sorted={false} series={series} xLabel="Re λ" yLabel="Im λ" xDomain={xDomain} yDomain={yDomain} equalAspect underlay={underlay} />
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-white/50">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[#ff5d73]/70 bg-[#ff5d73]/20 align-middle" />
          область стійкості явного Ейлера для h = {fmt(h, 3)}
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[#ffb547]/70 bg-[#ffb547]/20 align-middle" />
          RK4 для того самого h
        </span>
      </div>
    </div>
  );
}

const VERDICT: Record<Recommendation["verdict"], { icon: string; title: string; tone: string }> = {
  stiff: { icon: "🧱", title: "Жорстка система", tone: "border-[#ff5d73]/35 bg-[#ff5d73]/[0.07]" },
  moderate: { icon: "⚖️", title: "Помірно жорстка система", tone: "border-[#ffb547]/35 bg-[#ffb547]/[0.07]" },
  nonstiff: { icon: "🌊", title: "Нежорстка система", tone: "border-[#3ee6a8]/35 bg-[#3ee6a8]/[0.07]" },
  singular: { icon: "💥", title: "Розв'язок має особливість", tone: "border-[#ff5d73]/35 bg-[#ff5d73]/[0.07]" },
  fail: { icon: "❓", title: "Жоден із методів не дійшов до T", tone: "border-white/15 bg-white/[0.04]" },
};

const n0 = (x: number) => x.toLocaleString("uk-UA");
const pct = (x: number) => `${Math.round(x * 100)} %`;

function kText(r: Recommendation): string {
  if (!Number.isFinite(r.K)) return "не визначено";
  if (r.Klower) return `≥ ${fmt(r.Kmin, 3)} напевно (за щільністю кроків ≈ ${fmt(r.K, 3)})`;
  if (r.Kestimated) return `≈ ${fmt(r.K, 3)} (оцінка за щільністю кроків)`;
  return fmt(r.K, 3);
}

function RecommendationCard({
  rec,
  tName,
  span,
  methods,
  onAdd,
}: {
  rec: Recommendation;
  tName: string;
  span: number;
  methods: MethodId[];
  onAdd: (m: MethodId) => void;
}) {
  const v = VERDICT[rec.verdict];
  const d = rec.dopri,
    r = rec.ros;
  const m = METHODS[rec.method];
  const singularRun = d.status === "blowup" || d.status === "nan" || d.status === "tiny" ? d : r;
  const life = rec.maxDecay > 0 ? 1 / rec.maxDecay : NaN;
  const dStr = `${n0(d.sol.steps)}${d.status !== "ok" ? ` (${d.status === "steps" ? `ліміт ${n0(REC_MAX_STEPS)} кроків` : d.status === "time" ? "ліміт часу" : "зупинився"} при ${tName} ≈ ${fmt(d.tEnd, 4)})` : ""}`;
  const rStr = `${n0(r.sol.steps)}${r.status !== "ok" ? ` (зупинився при ${tName} ≈ ${fmt(r.tEnd, 4)})` : ""}`;

  let simple: string;
  let sci: string;
  switch (rec.verdict) {
    case "stiff":
      simple = `У системі є процес, що згасає дуже швидко — приблизно за ${fmt(life, 2)} одиниць часу, а стежити треба на відрізку завдовжки ${fmt(span, 3)}: це ≈ ${fmt(rec.S, 2)} таких «миттєвостей». Явний DOPRI мусить ступати дрібно, щоб не «вибухнути»: ${dStr} кроків проти ${rStr} у Розенброка — у ${rec.Klower ? "щонайменше " : ""}${fmt(rec.Klower ? rec.Kmin : rec.K, 2)} раза більше. Беріть Розенброк (або інший неявний метод: BDF2, неявний Ейлер).`;
      sci = `max(−Re λ) ≈ ${fmt(rec.maxDecay, 3)} уздовж еталонної траєкторії ⇒ S = max(−Re λ)·(T − t₀) ≈ ${fmt(rec.S, 3)} ≥ ${S_STIFF}. При rtol = 10⁻⁶: DOPRI 5(4) — ${dStr} прийнятих кроків (+${n0(d.sol.rejected)} відхилених, ${n0(d.sol.fevals)} f-обч.), Розенброк 2(3) — ${rStr} кроків (${n0(r.sol.fevals)} f-обч., ${n0(r.sol.jevals)} J-обч.) ⇒ K = ${kText(rec)} ≥ ${K_STIFF}. На ${pct(rec.stabFrac)} вибіркових кроків DOPRI h ≥ 0.5·h_стійк (медіана h/h_стійк = ${fmt(rec.stabMedian, 2)}): довжину кроку диктує стійкість, а не точність. Рекомендація: L-стійкий Розенброк 2(3) (ode23s), також BDF2 / неявний Ейлер.`;
      break;
    case "moderate":
      simple = `Явний DOPRI часто впирається в межу стійкості (${pct(rec.stabFrac)} кроків), але програє небагато: ${dStr} кроків проти ${rStr} у Розенброка. Для високої точності годиться DOPRI, для грубої (rtol ≈ 10⁻³) вигідніший Розенброк. За сумарною «ціною» обчислень зараз краще ${m.short}.`;
      sci = `S ≈ ${fmt(rec.S, 3)} ≥ ${S_STIFF}; K = ${kText(rec)} < ${K_STIFF}, але K ≥ ${K_MODERATE} або частка кроків DOPRI з h ≥ 0.5·h_стійк = ${pct(rec.stabFrac)} ≥ ${pct(STAB_MODERATE)}. Ціна (f + n·J обчислень): DOPRI ${n0(rec.costDopri)}, Розенброк ${n0(rec.costRos)} ⇒ ${m.name}. Зі зменшенням точності перевага зсувається до Розенброка: DOPRI тримає крок на межі стійкості незалежно від rtol.`;
      break;
    case "nonstiff":
      simple = `Явний DOPRI впорався за ${dStr} кроків, а Розенброк — за ${rStr}. Жорсткості немає: беріть DOPRI (як ode45 у MATLAB чи RK45 у SciPy) — він точніший і не потребує якобіана.`;
      sci = `K = ${kText(rec)} < ${K_MODERATE}: при rtol = 10⁻⁶ DOPRI 5-го порядку робить менше кроків, ніж Розенброк 2-го (для гладких нежорстких задач K ≈ 0.07–0.15). Частка кроків DOPRI з h ≥ 0.5·h_стійк — ${pct(rec.stabFrac)}. S ≈ ${fmt(rec.S, 3)}${rec.S >= S_STIFF ? " ≥ 100, але явний метод у стійкість не впирається — самих власних чисел для висновку недостатньо" : ""}.`;
      break;
    case "singular":
      simple = `Обидва методи зупинилися біля ${tName} ≈ ${fmt(singularRun.tEnd, 4)}: розв'язок сам іде в нескінченність (або права частина стає невизначеною). Це властивість системи, а не методу — зменште T або перевірте рівняння.`;
      sci = `DOPRI: ${d.message || "OK"}. Розенброк: ${r.message || "OK"}. Метод, що зупинився через ліміт, до цього t не дійшов, тож особливість (скінченночасовий вибух / вихід з області визначення f) — властивість розв'язку.`;
      break;
    default:
      simple = `Ні DOPRI, ні Розенброк не дійшли до кінця відрізка. Перевірте рівняння й початкові умови або зменште T.`;
      sci = `DOPRI: ${d.message}. Розенброк: ${r.message}.`;
  }

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${v.tone}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-2xl leading-none">{v.icon}</span>
        <div className="font-display text-[17px] text-white">{v.title}</div>
        {rec.verdict !== "singular" && rec.verdict !== "fail" && (
          <div className="flex items-center gap-2 text-[14px] text-white/85">
            → рекомендований метод:
            <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold" style={{ borderColor: m.color, background: `${m.color}22` }}>
              <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
              {m.name}
            </span>
          </div>
        )}
        {rec.verdict !== "singular" && !methods.includes(rec.method) && (
          <button type="button" onClick={() => onAdd(rec.method)} className="rounded-full border border-white/20 px-3 py-1 text-[12.5px] text-white/80 hover:border-[var(--accent)] hover:text-white">
            ＋ додати до порівняння
          </button>
        )}
      </div>
      <div className="mt-3 text-[14px] leading-relaxed text-white/80">
        <Say simple={simple}>{sci}</Say>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="K = кроки DOPRI / Розенброк" value={Number.isFinite(rec.K) ? `${rec.Klower ? "≥ " : rec.Kestimated ? "≈ " : ""}${fmt(rec.Klower ? rec.Kmin : rec.K, 3)}` : "—"} sub={`поріг жорсткості: ${K_STIFF}`} tone={rec.K >= K_STIFF || rec.Klower ? "bad" : rec.K >= K_MODERATE ? "warn" : "good"} />
        <Stat label="S = max(−Re λ)·(T − t₀)" value={fmt(rec.S, 3)} sub={`поріг: ${S_STIFF}`} tone={rec.S >= S_STIFF ? "warn" : "good"} />
        <Stat label="кроки DOPRI на межі стійк." value={pct(rec.stabFrac)} sub="h ≥ 0.5·h_стійк(DOPRI)" tone={rec.stabFrac >= STAB_MODERATE ? "warn" : "good"} />
        <Stat label="f-обч. DOPRI / Розенброк" value={`${n0(d.sol.fevals)} / ${n0(r.sol.fevals)}`} sub={`J-обч. Розенброка: ${n0(r.sol.jevals)}`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-white/55">
        DOPRI: <StatusBadge r={d} /> Розенброк: <StatusBadge r={r} />
      </div>
      <details className="mt-3 text-[12.5px] leading-relaxed text-white/60">
        <summary className="cursor-pointer select-none text-white/75">Як працює правило</summary>
        <div className="mt-2 space-y-1.5">
          <p>
            DOPRI 5(4) і Розенброк 2(3) запускаються з однаковою точністю rtol = 10⁻⁶, atol = 10⁻⁹ (ліміт {n0(REC_MAX_STEPS)} кроків і {RUN_TIME_MS / 1000} с кожен). K — відношення
            кількостей прийнятих кроків; якщо DOPRI не дійшов до T через ліміт, K ≥ (його кроки)/(кроки Розенброка) напевно, а оцінка — за кількістю кроків на одиницю часу. S =
            max(−Re λ)·(T − t₀) — скільки «часів життя» найшвидшої загасаючої моди вміщає відрізок (власні числа — у 160 точках еталонної траєкторії).
          </p>
          <p>
            <b className="text-white/80">Жорстка</b>: K ≥ {K_STIFF} і S ≥ {S_STIFF}. <b className="text-white/80">Помірно</b>: S ≥ {S_STIFF} і (K ≥ {K_MODERATE} або ≥ {pct(STAB_MODERATE)} кроків DOPRI
            на межі стійкості). Інакше — <b className="text-white/80">нежорстка</b>. Обидва зупинилися на одному t (вибух / NaN) — особливість розв&apos;язку.
          </p>
          <p>
            Чому поріг 3, а не 1: на гладких нежорстких задачах DOPRI (5-й порядок) при rtol = 10⁻⁶ робить у 7–14 разів менше кроків, ніж Розенброк (2-й порядок): K ≈ 0.07–0.15
            (Лоренц, Кеплер, маятник, SIR). K ≥ 3 означає програш у 20–40 разів відносно «норми» — майже завжди через стійкість. Самого S недостатньо: у Лоренца S ≈ 500, але K ≈ 0.09.
          </p>
        </div>
      </details>
    </div>
  );
}

/**
 * Аналіз жорсткості: власні числа якобіана в t₀ і в кінці (на комплексній площині з областями стійкості явних
 * методів для поточного h), межі кроку Ейлера/RK4, жорсткість уздовж еталонної траєкторії (`StiffnessPanel`) і
 * рекомендація методу.
 */
export default function StiffnessSection({
  problem,
  vars,
  tName,
  rec,
  h,
  methods,
  onAddMethod,
  logT,
  stale,
}: {
  problem: Problem;
  vars: string[];
  tName: string;
  rec: Recommendation | null;
  h: number;
  methods: MethodId[];
  onAddMethod: (m: MethodId) => void;
  logT: boolean;
  stale: boolean;
}) {
  const { mode } = useMode();
  const t0 = problem.t0 ?? 0;
  const span = problem.T - t0;
  const e0 = useMemo(() => eigenInfo(problem, t0, problem.y0), [problem, t0]);
  const ref = rec && rec.reference.sol.y[0]?.length === vars.length ? rec.reference : null;
  const e1 = useMemo(() => {
    if (!ref || ref.sol.t.length < 2) return null;
    const k = ref.sol.t.length - 1;
    return eigenInfo(problem, ref.sol.t[k], ref.sol.y[k]);
  }, [problem, ref]);
  const hasEigen = e0.ev.some((e) => Math.hypot(e.re, e.im) > 0) || (e1?.ev.some((e) => Math.hypot(e.re, e.im) > 0) ?? false);
  const explicitSel = methods.filter(isExplicit);
  const eulerWarn = explicitSel.length > 0 && Number.isFinite(e0.euler.h) && (e0.euler.h === 0 || h > e0.euler.h);
  const rk4Warn = (methods.includes("rk4") || methods.includes("rk3")) && Number.isFinite(e0.rk4.h) && h > e0.rk4.h;

  return (
    <div className={`space-y-4 transition-opacity ${stale ? "opacity-55" : ""}`}>
      <Grid cols={2}>
        <Card title="Власні числа якобіана" icon="🧭">
          {!e0.finite ? (
            <div className="text-[13px] text-[#ff8a9a]">Якобіан у t₀ містить NaN/∞ — власні числа не визначені.</div>
          ) : (
            <>
              <div className="space-y-2 text-[13px]">
                <div>
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: C_T0 }} />
                  <span className="text-white/55">
                    у {tName}₀ = {fmt(t0, 4)}:{" "}
                  </span>
                  <span className="font-mono text-white/90">{formatEigen(e0.ev).join(";  ")}</span>
                </div>
                {e1 && (
                  <div>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: C_T1 }} />
                    <span className="text-white/55">
                      у {tName} = {fmt(e1.t, 4)}
                      {ref!.status !== "ok" ? " (далі еталон не дійшов)" : ""}:{" "}
                    </span>
                    <span className="font-mono text-white/90">{formatEigen(e1.ev).join(";  ")}</span>
                  </div>
                )}
              </div>
              {hasEigen ? (
                <div className="mt-3">
                  <EigenPlane e0={e0} e1={e1} h={h} />
                </div>
              ) : (
                <div className="mt-3 text-[13px] text-white/50">Усі власні числа нульові — якобіан вироджений (напр. праві частини не залежать від змінних).</div>
              )}
            </>
          )}
        </Card>
        <Card title={`Що кажуть власні числа в ${tName}₀`} icon="📏">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="коеф. жорсткості" value={Number.isFinite(e0.ratio) ? fmt(e0.ratio, 3) : "—"} sub="max(−Re λ) / min(−Re λ)" tone={e0.ratio > 100 ? "warn" : "default"} />
            <Stat label="max(−Re λ)" value={fmt(e0.maxDecay, 3)} sub={e0.maxDecay > 0 ? `«час життя» ≈ ${fmt(1 / e0.maxDecay, 3)}` : "загасаючих мод немає"} />
            <Stat label="явний Ейлер" value={boundText(e0.euler)} sub="|1 + hλ| ≤ 1 для всіх λ" tone={eulerWarn ? "bad" : "default"} />
            <Stat label="RK4" value={boundText(e0.rk4)} sub="|R(hλ)| ≤ 1, R — многочлен 4-го ст." tone={rk4Warn ? "bad" : "default"} />
          </div>
          {e0.maxGrowth > 1e-9 && (
            <div className="mt-3 text-[12.5px] text-white/60">
              Є наростаючі моди (max Re λ ≈ {fmt(e0.maxGrowth, 3)}): {mode === "simple" ? "розв'язок біля старту сам віддаляється — це не нестійкість методу." : "вони не обмежують крок — ріст фізичний, а не чисельний."}
            </div>
          )}
          {(eulerWarn || rk4Warn) && (
            <div className="mt-3 rounded-xl border border-[#ff5d73]/30 bg-[#ff5d73]/[0.07] px-3 py-2 text-[13px] text-white/80">
              ⚠️ Поточний крок h = {fmt(h, 3)} {eulerWarn ? `більший за межу явного Ейлера (${boundText(e0.euler)})` : ""}
              {eulerWarn && rk4Warn ? " і " : ""}
              {rk4Warn ? `більший за межу RK4 (${boundText(e0.rk4)})` : ""} уже в {tName}₀ — явні методи зі сталим кроком, найімовірніше, «вибухнуть».
            </div>
          )}
          <div className="mt-3 text-[12px] leading-relaxed text-white/45">
            <Say simple="Власні числа — «швидкості» процесів біля поточної точки. Велике від'ємне число — процес, що згасає миттєво; саме воно змушує явні методи дрібнити крок.">
              Межі — найбільше h, за якого hλ лежить в області стійкості для всіх λ з Re λ &lt; 0 (для комплексних λ — уздовж променя). Це оцінка в одній точці: уздовж траєкторії
              λ змінюються — див. графік нижче.
            </Say>
          </div>
        </Card>
      </Grid>

      {rec ? (
        <>
          <RecommendationCard rec={rec} tName={tName} span={span} methods={methods} onAdd={onAddMethod} />
          {ref && ref.sol.t.length > 2 && (rec.maxDecay > 0 || rec.maxGrowth > 0) ? (
            <Card title="Жорсткість уздовж траєкторії" icon="🎢">
              <StiffnessPanel problem={problem} sol={ref.sol} logT={logT && t0 >= 0} />
              <div className="mt-2 text-[12px] text-white/45">
                Еталонна траєкторія: {ref.method === "ros" ? "Розенброк 2(3)" : "DOPRI 5(4)"}, rtol = 10⁻⁶. Червона — найшвидша мода |Re λ|, блакитна — найповільніша. Тут |Re λ|
                беруться для всіх мод, зокрема наростаючих і коливальних (Re λ ≈ 0), тож у коливальних систем «коефіцієнт жорсткості» буває великим і без жорсткості — висновок вище
                зроблено за K, а не за ним.
              </div>
            </Card>
          ) : null}
        </>
      ) : (
        <div className="grid h-32 place-items-center rounded-2xl border border-white/10 text-[14px] text-white/45">
          <span className="animate-pulse">Порівнюємо DOPRI і Розенброк з rtol = 10⁻⁶…</span>
        </div>
      )}
    </div>
  );
}
