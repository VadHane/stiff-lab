"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot, { type Series } from "@/components/plot/Plot";
import { drawArrowField } from "@/components/scenes/fieldArrows";
import TubeOscillatorScene from "@/components/scenes/TubeOscillatorScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { solveFullNewton } from "@/lib/newton-fixed";
import { comp, denseOutput, indexAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import VdpViolinScene from "@/components/analogy/VdpViolinScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

const W0 = 0.64;
const MU1 = [0.1, 0.2, 0.5, 1, 1.5, 2];
const MU1_COLORS = ["#5cc8ff", "#4dd0e1", "#7cf29c", "#ffe66d", "#ffb547", "#ff5d73"];
const ALL: MethodId[] = ["euler", "rk4", "ieuler", "trap", "bdf2", "dopri", "ros"];
const IMPLICIT: MethodId[] = ["ieuler", "trap", "bdf2", "theta"];
// debugger: μ = 5, ω = 0.64 (part 2 of the assignment); stable references
const DBG_F = (_t: number, y: number[]) => [y[1], 5 * (1 - y[0] * y[0]) * y[1] - W0 * W0 * y[0]];
const DBG_Y0 = [1, 2];
const DBG_VIEW = { x: 0, y: 1, xLabel: "u", yLabel: "u′", xDomain: [-3, 3] as [number, number], yDomain: [-9, 9] as [number, number] };
const PG_MU = [0.5, 2, 5];
const PG_V = { 0.5: 3, 2: 5, 5: 10 } as Record<number, number>;
const PG_LABELS: [string, string] = ["u", "u′"];

const vdp = (mu: number, w: number, T: number): Problem => ({
  f: (_t, y) => [y[1], mu * (1 - y[0] * y[0]) * y[1] - w * w * y[0]],
  jac: (_t, y) => [
    [0, 1],
    [-2 * mu * y[0] * y[1] - w * w, mu * (1 - y[0] * y[0])],
  ],
  y0: [1, 2],
  T,
});

/**
 * Period estimate for u'' + ω²u = μ(1−u²)u'. In the scaled time s = ωt the equation is the standard VdP
 * with μ' = μ/ω; blend of the harmonic limit 2π and the relaxation asymptotics (3−2ln2)μ' + 3α₁μ'^{−1/3}
 * (α₁ = 2.338 — first zero of Airy function), the Airy term switched on smoothly. Within ≈3.4 % of the
 * measured period for μ' from 0.1 to 160 (worst near μ' ≈ 2.8; checked against DOPRI / Rosenbrock).
 */
const periodGuess = (mu: number, w: number) => {
  const m = mu / w;
  const airy = 3 * 2.33811 * Math.pow(m, -1 / 3) * ((m * m) / (m * m + 60));
  return (Math.hypot(2 * Math.PI, (3 - 2 * Math.log(2)) * m) + airy) / w;
};

/** Up-crossings of u through 0 (linear interpolation of t and v = u′); i — index of the first node after the crossing. */
function upCrossings(s: Solution): { t: number; v: number; i: number }[] {
  const out: { t: number; v: number; i: number }[] = [];
  for (let i = 1; i < s.t.length; i++) {
    const a = s.y[i - 1][0],
      b = s.y[i][0];
    if (a < 0 && b >= 0) {
      const th = -a / (b - a);
      out.push({ t: s.t[i - 1] + th * (s.t[i] - s.t[i - 1]), v: s.y[i - 1][1] + th * (s.y[i][1] - s.y[i - 1][1]), i });
    }
  }
  return out;
}

function measurePeriod(s: Solution): number {
  const ups = upCrossings(s);
  return ups.length >= 3 ? ups[ups.length - 1].t - ups[ups.length - 2].t : NaN;
}

/** Ray casting: is the point (px, py) inside the closed polygon (xs, ys)? */
function insidePolygon(px: number, py: number, xs: number[], ys: number[]): boolean {
  let c = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++)
    if (ys[i] > py !== ys[j] > py && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
  return c;
}

function runMethod(m: MethodId, p: Problem, h: number): Solution {
  const span = p.T - (p.t0 ?? 0);
  if (m === "dopri") return solve(m, p, { rtol: 1e-6, atol: 1e-8, maxSteps: 100000 });
  if (m === "ros") return solve(m, p, { rtol: 1e-4, atol: 1e-7, maxSteps: 100000 });
  if (IMPLICIT.includes(m)) return solveFullNewton(m, p, Math.max(h, span / 20000));
  return solve(m, p, { h: Math.max(h, span / 100000), blowup: 1e6 });
}

export default function T14() {
  const [field1, setField1] = useState(1);
  const [aSel, setASel] = useState(40);
  const [mu, setMu] = useState(5);
  const [w, setW] = useState(W0);
  const [h, setH] = useState(0.01);
  const [methods, setMethods] = useState<MethodId[]>(["rk4", "ieuler", "dopri", "ros"]);
  const [pgMu, setPgMu] = useState(2);
  const pgF = useMemo(() => (_t: number, y: number[]) => [y[1], pgMu * (1 - y[0] * y[0]) * y[1] - W0 * W0 * y[0]], [pgMu]);
  const pgInit = useMemo(() => [1, 2], []);
  const pgCycle = useMemo(() => {
    const s = solve("dopri", { f: pgF, y0: [2, 0], T: 6 * periodGuess(pgMu, W0) }, { rtol: 1e-8, atol: 1e-10 });
    const P = measurePeriod(s);
    const tEnd = s.t[s.t.length - 1];
    const i0 = indexAt(s.t, tEnd - P * 1.02);
    return { u: comp(s, 0).slice(i0), v: comp(s, 1).slice(i0) };
  }, [pgF, pgMu]);

  const dMu = useDeferredValue(mu);
  const dW = useDeferredValue(w);
  const dH = useDeferredValue(h);
  const dA = useDeferredValue(aSel);
  const T = dA > 0 ? dA : 2 * periodGuess(dMu, dW);

  // [0,120] so that even μ = 0.1 (slowest attraction: the deviation from the cycle decays ≈ e^{−μt}) has settled on the cycle in the last quarter.
  const family = useMemo(
    () =>
      MU1.map((m) => {
        const s = solve("dopri", vdp(m, W0, 120), { rtol: 1e-8, atol: 1e-10 });
        let amp = 0;
        for (let i = Math.floor(s.t.length * 0.75); i < s.t.length; i++) amp = Math.max(amp, Math.abs(s.y[i][0]));
        const ups = upCrossings(s);
        const n = ups.length;
        // the last full period approximates the cycle: is the start (1, 2) inside it, and how far does the cycle reach in u′?
        let inside = false;
        let vMax = NaN;
        if (n >= 2) {
          const cu: number[] = [];
          const cv: number[] = [];
          for (let i = ups[n - 2].i - 1; i <= ups[n - 1].i; i++) {
            cu.push(s.y[i][0]);
            cv.push(s.y[i][1]);
          }
          inside = insidePolygon(1, 2, cu, cv);
          vMax = Math.max(...cv.map(Math.abs));
        }
        // approach to the cycle on the Poincaré section u = 0, u′ > 0: |u′ₖ − u′*|/u′* drops to 1 % at t = settle
        // (log-linear interpolation between crossings — the deviation decays geometrically)
        let settle = NaN;
        if (n >= 3) {
          const vStar = ups[n - 1].v;
          const dev = ups.map((c) => Math.abs(c.v - vStar) / vStar);
          let k = n - 1;
          while (k > 0 && dev[k - 1] <= 0.01) k--;
          settle = ups[k].t;
          if (k > 0 && dev[k] > 0) {
            const la = Math.log(dev[k - 1]),
              lb = Math.log(dev[k]);
            settle = ups[k - 1].t + ((la - Math.log(0.01)) / (la - lb)) * (ups[k].t - ups[k - 1].t);
          }
        }
        return { mu: m, s, P: measurePeriod(s), amp, inside, vMax, settle };
      }),
    [],
  );
  const famOut = family.filter((x) => !x.inside);
  const famIn = family.filter((x) => x.inside);
  const muList = (xs: typeof family) => xs.map((x) => String(x.mu)).join(", ");
  const vRange = (xs: typeof family) => {
    const v = xs.map((x) => x.vMax);
    return `${fmt(Math.min(...v), 3)}…${fmt(Math.max(...v), 3)}`;
  };
  const slow = family[0];

  const problem = useMemo(() => vdp(dMu, dW, T), [dMu, dW, T]);
  // DOPRI rtol 10⁻¹¹: with cubic Hermite dense output the reference is ≲ 10⁻⁸ off between its nodes,
  // below the errors of RK4 (h = 0.01) and DOPRI (rtol 10⁻⁶) it is compared with. For μ > 20 it is still cheap on
  // T ≤ 100 (≤ ~35k steps even at μ = 1000, a = 40), whereas a Rosenbrock rtol 10⁻⁷ reference is itself off by
  // ~10⁻³ (μ = 30…100) and would show DOPRI's error ~3× and RK4's up to ~500× too large; only long intervals
  // («2 періоди» at large μ/ω², up to ~10⁵ time units) fall back to Rosenbrock.
  const refDopri = dMu <= 20 || T <= 100;
  const ref = useMemo(
    () =>
      refDopri
        ? solve("dopri", problem, { rtol: 1e-11, atol: 1e-13, maxSteps: 400000 })
        : solve("ros", problem, { rtol: 1e-7, atol: 1e-9, maxSteps: 400000 }),
    [problem, refDopri],
  );
  const refAt = useMemo(() => denseOutput(ref, problem.f), [ref, problem]);

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = runMethod(m, problem, dH);
        // |u − u_ref| at the method's nodes; the reference between its own nodes — cubic Hermite (linear interpolation
        // would add ~h²|u″|/8 ≈ 10⁻⁴, more than the whole error of RK4 / DOPRI)
        const du = (k: number) => Math.abs(s.y[k][0] - refAt(s.t[k])[0]);
        let err = 0;
        const stride = Math.max(1, Math.floor(s.t.length / 4000));
        for (let k = 0; k < s.t.length; k += stride) {
          const d = du(k);
          if (!(d <= err)) err = d;
        }
        const errT: number[] = [];
        const errY: number[] = [];
        const pStride = Math.max(1, Math.floor(s.t.length / 3000));
        for (let k = 0; k < s.t.length; k += pStride) {
          errT.push(s.t[k]);
          errY.push(Math.max(1e-14, du(k)));
        }
        return { m, s, err, errT, errY };
      }),
    [methods, problem, dH, refAt],
  );

  const stiff = useMemo(() => {
    let fast = 0;
    const n = ref.t.length;
    for (let k = 0; k < 400; k++) {
      const [u, v] = ref.y[Math.floor((k / 399) * (n - 1))];
      const tr = dMu * (1 - u * u);
      const det = 2 * dMu * u * v + dW * dW;
      const disc = (tr * tr) / 4 - det;
      if (disc >= 0) {
        const l1 = Math.abs(tr / 2 + Math.sqrt(disc)),
          l2 = Math.abs(tr / 2 - Math.sqrt(disc));
        fast = Math.max(fast, l1, l2);
      } else fast = Math.max(fast, Math.abs(tr / 2));
    }
    return { fast };
  }, [ref, dMu, dW]);

  const period = measurePeriod(ref);
  // pointwise eigenvalue ratios of a nonlinear oscillator are meaningless (one eigenvalue crosses zero twice per cycle);
  // compare the fastest local rate with the slow time scale of the cycle instead: |λ|max · T/(2π)
  const stiffRatio = Number.isFinite(period) && period > 0 ? (stiff.fast * period) / (2 * Math.PI) : NaN;
  const amp = useMemo(() => {
    let m = 0;
    for (let i = Math.floor(ref.t.length / 2); i < ref.t.length; i++) m = Math.max(m, Math.abs(ref.y[i][0]));
    return m;
  }, [ref]);

  const table = useMemo(
    () =>
      [0.5, 1, 2, 5, 100, 1000].map((m) => {
        const p = vdp(m, W0, 40);
        const d = solve("dopri", p, { rtol: 1e-6, atol: 1e-8, maxSteps: 100000 });
        const r = solve("ros", p, { rtol: 1e-4, atol: 1e-7, maxSteps: 100000 });
        return { mu: m, d, r };
      }),
    [],
  );

  const dop = sols.find((x) => x.m === "dopri");
  const ros = sols.find((x) => x.m === "ros");
  const eul = sols.find((x) => x.m === "euler");
  const rescued = sols.filter((x) => IMPLICIT.includes(x.m) && x.s.rejected > 0);
  const hFixedNote = T / dH > 20000;

  return (
    <>
      <AnalogyCard
        emoji="🎻"
        title="Смичок і скрипкова струна"
        story={
          <>
            Смичок тягнуть рівно, а струна співає — сама. Секрет у терті: поки струна рухається повільно, смичок «підхоплює» її і{" "}
            <b>додає енергії</b>; коли вона розгойдалася надто сильно — тертя <b>гальмує</b>. Підкачка й гальмування врівноважуються на одній, цілком
            певній гучності — це і є граничний цикл. Що сильніше тиснути смичком (μ), то менше схожий звук на чисту синусоїду: струна довго «липне» до
            смичка, а потім різко зривається. Так само скриплять двері й співає келих під мокрим пальцем.
          </>
        }
        mapping={[
          ["відхилення струни", <>u(t)</>],
          ["натиск смичка (нелінійне тертя)", <>μ</>],
          ["смичок підкачує, поки |u| < 1", <>від&apos;ємне тертя −μ(1 − u²) &lt; 0</>],
          ["стала гучність, хоч як смикни", <>граничний цикл з амплітудою ≈ 2</>],
          ["«липне — зривається»", <>релаксаційні коливання при μ ≫ 1 (жорсткість)</>],
        ]}
      >
        <VdpViolinScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Лампа, що сама себе розгойдує" simpleTitle="Струна (чи лампа), що сама себе розгойдує">
        <Grid>
          <Card title="Рівняння з методички" icon="📜">
            <Tex block>{String.raw`u'' + \omega^2 u = \mu\,(1-u^2)\,u'`}</Tex>
            <p className="text-[14px] text-white/70">Як систему першого порядку (<Tex>{"v = u'"}</Tex>):</p>
            <Tex block>{String.raw`\begin{cases} u' = v,\\ v' = \mu(1-u^2)\,v - \omega^2 u, \end{cases}\qquad u(0)=1,\ \ v(0)=2,\ \ \omega = 0.64.`}</Tex>
            <Say
              simple={
                <p className="mt-1 text-[14px] leading-relaxed text-white/70">
                  Стартуємо з u(0) = 1 і швидкістю u′(0) = 2 («2u(0) = u′(0) = 2» в умові). Частина 1 — шість значень μ від 0.1 до 2 і їхні траєкторії на
                  одному рисунку. Частина 2 — відрізки [0, 10], [0, 20], [0, 40] при більшому μ.
                </p>
              }
            >
            <p className="mt-1 text-[14px] leading-relaxed text-white/70">
              Умова «<Tex>{"2u(0) = u'(0) = 2"}</Tex>» означає <Tex>{"u(0)=1,\\ u'(0)=2"}</Tex>. Частина 1: <Tex>{"\\mu = 0.1,\\,0.2,\\,0.5,\\,1,\\,1.5,\\,2"}</Tex>{" "}
              — фазові траєкторії на одному рисунку. Частина 2: відрізки <Tex>{"[0,a]"}</Tex>, <Tex>{"a = 10,\\,20,\\,40"}</Tex>.
            </p>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                  Балтазар ван дер Поль (1920-ті, Philips) так описував ламповий генератор — електричний «смичок»: поки коливання малі (|u| &lt; 1), лампа{" "}
                  <b>підкачує</b> енергію, коли великі — <b>гальмує</b>. У підсумку для будь-якого μ &gt; 0 коливання сходяться до однієї доріжки з розмахом ≈ 2 —
                  граничного циклу.
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/70">
              Балтазар ван дер Поль (1920-ті, Philips) описував так ламповий генератор: при <Tex>{"|u|<1"}</Tex> «тертя» <Tex>{"-\\mu(1-u^2)"}</Tex>{" "}
              від&apos;ємне — лампа <b>підкачує</b> енергію; при <Tex>{"|u|>1"}</Tex> — гальмує. Баланс дає <b>граничний цикл</b> з амплітудою ≈ 2 для
              будь-якого <Tex>{"\\mu>0"}</Tex>.
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="Де параметр ε?"
                simple={
                  <>
                    Частина 2 просить розв&apos;язки «для ε = 0.5, 1.0, 2.0», але літери ε у рівнянні немає. Найправдоподібніше — це той самий «натиск смичка» μ.
                    Тож даємо пресети μ = 0.5, 1, 2 і окремо μ = 5 (усі з ω = 0.64), а повзунок μ — аж до 1000, щоб відчути справжню жорсткість.
                  </>
                }
              >
                Частина 2 просить розв&apos;язки «для значень параметра ε = 0.5, 1.0, 2.0» при <Tex>{"\\mu = 5"}</Tex>, але ε у рівнянні немає. Трактуємо так:
                ε — це той самий коефіцієнт нелінійного тертя, тож пресети <Tex>{"\\mu \\in \\{0.5,\\,1,\\,2\\}"}</Tex> та окремо <Tex>{"\\mu = 5"}</Tex> (усі —
                з <Tex>{"\\omega = 0.64"}</Tex>). А щоб відчути справжню жорсткість, слайдер <Tex>{"\\mu"}</Tex> сягає 1000.
              </Insight>
            </div>
          </Card>
          <Card title="Звідки жорсткість" icon="🔬">
            <Tex block>{String.raw`J = \begin{pmatrix}0 & 1\\ -2\mu u v - \omega^2 & \mu(1-u^2)\end{pmatrix},\qquad \operatorname{tr}J = \mu(1-u^2)`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Коли струна «липне» до смичка (|u| ≈ 2), відхилення від доріжки гасне дуже швидко — у темпі ≈ 3μ, а сама доріжка проповзає повільно, за
                  час ~μ/ω². Що більший μ, то більша різниця темпів: вона росте як μ², і при μ = 1000 це мільйони — класична жорсткість.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              На повільних ділянках циклу <Tex>{"|u|\\approx 2"}</Tex>, тож одне власне число <Tex>{"\\lambda_{fast} \\approx \\mu(1-u^2) \\approx -3\\mu"}</Tex>, а
              повільний рух уздовж кривої <Tex>{"v = \\omega^2 u/(\\mu(1-u^2))"}</Tex> має масштаб <Tex>{"\\sim \\mu/\\omega^2"}</Tex>. Коефіцієнт жорсткості росте
              як <Tex>{"\\mu^2"}</Tex>: при <Tex>{"\\mu = 1000"}</Tex> це мільйони.
            </p>
            </Say>
            <Tex block>{String.raw`T_{\text{цикл}} \approx \begin{cases} 2\pi/\omega, & \mu \ll 1,\\[2pt] (3 - 2\ln 2)\,\mu/\omega^2, & \mu \gg 1. \end{cases}`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  При малих μ — майже синусоїда з періодом 2π/ω ≈ 9.8, при великих — <b>ривки</b>: довге повзання і миттєвий зрив. Явні методи мусять крокувати
                  дрібніше за ~2/(3μ) (Ейлер) чи ~2.8/(3μ) (RK4) навіть там, де струна майже стоїть.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              При малих <Tex>{"\\mu"}</Tex> — майже синусоїда, при великих — <b>релаксаційні коливання</b>: довге повзання і миттєвий стрибок. Явні методи
              мусять тримати <Tex>{"h \\lesssim 2/(3\\mu)"}</Tex> (Ейлер) чи <Tex>{"h \\lesssim 2.8/(3\\mu)"}</Tex> (RK4) навіть там, де розв&apos;язок майже не
              змінюється.
            </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Частина 1" title="Сімейство граничних циклів, ω = 0.64" simpleTitle="Шість натисків смичка — одна гучність">
        <Grid>
          <Card>
            <Plot
              title="Фазові траєкторії (u, u′) з векторним полем"
              height={360}
              xLabel="u"
              yLabel="u′"
              sorted={false}
              xDomain={[-3, 3]}
              yDomain={[-3.2, 3.2]}
              underlay={(ctx, tr) =>
                drawArrowField(ctx, tr, (u, v) => [v, field1 * (1 - u * u) * v - W0 * W0 * u], { nx: 20, ny: 14 })
              }
              markers={[{ x: 1, y: 2, color: "#ffffff", r: 4 }]}
              series={family.map(({ mu, s }, i) => ({
                x: comp(s, 0),
                y: comp(s, 1),
                color: MU1_COLORS[i],
                label: `μ=${mu}`,
                width: field1 === mu ? 2.2 : 1.3,
                opacity: field1 === mu ? 1 : 0.65,
                fade: true,
              }))}
            />
            <div className="mt-3">
              <Chips label="Векторне поле для μ =" value={field1} onChange={setField1} options={MU1.map((m) => ({ value: m, label: String(m) }))} />
            </div>
          </Card>
          <Card>
            <Plot
              title="u(t) для всіх μ"
              height={300}
              xLabel="t"
              xDomain={[0, 60]}
              yDomain={[-3, 3]}
              series={family.map(({ mu, s }, i) => ({ x: s.t, y: comp(s, 0), color: MU1_COLORS[i], label: `μ=${mu}`, width: 1.4 }))}
            />
            <div className="mt-3">
              <Table
                head={["μ", "Період (вимір.)", "2π/ω", "max|u| на циклі"]}
                rows={family.map(({ mu, P, amp }, i) => [
                  <span key={mu} style={{ color: MU1_COLORS[i] }}>
                    {mu}
                  </span>,
                  fmt(P, 4),
                  fmt((2 * Math.PI) / W0, 4),
                  fmt(amp, 4),
                ])}
              />
              <Say simple={<p className="mt-2 text-[12px] text-white/45">Період і розмах виміряно наприкінці довгого розрахунку [0, 120], коли струна вже вийшла на свою доріжку.</p>}>
                <p className="mt-2 text-[12px] text-white/45">Період і амплітуда виміряні на останній чверті відрізка [0, 120] (DOPRI, rtol 10⁻⁸).</p>
              </Say>
            </div>
          </Card>
        </Grid>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Insight
            tone="info"
            title="Усі дороги ведуть до циклу"
            simple={
              <>
                {famOut.length > 0 && (
                  <>
                    При слабкому натиску (μ = {muList(famOut)}) старт (біла точка) — <i>зовні</i> доріжки: струну смикнули сильніше, ніж вона звучить сама, і
                    коливання поступово стихають до своєї гучності.{" "}
                  </>
                )}
                {famIn.length > 0 && (
                  <>
                    {famOut.length > 0 ? "При сильнішому" : "При цих натисках"} (μ = {muList(famIn)}) доріжка розтягується, і той самий старт опиняється{" "}
                    <i>всередині</i> — коливання, навпаки, розгойдуються.{" "}
                  </>
                )}
                {famOut.length > 0 && famIn.length > 0 ? "І так, і так струна" : "Струна"} виходить на свою доріжку, і що слабший натиск μ, то повільніше: при μ ={" "}
                {slow.mu} — приблизно за {fmt(slow.settle / slow.P, 2)} коливання. А сама гучність (розмах ≈ 2) однакова для всіх μ: її задає лише баланс
                «підкачка при |u| &lt; 1 — гальмування при |u| &gt; 1».
              </>
            }
          >
            Траєкторія стартує з точки (1, 2) (біла).{" "}
            {famOut.length > 0 && (
              <>
                При μ = {muList(famOut)} вона лежить <i>зовні</i> циклу: тут цикл близький до еліпса з піввіссю по u′ лише 2ω ≈ 1.28 (max|u′| на циклі{" "}
                {vRange(famOut)}), а u′(0) = 2, тож траєкторія скручується досередини.{" "}
              </>
            )}
            {famIn.length > 0 && (
              <>
                При μ = {muList(famIn)} цикл уже витягнутий по u′ (max|u′| = {vRange(famIn)}), і старт лежить <i>всередині</i> — траєкторія розкручується
                назовні.{" "}
              </>
            )}
            Що менше μ, то повільніше притягання (при малих μ відхилення від циклу гасне як e<sup>−μt</sup>): при μ = {slow.mu} воно падає до 1 % (на
            перетині u = 0) за t ≈ {fmt(slow.settle, 3)}, тобто ≈ {fmt(slow.settle / slow.P, 2)} періоду. Амплітуда граничного циклу ≈ 2 при всіх μ: вона
            визначається лише балансом підкачки (|u| &lt; 1) і гальмування (|u| &gt; 1).
          </Insight>
          <Insight
            tone="good"
            title="Форма і період"
            simple={
              <>
                При μ = 0.1 доріжка — майже еліпс, а період ≈ 2π/ω ≈ 9.82 (чиста синусоїда). Що сильніший натиск, то більше доріжка вигинається в «S», а
                коливання повільнішають: {fmt(family[5]?.P ?? NaN, 3)} при μ = 2 — нижчий звук.
              </>
            }
          >
            При μ = 0.1 цикл майже еліпс з півосями 2 та 2ω ≈ 1.28, період ≈ 2π/ω ≈ 9.82. Зі зростанням μ цикл деформується в «S»-подібний, а період
            збільшується: {fmt(family[5]?.P ?? NaN, 3)} при μ = 2.
          </Insight>
        </div>
      </Section>

      <Section kicker="Частина 2 · Лабораторія" title="Від синусоїди до релаксаційних стрибків" simpleTitle="Від плавного співу до ривків">
        <Lab
          controls={
            <>
              <Chips
                label="Відрізок [0, a]"
                value={aSel}
                onChange={setASel}
                options={[
                  { value: 10, label: "a = 10" },
                  { value: 20, label: "a = 20" },
                  { value: 40, label: "a = 40" },
                  { value: 0, label: "2 періоди" },
                ]}
              />
              <Chips
                label="μ (ε з умови) та μ = 5"
                value={[0.5, 1, 2, 5, 100, 1000].includes(mu) ? mu : -1}
                onChange={(v) => v > 0 && setMu(v)}
                options={[0.5, 1, 2, 5, 100, 1000].map((v) => ({ value: v, label: `μ = ${v}` }))}
              />
              <Slider label="μ (лог.)" value={mu} onChange={setMu} min={0.1} max={1000} log />
              <Slider label="ω" value={w} onChange={setW} min={0.2} max={2} step={0.01} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Slider label="Крок h (фіксовані методи)" value={h} onChange={setH} min={0.0005} max={0.5} log hint="DOPRI: rtol 10⁻⁶ · Розенброк: rtol 10⁻⁴" />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Tex>{`T = ${fmt(T, 4)}`}</Tex>, <Tex>{`|\\lambda|_{max} \\approx ${fmt(stiff.fast, 3)}`}</Tex>. Межа явного Ейлера:{" "}
                <Tex>{`h < ${fmt(2 / Math.max(stiff.fast, 1e-9), 3)}`}</Tex>.
                {hFixedNote && <div className="mt-1 text-[#ffb547]">Фіксовані методи: неявні з кроком ≥ T/20000, явні ≥ T/100000, щоб не рахувати вічно.</div>}
              </div>

            </>
          }
        >
          <Playground sols={sols} ref0={ref} mu={dMu} w={dW} T={T} />
          <Grid>
            <Card>
              <Plot
                title="Крок h(t) (лог. шкала)"
                height={240}
                xLabel="t"
                logY
                series={sols.map(({ m, s }) => ({ x: s.t.slice(1), y: s.hs, color: METHODS[m].color, label: METHODS[m].short, width: 1.3 }))}
              />
            </Card>
            <Card>
              <Plot
                title="Похибка |u − u_еталон| (лог. шкала)"
                height={240}
                xLabel="t"
                logY
                yDomain={[1e-10, 10]}
                series={sols.map(({ m, errT, errY }) => ({ x: errT, y: errY, color: METHODS[m].color, label: METHODS[m].short, width: 1.2 }))}
              />
            </Card>
          </Grid>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Період циклу" value={Number.isFinite(period) ? fmt(period, 4) : "—"} sub={Number.isFinite(period) ? `оцінка ${fmt(periodGuess(dMu, dW), 4)}` : "збільшіть відрізок"} />
            <Stat label="Амплітуда" value={fmt(amp, 4)} sub="max|u| на 2-й половині відрізка" />
            <Stat label="max |λ| якобіана" value={fmt(stiff.fast, 3)} sub={Number.isFinite(stiffRatio) ? `жорсткість |λ|max·T/2π ≈ ${fmt(stiffRatio, 2)}` : "вздовж еталона"} tone={stiff.fast > 100 ? "warn" : "default"} />
            <Stat label="Еталон" value={`${ref.steps} кр.`} sub={refDopri ? "DOPRI, rtol 10⁻¹¹" : "Розенброк, rtol 10⁻⁷"} />
            {sols.map(({ m, s, err }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : fmt(err, 3)}
                sub={s.failed ? s.failed : `max похибка · ${s.steps} кр.${s.rejected ? ` · ${s.rejected} відх.` : ""} · ${fmtMs(s.ms)}`}
                tone={s.failed || err > 1 ? "bad" : err > 0.05 ? "warn" : "good"}
              />
            ))}
          </div>
          {eul?.s.failed && (
            <Insight
              tone="bad"
              title="Явний Ейлер вибухнув"
              simple={
                <>
                  Крок {fmt(eul.s.hs[0], 3)} задовгий: найшвидший процес тут має темп ≈ {fmt(stiff.fast, 3)}, і за один крок Ейлер «перелітає» правильне значення
                  так далеко, що відхилення не зменшується, а росте (h·|λ| = {fmt(eul.s.hs[0] * stiff.fast, 3)} &gt; 2). Кожен крок розгойдує похибку ще дужче. Для μ = {fmt(dMu, 3)} треба
                  h &lt; {fmt(2 / stiff.fast, 2)}.
                </>
              }
            >
              h·|λ|max = {fmt(eul.s.hs[0] * stiff.fast, 3)} &gt; 2 — поза областю стійкості. Для μ = {fmt(dMu, 3)} йому потрібен h &lt; {fmt(2 / stiff.fast, 2)}.
            </Insight>
          )}
          {dop && ros && dMu >= 30 && (
            <Insight
              tone="warn"
              title={`DOPRI: ${dop.s.steps} кроків проти ${ros.s.steps} у Розенброка`}
              simple={
                <>
                  Явний DOPRI змушений дріботіти кроком ~{fmt(median(dop.s.hs), 2)} — не через точність, а щоб не вибухнути. Розенброк (неявний) на повільних
                  ділянках розганяється до кроку {fmt(Math.max(...ros.s.hs), 3)}. Різниця: у {fmt(dop.s.steps / ros.s.steps, 2)} раза більше кроків у DOPRI.{" "}
                  <Relatable kind="steps" n={dop.s.steps} />
                  {dop.s.failed ? " DOPRI навіть не дійшов до кінця — вичерпав ліміт кроків!" : ""}
                </>
              }
            >
              Явний DOPRI змушений ходити кроком ~{fmt(median(dop.s.hs), 2)} — це межа стійкості ≈ 3.3/|λ| = {fmt(3.3 / stiff.fast, 2)}, а не вимога
              точності. Розенброк L-стійкий: на повільних ділянках його крок росте до {fmt(Math.max(...ros.s.hs), 3)}.
              {dop.s.failed ? " DOPRI навіть не дійшов до кінця — вичерпав ліміт кроків!" : ""}
            </Insight>
          )}
          {dMu < 0.6 && (
            <Insight
              tone="good"
              title="Майже гармонічні коливання"
              simpleTitle="Чиста нота"
              simple={
                <>
                  При μ = {fmt(dMu, 2)} натиск слабкий, струна співає майже синусоїду з періодом ≈ 2π/ω = {fmt((2 * Math.PI) / dW, 4)}. Жорсткості нема — усі
                  методи справляються, найекономніший DOPRI.
                </>
              }
            >
              При μ = {fmt(dMu, 2)} задача зовсім не жорстка: всі методи працюють, DOPRI найекономніший. Період ≈ 2π/ω = {fmt((2 * Math.PI) / dW, 4)}.
            </Insight>
          )}
          {rescued.length > 0 && (
            <Insight
              tone="info"
              title="Ньютон спіткнувся біля точки зриву"
              simple={
                <>
                  {rescued.map((x) => METHODS[x.m].short).join(", ")}: у момент зриву (u ≈ ±1) неявному методу треба знайти точку, де струна опиниться після
                  кроку, — а поблизу такої точки просто немає, струна «стрибає». Ми допомагаємо методом Ньютона з обережними кроками, а якщо й це не вдається —
                  дробимо крок (лічильник «відх.»). Тому для таких ривків на практиці беруть адаптивні неявні методи.
                </>
              }
            >
              {rescued.map((x) => METHODS[x.m].short).join(", ")}: у точці складки повільної кривої (u ≈ ±1) неявне рівняння кроку не має розв&apos;язку
              поблизу попереднього — система має «стрибнути». Ми розв&apos;язуємо його повним методом Ньютона з демпфуванням, а при невдачі дробимо крок
              (лічильник «відх.»). Саме тому на практиці для релаксаційних коливань беруть адаптивні неявні методи.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Результати" title="Ціна жорсткості: кроки на [0, 40], ω = 0.64" simpleTitle="Скільки кроків коштує сильний натиск">
        <Card>
          <Table
            head={["μ", "DOPRI45: кроки (відх.)", "час", "Розенброк: кроки (відх.)", "час", "DOPRI / Розенброк"]}
            rows={table.map(({ mu: m, d, r }) => [
              <button key={m} onClick={() => setMu(m)} className="text-[var(--accent)] hover:underline">
                {m}
              </button>,
              <span key="d" className={d.failed ? "text-[#ff5d73]" : ""}>
                {d.steps} ({d.rejected})
              </span>,
              fmtMs(d.ms),
              `${r.steps} (${r.rejected})`,
              fmtMs(r.ms),
              <span key="q" className={d.steps / r.steps > 3 ? "text-[#ff5d73]" : d.steps < r.steps ? "text-[#3ee6a8]" : ""}>
                {fmt(d.steps / r.steps, 3)}×
              </span>,
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Поки натиск слабкий, явний DOPRI економніший. Після μ ≈ 10 — навпаки: DOPRI мусить дріботіти (кроків ∝ μ), а неявному Розенброку однаково.
                При μ = 1000 це {table[5].d.steps} кроків проти {table[5].r.steps}. <Relatable kind="steps" n={table[5].d.steps} />
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            При малих μ явний DOPRI (5-й порядок) економніший за Розенброка (2-й порядок). Після μ ≈ 10 картина перевертається: кількість кроків DOPRI
            росте ∝ μ, а Розенброка — майже не залежить від μ. Це і є «жорсткість» у чистому вигляді.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково (μ = 5)" report={false}>
        <StepDebugger
          f={DBG_F}
          y0={DBG_Y0}
          T={30}
          view={DBG_VIEW}
          h0={0.25}
          hMin={0.005}
          hMax={0.5}
          hPresets={[0.25, 0.1, 0.05]}
          hPresetsLabel="Швидкі кроки"
          hint={
            <Say
              simple={
                <>
                  Площина (u, u′) при μ = 5. Широка сіра смуга — точний шлях струни (він швидко лягає на граничний цикл). Спробуйте явного Ейлера з h = 0.25:
                  уже з другого-третього кроку він перестрибує цей шлях туди-сюди, стрибки ростуть: на 5-му кроці точка вилітає за межі графіка, на 9-му —
                  вибух. RK4 з тим самим кроком протримається довше, але теж вибухне (на 25-му кроці). Трапеції, θ-метод і BDF2 спокійно дійдуть до кінця —
                  подивіться, скільки спроб Ньютона їм треба біля точок зриву. А неявний Ейлер з h = 0.25 на 15-му кроці (з t = 3.5) впреться саме в точку зриву: там
                  рівняння кроку не має розв&apos;язку поблизу (з h = 0.1 він пройде).
                </>
              }
            >
              Рівняння ван дер Поля з μ = 5, ω = 0.64, старт (1, 2). На повільних гілках λ ≈ −3μ = −15: при h = 0.25 маємо h|λ| ≈ 3.75 — поза областю
              стійкості і явного Ейлера (2), і RK4 (≈ 2.785). Перевірка: явний Ейлер вибухає на 9-му кроці (t = 2.25), RK4 — на 25-му (t = 6.25). Для неявних
              методів видно ітерації Ньютона, особливо біля складок u = ±1; у неявного Ейлера з h = 0.25 біля складки (t = 3.5) рівняння кроку взагалі
              втрачає корінь поблизу yₙ — Ньютон не збігається (з h = 0.1 проходить увесь відрізок).
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Смикніть струну будь-де — вона все одно заспіває свою ноту" report={false}>
        <div className="mb-3">
          <Chips label="Натиск смичка μ" value={pgMu} onChange={setPgMu} options={PG_MU.map((m) => ({ value: m, label: `μ = ${m}` }))} />
        </div>
        <PhasePlayground
          f={pgF}
          init={pgInit}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={{ x: [-3, 3], y: [-PG_V[pgMu], PG_V[pgMu]] }}
          speed={8}
          speedRange={[0.5, 40]}
          trail={40}
          strip={[{ comp: 0, label: "u", color: "#7cf29c" }]}
          window={60}
          kicks={[
            { label: "Смикнути", emoji: "🎻", apply: (y) => [y[0], y[1] + 2], hint: "u′ += 2" },
            { label: "Притиснути пальцем", emoji: "✋", apply: (y) => [y[0], 0], hint: "u′ = 0" },
            { label: "Майже тиша", emoji: "🤫", apply: () => [0.01, 0], hint: "u = 0.01, u′ = 0" },
          ]}
          underlay={(ctx, { X, Y }) => {
            ctx.setLineDash([3, 4]);
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            pgCycle.u.forEach((u, k) => (k ? ctx.lineTo(X(u), Y(pgCycle.v[k])) : ctx.moveTo(X(u), Y(pgCycle.v[k]))));
            ctx.stroke();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = "rgba(255,181,71,0.6)";
            ctx.lineWidth = 1.4;
            for (const [a, b] of [
              [-3, -1.002],
              [-0.998, 0.998],
              [1.002, 3],
            ]) {
              ctx.beginPath();
              let started = false;
              for (let k = 0; k <= 160; k++) {
                const u = a + ((b - a) * k) / 160;
                const v = (W0 * W0 * u) / (pgMu * (1 - u * u));
                if (Math.abs(v) > 2 * PG_V[pgMu]) {
                  started = false;
                  continue;
                }
                if (started) ctx.lineTo(X(u), Y(v));
                else {
                  ctx.moveTo(X(u), Y(v));
                  started = true;
                }
              }
              ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.fillStyle = "#ff5d73";
            ctx.beginPath();
            ctx.arc(X(0), Y(0), 4.5, 0, Math.PI * 2);
            ctx.fill();
          }}
          hint={
            <Say
              simple={
                <>
                  Клацніть будь-де: хоч ледь торкніться струни, хоч смикніть щосили — вона вийде на ту саму білу пунктирну доріжку (граничний цикл). Червона
                  точка в центрі — тиша, але нестійка: кнопка «Майже тиша» ставить струну за крок від неї, і смичок сам її розгойдує. Помаранчевий пунктир —
                  де прискорення струни дорівнює нулю.
                </>
              }
            >
              Фазова площина (u, u′) рівняння ван дер Поля з ω = 0.64 і вибраним μ; інтегрування — Розенброк у реальному часі. Біла пунктирна — граничний
              цикл (притягує всі траєкторії, крім рівноваги), помаранчева — нульклина v′ = 0: v = ω²u/(μ(1 − u²)), червона точка — нестійкий фокус/вузол (0, 0).
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="14"
          questions={[
            {
              id: "euler",
              q: <>μ = 5, відрізок [0, 40]. Явний Ейлер із фіксованим кроком h = 0.25. Що буде?</>,
              options: ["Дорахує, лише трохи неточно", "Вибухне за кілька кроків", "Застигне в нулі", "Повільно відстане по фазі, але не вибухне"],
              correct: 1,
              explain: (
                <>
                  На повільних гілках λ ≈ μ(1 − u²) ≈ −3μ = −15, тож h|λ| ≈ 3.75 &gt; 2 — поза кругом стійкості |1 + hλ| ≤ 1. Перевірка: розв&apos;язок
                  перевищує поріг 10⁶ уже при t = 2.25 (9-й крок).
                </>
              ),
              explainSimple: <>Відхилення від шляху струни тут гаснуть у темпі ≈ 15 за одиницю часу, і для такого темпу крок 0.25 завеликий: Ейлер перестрибує і розгойдується. Вибух — на 9-му кроці.</>,
              show: {
                label: "Показати μ = 5, h = 0.25",
                run: () => {
                  setMu(5);
                  setW(W0);
                  setASel(40);
                  setH(0.25);
                  setMethods((m) => (m.includes("euler") ? m : ["euler", ...m]));
                },
              },
            },
            {
              id: "cost",
              q: <>μ = 100, відрізок [0, 40]. У скільки разів більше кроків зробить явний DOPRI (rtol 10⁻⁶), ніж неявний Розенброк (rtol 10⁻⁴)?</>,
              options: ["Приблизно однаково", "Майже в 9 разів більше", "У 9 разів менше — DOPRI ж 5-го порядку", "DOPRI взагалі не дорахує"],
              correct: 1,
              explain: (
                <>
                  Перевірка: DOPRI — {table[4].d.steps} кроків, Розенброк — {table[4].r.steps} ({fmt(table[4].d.steps / table[4].r.steps, 3)}×). Крок DOPRI
                  обмежує стійкість (≈ 3.3/|λ|, |λ| ≈ 3μ), а не точність; L-стійкий Розенброк розганяє крок на повільних гілках. При μ = 1000 різниця — уже{" "}
                  {fmt(table[5].d.steps / table[5].r.steps, 3)}×.
                </>
              ),
              explainSimple: (
                <>
                  DOPRI робить {table[4].d.steps} кроків, Розенброк — {table[4].r.steps}. Явному методу заважає не точність, а страх «вибухнути», тож він дріботить
                  навіть там, де струна ледве повзе.
                </>
              ),
              show: {
                label: "Показати μ = 100",
                run: () => {
                  setMu(100);
                  setW(W0);
                  setASel(40);
                  setMethods((m) => [...m.filter((x) => x !== "dopri" && x !== "ros"), "dopri", "ros"]);
                },
              },
            },
            {
              id: "amp",
              q: <>А якою буде амплітуда граничного циклу при μ = 100 (ω = 0.64)?</>,
              options: ["≈ 0.02 — сильне тертя все гасить", "≈ 2, як і при малих μ", "≈ 200 — сильна підкачка", "Зростатиме без меж"],
              correct: 1,
              explain: (
                <>
                  Амплітуду задає баланс енергії за цикл (підкачка при |u| &lt; 1, гальмування при |u| &gt; 1), і для будь-якого μ він дає max|u| ≈ 2.
                  Перевірка (Розенброк): max|u| ≈ 2.001 при μ = 100 і ≈ 2.000 при μ = 1000. Змінюються лише форма і період (≈ (3 − 2 ln 2)μ/ω²).
                </>
              ),
              explainSimple: <>Скільки б не тиснути смичком, «гучність» та сама: розмах ≈ 2. Сильніший натиск змінює лише тембр (ривки) і висоту (нижча нота).</>,
              show: {
                label: "Показати μ = 100, 2 періоди",
                run: () => {
                  setMu(100);
                  setW(W0);
                  setASel(0);
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
            title="Граничний цикл — властивість рівняння"
            simpleTitle="Своя нота за будь-якого старту"
            simple={
              <>
                Хоч як смикни струну (аби не залишити її в ідеальній тиші), вона вийде на ту саму «гучність» — розмах ≈ 2. Слабкий натиск дає чисту
                синусоїду з частотою ω, сильний — ривки з довгим періодом ≈ (3 − 2 ln 2)μ/ω².
              </>
            }
          >
            Незалежно від μ і початкових умов (крім рівноваги в нулі) траєкторії притягуються до одного циклу з амплітудою ≈ 2. При μ → 0 це гармонічні
            коливання з частотою ω, при μ → ∞ — релаксаційні з періодом ≈ (3 − 2 ln 2)μ/ω².
          </Insight>
          <Insight
            tone="warn"
            title="Жорсткість вмикається поступово"
            simple={
              <>
                До μ ≈ 2 задача спокійна. З μ ≳ 50 явні методи вже бояться вибухнути: коли струна «липне», відхилення гаснуть у темпі ≈ 3μ, і кроки DOPRI
                дрібнішають пропорційно до 1/μ.
              </>
            }
          >
            При μ ≲ 2 задача нежорстка, а при μ ≳ 50 явні методи впираються в стійкість: на повільних гілках власне число ≈ −3μ, і кроки DOPRI
            дрібнішають пропорційно до 1/μ.
          </Insight>
          <Insight
            tone="good"
            title="Що обрати"
            simple={
              <>
                Натиск до ~10 — беріть DOPRI чи RK4. Сильний — неявні методи, що самі підбирають крок (Розенброк, BDF): сотні кроків там, де явним треба десятки
                тисяч, і дрібний крок лише в момент ривка.
              </>
            }
          >
            Для μ ≤ 10 — DOPRI/RK4. Для великих μ — L-стійкі адаптивні неявні методи (Розенброк, BDF): вони роблять сотні кроків там, де явні —
            десятки тисяч, і автоматично зменшують крок лише на стрибках.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                1927 року ван дер Поль і ван дер Марк почули у своєму генераторі «нерегулярний шум» і списали його на перешкоди. Сьогодні ми знаємо: це був один
                із перших помічених проявів хаосу (задача №16). А рівняння ван дер Поля описує серцебиття, світлячків і скрип дверей.
              </>
            }
          >
            Ван дер Поль і ван дер Марк у 1927-му почули в навушниках свого генератора «нерегулярний шум» при деяких частотах зовнішньої сили — і
            відмахнулися від нього як від перешкод. Сьогодні ми знаємо, що це був один із перших експериментально спостережених проявів детермінованого
            хаосу (див. задачу №16). А рівняння ван дер Поля моделює серцебиття, вогонь світлячків і навіть скрип дверей.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function Playground({ sols, ref0, mu, w, T }: { sols: { m: MethodId; s: Solution; err: number }[]; ref0: Solution; mu: number; w: number; T: number }) {
  const pb = usePlayback(16);
  const time = pb.progress * T;
  const scale = mu > 3 ? 1 / mu : 1;
  const data = useMemo(() => {
    const u = comp(ref0, 0);
    const v = comp(ref0, 1);
    let vMax = 0;
    for (const x of v) vMax = Math.max(vMax, Math.abs(x));
    const timeSeries: Series[] = [
      { x: ref0.t, y: u, color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
      ...sols.map(({ m, s, err }) => ({
        x: s.t,
        y: comp(s, 0),
        color: METHODS[m].color,
        label: METHODS[m].short,
        width: s.failed || err > 1 ? 1 : 1.6,
        opacity: s.failed || err > 1 ? 0.45 : 1,
      })),
    ];
    const phase: Series[] = [
      { x: u, y: v.map((x) => x * scale), color: "#ffffff", label: "еталон", width: 4, opacity: 0.25 },
      ...sols.map(({ m, s, err }) => ({
        x: comp(s, 0),
        y: comp(s, 1).map((x) => x * scale),
        color: METHODS[m].color,
        label: METHODS[m].short,
        width: s.failed || err > 1 ? 1 : 1.4,
        opacity: s.failed || err > 1 ? 0.45 : 0.9,
      })),
    ];
    const vs = v.map((x) => x * scale);
    const vLim = Math.max(...vs.map(Math.abs)) * 1.15 || 1;
    return { u, v, vMax, timeSeries, phase, vLim };
  }, [ref0, sols, scale]);

  const i = indexAt(ref0.t, time);
  const cu = data.u[i] ?? 0;
  const cv = (data.v[i] ?? 0) * scale;

  return (
    <>
      <Card title="Сцена: ламповий генератор" icon="📻">
        <TubeOscillatorScene t={ref0.t} u={data.u} v={data.v} time={time} mu={mu} vMax={data.vMax} />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${time.toFixed(1)}`} />
        </div>
      </Card>
      <Card>
        <Plot title="u(t)" height={260} xLabel="t" cursorX={time} yDomain={[-3, 3]} series={data.timeSeries} />
      </Card>
      <Card>
        <Plot
          title={mu > 3 ? "Фазовий портрет (u, u′/μ)" : "Фазовий портрет (u, u′)"}
          height={320}
          xLabel="u"
          yLabel={mu > 3 ? "u′/μ" : "u′"}
          sorted={false}
          xDomain={[-3, 3]}
          yDomain={[-data.vLim, data.vLim]}
          markers={[{ x: cu, y: cv, color: "#ffffff" }]}
          underlay={(ctx, tr) => {
            drawArrowField(ctx, tr, (u, y) => {
              const v = y / scale;
              return [v, (mu * (1 - u * u) * v - w * w * u) * scale];
            });
            ctx.strokeStyle = "rgba(255,181,71,0.55)";
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1.4;
            for (const [a, b] of [
              [-3, -1.0005],
              [-0.9995, 0.9995],
              [1.0005, 3],
            ]) {
              ctx.beginPath();
              let started = false;
              for (let k = 0; k <= 200; k++) {
                const u = a + ((b - a) * k) / 200;
                const y = ((w * w * u) / (mu * (1 - u * u))) * scale;
                const px = tr.X(u),
                  py = tr.Y(y);
                if (!Number.isFinite(py) || Math.abs(py) > 5000) {
                  started = false;
                  continue;
                }
                if (!started) {
                  ctx.moveTo(px, py);
                  started = true;
                } else ctx.lineTo(px, py);
              }
              ctx.stroke();
            }
            ctx.setLineDash([]);
          }}
          series={data.phase}
        />
        <Say
          simple={
            <p className="mt-2 text-[12.5px] text-white/55">
              Помаранчевий пунктир — де прискорення струни дорівнює нулю. При великому μ точка довго повзе вздовж його зовнішніх гілок (струна «липне» до
              смичка), а біля u = ±1, де пунктир тікає в нескінченність, миттєво зривається на протилежний бік.
            </p>
          }
        >
        <p className="mt-2 text-[12.5px] text-white/55">
          Помаранчевий пунктир — нульклина <Tex>{"v' = 0"}</Tex>: <Tex>{String.raw`v = \omega^2 u / (\mu(1-u^2))`}</Tex>. При великому μ траєкторія повзе
          вздовж її зовнішніх гілок (|u| &gt; 1 — повільний многовид), а біля <Tex>{"u=\\pm1"}</Tex>, де нульклина йде у нескінченність (у площині Льєнара
          це «коліна» кубіки), миттєво зривається на протилежну гілку.
        </p>
        </Say>
      </Card>
    </>
  );
}
