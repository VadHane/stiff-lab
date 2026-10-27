"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Plot, { type Transform } from "@/components/plot/Plot";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import NeuronScene, { ZONES, type Zone } from "@/components/scenes/NeuronScene";
import { drawBands, drawCurve, drawField } from "@/components/scenes/PhaseField";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { eigenvalues, type Complex } from "@/lib/linalg";
import { METHODS } from "@/lib/methods";
import { comp, denseOutput, isAdaptive, sampleAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import { traceStep } from "@/lib/step-trace";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import NeuronPokeScene from "@/components/analogy/NeuronPokeScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { useTaskExport } from "@/components/share/TaskActions";
import { exportT20 } from "@/components/share/TaskExports";
import { methodsIn, useUrlNum } from "@/components/share/TaskUrl";
import { useUrlState } from "@/lib/url-state";

const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "trap", "bdf2", "dopri", "ros", "thetaA"];
const EPS = 0.08,
  AA = 0.7,
  BB = 0.8;

// stable references for the debugger: I = 0.5 (periodic spikes), start from the condition
const F_DBG = (_t: number, y: number[]) => [y[0] - (y[0] * y[0] * y[0]) / 3 - y[1] + 0.5, EPS * (y[0] + AA - BB * y[1])];
const Y0_DBG = [0.55, 0.25];
const T_DBG = 60;
const DBG_VIEW = { x: 0, y: 1, xLabel: "V", yLabel: "W", xDomain: [-3, 2.6] as [number, number], yDomain: [-0.8, 2] as [number, number] };
const PG_LABELS: [string, string] = ["V", "W"];
const spikeEvent = (prev: number[], cur: number[]) => (prev[0] < 1 && cur[0] >= 1 ? "⚡ спайк!" : null);
const HOPF = [-1, 1].map((s) => {
  const V = s * Math.sqrt(1 - EPS * BB);
  return (V + AA) / BB - V + (V * V * V) / 3;
}) as [number, number];

const PRESETS = [
  { value: 0, label: "I = 0 (умова)" },
  { value: -3, label: "I = −3 (умова)" },
  { value: 0.5, label: "I = 0.5 — спайки" },
  { value: 2, label: "I = 2 — блок" },
];

function fhn(I: number, T: number, y0: number[]): Problem {
  return {
    f: (_t, y) => [y[0] - (y[0] * y[0] * y[0]) / 3 - y[1] + I, EPS * (y[0] + AA - BB * y[1])],
    jac: (_t, y) => [
      [1 - y[0] * y[0], -1],
      [EPS, -EPS * BB],
    ],
    y0,
    T,
  };
}

function equilibrium(I: number) {
  const p = 0.75,
    q = 2.625 - 3 * I;
  const s = Math.sqrt((q * q) / 4 + (p * p * p) / 27);
  const V = Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s);
  const W = (V + AA) / BB;
  const ev = eigenvalues([
    [1 - V * V, -1],
    [EPS, -EPS * BB],
  ]);
  const re = ev[0].re;
  const cx = Math.abs(ev[0].im) > 1e-12;
  const kind = re < 0 ? (cx ? "стійкий фокус" : "стійкий вузол") : cx ? "нестійкий фокус" : "нестійкий вузол";
  return { V, W, ev, stable: re < 0, kind };
}

function spikesOf(t: number[], v: number[]) {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) if (v[i - 1] < 1 && v[i] >= 1) out.push(t[i - 1] + ((1 - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  return out;
}

function zoneOf(V: number, W: number, Weq: number): Zone {
  if (V > -0.4) return "excited";
  if (W > Weq + 0.25) return "refractory";
  return "rest";
}

const effectiveH = (h: number, T: number) => Math.max(h, T / 40000);

function run(m: MethodId, p: Problem, h: number, tol: number): Solution {
  if (isAdaptive(m)) return solve(m, p, { rtol: tol, atol: tol, blowup: 1e6, maxSteps: 40000 });
  return solve(m, p, { h: effectiveH(h, p.T), blowup: 1e6 });
}

/** max |V − V_ref| at the method's own points; the reference is a dense (Hermite) interpolant */
function maxErrV(s: Solution, refAt: (t: number) => number[]) {
  let e = 0;
  for (let k = 0; k < s.t.length; k++) {
    const d = Math.abs(s.y[k][0] - refAt(s.t[k])[0]);
    if (!(d <= e)) e = d;
  }
  return e;
}

const evTex = (ev: Complex[]) =>
  Math.abs(ev[0].im) > 1e-12 ? `${fmt(ev[0].re, 4)} \\pm ${fmt(Math.abs(ev[0].im), 4)}\\,i` : `${fmt(ev[0].re, 4)},\\ ${fmt(ev[1].re, 4)}`;

export default function T20() {
  const [I, setI] = useUrlNum("I", 0.5, -3, 3);
  const [T, setT] = useUrlNum("T", 200, 20, 1000);
  const [V0, setV0] = useUrlNum("V0", 0.55, -2.5, 2.5);
  const [W0, setW0] = useUrlNum("W0", 0.25, -2, 2.5);
  const [h, setH] = useUrlNum("h", 0.1, 0.01, 2);
  const [tol, setTol] = useUrlNum("rtol", 1e-3, 1e-7, 0.1);
  const [methods, setMethods] = useUrlState<MethodId[]>("m", ["euler", "dopri", "ros", "thetaA"], methodsIn(ALL));
  const dI = useDeferredValue(I);
  const dT = useDeferredValue(T);
  const dV0 = useDeferredValue(V0);
  const dW0 = useDeferredValue(W0);
  const dh = useDeferredValue(h);
  const dtol = useDeferredValue(tol);
  useTaskExport(exportT20({ I, T, V0, W0, h: effectiveH(h, T), tol, methods }));

  const problem = useMemo(() => fhn(dI, dT, [dV0, dW0]), [dI, dT, dV0, dW0]);
  const eq = useMemo(() => equilibrium(dI), [dI]);
  const ref = useMemo(() => solve("dopri", problem, { rtol: 1e-9, atol: 1e-10, maxSteps: 400000 }), [problem]);
  const rV = useMemo(() => comp(ref, 0), [ref]);
  const rW = useMemo(() => comp(ref, 1), [ref]);
  const spikes = useMemo(() => spikesOf(ref.t, rV), [ref, rV]);
  const isi = spikes.length >= 3 ? (spikes[spikes.length - 1] - spikes[1]) / (spikes.length - 2) : NaN;
  const lamMax = useMemo(() => {
    let m = 0;
    for (let k = 0; k < ref.t.length; k++) for (const e of eigenvalues(problem.jac!(ref.t[k], ref.y[k]))) m = Math.max(m, Math.hypot(e.re, e.im));
    return m;
  }, [ref, problem]);
  const hEff = effectiveH(dh, dT);
  // reference between its nodes: cubic Hermite (O(h⁴)), not linear — otherwise errors below ~10⁻³ are invisible
  const refAt = useMemo(() => denseOutput(ref, problem.f), [ref, problem]);

  const sols = useMemo(
    () =>
      methods
        .slice()
        .sort((a, b) => ALL.indexOf(a) - ALL.indexOf(b))
        .map((m) => {
          const s = run(m, problem, dh, dtol);
          const err = maxErrV(s, refAt);
          const sp = spikesOf(s.t, comp(s, 0)).length;
          return { m, s, err, sp };
        }),
    [methods, problem, dh, dtol, refAt],
  );

  const bands = useMemo(() => {
    const out: { a: number; b: number; color: string }[] = [];
    let cur: Zone | null = null,
      a = 0;
    for (let i = 0; i < ref.t.length; i++) {
      const z = zoneOf(rV[i], rW[i], eq.W);
      if (z !== cur) {
        if (cur && cur !== "rest") out.push({ a, b: ref.t[i], color: `${ZONES[cur].color}1f` });
        cur = z;
        a = ref.t[i];
      }
    }
    if (cur && cur !== "rest") out.push({ a, b: ref.t[ref.t.length - 1], color: `${ZONES[cur].color}1f` });
    return out;
  }, [ref, rV, rW, eq.W]);

  const dom = useMemo(() => {
    let v0 = Math.min(-2.4, eq.V - 0.3),
      v1 = Math.max(2.4, eq.V + 0.3),
      w0 = eq.W - 0.4,
      w1 = eq.W + 0.4;
    for (let i = 0; i < rV.length; i++) {
      v0 = Math.min(v0, rV[i] - 0.2);
      v1 = Math.max(v1, rV[i] + 0.2);
      w0 = Math.min(w0, rW[i] - 0.3);
      w1 = Math.max(w1, rW[i] + 0.3);
    }
    return { v: [v0, v1] as [number, number], w: [w0, w1] as [number, number] };
  }, [rV, rW, eq]);

  const underlay = useCallback(
    (ctx: CanvasRenderingContext2D, tr: Transform) => {
      drawField(ctx, tr, (v, w) => [v - (v * v * v) / 3 - w + dI, EPS * (v + AA - BB * w)]);
      drawCurve(ctx, tr, (v) => v - (v * v * v) / 3 + dI, "#ff7ad9", { label: "V′ = 0" });
      drawCurve(ctx, tr, (v) => (v + AA) / BB, "#5cc8ff", { label: "W′ = 0" });
    },
    [dI],
  );
  const bandUnderlay = useCallback((ctx: CanvasRenderingContext2D, tr: Transform) => drawBands(ctx, tr, bands), [bands]);

  const fI = useMemo(() => {
    const Is: number[] = [],
      fr: number[] = [],
      amp: number[] = [];
    for (let k = 0; k <= 120; k++) {
      const i = -3 + k * 0.05;
      const s = solve("dopri", fhn(i, 500, [0.55, 0.25]), { rtol: 1e-6, atol: 1e-8 });
      const v = comp(s, 0);
      const sp = spikesOf(s.t, v).filter((x) => x > 200);
      Is.push(i);
      fr.push(sp.length >= 2 ? (1000 * (sp.length - 1)) / (sp[sp.length - 1] - sp[0]) : 0);
      let lo = Infinity,
        hi = -Infinity;
      for (let j = 0; j < v.length; j++)
        if (s.t[j] > 300) {
          lo = Math.min(lo, v[j]);
          hi = Math.max(hi, v[j]);
        }
      amp.push(hi - lo);
    }
    return { Is, fr, amp };
  }, []);
  const fCur = sampleAt(fI.Is, fI.fr, dI);

  const threshold = useMemo(() => {
    const d: number[] = [],
      vmax: number[] = [];
    for (let k = 0; k <= 60; k++) {
      const dd = (k / 60) * 3;
      const s = solve("dopri", fhn(dI, 80, [eq.V + dd, eq.W]), { rtol: 1e-6, atol: 1e-8 });
      let m = -Infinity;
      for (const y of s.y) m = Math.max(m, y[0]);
      d.push(dd);
      vmax.push(m);
    }
    // поріг — перший поштовх, після якого V піднімається істотно вище стартової точки V* + ΔV (регенеративна відповідь)
    let thr = NaN;
    if (eq.stable)
      for (let k = 1; k < d.length; k++)
        if (vmax[k] - (eq.V + d[k]) > 0.5) {
          thr = (d[k] + d[k - 1]) / 2;
          break;
        }
    return { d, vmax, thr };
  }, [dI, eq]);

  const table = useMemo(
    () =>
      [0, -3, 0.5].map((i) => {
        const p = fhn(i, 200, [0.55, 0.25]);
        const rfAt = denseOutput(solve("dopri", p, { rtol: 1e-9, atol: 1e-10 }), p.f);
        return (["dopri", "ros", "thetaA", "euler", "rk2", "rk3", "rk4", "ieuler", "bdf2"] as MethodId[]).map((m) => {
          const s = run(m, p, 0.1, 1e-3);
          return { m, s, e: maxErrV(s, rfAt) };
        });
      }),
    [],
  );

  // step debugger: implicit Euler with h = 1.5 from the start (I = 0.5) — where plain Newton from yₙ gives up
  const dbgIE = useMemo(() => {
    let t = 0,
      y = Y0_DBG,
      n = 0,
      contStep = 0,
      contT = NaN,
      contV = NaN,
      stopT = NaN;
    while (t < T_DBG - 1e-12) {
      const tr = traceStep("ieuler", F_DBG, t, y, Math.min(1.5, T_DBG - t));
      if (!tr.y1) {
        stopT = t;
        break;
      }
      n++;
      if (tr.newton?.continuation && !contStep) {
        contStep = n;
        contT = t;
        contV = tr.y1[0];
      }
      t = tr.t1;
      y = tr.y1;
    }
    return { n, contStep, contT, contV, stopT };
  }, []);

  // columns: I = 0, −3, 0.5
  const tableStats = useMemo(() => {
    const ok = (col: { s: Solution; e: number }[]) => col.filter((c) => !c.s.failed).map((c) => c.e);
    return {
      rk4Max: Math.max(...table.map((col) => col.find((c) => c.m === "rk4")!).filter((c) => !c.s.failed).map((c) => c.e)),
      spikeMax: Math.max(...ok(table[2])),
    };
  }, [table]);

  const [pgI, setPgI] = useState(0);
  const pgEq = useMemo(() => equilibrium(pgI), [pgI]);
  const pgF = useMemo(() => fhn(pgI, 1, [0, 0]).f, [pgI]);
  const pgInit = useMemo(() => [pgEq.V, pgEq.W], [pgEq]);
  const pgDomain = useMemo(
    () => ({ x: [-2.6, 2.6] as [number, number], y: [Math.min(-1, pgEq.W - 0.6), Math.max(2, pgEq.W + 0.6)] as [number, number] }),
    [pgEq],
  );
  const pgUnderlay = useCallback(
    (ctx: CanvasRenderingContext2D, { X, Y }: { X: (x: number) => number; Y: (y: number) => number }) => {
      const curve = (g: (v: number) => number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        for (let k = 0; k <= 160; k++) {
          const v = -2.6 + (5.2 * k) / 160;
          if (k) ctx.lineTo(X(v), Y(g(v)));
          else ctx.moveTo(X(v), Y(g(v)));
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };
      curve((v) => v - (v * v * v) / 3 + pgI, "rgba(255,122,217,0.8)");
      curve((v) => (v + AA) / BB, "rgba(92,200,255,0.8)");
      ctx.strokeStyle = "rgba(255,230,109,0.35)";
      ctx.beginPath();
      ctx.moveTo(X(1), Y(-10));
      ctx.lineTo(X(1), Y(10));
      ctx.stroke();
      ctx.fillStyle = pgEq.stable ? "#3ee6a8" : "#ff5d73";
      ctx.beginPath();
      ctx.arc(X(pgEq.V), Y(pgEq.W), 5, 0, Math.PI * 2);
      ctx.fill();
    },
    [pgI, pgEq],
  );
  const eq0 = useMemo(() => equilibrium(0), []);

  const blown = sols.filter((x) => x.s.failed);
  const refSp = spikes.length;
  const wrongSp = sols.filter((x) => !x.s.failed && x.sp !== refSp);
  const adaptive = sols.filter((x) => isAdaptive(x.m) && !x.s.failed);
  const fixed = sols.filter((x) => !isAdaptive(x.m) && !x.s.failed);
  const spiking = dI > HOPF[0] && dI < HOPF[1];

  return (
    <>
      <AnalogyCard
        emoji="🔘"
        title="Вимикач із пружиною"
        story={
          <>
            Натисніть на вимикач легенько — пружина поверне його назад, нічого не станеться. Натисніть трохи сильніше за поріг — і він <b>клацне до кінця сам</b>,
            байдуже, наскільки сильно ви тиснули. Нейрон працює так само: малий поштовх напруги згасає, а поштовх понад поріг запускає повний спайк — «все або
            нічого». Після клацання вимикач якийсь час не реагує, поки пружина взводиться, — це рефрактерність. А якщо тиснути постійно (струм I), він клацатиме
            ритмічно.
          </>
        }
        mapping={[
          ["сила натискання", <>поштовх ΔV мембранного потенціалу</>],
          ["клацання до кінця", <>спайк: V злітає до ≈ 1.7–1.9</>],
          ["пружина, що повертає", <>повільна змінна W (відновлення)</>],
          ["постійне натискання", <>струм I: при 0.33 &lt; I &lt; 1.42 — ритмічні спайки</>],
          ["швидкий клац + повільне взведення", <>дві шкали часу: ~1 і ~1/0.08 = 12.5</>],
        ]}
      >
        <NeuronPokeScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Нейрон у двох рівняннях" simpleTitle="Як нейрон вирішує: стріляти чи ні">
        <Grid>
          <Card title="Модель ФіцХью–Нагумо" icon="📜">
            <Tex block>{String.raw`\begin{cases} \dfrac{dV}{dt} = V - \dfrac{V^3}{3} - W + I,\\[2mm] \dfrac{dW}{dt} = 0.08\,(V + 0.7 - 0.8\,W), \end{cases}\qquad V(0) = 0.55,\ W(0) = 0.25.`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  V — напруга на оболонці нервової клітини: вона змінюється <b>швидко</b>. W — «пружина», що повертає клітину до спокою: вона змінюється
                  приблизно в 12 разів <b>повільніше</b> (множник 0.08). I — струм, яким ми постійно «тиснемо» на нейрон. За умовою треба порахувати V(t) і
                  W(t) для I = 0 та I = −3 з точністю 0.001. Це спрощена версія нобелівської моделі нейрона Ходжкіна–Хакслі (1952): з чотирьох рівнянь
                  залишили два, але поріг і спайки збереглися.
                </p>
              }
            >
              <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                <Tex>{"V"}</Tex> — мембранний потенціал (швидка змінна), <Tex>{"W"}</Tex> — «відновлення» (повільна змінна: інактивація натрієвих і активація
                калієвих каналів), <Tex>{"I"}</Tex> — зовнішній струм. Умова: <Tex>{"I = 0"}</Tex> та <Tex>{"I = -3"}</Tex>, точність <Tex>{"10^{-3}"}</Tex>. Це
                «спрощений Ходжкін–Хакслі»: чотири рівняння Нобелівської моделі 1952 р. стиснуті до двох із збереженням головного — порогу та спайків.
              </p>
            </Say>
          </Card>
          <Card title="Рівновага та її стійкість" icon="⚖️">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  У нейрона завжди рівно один стан спокою — там, де перетинаються кубічна крива «V не змінюється» і пряма «W не змінюється». Чи він справжній
                  спокій, вирішує струм I:
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Нульклини: <Tex>{"W = V - V^3/3 + I"}</Tex> (кубічна) і <Tex>{"W = (V + 0.7)/0.8"}</Tex> (пряма). Нахил прямої 1.25 більший за максимальний нахил кубіки (1),
                тож рівновага одна:
              </p>
            </Say>
            <Tex block>{String.raw`V_*^3 + 0.75\,V_* + 2.625 - 3I = 0,\qquad J_* = \begin{pmatrix}1 - V_*^2 & -1\\ 0.08 & -0.064\end{pmatrix}.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Якщо I між {HOPF[0].toFixed(2)} і {HOPF[1].toFixed(2)}, стан спокою стає «хитким» — нейрон не може в ньому всидіти й стріляє спайками
                  ритмічно. Поза цим проміжком він спокійний (і чекає поштовху).
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                <Tex>{"\\operatorname{tr}J_* = 0.936 - V_*^2"}</Tex>, <Tex>{"\\det J_* > 0"}</Tex> завжди. Втрата стійкості (Хопф) при <Tex>{"V_* = \\pm\\sqrt{0.936}"}</Tex>, тобто для
              </p>
            </Say>
            <Tex block>{`I \\in (${HOPF[0].toFixed(4)},\\ ${HOPF[1].toFixed(4)}) \\ \\Rightarrow\\ \\text{періодичні спайки}.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Швидке й повільне тут відрізняються лише в ~12.5 раза — задача <b>помірно</b> жорстка: явні методи працюють, але крок їм доводиться
                  тримати малим. <Relatable kind="ratio" n={12.5} />
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Відношення швидкостей <Tex>{"1/0.08 = 12.5"}</Tex> — задача <b>помірно</b> жорстка: явні методи працюють, але з обмеженням на крок.
              </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Подразнюємо нейрон">
        <Lab
          controls={
            <>
              <Chips label="Пресети струму" value={PRESETS.some((p) => p.value === I) ? I : NaN} onChange={setI} options={PRESETS} />
              <Slider
                label="Струм I"
                value={I}
                onChange={setI}
                min={-3}
                max={3}
                step={0.01}
                hint={`спайки при ${HOPF[0].toFixed(3)} < I < ${HOPF[1].toFixed(3)}`}
              />
              <Slider label="Кінець відрізка T" value={T} onChange={setT} min={20} max={1000} step={10} />
              <div className="grid grid-cols-2 gap-3">
                <Slider label="V(0)" value={V0} onChange={setV0} min={-2.5} max={2.5} step={0.05} />
                <Slider label="W(0)" value={W0} onChange={setW0} min={-2} max={2.5} step={0.05} />
              </div>
              <Slider label="Крок h (фіксовані)" value={h} onChange={setH} min={0.01} max={2} log hint={hEff > dh * 1.001 ? `фактично h = ${fmt(hEff, 3)} (≤ 40 000 кроків)` : undefined} />
              <Slider label="Точність rtol = atol" value={tol} onChange={setTol} min={1e-7} max={1e-1} log format={(v) => v.toExponential(0)} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] leading-relaxed text-white/65">
                Рівновага <Tex>{`(${fmt(eq.V, 4)},\\ ${fmt(eq.W, 4)})`}</Tex> — <b className="text-white/85">{eq.kind}</b>
                <br />
                <Tex>{`\\lambda = ${evTex(eq.ev)}`}</Tex>
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title="Мембранний потенціал V(t)"
              xLabel="t"
              height={280}
              yDomain={[Math.min(-2.6, eq.V - 0.3), Math.max(2.6, eq.V + 0.3)]}
              underlay={bandUnderlay}
              series={[
                { x: ref.t, y: rV, color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
                ...sols.map(({ m, s }) => ({
                  x: s.t,
                  y: comp(s, 0),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: s.failed ? 1 : 1.6,
                  opacity: s.failed ? 0.45 : 1,
                })),
              ]}
            />
            <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-white/55">
              {(["excited", "refractory"] as Zone[]).map((z) => (
                <span key={z} className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded" style={{ background: `${ZONES[z].color}55` }} />
                  {ZONES[z].label}
                </span>
              ))}
              <span>· решта — спокій</span>
            </div>
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Фазова площина (V, W)"
                xLabel="V"
                yLabel="W"
                height={340}
                sorted={false}
                xDomain={dom.v}
                yDomain={dom.w}
                underlay={underlay}
                markers={[
                  { x: eq.V, y: eq.W, color: eq.stable ? "#3ee6a8" : "#ff5d73", r: 6 },
                  { x: dV0, y: dW0, color: "#ffffff", r: 4 },
                ]}
                series={[
                  { x: rV, y: rW, color: "#ffffff", label: "еталон", width: 3, opacity: 0.6, fade: true },
                  ...sols
                    .filter(({ s }) => !s.failed)
                    .map(({ m, s }) => ({ x: comp(s, 0), y: comp(s, 1), color: METHODS[m].color, width: 1.3, opacity: 0.85 })),
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="Відновлення W(t)"
                xLabel="t"
                height={340}
                series={[
                  { x: ref.t, y: rW, color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
                  ...sols
                    .filter(({ s }) => !s.failed)
                    .map(({ m, s }) => ({ x: s.t, y: comp(s, 1), color: METHODS[m].color, label: METHODS[m].short, width: 1.5 })),
                ]}
              />
            </Card>
          </Grid>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, err, sp }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : `${s.steps} кр.`}
                sub={
                  s.failed
                    ? s.failed
                    : `${s.rejected ? `${s.rejected} відх. · ` : ""}${s.fevals} викл. f · max|ΔV| ${fmt(err, 2)} · ${sp} спайк. · ${fmtMs(s.ms)}`
                }
                tone={s.failed ? "bad" : sp !== refSp ? "warn" : err < 0.1 ? "good" : "default"}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="спайків (еталон)" value={refSp} sub={`на [0, ${fmt(dT, 4)}]`} tone={refSp > 1 ? "warn" : "default"} />
            <Stat label="міжспайковий інтервал" value={Number.isFinite(isi) ? fmt(isi, 4) : "—"} sub={Number.isFinite(isi) ? `частота ${fmt(1000 / isi, 3)} на 1000 од. часу` : "тонічних спайків нема"} />
            <Stat label="режим" value={spiking ? "генерація" : eq.V > 1 ? "блок" : "збудливий"} sub={eq.kind} tone={spiking ? "warn" : "good"} />
            <Stat
              label="поріг збудження ΔV"
              value={Number.isFinite(threshold.thr) ? fmt(threshold.thr, 3) : "—"}
              sub={!eq.stable ? "рівновага нестійка — порогу нема" : Number.isFinite(threshold.thr) ? "стрибок V від рівноваги, що запускає спайк" : "жоден поштовх ΔV ≤ 3 спайку не дає"}
            />
          </div>
          {blown.length > 0 && (
            <Insight
              tone="bad"
              title={`${blown.map((x) => METHODS[x.m].short).join(", ")}: вибух`}
              simple={
                <>
                  На бічних гілках (V ≈ ±2) напруга повертається до гілки дуже швидко — найшвидший темп уздовж траєкторії ≈ {fmt(lamMax, 3)} за одиницю
                  часу. Явний Ейлер витримує крок лише до ≈ {fmt(2 / lamMax, 3)}, а тут h = {fmt(hEff, 3)}: метод перестрибує гілку туди-сюди, і стрибки
                  ростуть, доки все не розлетиться.
                </>
              }
            >
              На гілках кубіки <Tex>{"|V| \\approx 2"}</Tex>, тож <Tex>{"\\partial \\dot V/\\partial V = 1 - V^2 \\approx -3"}</Tex>; уздовж еталонної траєкторії{" "}
              <Tex>{`|\\lambda|_{\\max} \\approx ${fmt(lamMax, 3)}`}</Tex>, і лінійна межа стійкості явного Ейлера і RK2 — <Tex>{`h < 2/|\\lambda|_{\\max} \\approx ${fmt(2 / lamMax, 3)}`}</Tex>, RK3 —{" "}
              <Tex>{`h \\lesssim ${fmt(2.513 / lamMax, 3)}`}</Tex>, RK4 — <Tex>{`h \\lesssim ${fmt(2.785 / lamMax, 3)}`}</Tex> (кубічна нелінійність ще трохи відтягує вибух). При <Tex>{`h = ${fmt(hEff, 3)}`}</Tex> швидка змінна
              починає «стрибати» між гілками й розлітається.
            </Insight>
          )}
          {wrongSp.length > 0 && (
            <Insight
              tone="warn"
              title="Неправильна кількість спайків"
              simple={
                <>
                  {wrongSp.map((x) => `${METHODS[x.m].short} (${x.sp})`).join(", ")} проти {refSp} у точному розрахунку. Для нейрона це найгірший промах:
                  інформація — це саме кількість і моменти спайків. Грубий крок потроху зсуває ритм, і за довгий час один спайк «губиться» або з&apos;являється
                  зайвий.
                </>
              }
            >
              {wrongSp.map((x) => `${METHODS[x.m].short} (${x.sp})`).join(", ")} проти {refSp} в еталоні. Для нейрона це найгірша похибка: кількість і моменти
              спайків — це і є «інформація», яку він передає. Грубий крок зсуває фазу, і за довгий час спайк «зникає» або з&apos;являється зайвий.
            </Insight>
          )}
          {adaptive.length > 0 && fixed.length > 0 && (
            <Insight
              tone="info"
              title="Адаптивні vs фіксовані"
              simpleTitle="Розумний крок проти рівного"
              simple={
                <>
                  Кількість кроків: {adaptive.map((x) => `${METHODS[x.m].short} — ${x.s.steps}`).join(", ")} проти{" "}
                  {fixed.map((x) => `${METHODS[x.m].short} — ${x.s.steps}`).join(", ")}. Методи зі змінним кроком дріботять лише тоді, коли нейрон «стріляє», а
                  поки він повільно відновлюється — крокують широко.
                </>
              }
            >
              {adaptive.map((x) => `${METHODS[x.m].short}: ${x.s.steps}`).join(", ")} кроків проти {fixed.map((x) => `${METHODS[x.m].short}: ${x.s.steps}`).join(", ")}.
              Адаптивні методи дріблять крок лише на фронтах спайку (див. графік кроку в розділі «Порівняння») і широко крокують по повільних гілках.
            </Insight>
          )}
          {dI < -1 ? (
            <Insight
              tone="note"
              title="Гіперполяризація"
              simpleTitle="Нейрон «придушений»"
              simple={
                <>
                  Від&apos;ємний струм I = {fmt(dI, 3)} тисне вимикач у протилежний бік: стан спокою V = {fmt(eq.V, 4)} лежить далеко від порогу, і нейрон
                  просто мовчки сповзає туди.{" "}
                  {Number.isFinite(threshold.thr)
                    ? `Щоб він вистрілив, тепер потрібен поштовх ΔV ≈ ${fmt(threshold.thr, 3)}.`
                    : 2 / 3 < eq.W - dI
                      ? "Жоден поштовх ΔV ≤ 3 не викличе спайку: у цьому стані напруга після поштовху лише спадає назад."
                      : "Чіткого порогу «все або нічого» вже нема: поштовх ΔV ≤ 3 дає лише слабку відповідь."}
                </>
              }
            >
              Від&apos;ємний струм <Tex>{`I = ${fmt(dI, 3)}`}</Tex> «притискає» мембрану: рівновага <Tex>{`V_* = ${fmt(eq.V, 4)}`}</Tex> далеко під порогом, і траєкторія
              монотонно сповзає до неї — нейрон «мовчить».{" "}
              {Number.isFinite(threshold.thr) ? (
                <>
                  Для спайку тепер потрібен поштовх <Tex>{`\\Delta V \\approx ${fmt(threshold.thr, 3)}`}</Tex>.
                </>
              ) : 2 / 3 < eq.W - dI ? (
                <>
                  Спайк уже не викликати жодним поштовхом <Tex>{"\\Delta V \\le 3"}</Tex>: на рівні <Tex>{"W = W_*"}</Tex> кубічна нульклина не має середньої та правої гілок
                  (<Tex>{`\\max_V (V - V^3/3) = 2/3 < W_* - I = ${fmt(eq.W - dI, 3)}`}</Tex>), тож <Tex>{"\\dot V < 0"}</Tex> усюди праворуч від рівноваги.
                </>
              ) : (
                <>
                  Чіткого порогу «все або нічого» тут уже нема: поштовх <Tex>{"\\Delta V \\le 3"}</Tex> дає лише слабку, не регенеративну відповідь.
                </>
              )}
            </Insight>
          ) : null}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Нейрон у прямому ефірі">
        <NeuronBlock ref_={ref} rV={rV} rW={rW} T={dT} spikes={spikes} Weq={eq.W} />
      </Section>

      <Section kicker="Збудливість" title="Закон «все або нічого» і частотна характеристика" simpleTitle="Все або нічого — і як часто нейрон стріляє">
        <Grid>
          <Card>
            <Plot
              title="Пікове V після поштовху ΔV від рівноваги"
              xLabel="ΔV"
              yLabel="max V"
              height={280}
              series={[{ x: threshold.d, y: threshold.vmax, color: "#ff7ad9", label: `I = ${fmt(dI, 3)}`, width: 2.5 }]}
              markers={Number.isFinite(threshold.thr) ? [{ x: threshold.thr, y: sampleAt(threshold.d, threshold.vmax, threshold.thr), color: "#ffffff" }] : []}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                  По горизонталі — сила поштовху, по вертикалі — найвища напруга, якої досягне нейрон. Малий поштовх — пружина повертає вимикач (лінія повзе
                  повільно). Трохи більший — і крива різко злітає: клац, повний спайк. Проміжних «пів-спайків» майже немає — це і є поріг.{" "}
                  {spiking && "Зараз нейрон і так стріляє сам — поріг втрачає сенс."}
                </p>
              }
            >
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                Малий поштовх — мембрана слухняно повертається (лінійна ділянка). Трохи більший — і траєкторія перескакує середню гілку кубіки та робить
                повний спайк. Проміжних «пів-спайків» майже нема: це поріг збудження. {spiking && "Зараз рівновага нестійка — нейрон і так генерує, поріг втрачає сенс."}
              </p>
            </Say>
          </Card>
          <Card>
            <Plot
              title="Частота спайків f(I) (на 1000 од. часу)"
              xLabel="I"
              height={280}
              cursorX={dI}
              markers={[{ x: dI, y: fCur, color: "#c38bff" }]}
              series={[{ x: fI.Is, y: fI.fr, color: "#c38bff", label: "f(I)", width: 2.5 }]}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                  Скільки спайків нейрон видає за 1000 одиниць часу при сталому струмі I. Ритм вмикається одразу з помітною частотою при I ≈{" "}
                  {HOPF[0].toFixed(2)} і зникає при I ≈ {HOPF[1].toFixed(2)}: занадто сильний струм «заклинює» вимикач у натиснутому стані (це називають
                  деполяризаційним блоком).
                </p>
              }
            >
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                Генерація вмикається стрибком при <Tex>{`I \\approx ${HOPF[0].toFixed(3)}`}</Tex> і гасне при <Tex>{`I \\approx ${HOPF[1].toFixed(3)}`}</Tex> (рівновага переходить на праву
                гілку — «деполяризаційний блок»). Стрибкоподібний старт з ненульовою частотою — ознака нейрона ІІ класу за Ходжкіним.
              </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Порівняння" title="Скільки кроків коштує точність 10⁻³" simpleTitle="Скільки кроків треба, щоб не загубити спайк">
        <Grid>
          <Card>
            <Plot
              title="Крок h(t) адаптивних методів (поточні параметри)"
              xLabel="t"
              height={260}
              logY
              series={sols
                .filter(({ m, s }) => isAdaptive(m) && s.hs.length)
                .map(({ m, s }) => ({ x: s.t.slice(1), y: s.hs, color: METHODS[m].color, label: METHODS[m].short, width: 1.5 }))}
            />
          </Card>
          <Card>
            <Table
              head={["Метод", "I = 0", "I = −3", "I = 0.5"]}
              rows={table[0].map((row, j) => [
                <span key={row.m} style={{ color: METHODS[row.m].color }}>
                  {METHODS[row.m].short}
                  {isAdaptive(row.m) ? "" : " h=0.1"}
                </span>,
                ...table.map((col) => {
                  const { s, e } = col[j];
                  if (s.failed) return <span className="text-[#ff5d73]">💥</span>;
                  return (
                    <span>
                      {s.steps}
                      <span className="text-white/40">{s.rejected ? `+${s.rejected}` : ""}</span>{" "}
                      <span className={e > 0.5 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>· {fmt(e, 2)}</span>
                    </span>
                  );
                }),
              ])}
            />
            <Say
              simple={
                <p className="mt-3 text-[12.5px] text-white/55">
                  У клітинці: скільки кроків зробив метод (+ скільки спроб відкинув) і найбільший промах по V на [0, 200]. Методи зі змінним кроком — з
                  точністю 0.001, як в умові, решта — з кроком 0.1 (2000 кроків). Найточніший — RK4: його промах не більший за {fmt(tableStats.rk4Max, 2)}.
                  Промах до ≈ {fmt(tableStats.spikeMax, 1)} у режимі спайків (I = 0.5) означає, що спайк стався трохи раніше чи пізніше, а не що його форма
                  неправильна. Зверніть увагу на I = −3: там Розенброк обганяє DOPRI в кілька разів.
                </p>
              }
            >
              <p className="mt-3 text-[12.5px] text-white/55">
                Кроки (+відхилені) · max |V − V_ет| на [0, 200]; еталон — DOPRI (rtol = 10⁻⁹) з кубічною ермітовою інтерполяцією між вузлами. Адаптивні — rtol
                = atol = 10⁻³ (як в умові), фіксовані — h = 0.1. RK4 з h = 0.1 тримає похибку ≤ {fmt(tableStats.rk4Max, 2)} в усіх трьох режимах. У
                спайковому режимі (I = 0.5) похибка до ≈ {fmt(tableStats.spikeMax, 1)} означає зсув фази спайку, що накопичується від спайку до спайку, а не
                «поганий» профіль.
              </p>
            </Say>
          </Card>
        </Grid>
        <Card className="mt-4">
          <StiffnessPanel problem={problem} sol={ref} />
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={F_DBG}
          y0={Y0_DBG}
          T={T_DBG}
          view={DBG_VIEW}
          h0={1}
          hMin={0.01}
          hMax={2}
          hPresets={[0.1, 0.5, 1, 1.5]}
          hPresetsLabel="Кроки для порівняння"
          hint={
            <Say
              simple={
                <>
                  Нейрон зі струмом I = 0.5 (стріляє ритмічно), старт з умови. Явний Ейлер з кроком 1: натисніть «⏩ ×10» — і побачите, як точка не повзе
                  вздовж гілки кубіки, а скаче через неї зигзагом, а на швидкому перельоті між гілками взагалі «перелітає» мимо. З кроком 1.5 зигзаг
                  розгойдується до вибуху. Неявний Ейлер з тим самим кроком 1 акуратно лягає на гілку. А от з кроком 1.5 і він спіткнеться — на
                  «коліні» кривої, де нейрон зривається у спайк,{" "}
                  {Number.isFinite(dbgIE.stopT)
                    ? `рівняння кроку перестає мати розв'язок поруч, і метод зупиняється після ${dbgIE.n} кроків.`
                    : dbgIE.contStep
                      ? `розв'язку рівняння кроку поруч уже нема, і на кроці ${dbgIE.contStep} Ньютону доводиться «підкрадатися» до далекої відповіді поступово (позначка під графіком). Зате далі метод спокійно проходить усі ${dbgIE.n} кроків до t = ${T_DBG}.`
                      : `але Ньютон усе ж знаходить наступну точку, і метод проходить усі ${dbgIE.n} кроків до t = ${T_DBG}.`}
                </>
              }
            >
              Фазова площина (V, W) при I = 0.5. На бічних гілках ∂V̇/∂V = 1 − V² ≈ −3, тож для явного Ейлера |1 + hλ| &gt; 1 уже при h ≳ 0.7: при h = 1
              траєкторія осцилює навколо гілки (і дає 7 спайків замість 6 на [0, 200]), при h = 1.5 — розходиться. Неявні методи на гілці стійкі за будь-якого
              h; ітерації Ньютона видно на стрибках між гілками. Але біля складок кубіки (V = ±1) при великому h неявне рівняння кроку може не мати
              близького кореня:{" "}
              {Number.isFinite(dbgIE.stopT)
                ? `неявний Ейлер з h = 1.5 зупиняється після ${dbgIE.n} кроків (t = ${fmt(dbgIE.stopT, 4)}), щойно траєкторія сходить з лівого «коліна».`
                : dbgIE.contStep
                  ? `у неявного Ейлера з h = 1.5 на кроці ${dbgIE.contStep} (з t = ${fmt(dbgIE.contT, 4)}), щойно траєкторія сходить з лівого «коліна», Ньютон із наближенням yₙ не збігається — корінь лежить далеко (V ≈ ${fmt(dbgIE.contV, 3)}) і знаходиться лише продовженням за параметром hb (позначка під графіком); далі метод проходить усі ${dbgIE.n} кроків до t = ${T_DBG}.`
                  : `неявний Ейлер з h = 1.5 обходиться звичайним Ньютоном і проходить усі ${dbgIE.n} кроків до t = ${T_DBG}.`}
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Тицьніть у нейрон — і почекайте на ⚡" report={false}>
        <div className="mb-3">
          <Chips
            label="Струм I у пісочниці"
            value={pgI}
            onChange={setPgI}
            options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>
        <PhasePlayground
          key={pgI}
          f={pgF}
          init={pgInit}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={pgDomain}
          speed={8}
          speedRange={[1, 40]}
          trail={40}
          strip={[
            { comp: 0, label: "V", color: "#ff7ad9" },
            { comp: 1, label: "W", color: "#5cc8ff" },
          ]}
          window={120}
          event={spikeEvent}
          kicks={[
            { label: "Укол", emoji: "📌", apply: (y) => [y[0] + 0.5, y[1]], hint: "V += 0.5" },
            { label: "Сильний укол", emoji: "⚡", apply: (y) => [y[0] + 1.5, y[1]], hint: "V += 1.5" },
            { label: "Заспокоїти", emoji: "🧘", apply: () => [pgEq.V, pgEq.W], hint: "у рівновагу" },
          ]}
          underlay={pgUnderlay}
          hint={
            <Say
              simple={
                <>
                  Нейрон стартує в стані спокою (крапка на перетині кривих). При I = 0 «Укол» (+0.5) — замало: точка повертається, тиша. «Сильний укол» (+1.5)
                  — і точка робить велику петлю: спайк ⚡. Спробуйте вколоти одразу після спайку — у рефрактерний період нейрон не відповідає. При I = 0.5
                  спокій хиткий — нейрон сам починає стріляти. Жовта вертикаль — рівень V = 1, перетин якого ми рахуємо як спайк.
                </>
              }
            >
              Фазова площина (V, W) з нульклинами: рожева кубіка W = V − V³/3 + I, блакитна пряма W = (V + 0.7)/0.8; крапка — рівновага (зелена — стійка,
              червона — нестійка). Старт у рівновазі; кіки миттєво зсувають V. Поріг при I = 0 ≈ 0.56–0.58: +0.5 дає підпорогову відповідь, +1.5 — спайк.
              Тост «⚡» — перетин V = 1 знизу вгору.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="20"
          questions={[
            {
              id: "all-or-nothing",
              q: <>I = 0, нейрон у спокої. Його штовхнули на ΔV = 0.5, а наступного разу — на ΔV = 0.6. Що побачимо?</>,
              options: [
                "Два спайки, другий трохи вищий",
                "0.5 — нічого, 0.6 — повний спайк до V ≈ 1.7",
                "Дві слабкі відповіді, пропорційні поштовху",
                "Нічого в обох випадках — потрібно ΔV > 1",
              ],
              correct: 1,
              explain: (
                <>
                  Поріг при I = 0 ≈ 0.56 (бісекцією; у лабораторії — 0.575 за сіткою з кроком 0.05). Після ΔV = 0.5 max V = −0.67 (траєкторія лише
                  відходить від рівноваги й повертається), після 0.6 — max V = 1.71: траєкторія перескакує середню гілку кубіки і робить повний оберт. Між 0.55 (max
                  V = −0.46) і 0.6 відповідь стрибає на ~2 одиниці.
                </>
              ),
              explainSimple: (
                <>
                  «Все або нічого»: 0.5 — пружина повертає вимикач, V піднімається лише до −0.67. 0.6 — клац, повний спайк до 1.71. Поріг — десь між 0.55 і
                  0.6. Спробуйте в сцені «Вимикач із пружиною» вгорі.
                </>
              ),
              show: {
                label: "Показати старт V* + 0.6",
                run: () => {
                  setI(0);
                  setT(200);
                  setV0(Number((eq0.V + 0.6).toFixed(4)));
                  setW0(Number(eq0.W.toFixed(4)));
                },
              },
            },
            {
              id: "euler-h1",
              q: <>I = 0.5 (ритмічні спайки), відрізок [0, 200]. Явний Ейлер з кроком h = 1 — удесятеро грубіше за h = 0.1. Що буде?</>,
              options: [
                "Вибухне вже на першому спайку",
                "Нічого не зміниться: ті самі 6 спайків",
                "Не вибухне, але нарахує 7 спайків замість 6",
                "Нейрон замовкне — жодного спайку",
              ],
              correct: 2,
              explain: (
                <>
                  Лінійна межа на бічних гілках h &lt; 2/|λ|ₘₐₓ ≈ 2/2.85 ≈ 0.70, тож при h = 1 явний Ейлер осцилює навколо гілки, але кубічна нелінійність
                  не дає йому розійтися (вибух починається з h ≈ 1.2). Зате фаза пливе: 7 перетинів V = 1 угору проти 6 в еталоні. При h = 0.9 — навпаки, 5.
                </>
              ),
              explainSimple: (
                <>
                  Ейлер не вибухає, але скаче через гілку зигзагом, і ритм збивається: за той самий час він «нараховує» 7 спайків замість 6. Для нейрона це
                  неправильна відповідь, хоча графік виглядає майже нормально.
                </>
              ),
              show: {
                label: "Показати Ейлера з h = 1",
                run: () => {
                  setI(0.5);
                  setT(200);
                  setV0(0.55);
                  setW0(0.25);
                  setH(1);
                  setMethods((ms) => (ms.includes("euler") ? ms : [...ms, "euler"]));
                },
              },
            },
            {
              id: "dopri-vs-ros",
              q: (
                <>
                  При I = 0.5 і точності 10⁻³ DOPRI робить 158 кроків, а Розенброк — 310. Що зміниться при I = −3 (нейрон «придушений», найбільша
                  жорсткість)?
                </>
              ),
              options: [
                "DOPRI знову буде вдвічі ощадливішим",
                "Розенброк — кілька десятків кроків, DOPRI — понад 200",
                "Обом вистачить кількох кроків — розв'язок же нудний",
                "DOPRI вибухне",
              ],
              correct: 1,
              explain: (
                <>
                  На лівій гілці λ ≈ −3.62 (рівновага V* ≈ −2.155): DOPRI обмежений областю стійкості (|hλ| ≲ 3.3 ⇒ h ≲ 0.9) і робить 237 кроків (+51
                  відхилених), а L-стійкий Розенброк — 34 (+2). При I = 0.5 жорсткості майже нема, і 5-й порядок DOPRI виграє.
                </>
              ),
              explainSimple: (
                <>
                  Розв&apos;язок нудний, але «нервовий»: напруга дуже швидко повертається до гілки. DOPRI боїться великих кроків (237 кроків і 51 невдала
                  спроба), а Розенброк спокійно крокує широко — 34 кроки.
                </>
              ),
              show: {
                label: "Показати I = −3",
                run: () => {
                  setI(-3);
                  setT(200);
                  setV0(0.55);
                  setW0(0.25);
                  setTol(1e-3);
                  setMethods((ms) => Array.from(new Set([...ms, "dopri", "ros"])) as MethodId[]);
                },
              },
            },
          ]}
        />
      </Section>

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="info"
            title="I = 0: збудливий спокій"
            simple={
              <>
                Старт з умови вже «за порогом», тож нейрон один раз клацає (спайк), відпочиває, поки пружина W взводиться, і завмирає в стані спокою
                V ≈ −1.2. Далі — тиша, доки його ще раз не штовхнуть.
              </>
            }
          >
            Старт <Tex>{"(0.55, 0.25)"}</Tex> лежить праворуч від середньої гілки кубіки — над порогом. Нейрон видає <b>один</b> спайк, проходить рефрактерну
            фазу (W високе) і спокійно сповзає у стійкий фокус <Tex>{"(-1.199, -0.624)"}</Tex>.
          </Insight>
          <Insight
            tone="note"
            title="I = −3: глибока гіперполяризація"
            simpleTitle="I = −3: нейрон придушений"
            simple={
              <>
                Сильний від&apos;ємний струм притискає напругу до V ≈ −2.16 — спайку немає. Саме тут система найбільш «нервова» (напруга повертається до гілки
                найшвидше), але відповідь нудна — і Розенброк проходить увесь відрізок за кілька десятків кроків.
              </>
            }
          >
            Рівновага <Tex>{"V_* \\approx -2.155"}</Tex>. Спайку нема: траєкторія одразу падає на ліву гілку. Жорсткість тут найбільша (<Tex>{"1 - V^2 \\approx -3.6"}</Tex>),
            але й розв&apos;язок найнудніший — Розенброк проходить [0, 200] за кілька десятків кроків.
          </Insight>
          <Insight
            tone="good"
            title="Спайки = релаксаційні коливання"
            simpleTitle="Ритмічні спайки = повільно-швидкий ритм"
            simple={
              <>
                Коли струм I між {HOPF[0].toFixed(2)} і {HOPF[1].toFixed(2)}, нейрон не може всидіти в спокої: довго й повільно «взводиться», потім миттєво
                клацає — і так по колу. Методи зі змінним кроком на клацаннях дріботять, а на повільних ділянках крокують широко.
              </>
            }
          >
            При <Tex>{`${HOPF[0].toFixed(2)} < I < ${HOPF[1].toFixed(2)}`}</Tex> рівновага на середній гілці нестійка, і виникає граничний цикл: повільне повзання по
            гілках і швидкі стрибки між ними. Саме на стрибках адаптивні методи зменшують крок у десятки разів.
          </Insight>
          <Insight
            tone="warn"
            title="Точність 10⁻³ — це небагато"
            simple={
              <>
                З точністю 0.001 кожен спайк виглядає правильно, але маленькі запізнення накопичуються: через кілька сотень одиниць часу спайки різних методів
                уже не збігаються. Для моделі мозку з мільйонами нейронів це важливо.
              </>
            }
          >
            З rtol = 10⁻³ форма спайку правильна, але фазова похибка накопичується: через кілька сотень одиниць часу спайки різних методів розходяться.
            Для довгих симуляцій нейромереж це суттєво.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                У 1962 р. Джин-Іті Нагумо спаяв цей «нейрон» із тунельного діода, котушки й конденсатора — і електронна схема стріляла спайками, як жива клітина.
                А Річард ФіцХью дійшов до тих самих рівнянь, досліджуючи модель Ходжкіна–Хакслі на аналоговому комп&apos;ютері.
              </>
            }
          >
            Джин-Іті Нагумо в 1962 р. зібрав цю модель «у залізі» — з тунельним діодом, котушкою і конденсатором. Електронний нейрон спайкував точно як
            справжній. А Річард ФіцХью отримав ті ж рівняння, досліджуючи модель Ходжкіна–Хакслі на аналоговому комп&apos;ютері.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function NeuronBlock({ ref_, rV, rW, T, spikes, Weq }: { ref_: Solution; rV: number[]; rW: number[]; T: number; spikes: number[]; Weq: number }) {
  const pb = usePlayback(Math.min(40, Math.max(10, T / 8)));
  const t = pb.progress * T;
  const V = sampleAt(ref_.t, rV, t);
  const W = sampleAt(ref_.t, rW, t);
  const zone = zoneOf(V, W, Weq);
  const trace = useMemo(() => ({ t: ref_.t, v: rV }), [ref_, rV]);
  const span = Math.min(T, 60);
  const fired = spikes.filter((s) => s <= t).length;
  const series = useMemo(
    () => [
      { x: rV, y: rW, color: "#c38bff", width: 2, opacity: 0.6 },
    ],
    [rV, rW],
  );
  return (
    <Grid>
      <Card>
        <NeuronScene t={t} V={V} W={W} zone={zone} spikes={spikes} trace={trace} span={span} />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${fmt(t, 4)}`} />
        </div>
      </Card>
      <Card>
        <Plot title="Де ми на фазовій площині" xLabel="V" yLabel="W" height={300} sorted={false} series={series} markers={[{ x: V, y: W, color: ZONES[zone].color, r: 7 }]} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="стан" value={ZONES[zone].label} tone={zone === "excited" ? "bad" : zone === "refractory" ? "warn" : "good"} />
          <Stat label="спайків на цей момент" value={fired} sub={`з ${spikes.length}`} />
        </div>
        <Say
          simple={
            <p className="mt-3 text-[13px] leading-relaxed text-white/60">
              <b style={{ color: ZONES.excited.color }}>Збудження</b> — вимикач клацнув: напруга висока, тіло клітини світиться, по відростку (аксону) біжить
              сигнал. <b style={{ color: ZONES.refractory.color }}>Рефрактерність</b> — пружина ще не взвелася (W високе): навіть сильний поштовх не викличе
              нового спайку. <b style={{ color: ZONES.rest.color }}>Спокій</b> — нейрон відпочив і готовий до нового клацання.
            </p>
          }
        >
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            <b style={{ color: ZONES.excited.color }}>Збудження</b> — V вище середньої гілки, мембрана деполяризована, сома спалахує й по аксону біжить імпульс.{" "}
            <b style={{ color: ZONES.refractory.color }}>Рефрактерність</b> — W ще високе: навіть сильний поштовх не викличе нового спайку.{" "}
            <b style={{ color: ZONES.rest.color }}>Спокій</b> — нейрон біля рівноваги й готовий до нового збудження.
          </p>
        </Say>
      </Card>
    </Grid>
  );
}
