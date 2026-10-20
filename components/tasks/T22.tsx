"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Plot, { type Transform } from "@/components/plot/Plot";
import StabilityExplorer, { amp } from "@/components/plot/StabilityExplorer";
import RLCScene from "@/components/scenes/RLCScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import Gauge from "@/components/ui/Gauge";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, isAdaptive, maxError, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import { traceStep } from "@/lib/step-trace";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import RadioTuneScene from "@/components/analogy/RadioTuneScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { plural } from "@/lib/relatable";

const ALL: MethodId[] = ["euler", "rk4", "ieuler", "trap", "theta", "bdf2", "dopri", "ros"];

interface Params {
  R: number; // Ом
  L: number; // Гн
  C: number; // нФ
  E: number; // В
  w: number; // рад/мс
  q0: number; // мкКл
  v0: number; // мА
  T: number; // мс
}

const BASE: Params = { R: 1e5, L: 25, C: 10, E: 10, w: 1, q0: 5, v0: 0.24, T: 10 };

const PRESETS: { key: string; label: string; p: Params; h?: number }[] = [
  { key: "q5", label: "Умова: q(0)=5", p: BASE },
  { key: "q8", label: "Умова: q(0)=8", p: { ...BASE, q0: 8 } },
  { key: "res", label: "🎵 резонанс", p: { ...BASE, R: 1e4, w: 2, q0: 0, v0: 0, T: 40 } },
  { key: "over", label: "🐌 перезатухання (жорстко)", p: { ...BASE, R: 2e6, T: 20 } },
  { key: "ring", label: "🔔 малий C — дзвін", p: { ...BASE, C: 0.1, T: 10 } },
];

/** γ, ω0 in 1/ms, e0 in μC/ms² */
function coeffs(p: Params) {
  const g = p.R / (2 * p.L) / 1000;
  const w0 = 1 / Math.sqrt(p.L * p.C * 1e-9) / 1000;
  const e0 = p.E / p.L;
  return { g, w0, e0 };
}

function exactRLC(p: Params) {
  const { g, w0, e0 } = coeffs(p);
  const w = p.w;
  const D = (w0 * w0 - w * w) ** 2 + (2 * g * w) ** 2;
  const a = (e0 * (w0 * w0 - w * w)) / D,
    b = (e0 * 2 * g * w) / D;
  const x0 = p.q0 - a,
    v0 = p.v0 - b * w;
  const d = g * g - w0 * w0;
  let hq: (t: number) => number, hv: (t: number) => number, regime: "under" | "critical" | "over";
  let lam: [number, number][];
  if (Math.abs(d) < 1e-6 * w0 * w0) {
    regime = "critical";
    const k = v0 + g * x0;
    hq = (t) => Math.exp(-g * t) * (x0 + k * t);
    hv = (t) => Math.exp(-g * t) * (k - g * (x0 + k * t));
    lam = [
      [-g, 0],
      [-g, 0],
    ];
  } else if (d > 0) {
    regime = "over";
    const s = Math.sqrt(d),
      r1 = -g + s,
      r2 = -g - s;
    const c1 = (v0 - r2 * x0) / (r1 - r2),
      c2 = (r1 * x0 - v0) / (r1 - r2);
    hq = (t) => c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
    hv = (t) => c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t);
    lam = [
      [r1, 0],
      [r2, 0],
    ];
  } else {
    regime = "under";
    const be = Math.sqrt(-d),
      B = (v0 + g * x0) / be;
    hq = (t) => Math.exp(-g * t) * (x0 * Math.cos(be * t) + B * Math.sin(be * t));
    hv = (t) => Math.exp(-g * t) * (-g * (x0 * Math.cos(be * t) + B * Math.sin(be * t)) + be * (-x0 * Math.sin(be * t) + B * Math.cos(be * t)));
    lam = [
      [-g, be],
      [-g, -be],
    ];
  }
  const at = (t: number) => [hq(t) + a * Math.cos(w * t) + b * Math.sin(w * t), hv(t) - a * w * Math.sin(w * t) + b * w * Math.cos(w * t)];
  return { at, a, b, amp: Math.hypot(a, b), regime, lam, g, w0, e0 };
}

function rlcProblem(p: Params): Problem {
  const { g, w0, e0 } = coeffs(p);
  return {
    f: (t, y) => [y[1], e0 * Math.cos(p.w * t) - 2 * g * y[1] - w0 * w0 * y[0]],
    jac: () => [
      [0, 1],
      [-w0 * w0, -2 * g],
    ],
    y0: [p.q0, p.v0],
    T: p.T,
  };
}

function run(m: MethodId, pr: Problem, h: number, tol: number): Solution {
  if (isAdaptive(m)) return solve(m, pr, { rtol: tol, atol: tol * 1e-2, blowup: 1e6, maxSteps: 100000 });
  return solve(m, pr, { h: Math.max(h, pr.T / 100000), blowup: 1e6 });
}

// stable references for the debugger («перезатухання», жорстко) and the playground
const DBG_P: Params = { ...BASE, R: 2e6, T: 6 };
const F_DBG = rlcProblem(DBG_P).f;
const Y0_DBG = [DBG_P.q0, DBG_P.v0];
const DBG_H = 0.1;
const DBG_VIEW = { x: 0, y: 1, xLabel: "q, мкКл", yLabel: "i, мА", xDomain: [3.4, 5.3] as [number, number], yDomain: [-0.7, 0.45] as [number, number] };
const PG_MODES = {
  res: { label: "🎵 резонанс: R = 10 кОм, ω = ω₀", p: { ...BASE, R: 1e4, w: 2 } },
  cond: { label: "📜 з умови: критичне, ω = 1", p: BASE },
};
const PG_INIT = [3, 0];
const PG_DOMAIN = { x: [-6, 6] as [number, number], y: [-12, 12] as [number, number] };
const PG_LABELS: [string, string] = ["q, мкКл", "i, мА"];

const REGIME = {
  under: { name: "недозатухання", sub: "коливання, що згасають", tone: "warn" as const },
  critical: { name: "критичне загасання", sub: "найшвидше повернення без коливань", tone: "good" as const },
  over: { name: "перезатухання", sub: "повільне повзання до нуля", tone: "default" as const },
};

/** Step debugger, preset «перезатухання», h = 0.1: implicit Euler's first steps vs the slow manifold i ≈ λ₁q and the exact current. */
function dbgImplicitEuler() {
  const ex = exactRLC(DBG_P);
  const l1 = ex.lam[0][0],
    l2 = ex.lam[1][0];
  let t = 0,
    y = Y0_DBG;
  const iErr: number[] = [];
  let i1 = NaN,
    l1q1 = NaN;
  for (let n = 1; n <= 3; n++) {
    const y1 = traceStep("ieuler", F_DBG, t, y, DBG_H).y1;
    if (!y1) break;
    t += DBG_H;
    y = y1;
    if (n === 1) {
      i1 = y[1];
      l1q1 = l1 * y[0];
    }
    iErr.push(Math.abs(y[1] - ex.at(t)[1]));
  }
  return { l1, l2, R: 1 / (1 - DBG_H * l2), i1, l1q1, iErr };
}

export default function T22() {
  const [P, setP] = useState<Params>(BASE);
  const dbgIE = useMemo(dbgImplicitEuler, []);
  const [h, setH] = useState(0.1);
  const [tol, setTol] = useState(0.01);
  const [methods, setMethods] = useState<MethodId[]>(["euler", "rk4", "ieuler", "trap", "dopri", "ros"]);
  const dP = useDeferredValue(P);
  const dh = useDeferredValue(h);
  const dtol = useDeferredValue(tol);
  const set = (k: keyof Params) => (v: number) => setP((p) => ({ ...p, [k]: v }));
  const preset = PRESETS.find((x) => (Object.keys(x.p) as (keyof Params)[]).every((k) => x.p[k] === P[k]))?.key ?? "";

  const ex = useMemo(() => exactRLC(dP), [dP]);
  const problem = useMemo(() => rlcProblem(dP), [dP]);
  const dense = useMemo(() => {
    const fast = Math.max(dP.w, Math.abs(ex.lam[1][1]), Math.abs(ex.lam[1][0]));
    const n = Math.min(40000, Math.max(2000, Math.ceil((dP.T * fast * 12) / (2 * Math.PI))));
    const t: number[] = [],
      q: number[] = [],
      i: number[] = [];
    for (let k = 0; k <= n; k++) {
      const tt = (dP.T * k) / n;
      const y = ex.at(tt);
      t.push(tt);
      q.push(y[0]);
      i.push(y[1]);
    }
    let qa = Infinity,
      qb = -Infinity,
      ia = Infinity,
      ib = -Infinity;
    for (let k = 0; k <= n; k++) {
      qa = Math.min(qa, q[k]);
      qb = Math.max(qb, q[k]);
      ia = Math.min(ia, i[k]);
      ib = Math.max(ib, i[k]);
    }
    const pq = (qb - qa) * 0.15 + 1e-3,
      pi = (ib - ia) * 0.15 + 1e-3;
    return { t, q, i, qd: [qa - pq, qb + pq] as [number, number], id: [ia - pi, ib + pi] as [number, number], qMax: Math.max(Math.abs(qa), Math.abs(qb)), iMax: Math.max(Math.abs(ia), Math.abs(ib)) };
  }, [ex, dP.T, dP.w]);

  const sols = useMemo(
    () =>
      methods
        .slice()
        .sort((a, b) => ALL.indexOf(a) - ALL.indexOf(b))
        .map((m) => {
          const s = run(m, problem, dh, dtol);
          const e = maxError(s, ex.at);
          return { m, s, err: e.perComp[0], errArr: e.err[0] };
        }),
    [methods, problem, dh, dtol, ex],
  );

  const { g, w0, e0 } = ex;
  const zeta = g / w0;
  const Q = w0 / (2 * g);
  const lamAbs = ex.lam.map(([re, im]) => Math.hypot(re, im));
  const stiff = ex.regime === "over" ? lamAbs[1] / lamAbs[0] : 1;
  const z1: [number, number] = [dh * ex.lam[1][0], dh * ex.lam[1][1]];
  const z2: [number, number] = [dh * ex.lam[0][0], dh * ex.lam[0][1]];
  const ampE = Math.max(amp("euler", z1), amp("euler", z2));
  const ampRK = Math.max(amp("rk4", z1), amp("rk4", z2));
  const wr = w0 * w0 - 2 * g * g > 0 ? Math.sqrt(w0 * w0 - 2 * g * g) : NaN;
  const qScale = Math.max(dense.qMax, 1e-6);

  const fr = useMemo(() => {
    const ws: number[] = [],
      Aq: number[] = [],
      Ai: number[] = [];
    for (let k = 0; k <= 400; k++) {
      const w = w0 * Math.pow(10, -2 + (4 * k) / 400);
      const A = e0 / Math.sqrt((w0 * w0 - w * w) ** 2 + (2 * g * w) ** 2);
      ws.push(w);
      Aq.push(A);
      Ai.push(A * w);
    }
    return { ws, Aq, Ai };
  }, [g, w0, e0]);

  const energy = useMemo(() => {
    const WC = dense.q.map((q) => (q * q * 1e-9) / (2 * dP.C * 1e-9));
    const WL = dense.i.map((i) => (dP.L * i * i * 1e-3) / 2);
    return { WC, WL, W: WC.map((v, k) => v + WL[k]) };
  }, [dense, dP.C, dP.L]);

  const steady = useMemo(() => {
    const x: number[] = [],
      y: number[] = [];
    for (let k = 0; k <= 200; k++) {
      const th = (2 * Math.PI * k) / 200;
      x.push(ex.a * Math.cos(th) + ex.b * Math.sin(th));
      y.push(dP.w * (-ex.a * Math.sin(th) + ex.b * Math.cos(th)));
    }
    return { x, y };
  }, [ex, dP.w]);

  const table = useMemo(() => {
    const hs = [0.2, 0.1, 0.05, 0.01];
    return PRESETS.filter((x) => x.key !== "res").map((pr) => {
      const p = rlcProblem(pr.p);
      const e = exactRLC(pr.p);
      return {
        pr,
        cells: hs.map((hh) =>
          (["euler", "rk4", "ieuler", "trap"] as MethodId[]).map((m) => {
            const s = run(m, p, hh, 0.01);
            return { s, e: maxError(s, e.at).perComp[0] };
          }),
        ),
      };
    });
  }, []);

  const frUnderlay = useCallback(
    (ctx: CanvasRenderingContext2D, tr: Transform) => {
      const x = tr.X(w0);
      ctx.save();
      ctx.strokeStyle = "rgba(255,230,109,0.4)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, tr.top);
      ctx.lineTo(x, tr.top + tr.height);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,230,109,0.8)";
      ctx.font = "12px var(--font-sans), system-ui, sans-serif";
      ctx.fillText("ω₀", x + 4, tr.top + 14);
      ctx.restore();
    },
    [w0],
  );

  const [pgMode, setPgMode] = useState<keyof typeof PG_MODES>("res");
  const pgP = PG_MODES[pgMode].p;
  const pgF = useMemo(() => rlcProblem(pgP).f, [pgP]);
  const pgEx = useMemo(() => exactRLC(pgP), [pgP]);
  const pgUnderlay = useCallback(
    (ctx: CanvasRenderingContext2D, { X, Y }: { X: (x: number) => number; Y: (y: number) => number }) => {
      ctx.strokeStyle = "rgba(255,230,109,0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let k = 0; k <= 120; k++) {
        const th = (2 * Math.PI * k) / 120;
        const x = pgEx.a * Math.cos(th) + pgEx.b * Math.sin(th);
        const y = pgP.w * (-pgEx.a * Math.sin(th) + pgEx.b * Math.cos(th));
        if (k) ctx.lineTo(X(x), Y(y));
        else ctx.moveTo(X(x), Y(y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,230,109,0.9)";
      ctx.beginPath();
      ctx.arc(X(0), Y(0), 2.5, 0, Math.PI * 2);
      ctx.fill();
    },
    [pgEx, pgP],
  );

  const blown = sols.filter((x) => x.s.failed);
  const inaccurate = sols.filter((x) => !x.s.failed && !isAdaptive(x.m) && x.err > 0.1 * qScale);
  const ad = sols.filter((x) => isAdaptive(x.m) && !x.s.failed);

  return (
    <>
      <AnalogyCard
        emoji="📻"
        title="Ручка налаштування радіо"
        story={
          <>
            Крутите ручку старого приймача: між станціями — тиша, а на «своїй» частоті звук раптом стає гучним. Це <b>резонанс</b>: коло з котушки й
            конденсатора має власну частоту ω₀ і охоче відгукується лише на неї. Резистор — це гальма: що більший опір, то нижчий і ширший пік, і приймач
            «ловить усе підряд», але тихо. У задачі опір такий, що коло загальмоване рівно критично: пік широкий і пологий. А якщо опір збільшити ще — з&apos;являється
            жорсткість: струм згасає миттєво, а заряд стікає повільно.
          </>
        }
        mapping={[
          ["ручка налаштування", <>частота генератора ω</>],
          ["станція, на яку «налаштоване» коло", <>власна частота ω₀ = 1/√(LC) = 2 рад/мс ≈ 318 Гц</>],
          ["гучність", <>амплітуда струму ω·Q(ω) — АЧХ</>],
          ["чіткість налаштування", <>добротність Q = ω₀/(2γ): менший R — вужчий пік</>],
          ["«шипіння» при перемиканні, що стихає", <>власні коливання, що згасають за ~1/γ</>],
        ]}
      >
        <RadioTuneScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Послідовне RLC-коло з генератором" simpleTitle="Коло, що вміє дзвеніти">
        <Grid>
          <Card title="Рівняння (друге правило Кірхгофа)" icon="📜">
            <Tex block>{String.raw`L\,\ddot q + R\,\dot q + \frac{q}{C} = \varepsilon_0\cos\omega t \ \Longleftrightarrow\ \ddot q + 2\gamma\dot q + \omega_0^2 q = e_0\cos\omega t,`}</Tex>
            <Tex block>{String.raw`\gamma = \frac{R}{2L},\qquad \omega_0^2 = \frac{1}{LC},\qquad e_0 = \frac{\varepsilon_0}{L}.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Резистор R, котушка L і конденсатор C з&apos;єднані в кільце з генератором змінної напруги. q — заряд на конденсаторі, i = q′ — струм. Котушка
                  «не любить» змін струму (як інерція), конденсатор тягне заряд назад до нуля (як пружина), резистор гальмує (як тертя). Умова: R = 100 кОм,
                  L = 25 Гн, C = 10 нФ, ε₀ = 10 В, q(0) = 5 (і 8), q′(0) = 0.24; крок 0.1, точність 0.01. Для чисельних методів рівняння другого порядку
                  переписуємо як систему двох рівнянь для q та i:
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Умова: <Tex>{"R = 10^5"}</Tex> Ом, <Tex>{"L = 25"}</Tex> Гн, <Tex>{"C = 10^{-8}"}</Tex> Ф, <Tex>{"\\varepsilon_0 = 10"}</Tex> В, <Tex>{"q(0) = 5"}</Tex> (і окремо 8),{" "}
                <Tex>{"\\dot q(0) = 0.24"}</Tex>; крок <Tex>{"h = 0.1"}</Tex>, точність 0.01. Як систему першого порядку: <Tex>{"y_1 = q,\\ y_2 = \\dot q = i"}</Tex>,
              </p>
            </Say>
            <Tex block>{String.raw`\dot{\mathbf y} = \begin{pmatrix}0 & 1\\ -\omega_0^2 & -2\gamma\end{pmatrix}\mathbf y + \begin{pmatrix}0\\ e_0\cos\omega t\end{pmatrix},\qquad \lambda_{1,2} = -\gamma \pm \sqrt{\gamma^2 - \omega_0^2}.`}</Tex>
          </Card>
          <Card title="Точний розв'язок" icon="🎯">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Рівняння лінійне, тому відповідь можна записати формулою — і чесно порівняти з нею кожен метод. Розв&apos;язок складається з двох частин:{" "}
                  <b>вимушених</b> коливань у такт генератора (вони живуть вічно) і <b>власних</b> коливань кола, що згасають — як «шипіння» приймача, яке стихає.
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Рівняння лінійне, тож <Tex>{"q = q_{\\text{вл}} + q_{\\text{вим}}"}</Tex>. Вимушена частина:
              </p>
            </Say>
            <Tex block>{String.raw`q_{\text{вим}} = a\cos\omega t + b\sin\omega t,\quad a = \frac{e_0(\omega_0^2-\omega^2)}{\Delta},\ b = \frac{2\gamma\omega\, e_0}{\Delta},\ \Delta = (\omega_0^2-\omega^2)^2 + 4\gamma^2\omega^2.`}</Tex>
            <p className="text-[14px] leading-relaxed text-white/75">
              Власна частина з <Tex>{"x_0 = q(0) - a"}</Tex>, <Tex>{"v_0 = \\dot q(0) - b\\omega"}</Tex>, <Tex>{"\\beta = \\sqrt{|\\omega_0^2 - \\gamma^2|}"}</Tex>:
            </p>
            <Tex block>{String.raw`q_{\text{вл}} = \begin{cases} e^{-\gamma t}\big(x_0\cos\beta t + \tfrac{v_0+\gamma x_0}{\beta}\sin\beta t\big), & \gamma<\omega_0,\\ e^{-\gamma t}\big(x_0 + (v_0+\gamma x_0)\,t\big), & \gamma=\omega_0,\\ c_1e^{\lambda_1t} + c_2e^{\lambda_2t}, & \gamma>\omega_0. \end{cases}`}</Tex>
          </Card>
        </Grid>
        <div className="mt-4">
          <Insight
            tone="note"
            title="Реконструкція нечитабельних даних і одиниці"
            simpleTitle="Що ми відновили в умові"
            simple={
              <>
                У методичці один символ стерся: «… = 25·10⁶». Найімовірніше, це індуктивність L = 25·10⁶ мкГн = 25 Гн — тоді гальмування й власна частота
                кола збігаються (по 2000 1/с), тобто коло загальмоване рівно «критично», що явно задумав автор. Щоб крок h = 0.1 мав сенс, рахуємо час у
                мілісекундах, заряд — у мікрокулонах, струм — у міліамперах. Частоту генератора не задано — беремо 1 рад/мс (≈ 159 Гц), її можна крутити.
              </>
            }
          >
            У методичці символ перед «= 25·10⁶» втрачено. Найправдоподібніше — це <Tex>{"L = 25\\cdot10^{6}"}</Tex> мкГн = 25 Гн: тоді{" "}
            <Tex>{"\\gamma = 10^5/50 = 2000\\ \\text{с}^{-1}"}</Tex> і <Tex>{"\\omega_0 = 1/\\sqrt{25\\cdot10^{-8}} = 2000\\ \\text{с}^{-1}"}</Tex> — рівно <b>критичне загасання</b>,
            явно задумане автором. Щоб крок <Tex>{"h = 0.1"}</Tex> мав сенс, вимірюємо час у <b>мілісекундах</b>, заряд — у мікрокулонах: <Tex>{"\\gamma = \\omega_0 = 2\\ \\text{мс}^{-1}"}</Tex>,{" "}
            <Tex>{"e_0 = 10/25 = 0.4\\ \\text{мкКл/мс}^2"}</Tex>, струм <Tex>{"\\dot q"}</Tex> — у міліамперах. Частоту генератора <Tex>{"\\omega"}</Tex> не задано — за замовчуванням 1 рад/мс
            (≈ 159 Гц), її можна крутити.
          </Insight>
        </div>
      </Section>

      <Section kicker="Лабораторія" title="Паяльник у руках">
        <Lab
          controls={
            <>
              <Chips
                label="Пресети"
                value={preset}
                onChange={(k) => {
                  const x = PRESETS.find((y) => y.key === k);
                  if (x) setP(x.p);
                }}
                options={PRESETS.map((x) => ({ value: x.key, label: x.label }))}
              />
              <Slider label="R, Ом" value={P.R} onChange={set("R")} min={1e3} max={1e7} log format={(v) => fmt(v, 3)} hint={`γ = R/2L = ${fmt(g, 4)} мс⁻¹`} />
              <Slider label="L, Гн" value={P.L} onChange={set("L")} min={0.5} max={200} log />
              <Slider label="C, нФ" value={P.C} onChange={set("C")} min={0.05} max={1000} log hint={`ω₀ = 1/√(LC) = ${fmt(w0, 4)} рад/мс`} />
              <Slider label="ε₀, В" value={P.E} onChange={set("E")} min={0} max={100} step={0.5} />
              <Slider label="ω генератора, рад/мс" value={P.w} onChange={set("w")} min={0.05} max={50} log />
              <div className="grid grid-cols-2 gap-3">
                <Slider label="q(0), мкКл" value={P.q0} onChange={set("q0")} min={-10} max={10} step={0.1} />
                <Slider label="q′(0), мА" value={P.v0} onChange={set("v0")} min={-10} max={10} step={0.01} />
              </div>
              <Slider label="T, мс" value={P.T} onChange={set("T")} min={1} max={100} log />
              <Slider label="Крок h, мс" value={h} onChange={setH} min={0.002} max={0.5} log />
              <Slider label="Точність (адаптивні)" value={tol} onChange={setTol} min={1e-8} max={0.1} log format={(v) => v.toExponential(0)} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Gauge value={ampE} label="явний Ейлер max|R(hλ)|" />
                <Gauge value={ampRK} label="RK4 max|R(hλ)|" />
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title="Заряд конденсатора q(t), мкКл"
              xLabel="t, мс"
              height={290}
              yDomain={dense.qd}
              series={[
                { x: dense.t, y: dense.q, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
                ...sols.map(({ m, s, err }) => ({
                  x: s.t,
                  y: comp(s, 0),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: s.failed || err > 0.3 * qScale ? 1 : 1.7,
                  opacity: s.failed || err > 0.3 * qScale ? 0.45 : 1,
                  dots: isAdaptive(m) && s.t.length < 60,
                  dotSize: 3,
                })),
              ]}
            />
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Струм i = q′(t), мА"
                xLabel="t, мс"
                height={240}
                yDomain={dense.id}
                series={[
                  { x: dense.t, y: dense.i, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
                  ...sols.map(({ m, s }) => ({ x: s.t, y: comp(s, 1), color: METHODS[m].color, width: s.failed ? 1 : 1.5, opacity: s.failed ? 0.45 : 1 })),
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="Похибка |q − q_точн| (лог)"
                xLabel="t, мс"
                height={240}
                logY
                yDomain={[1e-10, 1e3]}
                series={sols.map(({ m, s, errArr }) => ({ x: s.t, y: errArr.map((v) => Math.max(v, 1e-14)), color: METHODS[m].color, label: METHODS[m].short, width: 1.4 }))}
              />
            </Card>
          </Grid>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, err }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : fmt(err, 3)}
                sub={s.failed ? s.failed : `max |Δq| · ${s.steps} кр.${s.rejected ? ` (+${s.rejected})` : ""} · ${fmtMs(s.ms)}`}
                tone={s.failed || err > 0.3 * qScale ? "bad" : err > 0.01 ? "warn" : "good"}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="режим" value={REGIME[ex.regime].name} sub={REGIME[ex.regime].sub} tone={REGIME[ex.regime].tone} />
            <Stat label="ζ = γ/ω₀ · добротність Q" value={`${fmt(zeta, 3)} · ${fmt(Q, 3)}`} sub="ζ = 1 — критичне" />
            <Stat
              label="власні числа λ₁,₂"
              value={ex.regime === "under" ? `${fmt(ex.lam[0][0], 3)} ± ${fmt(ex.lam[0][1], 3)}i` : `${fmt(ex.lam[0][0], 3)}; ${fmt(ex.lam[1][0], 3)}`}
              sub="мс⁻¹"
            />
            <Stat label="коеф. жорсткості" value={fmt(stiff, 4)} sub={ex.regime === "over" ? "|λ₂| / |λ₁|" : "комплексні/рівні λ — не жорстка"} tone={stiff > 100 ? "warn" : "default"} />
          </div>
          {stiff > 100 && <Relatable kind="ratio" n={stiff} />}
          {blown.length > 0 && (
            <Insight
              tone="bad"
              title={`${blown.map((x) => METHODS[x.m].short).join(", ")}: вибух`}
              simple={
                ex.regime === "over" ? (
                  <>
                    Великий опір розділив коло на два темпи: струм згасає за ~{fmt(1 / Math.abs(ex.lam[1][0]), 2)} мс, а заряд стікає за ~
                    {fmt(1 / Math.abs(ex.lam[0][0]), 3)} мс. Явний метод крокує по {fmt(dh, 3)} мс — довше, ніж триває швидкий процес, — і перестрибує його.
                    {ampE > 1 && (
                      <>
                        {" "}Явний Ейлер на кожному кроці множить похибку на {fmt(ampE, 3)}; якби рахувати до кінця —{" "}
                        <Relatable kind="growth" n={Math.pow(ampE, dP.T / dh)} />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    Коло «дзвенить» з частотою ≈ {fmt(Math.abs(ex.lam[0][1]), 3)} рад/мс — за один крок {fmt(dh, 3)} мс фаза проскакує на{" "}
                    {fmt(dh * Math.abs(ex.lam[0][1]), 3)} рад — метод не встигає за коливаннями, і вони розгойдуються до вибуху.
                    {ampE > 1 && (
                      <>
                        {" "}Явний Ейлер на кожному кроці підсилює їх у {fmt(ampE, 4)} раза; якби рахувати до кінця —{" "}
                        <Relatable kind="growth" n={Math.pow(ampE, dP.T / dh)} />
                      </>
                    )}
                  </>
                )
              }
            >
              {ex.regime === "over" ? (
                <>
                  Швидка мода <Tex>{`\\lambda_2 = ${fmt(ex.lam[1][0], 4)}`}</Tex> мс⁻¹ дає <Tex>{`h\\lambda_2 = ${fmt(z1[0], 4)}`}</Tex> — за межею явного Ейлера (−2) і RK4 (−2.785). При цьому
                  розв&apos;язок визначає повільна мода <Tex>{`\\lambda_1 = ${fmt(ex.lam[0][0], 4)}`}</Tex>: класична жорсткість, коефіцієнт {fmt(stiff, 4)}.
                </>
              ) : (
                <>
                  Комплексні <Tex>{`h\\lambda = ${fmt(z1[0], 3)} \\pm ${fmt(Math.abs(z1[1]), 3)}i`}</Tex>: для явного Ейлера <Tex>{`|1 + h\\lambda| = ${fmt(ampE, 4)} > 1`}</Tex> — кожен крок
                  підсилює коливання. Коло з малим C «дзвенить» надто швидко для такого кроку.
                </>
              )}
            </Insight>
          )}
          {inaccurate.length > 0 && (
            <Insight
              tone="warn"
              title="Стійко ≠ точно"
              simple={
                <>
                  {inaccurate.map((x) => METHODS[x.m].short).join(", ")} не вибухають, але промахуються більш ніж на 10% розмаху заряду.
                  {ex.regime === "under" && ` За один крок коливання встигає повернутись на ${fmt(dh * Math.abs(ex.lam[0][1]), 3)} рад — метод бачить синусоїду надто рідко, як стробоскоп.`}
                  {ex.regime !== "under" && " Прості методи 1-го порядку помиляються пропорційно кроку: неявний Ейлер «підтягує» заряд до нуля швидше, ніж насправді, явний — навпаки."}
                </>
              }
            >
              {inaccurate.map((x) => METHODS[x.m].short).join(", ")} не вибухають, але похибка понад 10% від амплітуди.
              {ex.regime === "under" && ` За один крок фаза коливань змінюється на hβ ≈ ${fmt(dh * Math.abs(ex.lam[0][1]), 3)} рад — сітка просто не встигає за синусоїдою.`}
              {ex.regime !== "under" && " Методи 1-го порядку мають похибку O(h): неявний Ейлер «підтягує» розв'язок до нуля (числова дисипація), явний — навпаки, завищує."}
            </Insight>
          )}
          {ad.length > 0 && (
            <Insight
              tone="info"
              title="Адаптивні методи"
              simpleTitle="Методи, що самі обирають крок"
              simple={
                <>
                  {ad.map((x) => `${METHODS[x.m].short}: ${x.s.steps} ${plural(x.s.steps, ["крок", "кроки", "кроків"])}, промах ${fmt(x.err, 2)}`).join("; ")}.{" "}
                  {dtol >= 5e-3
                    ? "З точністю 0.01 (як в умові) їм вистачає кількох десятків кроків — крива плавна."
                    : `З точністю ${dtol.toExponential(0)} крок диктує вже вимога точності — особливо для Розенброка, який має лише 2-й порядок.`}
                  {ex.regime === "over" && stiff > 100 && " Але DOPRI тут дріботить не через точність, а щоб не розхитати швидкий процес — порівняйте з Розенброком."}
                </>
              }
            >
              {ad.map((x) => `${METHODS[x.m].short}: ${x.s.steps} кроків (${x.s.rejected} відх.), похибка ${fmt(x.err, 2)}`).join("; ")}.{" "}
              {dtol >= 5e-3
                ? "З точністю 0.01 (як в умові) їм вистачає кількох десятків кроків, бо розв'язок гладкий."
                : `З точністю ${dtol.toExponential(0)} крок диктує вже не стійкість, а похибка — особливо для Розенброка 2-го порядку.`}
              {ex.regime === "over" && stiff > 100 && " Але DOPRI тут обмежений стійкістю, а не точністю — порівняйте його кроки з Розенброком."}
            </Insight>
          )}
          {ex.regime === "critical" && (
            <Insight
              tone="good"
              title="Критичне загасання"
              simple={
                <>
                  Гальмування і власна частота кола однакові (γ = ω₀ = {fmt(g, 3)} мс⁻¹): заряд повертається до нуля найшвидше з можливих способів і без жодного
                  «перелітання». Із кроком {fmt(dh, 3)} мс{" "}
                  {dh * g < 2
                    ? `не вибухає жоден метод (явному Ейлеру досить h < ${fmt(2 / g, 3)} мс)`
                    : `явний Ейлер уже вибухає (йому треба h < ${fmt(2 / g, 3)} мс)`}
                  . Задача з умови <b>не</b> жорстка — проблеми з&apos;являться, якщо збільшити R (струм гаснутиме миттєво, а заряд — повільно) або зменшити C
                  (коло задзвенить надто швидко для кроку).
                </>
              }
            >
              <Tex>{`\\gamma = \\omega_0 = ${fmt(g, 3)}`}</Tex> мс⁻¹, подвійне власне число <Tex>{`\\lambda = ${fmt(-g, 3)}`}</Tex>: при поточному кроці{" "}
              <Tex>{`h\\lambda = ${fmt(-dh * g, 3)}`}</Tex>, тож {dh * g < 2 ? "усі методи стійкі (явному Ейлеру досить |hλ| < 2)" : "явний Ейлер уже за межею |hλ| < 2"}.
              Задача з умови <b>не</b> жорстка — жорсткість з&apos;являється, якщо збільшити R (перезатухання) або зменшити C (коливальна «жорсткість»: велика ω₀).
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Струм, який видно">
        <RLCBlock dense={dense} p={dP} />
      </Section>

      <Section kicker="Частотна характеристика" title="АЧХ і фазовий портрет" simpleTitle="Як коло відгукується на різні частоти">
        <Grid>
          <Card>
            <Plot
              title="Амплітуда вимушених коливань (лог-лог)"
              xLabel="ω, рад/мс"
              height={300}
              logX
              logY
              underlay={frUnderlay}
              cursorX={dP.w}
              markers={[
                { x: dP.w, y: ex.amp, color: "#ffe66d", r: 6 },
                { x: dP.w, y: ex.amp * dP.w, color: "#7cf29c", r: 5 },
              ]}
              series={[
                { x: fr.ws, y: fr.Aq, color: "#ffe66d", label: "заряд Q(ω), мкКл", width: 2.4 },
                { x: fr.ws, y: fr.Ai, color: "#7cf29c", label: "струм ωQ(ω), мА", width: 2, dash: [6, 4] },
              ]}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                  Наскільки сильно розгойдується коло, якщо генератор «співає» на частоті ω (обидві шкали логарифмічні). Струм найсильніший точно на власній
                  частоті ω₀ = {fmt(w0, 3)} рад/мс — це «станція» з аналогії.{" "}
                  {Number.isFinite(wr)
                    ? `Заряд — трохи раніше, при ω ≈ ${fmt(wr, 3)}.`
                    : "А заряд при такому сильному гальмуванні резонансу не має — що повільніше генератор, то більший заряд."}{" "}
                  Зараз амплітуда заряду — {fmt(ex.amp, 3)} мкКл.
                </p>
              }
            >
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                <Tex>{"Q(\\omega) = e_0/\\sqrt{(\\omega_0^2-\\omega^2)^2 + 4\\gamma^2\\omega^2}"}</Tex>. Резонанс струму — точно при <Tex>{"\\omega = \\omega_0"}</Tex>; резонанс заряду —
                при <Tex>{"\\omega_r = \\sqrt{\\omega_0^2 - 2\\gamma^2}"}</Tex>
                {Number.isFinite(wr) ? ` = ${fmt(wr, 4)}` : " — не існує (ζ > 1/√2)"}. Поточна амплітуда вимушених коливань: {fmt(ex.amp, 3)} мкКл.
              </p>
            </Say>
          </Card>
          <Card>
            <Plot
              title="Фазовий портрет (q, i)"
              xLabel="q"
              yLabel="i"
              height={300}
              sorted={false}
              markers={[{ x: dP.q0, y: dP.v0, color: "#ffffff", r: 4 }]}
              series={[
                { x: steady.x, y: steady.y, color: "#ffe66d", label: "усталений еліпс", width: 2, dash: [5, 4] },
                { x: dense.q, y: dense.i, color: "#ffffff", label: "точний", width: 2.5, opacity: 0.7, fade: true },
                ...sols.filter(({ s }) => !s.failed).map(({ m, s }) => ({ x: comp(s, 0), y: comp(s, 1), color: METHODS[m].color, width: 1.2, opacity: 0.8 })),
              ]}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                  Кожна точка — пара «заряд, струм» у якийсь момент. Коло поступово «забуває», з чого стартувало (приблизно за{" "}
                  {fmt(1 / Math.min(...ex.lam.map(([re]) => Math.abs(re))), 3)} мс), і далі ходить по жовтому еліпсу в такт генератору. Розмір еліпса — та сама
                  «гучність» з графіка ліворуч.
                </p>
              }
            >
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                Траєкторія забуває початкові умови за час ~<Tex>{`1/\\min|\\mathrm{Re}\\,\\lambda| \\approx ${fmt(1 / Math.min(...ex.lam.map(([re]) => Math.abs(re))), 3)}`}</Tex> мс і
                виходить на еліпс вимушених коливань — розмір якого і є точкою на АЧХ.
              </p>
            </Say>
          </Card>
        </Grid>
        <Card className="mt-4">
          <Plot
            title="Енергія: електричне поле конденсатора і магнітне поле котушки, мДж"
            xLabel="t, мс"
            height={230}
            series={[
              { x: dense.t, y: energy.WC, color: "#ff5d73", label: "W_C = q²/2C", width: 2 },
              { x: dense.t, y: energy.WL, color: "#5cc8ff", label: "W_L = Li²/2", width: 2 },
              { x: dense.t, y: energy.W, color: "#ffffff", label: "сума", width: 2, dash: [6, 4] },
            ]}
          />
          <Say
            simple={
              <p className="mt-2 text-[13px] text-white/55">
                Енергія переливається між конденсатором (червона) і котушкою (синя), як між потенціальною і кінетичною енергією гойдалки. Резистор потроху
                перетворює її на тепло, а генератор щоперіоду підкидає нову порцію.
              </p>
            }
          >
            <p className="mt-2 text-[13px] text-white/55">
              Енергія перетікає між конденсатором і котушкою, а резистор забирає її в тепло (потужність <Tex>{"Ri^2"}</Tex>); генератор підкачує нову порцію щоперіоду.
            </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Стійкість" title="Де лежать hλ₁,₂ відносно областей стійкості" simpleTitle="Карта «вибухне чи ні»">
        <Card>
          <StabilityExplorer
            z={[Math.max(z1[0], -12), Math.max(-8, Math.min(8, z1[1]))]}
            onZ={(zz) => {
              const l = Math.hypot(ex.lam[1][0], ex.lam[1][1]);
              if (l > 0) setH(Math.min(0.5, Math.max(0.002, Math.hypot(zz[0], zz[1]) / l)));
            }}
            range={4}
            extraPoints={[{ z: [Math.max(z2[0], -12), Math.max(-8, Math.min(8, z2[1]))], color: "#ffffffaa", label: "hλ₁" }]}
          />
          <Say
            simple={
              <p className="mt-2 text-[13px] text-white/55">
                Кожен метод має свою «безпечну зону» на цій карті. Точка — це «крок × темп кола»: поки вона всередині зони методу, він не вибухне. Перетягніть
                точку — і крок h зміниться. Для кола, що дзвенить, точка лежить угорі-збоку: явний Ейлер майже ніколи не встигає за чистими коливаннями, а RK4
                витримує, поки за крок проходить не більше ≈ 2.8 радіана коливання.
              </p>
            }
          >
            <p className="mt-2 text-[13px] text-white/55">
              Перетягніть точку <Tex>{"h\\lambda_2"}</Tex> — крок h зміниться відповідно. Для коливального кола точки комплексні: явний Ейлер не стійкий для чисто уявних{" "}
              <Tex>{"h\\lambda"}</Tex> взагалі, RK4 тримається до <Tex>{"|h\\beta| \\approx 2.83"}</Tex>.
            </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Результати" title="Максимальна похибка q для різних кроків" simpleTitle="Хто наскільки промахнувся">
        <Card>
          <Table
            head={["Режим", "h", ...(["euler", "rk4", "ieuler", "trap"] as MethodId[]).map((m) => METHODS[m].short)]}
            rows={table.flatMap(({ pr, cells }) =>
              cells.map((row, k) => [
                k === 0 ? <span className="text-white">{pr.label}</span> : "",
                [0.2, 0.1, 0.05, 0.01][k],
                ...row.map(({ s, e }) =>
                  s.failed ? (
                    <span className="text-[#ff5d73]">💥</span>
                  ) : (
                    <span className={e > 1 ? "text-[#ff5d73]" : e > 0.05 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>{fmt(e, 2)}</span>
                  ),
                ),
              ]),
            )}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Найбільший промах заряду (мкКл) для чотирьох методів і чотирьох кроків. У колі з умови не вибухає жоден метод навіть при h = 0.2. У
                «гальмівному» (R = 2 МОм) явні методи вибухають уже при h ≥ 0.05. У «дзвінкому» (C = 0.1 нФ) неявні не вибухають, але з великим кроком
                замість дзвону дають кашу.
              </p>
            }
          >
            <p className="mt-3 text-[13px] text-white/55">
              У критичному режимі з умови всі методи стійкі навіть при h = 0.2. У перезатухлому (R = 2 МОм) явні методи падають при h ≥ 0.05, у «дзвінкому»
              (C = 0.1 нФ, ω₀ = 20 рад/мс) — неявні стійкі, але з великими кроками дають фазову кашу.
            </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={F_DBG}
          y0={Y0_DBG}
          T={DBG_P.T}
          view={DBG_VIEW}
          h0={DBG_H}
          hMin={0.002}
          hMax={0.5}
          hPresets={[0.1, 0.02, 0.01]}
          hPresetsLabel="Кроки для порівняння"
          hint={
            <Say
              simple={
                <>
                  Пресет «перезатухання» (R = 2 МОм): струм згасає за ~0.0125 мс, а заряд стікає за ~20 мс. Явний Ейлер з кроком 0.1: перший крок — струм
                  стрибає з +0.24 до −3.6 і вилітає з картинки, другий — до +23.5. Неявний Ейлер не перестрибує: за перший крок струм падає з +0.24 до{" "}
                  {fmt(dbgIE.i1, 2)}, а за наступні 1–2 кроки «сідає» на доріжку i ≈ {fmt(dbgIE.l1, 1)}·q ≈ {fmt(dbgIE.l1q1, 2)} — щокроку промах відносно
                  справжнього струму меншає приблизно в {fmt(1 / dbgIE.R, 1)} разів. Далі доріжкою повільно повзе справжній розв&apos;язок. Трапеції не гасять стрибок, а
                  перекидають його через доріжку. З кроком 0.02 явний Ейлер уже стійкий.
                </>
              }
            >
              Фазова площина (q, i), γ = 40 мс⁻¹, ω₀ = 2 мс⁻¹: λ₂ ≈ −79.95, λ₁ ≈ −0.050. Явний Ейлер з h = 0.1: множник швидкої моди 1 + hλ₂ ≈ −7 —
              вибух; межа h &lt; 2/|λ₂| ≈ 0.025. Неявні методи прямують до повільного многовиду i ≈ λ₁q, але не за один крок: швидка складова
              відхилення від нього множиться щокроку на R(hλ₂) — у неявного Ейлера <Tex>{`R = 1/(1 - h\\lambda_2) \\approx ${fmt(dbgIE.R, 2)}`}</Tex> (L-стійкість дає R → 0 лише
              при hλ → −∞). Тому після першого кроку i ≈ {fmt(dbgIE.i1, 3)} проти λ₁q ≈ {fmt(dbgIE.l1q1, 3)}, а похибка струму за кроки 1–3 —{" "}
              {dbgIE.iErr.map((e) => fmt(e, 2)).join(" → ")}. Трапеції — з R(hλ₂) ≈ −0.6 (перекидання через многовид), θ-метод — ≈ −0.48. Задача
              неавтономна (генератор e₀cos t), але вимушена амплітуда тут лише ≈ 0.005 мкКл.
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Киньте в коло заряд — і подивіться, як воно заспокоїться" report={false}>
        <div className="mb-3">
          <Chips label="Коло в пісочниці" value={pgMode} onChange={setPgMode} options={(Object.keys(PG_MODES) as (keyof typeof PG_MODES)[]).map((k) => ({ value: k, label: PG_MODES[k].label }))} />
        </div>
        <PhasePlayground
          key={pgMode}
          f={pgF}
          init={PG_INIT}
          autonomous={false}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={1.5}
          speedRange={[0.2, 10]}
          trail={12}
          strip={[
            { comp: 0, label: "q", color: "#ffe66d" },
            { comp: 1, label: "i", color: "#7cf29c" },
          ]}
          window={15}
          kicks={[
            { label: "Кинути заряд", emoji: "⚡", apply: (y) => [y[0] + 3, y[1]], hint: "q += 3" },
            { label: "Імпульс струму", emoji: "💨", apply: (y) => [y[0], y[1] + 3], hint: "i += 3" },
            { label: "Закоротити", emoji: "🔌", apply: () => [0, 0], hint: "q = i = 0" },
          ]}
          underlay={pgUnderlay}
          hint={
            <Say
              simple={
                <>
                  Жовтий пунктирний еліпс — «пісня» генератора: туди рано чи пізно приходить коло, звідки б не стартувало. У режимі резонансу коло ще довго
                  «дзвенить» по спіралі (згасання ~5 мс), а з даними з умови — повертається майже без коливань, і еліпс там крихітний (0.08 мкКл). Кидайте
                  заряд, штовхайте струм — і рахуйте, скільки обертів зробить спіраль.
                </>
              }
            >
              Фазова площина (q, i). Пунктир — усталений еліпс q = a cos ωt + b sin ωt (a, b — з точного розв&apos;язку). Резонанс: γ = 0.2 мс⁻¹, ω = ω₀ = 2
              рад/мс, амплітуда e₀/(2γω) = 0.5 мкКл, власні коливання згасають як e^(−0.2t). Умова: γ = ω₀ = 2 (критичне), ω = 1, амплітуда 0.08 мкКл. Поле
              напрямків перемальовується щокадру: сила генератора e₀cos ωt змінюється в часі, тож «вітер» на площині теж повертається.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="22"
          questions={[
            {
              id: "over-euler",
              q: (
                <>
                  Опір збільшили в 20 разів (R = 2 МОм, пресет «перезатухання»): заряд тепер стікає дуже повільно — за десятки мілісекунд. Що буде з явним
                  Ейлером при тому самому кроці h = 0.1 мс?
                </>
              ),
              options: [
                "Стане ще точнішим — процес же повільніший",
                "Вибухне за кілька кроків",
                "Нічого не зміниться",
                "Почне коливатися з власною частотою кола",
              ],
              correct: 1,
              explain: (
                <>
                  λ = −γ ± √(γ² − ω₀²) = −40 ± 39.95: λ₁ ≈ −0.050 (повільний розряд), λ₂ ≈ −79.95 (миттєве загасання струму). hλ₂ ≈ −8, |1 + hλ₂| ≈ 7 —
                  поріг 10⁶ перетинається за кілька кроків (RK4 теж: межа ≈ −2.785). Коефіцієнт жорсткості ≈ 1600.
                </>
              ),
              explainSimple: (
                <>
                  Великий опір не лише сповільнив розряд, а й зробив згасання струму надшвидким (~0.0125 мс). Крок 0.1 мс у вісім разів довший — і явний Ейлер
                  на кожному кроці множить похибку на 7.
                </>
              ),
              show: {
                label: "Показати R = 2 МОм, h = 0.1",
                run: () => {
                  setP({ ...BASE, R: 2e6, T: 20 });
                  setH(0.1);
                  setMethods((ms) => Array.from(new Set([...ms, "euler", "ieuler"])) as MethodId[]);
                },
              },
            },
            {
              id: "rk4-vs-ieuler",
              q: <>Коло з умови (q(0) = 5), h = 0.1 — обидва методи стійкі. У скільки разів похибка RK4 менша, ніж у неявного Ейлера?</>,
              options: ["Однакова — крок же той самий", "Приблизно в 10 разів", "Приблизно в 1000 разів", "Неявний Ейлер точніший"],
              correct: 2,
              explain: (
                <>
                  max|Δq|: RK4 ≈ 9.6·10⁻⁵, неявний Ейлер ≈ 0.139 — у ≈1450 разів. Глобальна похибка RK4 — O(h⁴), неявного Ейлера — O(h): при hλ = −0.2 задача
                  не жорстка, і порядок методу вирішує все.
                </>
              ),
              explainSimple: (
                <>
                  RK4 промахується на ~0.0001, неявний Ейлер — на ~0.14: різниця понад тисячу разів за однакової кількості кроків. Коли задача не жорстка,
                  «розумніший» явний метод виграє.
                </>
              ),
              show: {
                label: "Показати умову з h = 0.1",
                run: () => {
                  setP(BASE);
                  setH(0.1);
                  setMethods((ms) => Array.from(new Set([...ms, "rk4", "ieuler"])) as MethodId[]);
                },
              },
            },
            {
              id: "ring-ieuler",
              q: <>Малий C = 0.1 нФ: коло «дзвенить» з частотою ≈ 20 рад/мс і згасає за ~0.5 мс. Неявний Ейлер з h = 0.1 мс стійкий. Що він покаже?</>,
              options: [
                "Майже точний дзвін, лише трохи зсунутий у часі",
                "Вибух — коливання надто швидкі",
                "Погасить дзвін у сотні разів швидше, ніж справжнє коло",
                "Дзвін без жодного згасання",
              ],
              correct: 2,
              explain: (
                <>
                  λ = −2 ± 19.9i, hλ = −0.2 ± 1.99i. Множник неявного Ейлера |1/(1 − hλ)| ≈ 0.43 за крок проти точного e^(−0.2) ≈ 0.82. За 1 мс (10 кроків):
                  0.43¹⁰ ≈ 2·10⁻⁴ проти e^(−2) ≈ 0.14 — числова дисипація в ~600 разів сильніша. Максимальна похибка q ≈ 2.9 мкКл.
                </>
              ),
              explainSimple: (
                <>
                  Неявний Ейлер «перестраховується» і гасить коливання на кожному кроці вдвічі сильніше, ніж треба. За 1 мс справжній дзвін слабне в ~7 разів, а
                  числовий — майже в 5000. Не вибух, але й не правда.
                </>
              ),
              show: {
                label: "Показати C = 0.1 нФ, h = 0.1",
                run: () => {
                  setP({ ...BASE, C: 0.1, T: 10 });
                  setH(0.1);
                  setMethods((ms) => Array.from(new Set([...ms, "ieuler", "trap", "rk4"])) as MethodId[]);
                },
              },
            },
          ]}
        />
      </Section>

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="good"
            title="Задача з умови — критичне загасання"
            simple={
              <>
                Опір у колі з умови підібраний «ідеально»: заряд повертається до нуля найшвидше і без перелітання — так налаштовують стрілки приладів і
                амортизатори авто. Через ~5 мс залишається тільки рівне коливання в такт генератору з амплітудою 0.08 мкКл.
              </>
            }
          >
            <Tex>{"\\gamma = \\omega_0"}</Tex>: заряд повертається до нуля найшвидше з можливих способів без перерегулювання. Так налаштовують стрілочні прилади й
            амортизатори. Для даних з умови (ω = 1 рад/мс) після ~5 мс лишаються тільки вимушені коливання амплітудою 0.08 мкКл.
          </Insight>
          <Insight
            tone="bad"
            title="Звідки береться жорсткість"
            simple={
              <>
                Якщо гальмування набагато сильніше за «пружність» кола, процеси розходяться: струм гасне миттєво, а конденсатор розряджається повільно. Для
                R = 2 МОм швидкий процес у ≈1600 разів швидший за повільний. <Relatable kind="ratio" n={1598} /> Явний метод мусить крокувати під
                найшвидший — увесь час.
              </>
            }
          >
            При <Tex>{"\\gamma \\gg \\omega_0"}</Tex> корені <Tex>{"\\lambda_1 \\approx -\\omega_0^2/2\\gamma"}</Tex> та <Tex>{"\\lambda_2 \\approx -2\\gamma"}</Tex> розходяться як{" "}
            <Tex>{"4\\gamma^2/\\omega_0^2 = 4\\zeta^2 = R^2C/L"}</Tex>. Великий опір (або більша ємність) — і повільний розряд конденсатора співіснує з миттєвим загасанням
            струму.
          </Insight>
          <Insight
            tone="warn"
            title="Коливальна «жорсткість»"
            simpleTitle="Коло, що дзвенить надто швидко"
            simple={
              <>
                При малому C коло дзвенить дуже часто — за один крок 0.1 мс коливання встигає повернутися майже на 2 радіани (третину оберту). Неявні методи не
                вибухають, але бачать дзвін як стробоскоп: показують не те, що є. Тут крок треба зменшувати заради точності, а не заради стійкості.
              </>
            }
          >
            При малому C власні числа комплексні з великою уявною частиною. Неявні методи формально стійкі, але не точні: hβ ~ 2 рад на крок — це не
            розв&apos;язок, а стробоскоп. Тут треба зменшувати крок за точністю, а не за стійкістю.
          </Insight>
          <Insight
            tone="info"
            title="Точний розв'язок — розкіш"
            simple={
              <>
                Для лінійного кола відповідь відома формулою — тож видно, хто скільки помиляється. У колі з умови RK4 з кроком 0.1 помиляється на ~0.0001, неявний
                Ейлер — на ~0.1: у тисячу разів гірше при тій самій кількості кроків. Коли задача не жорстка, точніший метод виграє.
              </>
            }
          >
            Лінійність дає змогу порівнювати методи з ідеалом. Для кола з умови RK4 з h = 0.1 має похибку ~10⁻⁴, неявний Ейлер — ~10⁻¹: різниця в 1000 разів при
            однаковій кількості кроків. Порядок методу важливий, коли задача не жорстка.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Це саме рівняння описує вантаж на пружині з амортизатором: котушка — маса, резистор — тертя, конденсатор — пружина. Тому до цифрових
                комп&apos;ютерів механіку «рахували» на електричних схемах: спаяти RLC-коло було простіше, ніж виточити механізм.
              </>
            }
          >
            Те саме рівняння описує вантаж на пружині з демпфером: L ↔ маса, R ↔ в&apos;язке тертя, 1/C ↔ жорсткість. Саме тому до появи цифрових комп&apos;ютерів
            механічні системи «обчислювали» на аналогових електричних схемах — зібрати RLC-коло було простіше, ніж виточити механізм.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function RLCBlock({
  dense,
  p,
}: {
  dense: { t: number[]; q: number[]; i: number[]; qMax: number; iMax: number; qd: [number, number] };
  p: Params;
}) {
  const pb = usePlayback(12);
  const t = pb.progress * p.T;
  const k = Math.min(dense.t.length - 1, Math.round(pb.progress * (dense.t.length - 1)));
  const q = dense.q[k],
    i = dense.i[k];
  const emf = p.E > 0 ? Math.cos(p.w * t) : 0;
  const series = useMemo(
    () => [
      { x: dense.t, y: dense.q, color: "#ffe66d", label: "q(t), мкКл", width: 2 },
      { x: dense.t, y: dense.i, color: "#7cf29c", label: "i(t), мА", width: 1.6, noRange: true },
    ],
    [dense],
  );
  return (
    <Grid>
      <Card>
        <RLCScene q={q} i={i} qMax={dense.qMax} iMax={dense.iMax} emf={emf} R={p.R} />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${fmt(t, 3)} мс`} />
        </div>
      </Card>
      <Card>
        <Plot title="Синхронно з анімацією" xLabel="t, мс" height={260} cursorX={t} markers={[{ x: t, y: q, color: "#ffe66d" }]} series={series} />
        <Say
          simple={
            <p className="mt-3 text-[13px] leading-relaxed text-white/60">
              Зелені «електрони» зсуваються вздовж дроту рівно на стільки, скільки заряду пройшло. Обкладки конденсатора світяться червоним (+) і синім (−) —
              що більший заряд, то яскравіше. Навколо котушки — магнітне поле, тим сильніше, чим більший струм. Резистор розжарюється від струму, а стовпчик
              генератора показує його напругу в цей момент.
            </p>
          }
        >
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            Зелені «електрони» зсуваються вздовж кола рівно на <Tex>{"q(t)"}</Tex> — заряд, що пройшов через переріз дроту. Обкладки конденсатора світяться
            червоним (+) і синім (−) пропорційно <Tex>{"|q|"}</Tex>, котушка оточена магнітним полем <Tex>{"\\propto |i|"}</Tex>, резистор розжарюється як{" "}
            <Tex>{"i^2R"}</Tex>, а стовпчик генератора показує <Tex>{"\\varepsilon(t)"}</Tex>.
          </p>
        </Say>
      </Card>
    </Grid>
  );
}
