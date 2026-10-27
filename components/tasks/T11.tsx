"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot, { type Transform } from "@/components/plot/Plot";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import HeartScene from "@/components/scenes/HeartScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { cached } from "@/lib/stiffc-cache";
import { isAdaptive, sampleAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import HeartbeatScene from "@/components/analogy/HeartbeatScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { useTaskExport } from "@/components/share/TaskActions";
import { exportT11 } from "@/components/share/TaskExports";
import { methodsIn, useUrlNum } from "@/components/share/TaskUrl";
import { useUrlState } from "@/lib/url-state";

const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "dopri", "ros"];
// stable references for the debugger / playground: a = 6, ε = 0.05, x₀ = 1 (relaxation oscillations)
const F6 = (_t: number, y: number[]) => [-(y[0] * y[0] * y[0] - 6 * y[0] + y[1]) / 0.05, y[0] - 1];
const Y0 = [1, 0.05];
const DBG_VIEW = { x: 1, y: 0, xLabel: "b", yLabel: "x", xDomain: [-8, 8] as [number, number], yDomain: [-3.6, 3.6] as [number, number] };
const DBG_H = [0.12, 0.02, 0.005];
const PG_DOMAIN = { x: [-8, 8] as [number, number], y: [-3.6, 3.6] as [number, number] };
const PG_LABELS: [string, string] = ["b", "x"];
const PG_KICKS = [
  { label: "Дефібрилятор", emoji: "⚡", apply: (y: number[]) => [y[0] - 2.5, y[1]], hint: "x −= 2.5: примусове скорочення волокна" },
  { label: "Переляк", emoji: "😱", apply: (y: number[]) => [y[0], y[1] + 1], hint: "b += 1: адреналін підсилює керуючий сигнал" },
  { label: "Заспокоїтись", emoji: "🧘", apply: (y: number[]) => [y[0], y[1] - 1], hint: "b −= 1" },
];
const PG_STRIP = [
  { comp: 0, label: "x — волокно", color: "#ff5d73" },
  { comp: 1, label: "b — сигнал", color: "#5cc8ff" },
];
const pgBeat = (prev: number[], cur: number[]) => (prev[0] > 0 && cur[0] <= 0 ? "💓 систола — стрибок!" : null);
function pgUnderlay(ctx: CanvasRenderingContext2D, { X, Y }: { X: (v: number) => number; Y: (v: number) => number }) {
  const fold = Math.SQRT2;
  const branch = (x0: number, x1: number, dash: number[], color: string, w: number) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let k = 0; k <= 120; k++) {
      const x = x0 + ((x1 - x0) * k) / 120;
      const px = X(6 * x - x * x * x),
        py = Y(x);
      if (k) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.stroke();
  };
  branch(fold, 3.6, [], "rgba(255,255,255,0.55)", 2.5);
  branch(-3.6, -fold, [], "rgba(255,255,255,0.55)", 2.5);
  branch(-fold, fold, [5, 5], "rgba(255,255,255,0.35)", 1.5);
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "rgba(255,181,71,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(-8), Y(1));
  ctx.lineTo(X(8), Y(1));
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [b, x, c] of [
    [6 * fold - fold ** 3, fold, "#ffb547"],
    [-(6 * fold - fold ** 3), -fold, "#ffb547"],
    [5, 1, "#5cc8ff"],
  ] as [number, number, string][]) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(X(b), Y(x), 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
const PRESETS = [
  { a: -1, label: "a = −1 (a ≤ 0)" },
  { a: 1, label: "a = 1 (мале)" },
  { a: 2.9, label: "a = 2.9 (біля порогу)" },
  { a: 6, label: "a = 6 (велике)" },
];
const EPS_LIST = [0.05, 0.025];
const MAX_N = 40000;
const IMPLICIT: MethodId[] = ["ieuler", "theta", "trap", "bdf2"];

/** Loop-based extrema: solutions can hold 10⁵ points, more than spread arguments allow in some browsers. */
function maxOf(a: ArrayLike<number>, init = -Infinity): number {
  let m = init;
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}
function minOf(a: ArrayLike<number>, init = Infinity): number {
  let m = init;
  for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
  return m;
}

function makeProblem(a: number, eps: number, x0: number, T: number): Problem {
  return {
    f: (_t, y) => [-(y[0] * y[0] * y[0] - a * y[0] + y[1]) / eps, y[0] - x0],
    jac: (_t, y) => [
      [-(3 * y[0] * y[0] - a) / eps, -1 / eps],
      [1, 0],
    ],
    y0: [1, 0.05],
    T,
  };
}

/** Period from downward crossings of the level between x-extremes (after the transient). */
function periodOf(sol: Solution): number {
  const x = sol.y.map((v) => v[0]);
  const n = x.length;
  if (n < 10) return NaN;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = Math.floor(n / 4); i < n; i++) {
    lo = Math.min(lo, x[i]);
    hi = Math.max(hi, x[i]);
  }
  if (hi - lo < 0.5) return NaN;
  const lvl = (lo + hi) / 2;
  const cr: number[] = [];
  for (let i = 1; i < n; i++)
    if (x[i - 1] > lvl && x[i] <= lvl) {
      const w = (x[i - 1] - lvl) / (x[i - 1] - x[i]);
      cr.push(sol.t[i - 1] + w * (sol.t[i] - sol.t[i - 1]));
    }
  if (cr.length < 2) return NaN;
  const d = cr.slice(1).map((c, i) => c - cr[i]);
  const use = d.length > 1 ? d.slice(1) : d;
  return use.reduce((s, v) => s + v, 0) / use.length;
}

function errVsRef(s: Solution, ref: Solution, i: number) {
  const rt = ref.t,
    ry = ref.y.map((v) => v[i]);
  let m = 0;
  for (let k = 0; k < s.t.length; k++) {
    const d = Math.abs(s.y[k][i] - sampleAt(rt, ry, s.t[k]));
    if (!(d <= m)) m = d;
  }
  return m;
}

function run(m: MethodId, a: number, eps: number, x0: number, T: number, h: number, tol: number): Solution {
  const key = `T11|${m}|${a}|${eps}|${x0}|${T}|${isAdaptive(m) ? tol : h}`;
  return cached(key, () =>
    solve(m, makeProblem(a, eps, x0, T), isAdaptive(m) ? { rtol: tol, atol: tol * 1e-3, maxSteps: 120000, blowup: 1e6 } : { h, blowup: 1e6 }),
  );
}

export default function T11() {
  const [a, setA] = useUrlNum("a", 6, -3, 10);
  const [eps, setEps] = useUrlNum("eps", 0.05, 0.003, 0.5);
  const [x0, setX0] = useUrlNum("x0", 1, 0, 2);
  const [T, setT] = useUrlNum("T", 50, 5, 60);
  const [h, setH] = useUrlNum("h", 0.01, 0.001, 0.1);
  const [tol, setTol] = useUrlNum("rtol", 1e-4, 1e-7, 1e-2);
  const [methods, setMethods] = useUrlState<MethodId[]>("m", ["euler", "bdf2", "dopri", "ros"], methodsIn(ALL));
  const [table, setTable] = useState<null | { a: number; x0: number; T: number; h: number; tol: number; cells: { s: Solution; per: number }[][]; refPer: number[] }>(null);
  const da = useDeferredValue(a);
  const de = useDeferredValue(eps);
  const dx0 = useDeferredValue(x0);
  const dT = useDeferredValue(T);
  const dh0 = useDeferredValue(h);
  const dtol = useDeferredValue(tol);
  const dh = Math.max(dh0, dT / MAX_N);
  const ensureMethods = (...ms: MethodId[]) => setMethods((cur) => [...cur, ...ms.filter((m) => !cur.includes(m))]);
  useTaskExport(exportT11({ a, eps, x0, T, h: Math.max(h, T / MAX_N), tol, methods }));

  const problem = useMemo(() => makeProblem(da, de, dx0, dT), [da, de, dx0, dT]);
  const ref = useMemo(
    () => cached(`T11|ref|${da}|${de}|${dx0}|${dT}`, () => solve("ros", problem, { rtol: 1e-8, atol: 1e-10, maxSteps: 400000 })),
    [problem, da, de, dx0, dT],
  );
  const period = useMemo(() => periodOf(ref), [ref]);

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = run(m, da, de, dx0, dT, dh, dtol);
        const ex = errVsRef(s, ref, 0);
        return { m, s, ex, per: periodOf(s) };
      }),
    [methods, da, de, dx0, dT, dh, dtol, ref],
  );

  const fold = da > 0 ? Math.sqrt(da / 3) : NaN;
  const regime = da <= 0 ? "mono" : dx0 < fold ? "osc" : "rest";

  const xr = useMemo(() => {
    const xs = ref.y.map((v) => v[0]);
    let lo = minOf(xs, -0.5),
      hi = maxOf(xs, 1.2);
    lo -= 0.3;
    hi += 0.3;
    return [lo, hi] as [number, number];
  }, [ref]);

  const manifold = useMemo(() => {
    const n = 400;
    const xs: number[] = [],
      bs: number[] = [];
    for (let k = 0; k <= n; k++) {
      const x = xr[0] + ((xr[1] - xr[0]) * k) / n;
      xs.push(x);
      bs.push(da * x - x * x * x);
    }
    const stable = xs.map((x) => 3 * x * x - da > 0);
    const split = (want: boolean) => ({ x: bs.map((b, k) => (stable[k] === want ? b : NaN)), y: xs });
    return { s: split(true), u: split(false) };
  }, [xr, da]);

  const bRange = useMemo(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const v of ref.y) {
      lo = Math.min(lo, v[1]);
      hi = Math.max(hi, v[1]);
    }
    const pad = Math.max(0.6, (hi - lo) * 0.25);
    return [lo - pad, hi + pad] as [number, number];
  }, [ref]);

  const field = useMemo(
    () => (ctx: CanvasRenderingContext2D, tr: Transform) => {
      const [b0, b1] = tr.xDomain,
        [x0d, x1d] = tr.yDomain;
      ctx.strokeStyle = "rgba(255,255,255,0.13)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 22; i++)
        for (let j = 0; j <= 14; j++) {
          const b = b0 + ((b1 - b0) * i) / 22,
            x = x0d + ((x1d - x0d) * j) / 14;
          const db = x - dx0,
            dx = -(x * x * x - da * x + b) / de;
          const px = tr.X(b),
            py = tr.Y(x);
          const vx = tr.X(b + db * 1e-3) - px,
            vy = tr.Y(x + dx * 1e-3) - py;
          const L = Math.hypot(vx, vy) || 1;
          const ux = (vx / L) * 7,
            uy = (vy / L) * 7;
          ctx.beginPath();
          ctx.moveTo(px - ux, py - uy);
          ctx.lineTo(px + ux, py + uy);
          ctx.lineTo(px + ux - 0.45 * ux - 0.3 * uy, py + uy - 0.45 * uy + 0.3 * ux);
          ctx.stroke();
        }
    },
    [da, de, dx0],
  );

  const phaseSeries = useMemo(
    () => [
      { x: manifold.s.x, y: manifold.s.y, color: "#ffffff", width: 3, opacity: 0.5, label: "повільний многовид (стійкі гілки)", noRange: true },
      { x: manifold.u.x, y: manifold.u.y, color: "#ffffff", width: 1.5, opacity: 0.4, dash: [5, 5], label: "нестійка гілка", noRange: true },
      { x: [bRange[0], bRange[1]], y: [dx0, dx0], color: "#ffb547", width: 1, dash: [3, 4], opacity: 0.7, label: "нульклина x = x₀", noRange: true },
      { x: ref.y.map((v) => v[1]), y: ref.y.map((v) => v[0]), color: "#ff5d73", width: 2.5, fade: true, label: "еталон" },
      ...sols
        .filter(({ s }) => !s.failed)
        .map(({ m, s }) => ({ x: s.y.map((v) => v[1]), y: s.y.map((v) => v[0]), color: METHODS[m].color, width: 1, opacity: 0.6 })),
    ],
    [manifold, ref, sols, bRange, dx0],
  );

  const xSeries = useMemo(
    () => [
      { x: ref.t, y: ref.y.map((v) => v[0]), color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      ...sols.map(({ m, s }) => ({
        x: s.t,
        y: s.y.map((v) => v[0]),
        color: METHODS[m].color,
        label: METHODS[m].short,
        width: s.failed ? 1 : 1.6,
        opacity: s.failed ? 0.45 : 1,
      })),
    ],
    [ref, sols],
  );
  const bSeries = useMemo(
    () => [
      { x: ref.t, y: ref.y.map((v) => v[1]), color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      ...sols.map(({ m, s }) => ({ x: s.t, y: s.y.map((v) => v[1]), color: METHODS[m].color, width: s.failed ? 1 : 1.5, opacity: s.failed ? 0.45 : 1 })),
    ],
    [ref, sols],
  );

  const stepData = useMemo(() => {
    const lim = ref.t.map((_, k) => {
      const x = ref.y[k][0];
      return (2 * de) / Math.max(Math.abs(3 * x * x - da), 1e-3);
    });
    const ad = sols.filter(({ m }) => isAdaptive(m));
    return {
      series: [
        { x: ref.t, y: lim, color: "#ff5d73", width: 1.5, dash: [5, 4], label: "межа явн. Ейлера 2/|λ|" },
        ...ad.map(({ m, s }) => ({ x: s.t.slice(1), y: s.hs, color: METHODS[m].color, label: `крок ${METHODS[m].short}`, width: 1.4 })),
        ...(sols.some(({ m }) => !isAdaptive(m)) ? [{ x: [0, dT], y: [dh, dh], color: "#ffffff", width: 1, opacity: 0.5, label: "фіксований h" }] : []),
      ],
      minLim: minOf(lim),
    };
  }, [ref, sols, de, da, dT, dh]);

  const computeTable = () => {
    const cells = ALL.map((m) =>
      EPS_LIST.map((e) => {
        const s = run(m, da, e, dx0, dT, dh, dtol);
        return { s, per: periodOf(s) };
      }),
    );
    const refPer = EPS_LIST.map((e) =>
      periodOf(cached(`T11|ref|${da}|${e}|${dx0}|${dT}`, () => solve("ros", makeProblem(da, e, dx0, dT), { rtol: 1e-8, atol: 1e-10, maxSteps: 400000 }))),
    );
    setTable({ a: da, x0: dx0, T: dT, h: dh, tol: dtol, cells, refPer });
  };
  const tableStale = table !== null && (table.a !== da || table.x0 !== dx0 || table.T !== dT || table.h !== dh || table.tol !== dtol);

  const eul = sols.find((r) => r.m === "euler");
  const dop = sols.find((r) => r.m === "dopri");
  const ros = sols.find((r) => r.m === "ros");
  const newtonFail = sols.filter(({ m, s }) => IMPLICIT.includes(m) && s.failed?.includes("Ньютона"));
  const lamMax = 2 / stepData.minLim;
  const aHopf = 3 * dx0 * dx0;
  /** Quality of a run: relative period error when the reference has a cycle, otherwise max|Δx|. */
  const quality = (ex: number, per: number): "good" | "warn" | "bad" => {
    if (Number.isFinite(period)) {
      if (!Number.isFinite(per)) return "bad";
      const rel = Math.abs(per - period) / period;
      return rel < 0.01 ? "good" : rel < 0.05 ? "warn" : "bad";
    }
    return ex > 0.5 ? "bad" : ex > 0.05 ? "warn" : "good";
  };

  /**
   * Numbers for the quizzes "eps" and "euler", computed with exactly the settings their "show" buttons set (a = 6, x₀ = 1, T = 50,
   * rtol = 10⁻⁴, h = 0.01) and the lab's cache keys, so the explanations always match the stat cards.
   */
  const quizNums = useMemo(() => {
    const at = (m: MethodId, e: number) => run(m, 6, e, 1, 50, 0.01, 1e-4);
    const dopri = EPS_LIST.map((e) => at("dopri", e).steps);
    const rosS = EPS_LIST.map((e) => at("ros", e));
    const eu = at("euler", 0.05);
    // b range of the Euler run after t = 10, when it has long been stuck near the upper fold
    let bLo = Infinity,
      bHi = -Infinity;
    for (let k = 0; k < eu.t.length; k++)
      if (eu.t[k] >= 10) {
        bLo = Math.min(bLo, eu.y[k][1]);
        bHi = Math.max(bHi, eu.y[k][1]);
      }
    const eu2 = at("euler", 0.025);
    return {
      dopri,
      ros: rosS.map((s) => s.steps),
      rosPer: rosS.map(periodOf),
      eulPer: periodOf(eu),
      bLo,
      bHi,
      eul2T: eu2.failed ? eu2.t[eu2.t.length - 1] : NaN,
    };
  }, []);

  const analogy = useMemo(
    () => (
      <>
        <AnalogyCard
          emoji="🫀"
          title="ЕКГ: повільне «набирання» — і раптовий стрибок"
          story={
            <>
              Серце не стискається плавно, як гумовий м&apos;ячик. «Водій ритму» повільно накопичує електричну напругу, м&apos;яз терпляче розтягується — а потім{" "}
              <b>за мить</b> різко скорочується (систола) і так само різко розслабляється (діастола). На кардіограмі — довгі пологі ділянки й гострі піки. У
              моделі Зімана це дві змінні: повільний сигнал b і швидке волокно x. Швидкість стрибка задає крихітне ε — саме воно робить задачу жорсткою.
            </>
          }
          mapping={[
            ["розтягнутість м'язового волокна", <>швидка змінна x (велике x — розслаблене)</>],
            ["напруга «водія ритму»", <>повільна змінна b</>],
            ["як швидко м'яз реагує на сигнал", <>мале ε = 0.05 або 0.025 (стрибок за час ~ε)</>],
            ["збудливість серцевої тканини", <>параметр a: при a &gt; 3 серце б&apos;ється саме</>],
            ["гострий пік на кардіограмі", <>стрибок з «краю» кривої b = ax − x³ (складки)</>],
          ]}
        >
          <HeartbeatScene />
        </AnalogyCard>
      </>
    ),
    // static block (only stable setters inside): keep it out of slider-driven re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const extras = useMemo(
    () => (
      <>
        <Section kicker="Під мікроскопом" title="Один крок методу — покроково" simpleTitle="Як метод робить один крок" report={false}>
          <StepDebugger
            f={F6}
            y0={Y0}
            T={14}
            view={DBG_VIEW}
            h0={0.12}
            hMin={0.002}
            hMax={0.2}
            hPresets={DBG_H}
            hPresetsLabel="Кроки для порівняння"
            hint={
              <Say
                simple={
                  <>
                    Площина (b, x), як у лабораторії (a = 6, ε = 0.05). Старт — (0.05, 1): посередині між «відштовхувальною» серединою кривої та верхньою гілкою.
                    Натисніть «⏭ Крок» з явним Ейлером при h = 0.12: він перелітає до x ≈ 12.9 — далеко за гілку — і наступним кроком вибухає (RK2, RK3 і RK4 з
                    таким кроком вибухають ще швидше: за один-два кроки). Неявний Ейлер з тим
                    самим кроком не вибухає, але «приземляється» не туди: на відштовхувальну середину (x ≈ −0.09), хоча біла пунктирна показує, що справжній шлях веде
                    вгору, до x ≈ 2.44. θ-метод і трапеції з h = 0.12 на верхню гілку потрапляють, але скачуть навколо неї зигзагом. Візьміть h = 0.005 — і
                    всі методи чесно доповзуть до гілки.
                  </>
                }
              >
                a = 6, ε = 0.05, старт (b, x) = (0.05, 1) — між середньою (нестійкою) і верхньою гілками. Тут ∂ẋ/∂x = −(3x² − a)/ε = +60, а на верхній гілці
                x ≈ 2.445 — ≈ −239. Явний Ейлер з h = 0.12: перший крок до x ≈ 12.9, другий вибухає (h|λ| ≈ 29); RK2 першим кроком відлітає до x ≈ −694 і вибухає
                другим, RK3 і RK4 вибухають уже на першому. Неявний Ейлер (і перший крок BDF2) з тим самим h:
                R(z) = 1/(1 − z) при z = hλ = +7.2 дає |R| ≈ 0.16 — метод «гасить» навіть фізичну нестійкість і сходиться на середню гілку (x ≈ −0.09), хоча
                локальний точний розв&apos;язок (пунктир) іде на верхню. θ-метод і трапеції (корінь знаходиться через продовження за параметром) виходять на верхню гілку,
                але не гасять швидку моду, а «перевертають» її: x = 2.65 → 2.23 → 2.52… (θ, R(−∞) ≈ −0.82) і 2.69 → 2.10 → 2.61… (трапеції, R(−∞) = −1). При h =
                0.005 усі вісім методів коректно виходять на гілку.
              </Say>
            }
          />
        </Section>

        <Section kicker="Пісочниця" title="Клацніть будь-де — серце саме знайде свій ритм" report={false}>
          <PhasePlayground
            f={F6}
            init={Y0}
            axes={[1, 0]}
            labels={PG_LABELS}
            domain={PG_DOMAIN}
            speed={4}
            speedRange={[0.5, 20]}
            trail={13}
            strip={PG_STRIP}
            window={26}
            kicks={PG_KICKS}
            event={pgBeat}
            underlay={pgUnderlay}
            hint={
              <Say
                simple={
                  <>
                    Клацніть будь-де: волокно майже вертикально «падає» на найближчу надійну гілку S-кривої (суцільна біла), повільно повзе по ній до помаранчевого
                    «краю» — і зривається на іншу гілку. З будь-якої точки серце виходить на той самий ритм. ⚡ — примусове скорочення (x −= 2.5), 😱 — переляк
                    (b += 1: у фазі розслаблення удар настає раніше), 🧘 — навпаки (b −= 1).
                  </>
                }
              >
                a = 6, ε = 0.05. За час ~ε/(3x² − a) траєкторія потрапляє на стійку гілку повільного многовиду b = 6x − x³ (|x| &gt; √2), рухається вздовж неї з
                ḃ = x − 1 і в складці (±4√2, ±√2) зривається на протилежну гілку. Релаксаційний граничний цикл (T ≈ 12.75) притягує всі траєкторії. Помаранчевий
                пунктир — нульклина ḃ = 0 (x = 1), блакитна точка — нестійка рівновага (b, x) = (5, 1).
              </Say>
            }
          />
        </Section>

        <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
          <QuizBlock
            taskId="11"
            questions={[
              {
                id: "a29",
                q: <>a = 2.9 — трохи нижче порогу 3 (ε = 0.05, x₀ = 1). Що робитиме серце?</>,
                options: ["Битиметься з періодом ≈ 10", "Кілька згасаючих коливань — і зупинка", "Одразу стрибне на нижню гілку і там завмре", "Розгойдуватиметься все сильніше"],
                correct: 1,
                explain: (
                  <>
                    Рівновага (x, b) = (1, 1.9) ще на стійкій гілці: tr J* = (a − 3)/ε = −2, det J* = 1/ε = 20, тож λ = −1 ± 4.36i — стійкий фокус. Спіраль
                    згасає як e⁻ᵗ (за ~5 одиниць часу), і еталон закінчує рівно в (1, 1.9). Граничний цикл народжується лише при a &gt; 3 (біфуркація Хопфа).
                  </>
                ),
                explainSimple: <>Точка спокою ще на «надійній» гілці, хоч і біля самого краю. Серце кілька разів здригнеться й завмре в x = 1, b = 1.9. Битися почне лише при a &gt; 3.</>,
                show: {
                  label: "Показати a = 2.9",
                  run: () => {
                    setA(2.9);
                    setEps(0.05);
                    setX0(1);
                  },
                },
              },
              {
                id: "eps",
                q: <>a = 6, rtol = 10⁻⁴, відрізок [0, 50]. Зменшимо ε удвічі: 0.05 → 0.025. Що станеться з кількістю кроків DOPRI і Розенброка?</>,
                options: [
                  "Обидва зроблять удвічі більше кроків",
                  "DOPRI — майже вдвічі більше, Розенброк — майже стільки ж",
                  "Обидва майже не зміняться: ритм серця той самий",
                  "Розенброк — удвічі більше, DOPRI — стільки ж",
                ],
                correct: 1,
                explain: (
                  <>
                    DOPRI: {quizNums.dopri[0]} → {quizNums.dopri[1]} кроків (×{fmt(quizNums.dopri[1] / quizNums.dopri[0], 3)}) — на гілках його крок прикутий до
                    межі стійкості ~2ε/(3x² − a), пропорційної ε. Розенброк: {quizNums.ros[0]} → {quizNums.ros[1]} (
                    {quizNums.ros[1] >= quizNums.ros[0] ? "+" : "−"}
                    {fmt(Math.abs(quizNums.ros[1] / quizNums.ros[0] - 1) * 100, 1)} %) — неявному методу жорсткість не заважає, крок задає точність, а період
                    майже не змінився ({fmt(quizNums.rosPer[0], 4)} → {fmt(quizNums.rosPer[1], 4)}).
                  </>
                ),
                explainSimple: (
                  <>
                    Явний DOPRI мусить крокувати під найшвидший процес, а той пришвидшився вдвічі — отже, і кроків майже вдвічі більше ({quizNums.dopri[0]} →{" "}
                    {quizNums.dopri[1]}). Розенброку байдуже: {quizNums.ros[0]} → {quizNums.ros[1]}.
                  </>
                ),
                show: {
                  label: "Показати ε = 0.025",
                  run: () => {
                    setA(6);
                    setX0(1);
                    setT(50);
                    setTol(1e-4);
                    setEps(0.025);
                    ensureMethods("dopri", "ros");
                  },
                },
              },
              {
                id: "euler",
                q: <>a = 6, ε = 0.05, явний Ейлер з h = 0.01. Тут h·|λ|max ≈ 3.65 &gt; 2. Що покаже лабораторія?</>,
                options: [
                  "💥 Вибух за кілька кроків",
                  "Нормальне серцебиття з періодом ≈ 12.7",
                  "Не вибухне, але застрягне біля «краю» й тремтітиме — серцебиття зникне",
                  "Зупиниться в точці спокою x = 1",
                ],
                correct: 2,
                explain: (
                  <>
                    Лінійна теорія обіцяє нестійкість, але система нелінійна: щойно x відскакує від гілки, 3x² − a змінюється, і розгойдування обмежується. Ейлер
                    доповзає верхньою гілкою до складки b₊ = 4√2 ≈ 5.66 і зривається вниз, але на нижній гілці (там h|λ| ≈ 3.6 &gt; 2) не втримується: нестійкість
                    відкидає його назад на верхню гілку, і він знову повзе до тієї самої складки. Тож після t = 10 змінна b лишається в межах{" "}
                    {fmt(quizNums.bLo, 3)}…{fmt(quizNums.bHi, 3)}, а знайдений «період» ≈ {fmt(quizNums.eulPer, 3)} — це тремтіння біля складки, а не
                    серцебиття.
                    {Number.isFinite(quizNums.eul2T) && <> При ε = 0.025 той самий крок уже вибухає (t ≈ {fmt(quizNums.eul2T, 2)}).</>}
                  </>
                ),
                explainSimple: (
                  <>
                    Ейлер не вибухає — система сама себе гальмує. Але чесного серцебиття немає: біля краю кривої він зривається вниз, не втримується на нижній
                    гілці, і його відкидає назад — знову й знову. Після t = 10 сигнал b так і лишається біля краю (між {fmt(quizNums.bLo, 2)} і {fmt(quizNums.bHi, 2)}).
                    Розв&apos;язок «живий», а серцебиття немає — підступніше за вибух!
                  </>
                ),
                show: {
                  label: "Показати Ейлера з h = 0.01",
                  run: () => {
                    setA(6);
                    setX0(1);
                    setT(50);
                    setEps(0.05);
                    setH(0.01);
                    ensureMethods("euler");
                  },
                },
              },
            ]}
          />
        </Section>
      </>
    ),
    // static block (only stable setters inside): keep it out of slider-driven re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      {analogy}

      <Section kicker="Постановка" title="Серце як катастрофа складки" simpleTitle="Як влаштована модель серця">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`\begin{cases}\varepsilon\,\dfrac{dx}{dt} = -\left(x^3 - a\,x + b\right), & x(0)=1,\\[2mm] \dfrac{db}{dt} = x - x_0, & b(0)=0.05,\end{cases}`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  x — наскільки розтягнуте м&apos;язове волокно (велике x — серце розслаблене, мале чи від&apos;ємне — стиснуте), b — керуючий електричний сигнал
                  від «водія ритму». Друге рівняння каже: сигнал b повільно росте, поки волокно довше за норму x₀ = 1, і спадає, коли коротше. Перше — що волокно
                  миттєво підлаштовується під сигнал, бо ε (0.05 або 0.025) дуже мале. Параметр a — «збудливість»: від нього залежить, стоїть серце чи б&apos;ється.
                </p>
              }
            >
              <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                <Tex>{"x"}</Tex> — довжина м&apos;язового волокна серця, <Tex>{"b"}</Tex> — електрохімічний керуючий сигнал (потенціал пейсмейкера),{" "}
                <Tex>{"x_0 = 1"}</Tex> — довжина волокна в стані спокою, <Tex>{"\\varepsilon = 0.05"}</Tex> та <Tex>{"0.025"}</Tex> — мала «інерційність» волокна.
                Розглядаємо три режими: <Tex>{"a \\le 0"}</Tex>, мале <Tex>{"a > 0"}</Tex> і велике <Tex>{"a > 0"}</Tex>.
              </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="Друкарська помилка в умові"
                simpleTitle="Дрібна помилка в умові"
                simple={
                  <>
                    У методичці написано «z(0) = 1», але змінної z у моделі немає — мається на увазі x(0) = 1. А що таке «мале» і «велике» a, не сказано; нижче
                    видно, що межа рівно a = 3, тож беремо a = 1 (і 2.9 — біля самої межі) та a = 6.
                  </>
                }
              >
                У методичці початкова умова записана як <Tex>{"z(0) = 1"}</Tex>, але змінної <Tex>{"z"}</Tex> у системі немає — це <Tex>{"x(0) = 1"}</Tex>.
                «Мале» і «велике» <Tex>{"a"}</Tex> не уточнено — нижче показано, що межа між ними точно <Tex>{"a = 3x_0^2 = 3"}</Tex>, тож беремо{" "}
                <Tex>{"a = 1"}</Tex> (і <Tex>{"2.9"}</Tex>, біля порогу) та <Tex>{"a = 6"}</Tex>.
              </Insight>
            </div>
          </Card>
          <Card title="Геометрія: повільний многовид і складки" icon="📐">
            <p className="text-[14px] leading-relaxed text-white/75">
              <Say simple={<>Оскільки ε дуже мале, волокно x майже миттєво «падає» на S-подібну криву</>}>
                Оскільки <Tex>{"\\varepsilon \\ll 1"}</Tex>, змінна <Tex>{"x"}</Tex> швидка: вона майже миттєво «падає» на криву рівноваг
              </Say>
            </p>
            <Tex block>{String.raw`x^3 - a x + b = 0 \;\Longleftrightarrow\; b = a x - x^3 .`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  і далі повільно повзе по ній, бо сигнал b змінюється повільно. При a &gt; 0 крива має два «згини» — складки при x = ±√(a/3). Дійшовши до
                  згину, волокну далі повзти нікуди, і воно <b>стрибком</b> перелітає на іншу гілку кривої — це і є скорочення серця. Середня частина кривої
                  «відштовхувальна»: там волокно не втримується. Єдина точка спокою — x = x₀ = 1, b = a − 1. Чи втримається там серце, підказує матриця нижче
                  (якобіан): досить знака числа tr J*.
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Гілка стійка там, де <Tex>{"\\partial_x(-(x^3-ax+b)) = -(3x^2 - a) < 0"}</Tex>, тобто <Tex>{"|x| > \\sqrt{a/3}"}</Tex>. При <Tex>{"a > 0"}</Tex> крива
                має дві <b>складки</b> <Tex>{"x_\\pm = \\pm\\sqrt{a/3}"}</Tex>: дійшовши до краю гілки, волокно не має куди «повзти» і <b>стрибком</b> перескакує на
                іншу гілку — це і є систола. Єдина рівновага системи: <Tex>{"x^* = x_0,\\ b^* = a x_0 - x_0^3"}</Tex> (для <Tex>{"x_0 = 1"}</Tex>: <Tex>{"b^* = a - 1"}</Tex>).
              </p>
            </Say>
            <Tex block>{String.raw`J = \begin{pmatrix} -\frac{3x^2-a}{\varepsilon} & -\frac1\varepsilon \\ 1 & 0\end{pmatrix},\qquad \operatorname{tr}J^* = \frac{a-3x_0^2}{\varepsilon},\quad \det J^* = \frac1\varepsilon > 0 .`}</Tex>
            <Say
              simple={
                <>
                  <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-white/70">
                    <li>a ≤ 0 — крива без згинів, стрибати нема звідки: волокно плавно сповзає у спокій.</li>
                    <li>0 &lt; a &lt; 3 — точка спокою лежить на «надійній» гілці (tr J* &lt; 0): серце завмирає (при a = 2.9 ще кілька згасаючих тремтінь).</li>
                    <li>a &gt; 3 — точка спокою на «відштовхувальній» середині (tr J* &gt; 0): спокою немає, серце б&apos;ється саме (вже при a = 3.2 період ≈ 9.75).</li>
                  </ul>
                  <p className="mt-2 text-[13.5px] text-white/65">
                    Жорсткість: після стрибка волокно «пружинить» до кривої з темпом до ~3a/ε — при a = 6, ε = 0.025 це ≈ 730 за одиницю часу, тоді як повзання
                    вздовж кривої має темп ~1. <Relatable kind="ratio" n={727} />
                  </p>
                </>
              }
            >
              <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-white/70">
                <li>
                  <Tex>{"a \\le 0"}</Tex>: кубіка монотонна, складок нема — жодних стрибків, плавне повзання до рівноваги.
                </li>
                <li>
                  <Tex>{"0 < a < 3x_0^2"}</Tex> (<Tex>{"= 3"}</Tex> при <Tex>{"x_0 = 1"}</Tex>): <Tex>{"\\operatorname{tr}J^* < 0"}</Tex>, рівновага на стійкій гілці → стійкий фокус/вузол, серце
                  «завмирає» в діастолі (при <Tex>{"a = 2.9"}</Tex>: <Tex>{"\\lambda = -1 \\pm 4.36i"}</Tex>, спіраль згасає за <Tex>{"\\sim 5"}</Tex> одиниць часу).
                </li>
                <li>
                  <Tex>{"a > 3x_0^2"}</Tex>: <Tex>{"\\operatorname{tr}J^* > 0"}</Tex>, рівновага на середній (нестійкій) гілці → біфуркація Хопфа при <Tex>{"a = 3x_0^2"}</Tex> і{" "}
                  <b>релаксаційні коливання</b> — серцебиття (перевірено числово: <Tex>{"a = 3.2"}</Tex> вже дає цикл із періодом ≈ 9.75 при ε = 0.05).
                </li>
              </ul>
              <p className="mt-2 text-[13.5px] text-white/65">
                Жорсткість: на стійких гілках швидке власне число <Tex>{"\\lambda \\approx -(3x^2-a)/\\varepsilon"}</Tex>; після стрибка волокно приземляється при{" "}
                <Tex>{"|x| = 2\\sqrt{a/3}"}</Tex>, де <Tex>{"3x^2 - a = 3a"}</Tex>, тож <Tex>{"|\\lambda|_{\\max} \\approx 3a/\\varepsilon"}</Tex> — для <Tex>{"a=6,\\ \\varepsilon=0.025"}</Tex> це{" "}
                <Tex>{"\\approx -730"}</Tex> (числово вздовж еталону: 727), тоді як повільний рух має масштаб <Tex>{"\\sim 1"}</Tex>.
              </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Запустіть серце">
        <Lab
          controls={
            <>
              <Chips label="Режим a" value={PRESETS.some((p) => p.a === a) ? a : NaN} onChange={(v) => Number.isFinite(v) && setA(v)} options={PRESETS.map((p) => ({ value: p.a, label: p.label }))} />
              <Slider label="Параметр a" value={a} onChange={setA} min={-3} max={10} step={0.1} hint={a > 0 ? `складки при x = ±${fmt(Math.sqrt(a / 3), 3)}` : "складок немає"} />
              <Chips label="ε з умови" value={EPS_LIST.includes(eps) ? eps : -1} onChange={(v) => v > 0 && setEps(v)} options={EPS_LIST.map((v) => ({ value: v, label: `ε = ${v}` }))} />
              <Slider label="Довільне ε" value={eps} onChange={setEps} min={0.003} max={0.5} log />
              <Slider label="Довжина спокою x₀" value={x0} onChange={setX0} min={0} max={2} step={0.05} />
              <Slider label="Кінець відрізка T" value={T} onChange={setT} min={5} max={60} step={1} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Slider
                label="Крок h (фіксовані методи)"
                value={h}
                onChange={setH}
                min={0.001}
                max={0.1}
                log
                hint={dh > dh0 ? `крок обмежено до T/${MAX_N / 1000}k = ${fmt(dh, 3)}` : `${Math.round(dT / dh).toLocaleString("uk-UA")} кроків`}
              />
              <Slider label="Точність rtol (адаптивні)" value={tol} onChange={setTol} min={1e-7} max={1e-2} log format={(v) => fmt(v, 2)} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Say
                  simple={
                    <>
                      Найшвидший процес на цій траєкторії має темп ≈ {fmt(lamMax, 3)} за одиницю часу. Тому явний Ейлер не «перестрибує» лише з кроком, меншим
                      за {fmt(stepData.minLim, 3)}.
                    </>
                  }
                >
                  Найшвидша мода вздовж еталонної траєкторії: <Tex>{`|\\lambda|_{\\max} \\approx ${fmt(lamMax, 3)}`}</Tex>, отже лінійна межа стійкості явного Ейлера —{" "}
                  <Tex>{`h < 2/|\\lambda|_{\\max} = ${fmt(stepData.minLim, 3)}`}</Tex>.
                </Say>
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title="Фазова площина (b, x): траєкторія «обходить» складки"
              height={380}
              sorted={false}
              xLabel="b"
              yLabel="x"
              xDomain={bRange}
              yDomain={xr}
              underlay={field}
              series={phaseSeries}
              markers={[
                ...(da > 0
                  ? [
                      { x: da * fold - fold ** 3, y: fold, color: "#ffb547", r: 4 },
                      { x: -(da * fold - fold ** 3), y: -fold, color: "#ffb547", r: 4 },
                    ]
                  : []),
                { x: da * dx0 - dx0 ** 3, y: dx0, color: "#5cc8ff", r: 5 },
              ]}
            />
            <p className="mt-2 text-[12.5px] text-white/50">
              <Say
                simple={
                  <>
                    Біла S-крива — «доріжка», по якій повзе волокно (пунктир — її відштовхувальна середина). Помаранчеві точки — «краї», з яких воно стрибає,
                    блакитна — точка спокою. Стрілки майже всюди вертикальні: волокно x змінюється в сотні разів швидше за сигнал b.
                  </>
                }
              >
                Помаранчеві точки — складки, блакитна — рівновага. Стрілки — векторне поле: майже вертикальні (швидкий рух x) скрізь, крім околу кривої.
              </Say>
            </p>
          </Card>
          <Grid>
            <Card>
              <Plot title="x(t) — довжина волокна" height={250} xLabel="t" yDomain={xr} series={xSeries} />
            </Card>
            <Card>
              <Plot title="b(t) — керуючий сигнал" height={250} xLabel="t" yDomain={bRange} series={bSeries} />
            </Card>
          </Grid>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, ex, per }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : `${s.steps} кр.`}
                sub={
                  s.failed
                    ? s.failed
                    : `${isAdaptive(m) ? `відхил. ${s.rejected} · ` : ""}${fmtMs(s.ms)} · max|Δx| ${fmt(ex, 2)}${Number.isFinite(per) ? ` · T≈${fmt(per, 4)}` : Number.isFinite(period) ? " · циклу не знайдено" : ""}`
                }
                tone={s.failed ? "bad" : quality(ex, per)}
              />
            ))}
          </div>
          <p className="text-[12px] text-white/45">
            <Say
              simple={
                <>
                  max|Δx| — найбільший промах відносно еталону в один і той самий момент часу. Для серця він великий навіть у хороших методів: якщо стрибок
                  стався на мить раніше, у цю мить x уже на іншій гілці.{" "}
                  {Number.isFinite(period)
                    ? "Тому колір картки визначаємо за тим, наскільки точно метод вгадав період (<1 % — зелений, <5 % — жовтий)."
                    : "Тут еталон без циклу, тож колір картки визначає max|Δx| (<0.05 / <0.5)."}
                </>
              }
            >
            max|Δx| — поточкова похибка відносно еталону; для релаксаційних коливань вона велика (до розмаху стрибка ≈ {fmt(xr[1] - xr[0] - 0.6, 2)}) навіть у хороших методів,
            бо найменший зсув фази у вертикальному стрибку дає похибку O(1). Тому колір картки{Number.isFinite(period) ? " визначає відносна похибка періоду (<1 % / <5 %)." : " визначає max|Δx| (<0.05 / <0.5), бо еталон тут без циклу."}
            </Say>
          </p>
          <Card>
            <Plot title="Кроки адаптивних методів і межа стійкості явного Ейлера" height={240} logY xLabel="t" yLabel="h" series={stepData.series} />
            <p className="mt-2 text-[12.5px] text-white/50">
              <Say
                simple={
                  <>
                    Червоний пунктир — найбільший крок, з яким явний метод не «перестрибує». DOPRI весь час притиснутий до нього, навіть коли серце ледве
                    змінюється. Розенброк ходить кроками в десятки разів більшими і дрібнить їх лише в момент стрибка.
                  </>
                }
              >
                На повільних ділянках DOPRI тримає крок біля червоної межі <Tex>{"2/|\\lambda|"}</Tex> — його обмежує стійкість, а не точність. Розенброк вільно
                «перестрибує» її і дрібнить крок лише в момент стрибка.
              </Say>
            </p>
          </Card>

          {regime === "mono" && (
            <Insight
              tone="info"
              title="a ≤ 0: кубіка без складок"
              simpleTitle="a ≤ 0: стрибати нема звідки"
              simple={
                <>
                  Крива без «згинів», тож волокно просто плавно сповзає в точку спокою (x, b) = ({fmt(dx0, 3)}, {fmt(da * dx0 - dx0 ** 3, 3)}). Для серця це
                  параліч: жодного скорочення.
                </>
              }
            >
              Функція <Tex>{"b = ax - x^3"}</Tex> монотонна, стрибків немає: волокно плавно переходить до рівноваги <Tex>{`(x, b) = (${fmt(dx0, 3)}, ${fmt(da * dx0 - dx0 ** 3, 3)})`}</Tex>.
              Біологічно — «паралізоване» серце: жодних скорочень.
            </Insight>
          )}
          {regime === "rest" && (
            <Insight
              tone="info"
              title={`0 < a < 3x₀²: стійкий спокій`}
              simpleTitle="Серце завмерло"
              simple={
                <>
                  Точка спокою x₀ = {fmt(dx0, 3)} лежить на «надійній» гілці (далі від середини, ніж згин {fmt(fold, 3)}), тож серце зупиняється в розслабленому
                  стані.
                  {da > aHopf - 0.5 && <> Біля порогу a = {fmt(aHopf, 3)} ще видно кілька згасаючих тремтінь — система «майже» готова битися.</>}
                </>
              }
            >
              Рівновага <Tex>{"x_0"}</Tex> лежить на стійкій гілці (<Tex>{`x_0 = ${fmt(dx0, 3)} > \\sqrt{a/3} = ${fmt(fold, 3)}`}</Tex>). Серце «завмирає» в діастолі.
              {da > aHopf - 0.5 && (
                <>
                  {" "}
                  Біля порогу <Tex>{`a = 3x_0^2 = ${fmt(aHopf, 3)}`}</Tex> слід <Tex>{`\\operatorname{tr}J^* = ${fmt((da - aHopf) / de, 3)}`}</Tex> майже нульовий — бачимо
                  загасаючі коливання: передвісник біфуркації Хопфа.
                </>
              )}
            </Insight>
          )}
          {newtonFail.length > 0 && (
            <Insight
              tone="warn"
              title="Неявний метод спіткнувся на складці"
              simpleTitle="Неявний метод спіткнувся на «краю» кривої"
              simple={
                <>
                  {newtonFail.map(({ m }) => METHODS[m].short).join(", ")}: це не вибух. Неявний метод на кожному кроці розв&apos;язує рівняння, а в момент стрибка
                  єдина правильна відповідь лежить аж на протилежній гілці (x ≈ {fmt(-2 * fold, 3)}). Метод Ньютона стартує біля краю і туди не дотягується.
                  Зменште крок або візьміть Розенброка — він сам дрібнить крок саме тут.
                </>
              }
            >
              {newtonFail.map(({ m, s }) => `${METHODS[m].short}: ${s.failed}`).join("; ")}. Це не вибух, а відмова Ньютона: у момент стрибка рівняння кроку має{" "}
              <b>єдиний</b> корінь — уже на протилежній гілці (<Tex>{`x \\approx ${fmt(-2 * fold, 3)}`}</Tex>), тоді як стартове наближення лежить біля складки. Між ними
              нев&apos;язка має локальний мінімум, і демпфований Ньютон у ньому застрягає. Зменшіть h (менше <Tex>{"\\varepsilon"}</Tex>) або візьміть адаптивний Розенброк — він дрібнить крок саме
              тут.
            </Insight>
          )}
          {regime === "osc" && (
            <Insight
              tone="good"
              title="Серцебиття є!"
              simple={
                <>
                  Точка спокою на відштовхувальній середині — спокою немає. Волокно повзе вздовж гілки, зривається з краю, повзе назад — і так по колу. Один
                  удар триває {fmt(period, 4)} одиниць часу, а сам стрибок — лише ~ε = {fmt(de, 2)}.
                </>
              }
            >
              Рівновага на нестійкій середній гілці — виникає граничний цикл: повільне повзання вздовж гілок (діастола/систола) і миттєві стрибки зі складок.
              Період <Tex>{`T \\approx ${fmt(period, 4)}`}</Tex>; стрибок триває лише <Tex>{`\\sim\\varepsilon = ${fmt(de, 2)}`}</Tex>.
            </Insight>
          )}
          {eul && eul.s.failed && (
            <Insight
              tone="bad"
              title="Явний Ейлер вибухнув"
              simple={
                <>
                  Крок {fmt(dh, 3)} задовгий для найшвидшого процесу: h·|λ| ≈ {fmt(dh * lamMax, 3)}, а дозволено не більше 2. Кожен крок перелітає гілку все далі
                  — і розв&apos;язок вилітає в нескінченність. Зменште крок до {fmt(stepData.minLim, 2)} — і Ейлер оживе.
                </>
              }
            >
              Крок <Tex>{`h = ${fmt(dh, 3)}`}</Tex>, а на стійкій гілці <Tex>{`|\\lambda| \\approx ${fmt(lamMax, 3)}`}</Tex>, тобто{" "}
              <Tex>{`h|\\lambda| \\approx ${fmt(dh * lamMax, 3)} > 2`}</Tex>. Зменшіть h до <Tex>{`${fmt(stepData.minLim, 2)}`}</Tex> — і він оживе.
            </Insight>
          )}
          {eul && !eul.s.failed && dh * lamMax > 2 && (
            <Insight
              tone="warn"
              title="Ейлер не вибухнув, хоча h|λ| > 2"
              simpleTitle="Ейлер не вибухнув, хоча за правилом мав би"
              simple={
                <>
                  За «правилом» (h·|λ| ≈ {fmt(dh * lamMax, 3)} &gt; 2) мав би вибухнути, але біля кривої система сама себе гальмує: щойно x відскакує, темп
                  падає. Тож розв&apos;язок не тікає, а <b>тремтить</b> біля гілки — і може застрягнути біля краю замість чесного стрибка. Промах max|Δx| ={" "}
                  {fmt(eul.ex, 3)}.
                </>
              }
            >
              <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(dh * lamMax, 3)}`}</Tex>, але нестійкість лінійна, а система — ні: біля гілки «розгойдування» x змінює{" "}
              <Tex>{"3x^2 - a"}</Tex> і самообмежується. Розв&apos;язок «тремтить» навколо гілки; похибка max|Δx| = {fmt(eul.ex, 3)}.
            </Insight>
          )}
          {dop && ros && !dop.s.failed && !ros.s.failed && (
            <Insight
              tone="info"
              title="Хто ефективніший?"
              simple={
                <>
                  DOPRI зробив {dop.s.steps} кроків, Розенброк — {ros.s.steps}
                  {dop.s.steps > ros.s.steps ? (
                    <>
                      , тобто в {fmt(dop.s.steps / Math.max(1, ros.s.steps), 3)} раза менше. Явний метод мусить дріботіти навіть там, де серце майже не
                      змінюється.
                    </>
                  ) : (
                    <>, тобто не менше: при такому ε і точності жорсткість ще помірна.</>
                  )}{" "}
                  <Relatable kind="steps" n={dop.s.steps} />
                </>
              }
            >
              DOPRI зробив {dop.s.steps} кроків (+{dop.s.rejected} відхилених), Розенброк — {ros.s.steps} (+{ros.s.rejected}). Відношення{" "}
              {fmt(dop.s.steps / Math.max(1, ros.s.steps), 3)}× — {dop.s.steps > ros.s.steps ? "жорсткість «з'їдає» перевагу явного методу 5-го порядку." : "при такому ε і точності жорсткість ще помірна."}
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Серце б'ється в такт x(t)" simpleTitle="Серце на екрані">
        <Card>
          <HeartScene sol={ref} eps={de} period={period} />
          <p className="mt-3 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Серце тим більше, чим розслабленіше волокно (більше x). Монітор показує, наскільки швидко змінюється x: кожен стрибок з «краю» кривої — гострий
                  пік, як на справжній кардіограмі. Спробуйте a = 1 (серце зупиняється) або ε = 0.2 (стрибки розмиваються).
                </>
              }
            >
              Розмір серця пропорційний <Tex>{"x"}</Tex> (розслаблене волокно — велике серце), монітор показує <Tex>{"-\\varepsilon\\,\\dot x"}</Tex>: кожен стрибок зі
              складки — гострий «QRS-комплекс». Спробуйте a = 1 (серце зупиняється) або ε = 0.2 (стрибки розмиваються).
            </Say>
          </p>
        </Card>
      </Section>

      <Section
        kicker="Результати"
        title={table ? `Порівняння методів при a = ${fmt(table.a, 3)}, x₀ = ${fmt(table.x0, 3)}, h = ${fmt(table.h, 3)}, rtol = ${fmt(table.tol, 2)}` : "Порівняння методів для обох ε з умови"}
        simpleTitle={table ? `Хто з методів впорався (a = ${fmt(table.a, 3)}, обидва ε)` : "Хто з методів впорається з обома ε"}
      >
        <Card>
          {table ? (
            <Table
              head={["Метод", ...EPS_LIST.map((e) => `ε = ${e}: кроки`), ...EPS_LIST.map((e) => `ε = ${e}: період`)]}
              rows={ALL.map((m, j) => [
                <span key={m} style={{ color: METHODS[m].color }}>
                  {METHODS[m].name}
                </span>,
                ...EPS_LIST.map((_, i) => {
                  const { s } = table.cells[j][i];
                  if (s.failed) return <span className="text-[#ff5d73]">{s.failed.includes("Ньютона") ? "✗ Ньютон" : "💥 вибух"} (t≈{fmt(s.t[s.t.length - 1], 3)})</span>;
                  return (
                    <span>
                      {s.steps.toLocaleString("uk-UA")}
                      {isAdaptive(m) && <span className="text-white/40"> (+{s.rejected})</span>}
                    </span>
                  );
                }),
                ...EPS_LIST.map((_, i) => {
                  const { s, per } = table.cells[j][i];
                  if (s.failed) return <span className="text-white/30">—</span>;
                  if (!Number.isFinite(per)) return <span className={Number.isFinite(table.refPer[i]) ? "text-[#ff5d73]" : "text-white/40"}>немає циклу</span>;
                  if (!Number.isFinite(table.refPer[i])) return <span className="text-[#ff5d73]">{fmt(per, 4)} (хибний цикл)</span>;
                  const rel = Math.abs(per - table.refPer[i]) / table.refPer[i];
                  return <span className={rel < 0.01 ? "text-[#3ee6a8]" : rel < 0.05 ? "text-[#ffb547]" : "text-[#ff5d73]"}>{fmt(per, 4)}</span>;
                }),
              ])}
            />
          ) : (
            <button onClick={computeTable} className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/15 px-4 py-2 text-[13px] text-white hover:bg-[var(--accent)]/25">
              Порахувати таблицю (10 методів × 2 ε з поточними a, x₀, T, h, rtol)
            </button>
          )}
          {table && (
            <p className="mt-3 text-[13px] text-white/55">
              <Say
                simple={
                  <>
                    Еталонний (дуже точний) період: ε = 0.05 → {Number.isFinite(table.refPer[0]) ? fmt(table.refPer[0], 5) : "немає циклу"}, ε = 0.025 →{" "}
                    {Number.isFinite(table.refPer[1]) ? fmt(table.refPer[1], 5) : "немає циклу"}. Колір — наскільки метод промахнувся з періодом (&lt;1 % —
                    зелений, &lt;5 % — жовтий). «✗ Ньютон» означає, що неявний метод із завеликим кроком не зміг розв&apos;язати своє рівняння на краю кривої, — це
                    не вибух.
                  </>
                }
              >
              Еталонний період (Розенброк, rtol = 10⁻⁸): ε = 0.05 → {Number.isFinite(table.refPer[0]) ? fmt(table.refPer[0], 5) : "немає циклу"}, ε = 0.025 →{" "}
              {Number.isFinite(table.refPer[1]) ? fmt(table.refPer[1], 5) : "немає циклу"}. Колір — відносна похибка періоду (&lt;1 %, &lt;5 %, більше). «✗ Ньютон» у неявних
              методів з великим h — відмова розв&apos;язувача на складці (див. пояснення в лабораторії), а не нестійкість методу.
              </Say>
            </p>
          )}
          {table && (
            <button onClick={computeTable} className={`mt-2 text-[12px] underline-offset-2 hover:underline ${tableStale ? "text-[#ffb547]" : "text-[var(--accent)]"}`}>
              {tableStale ? "параметри змінилися — перерахувати" : "перерахувати"}
            </button>
          )}
        </Card>
      </Section>

      <Section kicker="Жорсткість" title="Власні числа якобіана вздовж траєкторії" simpleTitle="Де задача жорстка, а де ні">
        <Card>
          <StiffnessPanel problem={problem} sol={ref} />
          <p className="mt-2 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Графік показує темпи найшвидшого й найповільнішого процесів у кожен момент. На гілках найшвидший — ~(3x² − a)/ε, тобто сотні; біля «країв» він
                  падає до нуля, а під час стрибка навіть стає «розганяльним». Жорсткість то зникає, то повертається. ε удвічі менше — удвічі жорсткіше.
                </>
              }
            >
            На гілках швидке власне число <Tex>{"\\sim -(3x^2-a)/\\varepsilon"}</Tex>, біля складок воно проходить через нуль (і навіть стає додатним на нестійкій гілці під час
            стрибка) — жорсткість то зникає, то повертається. Зменшення ε вдвічі вдвічі підвищує жорсткість.
            </Say>
          </p>
        </Card>
      </Section>

      {extras}

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="good"
            title="Три режими — одна кубіка"
            simple={
              <>
                Усе вирішує, де стоїть точка спокою відносно «згинів» кривої: a ≤ 0 — серце паралізоване, 0 &lt; a &lt; 3 — завмирає, a &gt; 3 — б&apos;ється
                саме (при a = 6, ε = 0.05 один удар триває ≈ 12.75 одиниці часу).
              </>
            }
          >
            Поведінку повністю визначає положення <Tex>{"x_0"}</Tex> відносно складок <Tex>{"\\pm\\sqrt{a/3}"}</Tex>: при <Tex>{"a \\le 0"}</Tex> — плавний перехід, при{" "}
            <Tex>{"0 < a < 3x_0^2"}</Tex> — стійкий спокій, при <Tex>{"a > 3x_0^2"}</Tex> — релаксаційний цикл «серцебиття» з різкими стрибками (для <Tex>{"x_0 = 1"}</Tex> поріг{" "}
            <Tex>{"a = 3"}</Tex>; при ε = 0.05 період ≈ 12.75 для a = 6).
          </Insight>
          <Insight
            tone="bad"
            title="Жорсткість ∝ 1/ε"
            simpleTitle="Що менше ε, то жорсткіше"
            simple={
              <>
                Що швидше м&apos;яз реагує (менше ε), то дрібніше мусить крокувати явний метод — навіть коли серце майже не рухається. ε удвічі менше — DOPRI
                робить майже вдвічі більше кроків.
              </>
            }
          >
            На стійких гілках <Tex>{"|\\lambda| \\sim (3x^2-a)/\\varepsilon"}</Tex>, тож явні методи мусять тримати <Tex>{"h \\lesssim 2\\varepsilon/(3x^2-a)"}</Tex> навіть тоді,
            коли розв&apos;язок майже не змінюється. Зменшення ε у 2 рази подвоює кількість кроків DOPRI.
          </Insight>
          <Insight
            tone="info"
            title="Неявні методи і стрибки"
            simple={
              <>
                Неявні методи не бояться швидкості на гілках, але сам стрибок із великим кроком «розмазують» — і ритм потроху збивається. Розенброк підбирає
                крок сам: великий на гілках, дрібний у стрибку.
              </>
            }
          >
            Неявні методи стійкі на гілках, але точність у момент стрибка задає крок: з великим h стрибок «розмазується», і накопичується похибка фази (період).
            Адаптивний Розенброк поєднує обидва світи — великі кроки на гілках і дрібні в стрибках.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Математик Крістофер Зіман у 1972 р. описав серце як «катастрофу складки»: повільна зміна сигналу раптом обертається стрибком. Він же змайстрував
                «машину катастроф» з гумок і картонного диска — її досі збирають на уроках математики.
              </>
            }
          >
            Крістофер Зіман (1972) запропонував цю модель як ілюстрацію теорії катастроф Тома: серце — «складка», а нервовий імпульс — це повільний параметр, що
            доводить систему до краю. Він же побудував знамениту «машину катастроф» Зімана з гумок і картонного диска — її досі збирають на уроках математики.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
