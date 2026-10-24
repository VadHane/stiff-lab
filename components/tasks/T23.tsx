"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot, { type Series } from "@/components/plot/Plot";
import PhasorScene from "@/components/scenes/PhasorScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, denseOutput, indexAt, isAdaptive, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import FanStrobeScene from "@/components/analogy/FanStrobeScene";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

const ALL: MethodId[] = ["dopri", "ros", "rk2", "rk3", "rk4", "ieuler", "trap", "thetaA"];
const EPS_GRID = [0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.003];

const MODES = [
  { id: 0, label: "ω = 1", tex: "\\omega = 1", w: () => 1, W: (t: number) => t },
  { id: 1, label: "ω = 1 + 0.5 sin τ", tex: "\\omega = 1 + 0.5\\sin\\tau", w: (t: number) => 1 + 0.5 * Math.sin(t), W: (t: number) => t + 0.5 * (1 - Math.cos(t)) },
  { id: 2, label: "ω = 1 − τ/10 (резонанс)", tex: "\\omega = 1 - \\tau/10", w: (t: number) => 1 - t / 10, W: (t: number) => t - (t * t) / 20 },
  { id: 3, label: "ω = 0.5", tex: "\\omega = 0.5", w: () => 0.5, W: (t: number) => 0.5 * t },
];

// sandbox: state (a, φ, a·cos φ, a·sin φ) so that the phasor plane can be plotted directly; b, c — from the assignment
const PG_OPTS = [
  { id: 0, eps: 0.05, mode: 0, t0: 0, label: "ε = 0.05, ω = 1" },
  { id: 1, eps: 0.01, mode: 0, t0: 0, label: "ε = 0.01, ω = 1" },
  { id: 2, eps: 0.05, mode: 2, t0: 8.5, label: "резонанс: ω = 1 − τ/10, старт τ = 8.5" },
];
const PG_INIT = [1, 2 * Math.PI, 1, 0];
const PG_DOMAIN = { x: [-2, 2] as [number, number], y: [-2, 2] as [number, number] };
const PG_LABELS: [string, string] = ["a cos φ", "a sin φ"];
const pgClick = (x: number, y: number) => [Math.hypot(x, y), Math.atan2(y, x), x, y];
const pgAmp = (y: number[], a: number) => [a, y[1], a * Math.cos(y[1]), a * Math.sin(y[1])];

const system = (eps: number, mode: number, b: number, c: number, T: number): Problem => {
  const w = MODES[mode].w;
  return {
    f: (t, y) => [-y[0] + b * Math.sin(y[1]), w(t) / eps + c * Math.sin(2 * y[1])],
    jac: (_t, y) => [
      [-1, b * Math.cos(y[1])],
      [0, 2 * c * Math.cos(2 * y[1])],
    ],
    y0: [1, 2 * Math.PI],
    T,
  };
};

/** ∫₀ᵀ |ω(τ)| dτ (Simpson) — total phase advance / ε, counts the turns backwards after ω changes sign too. */
function absOmegaIntegral(mode: number, T: number): number {
  const w = MODES[mode].w;
  const n = 2000;
  const h = T / n;
  let s = Math.abs(w(0)) + Math.abs(w(T));
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * Math.abs(w(i * h));
  return (s * h) / 3;
}

function runMethod(m: MethodId, p: Problem, h: number): Solution {
  if (m === "dopri") return solve(m, p, { rtol: 1e-6, atol: 1e-8, maxSteps: 300000 });
  if (m === "ros") return solve(m, p, { rtol: 1e-4, atol: 1e-7, maxSteps: 300000 });
  if (m === "thetaA") return solve(m, p, { rtol: 1e-4, atol: 1e-6, maxSteps: 300000 });
  return solve(m, p, { h: Math.max(h, p.T / 200000), blowup: 1e8 });
}

/**
 * max|a − a_ref| over the nodes of s (at most ~5000 of them). a_ref between the reference's own nodes — cubic Hermite
 * dense output: linear interpolation of the DOPRI reference (mean step ≈ 0.004 at ε = 0.05) would add a floor of
 * 1.5–2.3·10⁻⁴ — 2–3 orders above the errors of DOPRI and RK4 at small h.
 */
function maxErrA(s: Solution, refAt: ReturnType<typeof denseOutput>): number {
  let e = 0;
  const stride = Math.max(1, Math.floor(s.t.length / 5000));
  for (let k = 0; k < s.t.length; k += stride) {
    const d = Math.abs(s.y[k][0] - refAt(s.t[k])[0]);
    if (!(d <= e)) e = d;
  }
  return e;
}

export default function T23() {
  const [eps, setEps] = useState(0.05);
  const [mode, setMode] = useState(0);
  const [b, setB] = useState(1.5);
  const [c, setC] = useState(0.84);
  const [T, setT] = useState(20);
  const [h, setH] = useState(0.005);
  const [zoom, setZoom] = useState(0);
  const [methods, setMethods] = useState<MethodId[]>(["dopri", "ros", "rk4", "ieuler"]);
  const [pgId, setPgId] = useState(0);
  const pgOpt = PG_OPTS[pgId];
  const pgF = useMemo(() => {
    const w = MODES[pgOpt.mode].w;
    return (t: number, y: number[]) => {
      const da = -y[0] + 1.5 * Math.sin(y[1]);
      const dp = w(t) / pgOpt.eps + 0.84 * Math.sin(2 * y[1]);
      const cs = Math.cos(y[1]),
        sn = Math.sin(y[1]);
      return [da, dp, da * cs - y[0] * sn * dp, da * sn + y[0] * cs * dp];
    };
  }, [pgOpt]);

  const dEps = useDeferredValue(eps);
  const dMode = useDeferredValue(mode);
  const dB = useDeferredValue(b);
  const dC = useDeferredValue(c);
  const dT = useDeferredValue(T);
  const dH = useDeferredValue(h);

  const problem = useMemo(() => system(dEps, dMode, dB, dC, dT), [dEps, dMode, dB, dC, dT]);
  const ref = useMemo(() => solve("dopri", problem, { rtol: 1e-10, atol: 1e-12, maxSteps: 800000 }), [problem]);
  const refA = useMemo(() => comp(ref, 0), [ref]);
  const refP = useMemo(() => comp(ref, 1), [ref]);
  const refAt = useMemo(() => denseOutput(ref, problem.f), [ref, problem]);

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = runMethod(m, problem, dH);
        const errA = maxErrA(s, refAt);
        const last = s.y[s.y.length - 1];
        const errPhi = Math.abs(last[1] - refP[refP.length - 1]);
        return { m, s, errA, errPhi };
      }),
    [methods, problem, dH, refAt, refP],
  );

  // implicit Euler vs trapezoid at the same coarse step (insight "Крок більший за половину ε"): the ratio depends strongly on h
  // (≈ 1 at h ~ 0.1–0.2, 7–15 just above ε/2, tens to hundreds with the resonance ω = 1 − τ/10), so it is computed, not quoted
  const ieOverTrap = useMemo(() => {
    const ieS = sols.find((x) => x.m === "ieuler");
    if (!ieS || ieS.s.failed || !(ieS.s.hs[0] > dEps * 0.5)) return NaN;
    const trS = sols.find((x) => x.m === "trap");
    const trErr = trS ? (trS.s.failed ? NaN : trS.errA) : maxErrA(runMethod("trap", problem, dH), refAt);
    return ieS.errA / trErr;
  }, [sols, dEps, problem, dH, refAt]);

  // quiz "RK4 or implicit Euler": ε = 0.05, ω = 1, b = 1.5, c = 0.84, h = 0.05 on [0, 20]
  const quizCoarse = useMemo(() => {
    const p = system(0.05, 0, 1.5, 0.84, 20);
    const at = denseOutput(solve("dopri", p, { rtol: 1e-10, atol: 1e-12, maxSteps: 800000 }), p.f);
    const e = (m: MethodId) => maxErrA(runMethod(m, p, 0.05), at);
    const rk4 = e("rk4");
    const ie = e("ieuler");
    return { rk4, ie, trap: e("trap"), ratio: ie / rk4 };
  }, []);

  const avgDev = useMemo(() => {
    let m = 0;
    for (let i = 0; i < ref.t.length; i++) m = Math.max(m, Math.abs(refA[i] - Math.exp(-ref.t[i])));
    return m;
  }, [ref, refA]);

  const epsScan = useMemo(
    () =>
      EPS_GRID.map((e) => {
        const p = system(e, dMode, dB, dC, 20);
        const d = solve("dopri", p, { rtol: 1e-6, atol: 1e-8, maxSteps: 300000 });
        const r = solve("ros", p, { rtol: 1e-4, atol: 1e-7, maxSteps: 300000 });
        return { e, d: d.steps, r: r.steps, dMs: d.ms, rMs: r.ms };
      }),
    [dMode, dB, dC],
  );

  // total number of turns = Σ|Δφ|/2π (for ω = 1 − τ/10 the phase turns back after τ = 10, the net change is ≈ 0)
  const turns = useMemo(() => {
    let s = 0;
    for (let i = 1; i < refP.length; i++) s += Math.abs(refP[i] - refP[i - 1]);
    return s / (2 * Math.PI);
  }, [refP]);
  const lockBand = dMode === 2 ? [10 * (1 - dC * dEps), 10 * (1 + dC * dEps)] : null;
  /**
   * Resonance ω = 1 − τ/10: does the phase really get captured? |ω/ε| < c only guarantees that fixed points exist; whether the phase reaches the
   * stable one depends on the angle at which it enters the window (with the assignment's b, c it is captured at ε = 0.05, sin φ(10) ≈ −0.94,
   * but not at ε = 0.01, sin φ(10) ≈ −0.30, where it hangs near the unstable point). At ω = 0 (τ = 10) the stable points are φ* = π/2 + kπ,
   * sin φ* = ±1; we call the phase captured when the reference is within ≈ 0.45 rad of one of them: |sin φ(10)| ≥ 0.9. The amplitude kick is
   * measured directly: the largest a − e^(−τ) from the start of the window to T.
   */
  const res = useMemo(() => {
    if (dMode !== 2 || dT < 10) return null;
    const s10 = Math.sin(refAt(10)[1]);
    const from = Math.max(0, 10 * (1 - dC * dEps));
    // how far the phase moves inside the window (to its end or to T)
    const shift = Math.abs(refAt(Math.min(dT, 10 * (1 + dC * dEps)))[1] - refAt(from)[1]);
    let dev = 0,
      tDev = NaN;
    for (let i = 0; i < ref.t.length; i++) {
      if (ref.t[i] < from) continue;
      const d = refA[i] - Math.exp(-ref.t[i]);
      if (Math.abs(d) > Math.abs(dev)) {
        dev = d;
        tDev = ref.t[i];
      }
    }
    return { s10, locked: dC > 0 && Math.abs(s10) >= 0.9, sStar: s10 < 0 ? -1 : 1, shift, dev, tDev };
  }, [dMode, dT, dC, dEps, refAt, ref, refA]);
  const lamMax = Math.max(1, 2 * dC);
  const phaseDev = useMemo(() => {
    const W = MODES[dMode].W;
    const stride = Math.max(1, Math.floor(ref.t.length / 4000));
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < ref.t.length; i += stride) {
      x.push(ref.t[i]);
      y.push(refP[i] - 2 * Math.PI - W(ref.t[i]) / dEps);
    }
    return { x, y };
  }, [ref, refP, dMode, dEps]);

  const dop = sols.find((x) => x.m === "dopri");
  const ros = sols.find((x) => x.m === "ros");
  const coarse = sols.filter((x) => !isAdaptive(x.m) && x.s.hs[0] > dEps * 0.5);
  const ie = sols.find((x) => x.m === "ieuler");
  const stepsPerTurn = (2 * Math.PI * dEps) / (dH * Math.max(1e-9, Math.abs(MODES[dMode].w(0))));
  const xView: [number, number] = zoom === 1 ? [0, Math.min(1, dT)] : zoom === 2 && lockBand ? [8, 13] : [0, dT];

  return (
    <>
      <AnalogyCard
        emoji="🎡"
        title="Вентилятор на відео і колесо, що крутиться назад"
        story={
          <>
            Зніміть на телефон вентилятор чи колесо автомобіля — і на відео воно може повільно крутитися <b>назад</b> або стояти на місці. Камера бачить
            лопаті лише раз на кадр; якщо за кадр лопать проходить більше пів оберту, напрям «вгадати» неможливо. У нашій задачі фаза φ крутиться дуже
            швидко (з частотою ω/ε), а амплітуда a — повільно згасає. Чисельний метод — та сама камера: він бачить фазу лише в моменти кроків.
          </>
        }
        mapping={[
          ["кут лопаті", <>фаза φ(τ), швидкість ω/ε (20 або 100 рад за одиницю τ)</>],
          ["довжина лопаті, що повільно «всихає»", <>амплітуда a(τ) ≈ e^(−τ)</>],
          ["частота кадрів камери", <>1/h — крок методу</>],
          ["колесо «крутиться назад» на відео", <>менше двох кроків на оберт: h &gt; πε/ω</>],
          ["«на око» лопаті зливаються в диск", <>усереднення: ⟨sin φ⟩ ≈ 0</>],
        ]}
      >
        <FanStrobeScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Швидка фаза, повільна амплітуда" simpleTitle="Стрілка, що шалено крутиться і повільно коротшає">
        <Grid>
          <Card title="Система з методички" icon="📜">
            <Tex block>{String.raw`\begin{cases}\dfrac{da}{d\tau} = -a + b\sin\varphi, & a(0) = 1,\\[6pt] \dfrac{d\varphi}{d\tau} = \dfrac{\omega(\tau)}{\varepsilon} + c\sin 2\varphi, & \varphi(0) = 2\pi,\end{cases}`}</Tex>
            <Tex block>{String.raw`\varepsilon = 0.05\ \text{і}\ 0.01,\quad b = 1.5,\quad c = 0.84,\quad \tau\in[0, 20].`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/70">
                  Уявіть стрілку довжиною a, повернуту на кут φ. Кут крутиться дуже швидко — 20 (при ε = 0.05) або 100 (при ε = 0.01) радіан за одиницю часу τ, а
                  довжина змінюється повільно: в середньому згасає. Так записують генератори, лазери, маятники з «дихаючою» довжиною — усе, що швидко коливається
                  і повільно змінює розмах.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/70">
              Це «одночастотна» система в змінних амплітуда–фаза: так після заміни <Tex>{"x = a\\cos\\varphi"}</Tex> записують слабко нелінійний
              осцилятор із повільно змінними параметрами (лазер, генератор, маятник із «дихаючою» довжиною). Фаза <Tex>{"\\varphi"}</Tex> обертається з
              великою швидкістю <Tex>{"\\omega/\\varepsilon"}</Tex> (20 або 100 рад на одиницю τ), амплітуда <Tex>{"a"}</Tex> змінюється повільно.
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="ω(τ) у методичці не задано"
                simpleTitle="Яка частота ω? У методичці не сказано"
                simple={
                  <>
                    Даємо вибір: ω = 1 (за замовчуванням), ω = 1 + 0.5 sin τ (частота повільно «дихає»), ω = 1 − τ/10 (частота проходить через нуль при τ = 10 —
                    резонанс) і ω = 0.5.
                  </>
                }
              >
                Даємо вибір: <Tex>{"\\omega = 1"}</Tex> (за замовчуванням), <Tex>{"\\omega = 1 + 0.5\\sin\\tau"}</Tex> (повільна модуляція),{" "}
                <Tex>{"\\omega = 1 - \\tau/10"}</Tex> (проходження через резонанс <Tex>{"\\omega = 0"}</Tex> при <Tex>{"\\tau = 10"}</Tex>) і{" "}
                <Tex>{"\\omega = 0.5"}</Tex>.
              </Insight>
            </div>
          </Card>
          <Card title="Принцип усереднення" icon="⚖️">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Поки стрілка шалено крутиться, sin φ половину часу додатний, половину — від&apos;ємний, і в середньому дає нуль (навіть якщо обертання трохи
                  нерівномірне — у точках φ і φ + π стрілка буває однаково довго). Тож «на око» довжина просто згасає як e^(−τ) — а реальна крива лише трохи
                  тремтить навколо цієї, на величину порядку ε:
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Поки фаза швидко обертається, <Tex>{"\\sin\\varphi"}</Tex> за один оберт в середньому дорівнює нулю. Навіть з нерівномірним обертанням (
              <Tex>{"c\\sin2\\varphi"}</Tex>) час перебування в точках <Tex>{"\\varphi"}</Tex> і <Tex>{"\\varphi + \\pi"}</Tex> однаковий, а{" "}
              <Tex>{"\\sin"}</Tex> там має протилежні знаки. Тож усереднена система:
            </p>
            </Say>
            <Tex block>{String.raw`\frac{d\bar a}{d\tau} = -\bar a + b\,\langle\sin\varphi\rangle = -\bar a\quad\Rightarrow\quad \bar a(\tau) = e^{-\tau},\qquad |a - \bar a| = O(\varepsilon).`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Усереднення ламається, коли стрілка <b>перестає крутитися</b>: якщо частота ω/ε стає меншою за c, стрілка може «застрягнути» на одному куті —{" "}
                  <b>захоплення фази</b> (резонанс). Для ω = 1 − τ/10 це вузьке вікно біля τ = 10 шириною 20cε.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Усереднення ламається, коли фаза перестає обертатися: рівняння <Tex>{"\\varphi' = \\omega/\\varepsilon + c\\sin 2\\varphi = 0"}</Tex> має
              розв&apos;язки при <Tex>{"|\\omega/\\varepsilon| \\le c"}</Tex> — <b>захоплення фази</b> (резонанс). Для <Tex>{"\\omega = 1 - \\tau/10"}</Tex> це
              вузеньке вікно <Tex>{"|\\tau - 10| \\le 10c\\varepsilon"}</Tex>.
            </p>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  У звичному сенсі задача <b>не жорстка</b>: жодних процесів, що згасають за мить (найшвидший темп ≈ {fmt(Math.max(1, 2 * dC), 3)}). Її складність
                  інша — шалене обертання: метод мусить «побачити» кожен оберт, тож крок має бути набагато меншим за ε, а кількість кроків росте як 1/ε.
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Якобіан <Tex>{String.raw`J = \begin{pmatrix}-1 & b\cos\varphi\\ 0 & 2c\cos2\varphi\end{pmatrix}`}</Tex> має власні числа{" "}
              <Tex>{"-1"}</Tex> і <Tex>{`2c\\cos 2\\varphi \\in [-${fmt(2 * dC, 3)}, ${fmt(2 * dC, 3)}]`}</Tex> — у класичному сенсі задача <b>не жорстка</b>! Її складність —
              швидкі осциляції з частотою <Tex>{"\\omega/\\varepsilon"}</Tex>: кожен метод мусить «пройти» кожен оберт, тож{" "}
              <Tex>{"h \\ll \\varepsilon"}</Tex>, і кількість кроків росте як <Tex>{"1/\\varepsilon"}</Tex>.
            </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Фазор, що крутиться і всихає" simpleTitle="Стрілка, що крутиться і всихає">
        <Lab
          controls={
            <>
              <Chips label="ε з умови" value={[0.05, 0.01].includes(eps) ? eps : -1} onChange={(v) => v > 0 && setEps(v)} options={[0.05, 0.01].map((v) => ({ value: v, label: `ε = ${v}` }))} />
              <Slider label="ε (лог.)" value={eps} onChange={setEps} min={0.003} max={0.3} log />
              <Chips label="Частота ω(τ)" value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.id, label: m.label }))} />
              <Slider label="b" value={b} onChange={setB} min={0} max={3} step={0.05} />
              <Slider label="c" value={c} onChange={setC} min={0} max={3} step={0.01} />
              <Slider label="Кінець відрізка" value={T} onChange={setT} min={2} max={40} step={1} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Slider label="Крок h (RK2, RK3, RK4, неявн. Ейлер, трапеції)" value={h} onChange={setH} min={0.0005} max={0.2} log hint={`h/ε = ${fmt(h / eps, 3)} — кроків на оберт ≈ ${fmt((2 * Math.PI * eps) / h, 3)}`} />
              <Chips
                label="Масштаб часу"
                value={zoom}
                onChange={setZoom}
                options={[
                  { value: 0, label: "увесь" },
                  { value: 1, label: "τ ∈ [0, 1]" },
                  ...(mode === 2 ? [{ value: 2, label: "резонанс τ ∈ [8, 13]" }] : []),
                ]}
              />
            </>
          }
        >
          <Playground ref0={ref} sols={sols} T={dT} eps={dEps} mode={dMode} c={dC} xView={xView} lockBand={lockBand} />

          <Grid>
            <Card>
              <Plot
                title="Поправка фази φ − 2π − (1/ε)∫ω dτ"
                height={240}
                xLabel="τ"
                xDomain={xView}
                series={[{ x: phaseDev.x, y: phaseDev.y, color: "#9ad0ff", label: "еталон", width: 1.4 }]}
              />
              <Say
                simple={
                  <p className="mt-2 text-[12.5px] text-white/55">
                    Наскільки стрілка відстає чи випереджає «ідеально рівне» обертання. Без доданка c·sin 2φ тут був би нуль. Нерівномірність дає дрібне тремтіння,
                    а коли фазу захоплено — стрілка зупиняється, і відставання різко росте.
                  </p>
                }
              >
              <p className="mt-2 text-[12.5px] text-white/55">
                Без доданка <Tex>{"c\\sin2\\varphi"}</Tex> тут був би нуль. Нерівномірність обертання дає малі коливання, а при захопленні фаза зупиняється —
                поправка різко «відстає».
              </p>
              </Say>
            </Card>
            <Card>
              <Plot
                title="Кроки на [0, 20] залежно від ε (лог-лог)"
                height={240}
                xLabel="ε"
                logX
                logY
                cursorX={dEps}
                series={[
                  { x: epsScan.map((s) => s.e), y: epsScan.map((s) => s.d), color: METHODS.dopri.color, label: "DOPRI45", width: 2 },
                  { x: epsScan.map((s) => s.e), y: epsScan.map((s) => s.r), color: METHODS.ros.color, label: "Розенброк", width: 2 },
                  { x: epsScan.map((s) => s.e), y: epsScan.map((s) => 40 / s.e), color: "#ffffff", label: "∝ 1/ε", width: 1, dash: [4, 4], opacity: 0.4 },
                ]}
              />
            </Card>
          </Grid>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Обертів фази (усього)" value={fmt(turns, 4)} sub={`ω/ε на старті = ${fmt(MODES[dMode].w(0) / dEps, 3)}`} />
            <Stat label="max |a − e^(−τ)|" value={fmt(avgDev, 3)} sub={`похибка усереднення · ε = ${fmt(dEps, 3)}`} tone={avgDev < 0.2 ? "good" : "warn"} />
            <Stat label="Еталон" value={`${ref.steps} кр.`} sub="DOPRI, rtol 10⁻¹⁰" />
            <Stat label="a(T)" value={fmt(refA[refA.length - 1], 4)} sub={`e^{−T} = ${fmt(Math.exp(-dT), 3)}`} />
            {sols.map(({ m, s, errA, errPhi }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : fmt(errA, 3)}
                sub={s.failed ? s.failed : `max|Δa| · |Δφ(T)| = ${fmt(errPhi, 3)} · ${s.steps} кр. · ${fmtMs(s.ms)}`}
                tone={s.failed || errA > 0.1 ? "bad" : errA > 0.01 ? "warn" : "good"}
              />
            ))}
          </div>

          <Insight
            tone="info"
            title={`Усереднення: похибка ${fmt(avgDev, 2)} при ε = ${fmt(dEps, 3)}`}
            simpleTitle={`«На око» помиляємось на ${fmt(avgDev, 2)}`}
            simple={
              <>
                Найбільше відхилення справжньої довжини стрілки від простого згасання e^(−τ) — {fmt(avgDev, 2)}, тобто ≈ {fmt(avgDev / dEps, 3)}·ε.{" "}
                {dMode === 2 && res
                  ? res.locked
                    ? "Тут винне не ε, а резонанс: у вікні захоплення стрілка стоїть, sin φ перестає бути «в середньому нулем», і довжина тягнеться до b·sin φ*."
                    : "Тут винне не ε, а резонанс: біля τ = 10 обертання сповільнюється, sin φ перестає бути «в середньому нулем», і довжина дістає «удар» — хоча цього разу стрілка до кута ±90° не прилипає (див. нижче)."
                  : dMode === 2
                    ? "Резонанс (ω = 0 при τ = 10) лежить за кінцем відрізка — збільште T, щоб його побачити."
                    : "Зменшіть ε у 5 разів — і відхилення зменшиться приблизно так само: що швидше крутиться стрілка, то краще працює усереднення."}
              </>
            }
          >
            Відношення max|a − e^(−τ)|/ε ≈ {fmt(avgDev / dEps, 3)}.{" "}
            {dMode === 2 && res
              ? res.locked
                ? "Для ω = 1 − τ/10 помилка велика не через ε, а через резонанс: у вікні захоплення фаза стоїть, sin φ ≠ 0 в середньому, і амплітуда тягнеться до b·sin φ*."
                : "Для ω = 1 − τ/10 помилка велика не через ε, а через резонанс: біля τ = 10 обертання сповільнюється, sin φ ≠ 0 в середньому, і амплітуда дістає «удар», хоча фаза цього разу до стійкої точки φ* не підходить (див. нижче)."
              : dMode === 2
                ? "Резонанс (ω = 0 при τ = 10) лежить за кінцем відрізка — збільште T, щоб його побачити."
                : dMode === 1
                ? "Зменшіть ε у 5 разів — і відхилення від усередненого розв'язку зменшиться приблизно так само: класична оцінка O(ε) теореми Боголюбова."
                : `Перше наближення дає a ≈ ā − (εb/ω)cos φ з ā(0) = 1 + εb/ω, тож найбільше відхилення (біля τ = 0, коли cos φ = −1) ≈ 2bε/ω, тобто стала ≈ 2b/ω = ${fmt((2 * dB) / MODES[dMode].w(0), 3)}. Зменшіть ε у 5 разів — і відхилення зменшиться так само: оцінка O(ε) теореми Боголюбова.`}
          </Insight>
          {lockBand && (
            <Insight
              tone="warn"
              title={`Проходження через резонанс: τ ∈ [${fmt(lockBand[0], 3)}, ${fmt(lockBand[1], 3)}]`}
              simple={
                !res ? (
                  <>Відрізок закінчується раніше, ніж частота доходить до нуля (τ = 10). Збільште T, щоб побачити проходження через резонанс.</>
                ) : dC === 0 ? (
                  <>
                    При c = 0 вікна немає: стрілка лише на мить зупиняється при τ = 10 і крутиться назад. Але біля τ = 10 вона обертається повільно, sin φ не
                    встигає усереднитися до нуля — і довжина все одно дістає «удар»: найбільше відхилення від e^(−τ) — {fmt(res.dev, 3)} при τ ≈ {fmt(res.tDev, 3)}.
                  </>
                ) : res.locked ? (
                  <>
                    У цьому вікні частота ω/ε менша за c, і стрілка «застрягає» на куті, де sin φ ≈ {res.sStar > 0 ? "+1" : "−1"} (при τ = 10 sin φ ≈{" "}
                    {fmt(res.s10, 3)}). Ще трохи раніше обертання різко сповільнюється. За цей час довжина тягнеться до b·sin φ* ≈ {fmt(res.sStar * dB, 3)} —
                    отримує «удар»: найбільше відхилення від e^(−τ) — {fmt(res.dev, 3)} при τ ≈ {fmt(res.tDev, 3)}, далі воно повільно згасає як e^(−τ). Після τ =
                    10 частота стає від&apos;ємною — і стрілка крутиться у зворотний бік.
                  </>
                ) : (
                  <>
                    У цьому вікні частота ω/ε менша за c, і стрілка могла б «застрягнути» на куті, де sin φ = ±1. Але цього разу до такого кута вона не доходить:
                    за все вікно стрілка повертається на {fmt(res.shift, 2)} рад, і при τ = 10 sin φ ≈ {fmt(res.s10, 3)}. Застрягне чи ні, залежить від кута, з
                    яким стрілка входить у вікно, тобто від ε і початкової фази. Утім біля τ = 10 вона все одно крутиться дуже повільно, sin φ не усереднюється до
                    нуля — і довжина дістає «удар»:
                    найбільше відхилення від e^(−τ) — {fmt(res.dev, 3)} при τ ≈ {fmt(res.tDev, 3)}, далі воно повільно згасає як e^(−τ). Після τ = 10 частота стає
                    від&apos;ємною — і стрілка крутиться у зворотний бік.
                  </>
                )
              }
            >
              {!res ? (
                <>Відрізок закінчується раніше, ніж ω доходить до нуля (τ = 10): збільште T, щоб побачити проходження через резонанс.</>
              ) : dC === 0 ? (
                <>
                  При c = 0 нерухомих точок у рівнянні фази немає: φ′ = ω/ε, фаза лише на мить зупиняється при τ = 10 і повертає назад. Але біля τ = 10 обертання
                  повільне (стаціонарна фаза), ⟨sin φ⟩ ≠ 0 — і амплітуда дістає «удар»: max(a − e^(−τ)) за модулем {fmt(res.dev, 3)} при τ ≈ {fmt(res.tDev, 3)}.
                </>
              ) : (
                <>
                  Тут |ω/ε| &lt; c, у рівнянні фази з&apos;являються нерухомі точки sin 2φ* = −ω/(εc) (стійка — та, де cos 2φ* &lt; 0; при ω = 0 це φ* = π/2 або 3π/2,
                  sin φ* = ±1). Ще трохи раніше обертання різко сповільнюється: період оберту 2π/√((ω/ε)² − c²) росте до нескінченності.{" "}
                  {res.locked ? (
                    <>
                      Тут фаза «прилипає» до стійкої точки: при τ = 10 sin φ ≈ {fmt(res.s10, 3)}, тобто φ* = {res.sStar > 0 ? "π/2" : "3π/2"}. Амплітуда за цей час
                      прямує до b·sin φ* ≈ {fmt(res.sStar * dB, 3)} і отримує «удар»: найбільше відхилення від e^(−τ) — {fmt(res.dev, 3)} при τ ≈ {fmt(res.tDev, 3)}, далі
                      воно повільно згасає як e^(−τ).
                    </>
                  ) : (
                    <>
                      Але нерухомі точки ще не означають захоплення: чи підійде фаза до стійкої, залежить від кута, з яким вона входить у вікно. Тут — ні: за
                      вікно (Δτ = 20cε ≈ {fmt(20 * dC * dEps, 3)}) фаза зміщується на {fmt(res.shift, 2)} рад, і при τ = 10 sin φ ≈ {fmt(res.s10, 3)}, а не ±1.
                      Утім уповільнене обертання біля τ = 10 все одно робить ⟨sin φ⟩ ≠ 0, і амплітуда дістає «удар»: найбільше відхилення від e^(−τ) —{" "}
                      {fmt(res.dev, 3)} при τ ≈ {fmt(res.tDev, 3)}; його знак і величину задає фаза на вході у вікно, а не b·sin φ*.
                    </>
                  )}{" "}
                  Після τ = 10 частота стає від&apos;ємною — фаза крутиться у зворотний бік.
                </>
              )}
            </Insight>
          )}
          {coarse.length > 0 && (
            <Insight
              tone="bad"
              title="Крок більший за половину ε"
              simple={
                <>
                  {coarse.map((x) => METHODS[x.m].short).join(", ")}: крок h = {fmt(dH, 3)} — лише {fmt(stepsPerTurn, 2)} «кадрів» на оберт стрілки. Методи не
                  вибухають (задача не жорстка), але точність тримається лише доти, доки кадрів на оберт достатньо: зараз похибка фази в кінці —{" "}
                  {coarse.map((x) => `${METHODS[x.m].short} ${fmt(x.errPhi, 2)}`).join(", ")}. Коли кадрів лишається менше двох-трьох, похибка різко зростає.
                  {ie && Number.isFinite(ieOverTrap)
                    ? ieOverTrap > 1.2
                      ? ` Неявний Ейлер ще й «змазує» швидке тремтіння довжини: його промах по амплітуді — ${fmt(ieOverTrap, 2)}× від промаху трапецій з тим самим кроком.`
                      : ` Промах неявного Ейлера по амплітуді зараз не помітно більший, ніж у трапецій з тим самим кроком (${fmt(ieOverTrap, 2)}×): ${
                          stepsPerTurn < 3.5
                            ? "з такими рідкими «кадрами» обидва методи вже погано бачать оберти."
                            : "тут перевага точнішого методу трапецій по амплітуді не проявляється."
                        }`
                    : ""}
                </>
              }
            >
              {coarse.map((x) => METHODS[x.m].short).join(", ")}: h = {fmt(dH, 3)} — лише {fmt(stepsPerTurn, 2)} кроків
              на оберт фази (на старті). Методи не вибухають (задача не жорстка), але точність визначається кількістю кроків на оберт: |Δφ(T)| ={" "}
              {coarse.map((x) => `${fmt(x.errPhi, 2)} (${METHODS[x.m].short})`).join(", ")}, і при менш ніж 2–3 кроках на оберт похибки фази та середнього ⟨sin φ⟩
              різко зростають.
              {ie && Number.isFinite(ieOverTrap)
                ? ieOverTrap > 1.2
                  ? ` Неявний Ейлер (1-й порядок) при цьому ще й штучно згладжує швидку складову a: його max|Δa| — ${fmt(ieOverTrap, 2)}× від трапецієвої при тому самому h.`
                  : ` Max|Δa| неявного Ейлера (1-й порядок) зараз не помітно більша за трапецієву при тому самому h (${fmt(ieOverTrap, 2)}×): ${
                      stepsPerTurn < 3.5
                        ? "при такому грубому кроці похибка визначається вже не порядком, а тим, що оберти фази майже не розділяються."
                        : "при цьому h перевага 2-го порядку трапецій по амплітуді не проявляється."
                    }`
                : ""}
            </Insight>
          )}
          {dop && ros && (
            <Insight
              tone="good"
              title={`DOPRI ${dop.s.steps} кроків vs Розенброк ${ros.s.steps}`}
              simple={
                <>
                  Неявний Розенброк тут нічого не виграє: «сірника з чайником» немає, а шалене обертання вимагає дрібних кроків від усіх. DOPRI (5-й порядок)
                  точніший на кожному кроці —{" "}
                  {dop.s.steps < ros.s.steps ? `тому робить у ${fmt(ros.s.steps / dop.s.steps, 2)} рази менше кроків` : "і не гірший"}. Мораль: «жорстка» і
                  «важка» — різні речі.
                </>
              }
            >
              Тут неявний Розенброк не має переваг: жорсткості немає, а точність 2-го порядку на швидких осциляціях вимагає дрібних кроків. DOPRI 5-го
              порядку — {dop.s.steps < ros.s.steps ? `у ${fmt(ros.s.steps / dop.s.steps, 2)} рази економніший` : "не гірший"}. Мораль: «жорстка» і «важка
              для інтегрування» — різні речі.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Результати" title="Ціна малого ε" simpleTitle="Що швидше крутиться — то дорожче рахувати">
        <Card>
          <Table
            head={["ε", "ω/ε (старт)", "обертів за [0,20]", "DOPRI: кроки", "час", "Розенброк: кроки", "час"]}
            rows={epsScan.map((s) => [
              <button key={s.e} onClick={() => setEps(s.e)} className="text-[var(--accent)] hover:underline">
                {s.e}
              </button>,
              fmt(MODES[dMode].w(0) / s.e, 3),
              fmt(absOmegaIntegral(dMode, 20) / s.e / (2 * Math.PI), 3),
              s.d,
              fmtMs(s.dMs),
              s.r,
              fmtMs(s.rMs),
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Кроків у обох методів стає більше пропорційно до кількості обертів стрілки — тобто як 1/ε. При ε = {epsScan[epsScan.length - 1].e} DOPRI робить
                уже {epsScan[epsScan.length - 1].d} кроків. <Relatable kind="steps" n={epsScan[epsScan.length - 1].d} /> Тому для таких задач придумали хитрість:
                рахувати одразу <i>усереднену</i> систему (тут — просто згасання e^(−τ)) великими кроками.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Кількість кроків обох методів росте як 1/ε — прямо пропорційно кількості обертів фази. Саме тому для швидко-осцилюючих задач придумали
            спеціальні методи: інтегрують <i>усереднену</i> систему (тут — просто <Tex>{"\\bar a' = -\\bar a"}</Tex>) з великим кроком.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Пісочниця" title="Задайте стрілці довжину й кут — і подивіться, як вона всихає" report={false}>
        <div className="mb-3">
          <Chips label="Режим" value={pgId} onChange={setPgId} options={PG_OPTS.map((o) => ({ value: o.id, label: o.label }))} />
        </div>
        <PhasePlayground
          f={pgF}
          init={PG_INIT}
          t0={pgOpt.t0}
          axes={[2, 3]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          fromClick={pgClick}
          field={false}
          speed={0.1}
          speedRange={[0.01, 1]}
          trail={0.5}
          strip={[
            { comp: 0, label: "a", color: "#ffe66d" },
            { comp: 3, label: "a·sin φ", color: "#9ad0ff" },
          ]}
          window={3}
          kicks={[
            { label: "Подовжити стрілку", emoji: "📏", apply: (y) => pgAmp(y, y[0] + 0.8), hint: "a += 0.8" },
            { label: "Перекинути фазу", emoji: "🔄", apply: (y) => [y[0], y[1] + Math.PI, -y[2], -y[3]], hint: "φ += π" },
          ]}
          underlay={(ctx, { X, Y }) => {
            ctx.setLineDash([4, 5]);
            ctx.strokeStyle = "rgba(255,230,109,0.45)";
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.arc(X(0), Y(0), X(1) - X(0), 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2);
            ctx.fill();
          }}
          hint={
            <Say
              simple={
                <>
                  Кінчик стрілки (a cos φ, a sin φ). Клацніть будь-де — задасте нові довжину й кут. Стрілка крутиться так швидко, що слід зливається в «диск»,
                  а довжина повільно всихає до центру — незалежно від того, куди ви клацнули: усереднення в дії. На стрічці — довжина a: плавне згасання з
                  дрібним тремтінням. У режимі «резонанс» біля τ ≈ 9.6–10.4 стрілка раптом зупиняється (з цього старту — там, де sin φ ≈ +1) — і довжина
                  тягнеться до +1.5. Натисніть у цьому вікні «Перекинути фазу» — стрілка стане навпроти, і довжина потягнеться вниз, до −1.5.
                </>
              }
            >
              Площина (a cos φ, a sin φ) системи задачі з b = 1.5, c = 0.84; стан розширено компонентами X = a cos φ, Y = a sin φ (рівняння для них — за
              правилом ланцюжка), клік задає a = √(X² + Y²), φ = atan2(Y, X). Інтегрування — Розенброк у реальному часі, швидкість за замовчуванням 0.1 од. τ
              за секунду. Для ω = 1 − τ/10 відлік починається з τ = 8.5, вікно захоплення |τ − 10| ≤ 10cε ≈ 0.42.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="23"
          questions={[
            {
              id: "eps",
              q: <>ω = 1, відрізок [0, 20]. При ε = 0.05 DOPRI (rtol 10⁻⁶) робить ≈ 800 кроків. Скільки знадобиться при ε = 0.01?</>,
              options: ["Приблизно стільки ж — жорсткості ж нема", "Приблизно вчетверо більше", "У 25 разів більше", "Менше — фаза ж та сама"],
              correct: 1,
              explain: (
                <>
                  Кроки визначає кількість обертів фази, а вона ∝ 1/ε: 64 оберти проти 318. Перевірка: 812 кроків при ε = 0.05 і 3097 при ε = 0.01 (×3.8 — того ж
                  порядку, що й ×5 за обертами).
                </>
              ),
              explainSimple: <>Стрілка крутиться вп&apos;ятеро швидше — і кожен оберт треба «побачити». Перевірка: 812 → 3097 кроків, майже вчетверо більше.</>,
              show: {
                label: "Показати ε = 0.01",
                run: () => {
                  setMode(0);
                  setT(20);
                  setEps(0.01);
                  setMethods((m) => (m.includes("dopri") ? m : ["dopri", ...m]));
                },
              },
            },
            {
              id: "rk4ie",
              q: <>ε = 0.05, ω = 1, крок h = 0.05 — це лише ≈ 6 кроків на оберт фази. Хто точніше порахує амплітуду a: RK4 чи неявний Ейлер?</>,
              options: [
                "Неявний Ейлер — він же «для жорстких задач»",
                `RK4, приблизно у ${Math.round(quizCoarse.ratio / 10) * 10} разів точніше`,
                "Однаково",
                "Обидва вибухнуть",
              ],
              correct: 1,
              explain: (
                <>
                  Задача не жорстка, тож стійкість неявного методу нічого не дає, а порядок вирішує все. Перевірка (max|Δa| на [0, 20]): RK4 ≈{" "}
                  {fmt(quizCoarse.rk4, 2)}, неявний Ейлер ≈ {fmt(quizCoarse.ie, 2)} — це ≈ {fmt(quizCoarse.ratio, 2)}× гірше. Для порівняння, трапеції — ≈{" "}
                  {fmt(quizCoarse.trap, 2)}.
                </>
              ),
              explainSimple: (
                <>
                  Тут немає «сірника й чайника», тож неявність не допомагає — важить точність кожного кроку. RK4 промахується на{" "}
                  {String(Number(quizCoarse.rk4.toPrecision(2)))}, неявний Ейлер — на {String(Number(quizCoarse.ie.toPrecision(2)))}.
                </>
              ),
              show: {
                label: "Показати h = 0.05",
                run: () => {
                  setMode(0);
                  setT(20);
                  setEps(0.05);
                  setH(0.05);
                  setMethods((m) => [...m.filter((x) => x !== "rk4" && x !== "ieuler"), "rk4", "ieuler"]);
                },
              },
            },
            {
              id: "res",
              q: <>ω = 1 − τ/10, ε = 0.05. Де амплітуда a(τ) найдальше відходить від усередненої e^(−τ)?</>,
              options: ["На самому початку, τ ≈ 0", "Біля τ ≈ 10–11 — одразу після резонансу", "У кінці, τ = 20", "Ніде — усереднення працює всюди"],
              correct: 1,
              explain: (
                <>
                  У вікні захоплення |τ − 10| ≤ 10cε ≈ 0.42 фаза стоїть біля φ* з sin φ* ≈ −1, і a тягнеться до b·sin φ* = −1.5. Перевірка: найбільше відхилення
                  ≈ 1.25 при τ ≈ 11.0 (до τ = 8 — лише ≈ 0.3).
                </>
              ),
              explainSimple: <>Біля τ = 10 стрілка «застрягає», і довжина летить до −1.5. Найбільший промах усереднення (≈ 1.25) — при τ ≈ 11, одразу після резонансу.</>,
              show: {
                label: "Показати резонанс",
                run: () => {
                  setEps(0.05);
                  setT(20);
                  setMode(2);
                  setZoom(2);
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
            title="Повільне і швидке"
            simple={
              <>
                Довжина стрілки «не встигає» відчути шалене обертання і в середньому згасає як e^(−τ). Дрібне тремтіння навколо цієї кривої — розміром ~ε: при ε =
                0.05 його видно неозброєним оком, при ε = 0.01 — ледь-ледь.
              </>
            }
          >
            Амплітуда «не встигає» відчути швидкі коливання sin φ і в середньому згасає як e^(−τ). Залишкові коливання навколо цієї кривої мають розмах
            O(ε): при ε = 0.05 помітні неозброєним оком, при ε = 0.01 — ледь-ледь.
          </Insight>
          <Insight
            tone="warn"
            title="Резонанс ламає усереднення"
            simple={
              <>
                Коли частота проходить через нуль, стрілка майже зупиняється — і довжина отримує «удар», якого просте усереднення не бачить. Чи «прилипне»
                стрілка до кута ±90°, залежить від того, як вона підійде до резонансу: з параметрами умови при ε = 0.05 прилипає (довжина падає до −1.25), а при
                ε = 0.01 — ні, і удар має інший знак (+0.43). Вікно вузьке (~20cε), але наслідки помітні ще довго після нього.
              </>
            }
          >
            Коли частота проходить через нуль, обертання фази сповільнюється, а у вікні |ω/ε| &lt; c з&apos;являються нерухомі точки. Чи захопиться фаза,
            залежить від кута на вході у вікно: з b, c з умови при ε = 0.05 — так (sin φ(10) ≈ −0.94, a спадає до −1.25), при ε = 0.01 — ні (sin φ(10) ≈ −0.30,
            найбільше відхилення +0.43). В обох випадках амплітуда отримує стрибок, якого усереднена модель не бачить. Вузьке вікно (ширина ~20cε) — але ефект
            помітний і після нього.
          </Insight>
          <Insight
            tone="good"
            title="Методи"
            simple={
              <>
                Задача не жорстка (найшвидший темп ≤ {fmt(lamMax, 3)}), але швидко крутиться: усім методам потрібен крок, набагато менший за ε. Явний DOPRI —
                найекономніший, неявні виграшу не дають, а неявний Ейлер ще й «змазує» швидке тремтіння.
              </>
            }
          >
            Задача не жорстка (|λ| ≤ {fmt(lamMax, 3)}), зате швидко-осцилююча: усі методи потребують h ≪ ε. Явний DOPRI найекономніший, неявні не дають
            виграшу, а неявний Ейлер (1-й порядок) ще й штучно згладжує швидкі коливання амплітуди.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Метод усереднення придумали в Києві 1930-х Микола Крилов і Микола Боголюбов — для розрахунку радіогенераторів. А захоплення фази — той самий
                ефект, що синхронізує маятникові годинники на одній стіні (Гюйгенс, 1665) і світлячків на одному дереві.
              </>
            }
          >
            Метод усереднення Крилова–Боголюбова народився у Києві в 1930-х: Микола Крилов і Микола Боголюбов розробляли його для розрахунку радіотехнічних
            генераторів. А захоплення фази — той самий ефект, що синхронізує маятникові годинники на одній стіні (Гюйгенс, 1665) і світлячків на одному дереві.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function Playground({
  ref0,
  sols,
  T,
  eps,
  mode,
  c,
  xView,
  lockBand,
}: {
  ref0: Solution;
  sols: { m: MethodId; s: Solution; errA: number }[];
  T: number;
  eps: number;
  mode: number;
  c: number;
  xView: [number, number];
  lockBand: number[] | null;
}) {
  const pb = usePlayback(Math.max(12, Math.min(60, (T / eps) * 0.04)));
  const time = xView[0] + pb.progress * (xView[1] - xView[0]);
  const data = useMemo(() => {
    const a = comp(ref0, 0);
    const phi = comp(ref0, 1);
    const tt: number[] = [];
    for (let k = 0; k <= 400; k++) tt.push((T * k) / 400);
    const aSeries: Series[] = [
      { x: ref0.t, y: a, color: "#ffffff", label: "еталон", width: 3.5, opacity: 0.35 },
      { x: tt, y: tt.map((t) => Math.exp(-t)), color: "#ffe66d", label: "усереднення e^(−τ)", width: 2, dash: [6, 4] },
      ...sols.map(({ m, s, errA }) => ({ x: s.t, y: comp(s, 0), color: METHODS[m].color, label: METHODS[m].short, width: 1.3, opacity: s.failed || errA > 0.1 ? 0.5 : 1 })),
    ];
    const sinSeries: Series[] = [{ x: ref0.t, y: phi.map(Math.sin), color: "#9ad0ff", label: "sin φ", width: 1 }];
    const spiral: Series[] = [
      { x: a.map((v, i) => v * Math.cos(phi[i])), y: a.map((v, i) => v * Math.sin(phi[i])), color: "#9ad0ff", label: "еталон", width: 0.9, fade: true },
    ];
    return { a, phi, aSeries, sinSeries, spiral };
  }, [ref0, sols, T]);

  const i = indexAt(ref0.t, time);
  const wNow = MODES[mode].w(time) / eps;
  const band = (ctx: CanvasRenderingContext2D, tr: { X: (x: number) => number; top: number; height: number }) => {
    if (!lockBand) return;
    ctx.fillStyle = "rgba(255,122,217,0.12)";
    const x0 = tr.X(lockBand[0]),
      x1 = tr.X(lockBand[1]);
    ctx.fillRect(x0, tr.top, x1 - x0, tr.height);
  };

  return (
    <>
      <Card title="Сцена: фазор" icon="🎼">
        <PhasorScene t={ref0.t} a={data.a} phi={data.phi} time={time} omegaOverEps={wNow} c={c} />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`τ = ${time.toFixed(2)}`} />
        </div>
        <Say
          simple={
            <p className="mt-2 text-[12.5px] text-white/55">
              Стрілка довжиною a під кутом φ. Зараз вона робить ~{fmt(Math.abs(wNow) / (2 * Math.PI), 2)} обертів за одиницю τ (на екрані можливий «ефект колеса
              воза» — як у вентилятора на відео), а її довжина повільно повторює жовте коло e^(−τ).
            </p>
          }
        >
        <p className="mt-2 text-[12.5px] text-white/55">
          Стрілка довжиною a під кутом φ. Зараз вона обертається ~{fmt(Math.abs(wNow) / (2 * Math.PI), 2)} разів за одиницю τ (|ω/ε|/2π; на екрані
          можливий «ефект колеса воза» — стробоскопічна ілюзія), а її довжина повільно повторює жовте коло e^(−τ).
        </p>
        </Say>
      </Card>
      <Card>
        <Plot title="Амплітуда a(τ)" height={270} xLabel="τ" xDomain={xView} cursorX={time} underlay={band} series={data.aSeries} />
      </Card>
      <Grid>
        <Card>
          <Plot title="sin φ(τ) — швидкі осциляції" height={240} xLabel="τ" xDomain={xView} yDomain={[-1.15, 1.15]} cursorX={time} underlay={band} series={data.sinSeries} />
        </Card>
        <Card>
          <Plot
            title="Спіраль (a cos φ, a sin φ)"
            height={240}
            xLabel="a cos φ"
            yLabel="a sin φ"
            sorted={false}
            equalAspect
            markers={[{ x: data.a[i] * Math.cos(data.phi[i]), y: data.a[i] * Math.sin(data.phi[i]), color: "#ffffff" }]}
            series={data.spiral}
          />
        </Card>
      </Grid>
    </>
  );
}
