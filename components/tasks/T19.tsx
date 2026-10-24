"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot, { type Series } from "@/components/plot/Plot";
import StabilityExplorer, { amp } from "@/components/plot/StabilityExplorer";
import SpringMountScene from "@/components/scenes/SpringMountScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, denseOutput, indexAt, sampleAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import DuffingWasherScene from "@/components/analogy/DuffingWasherScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "dopri", "ros"];
const H_LIST = [0.02, 0.01, 0.005, 0.002];
const TABLE_M: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];

interface Par {
  m: number;
  c: number;
  k: number;
  d: number;
  u0: number;
}

const BOOK: Par = { m: 0.01, c: 0.15, k: 2, d: 2, u0: 10 };
// debugger / sandbox: the parameters of the assignment; stable references
const BOOK_F = (_t: number, y: number[]) => [y[1], -(0.15 * y[1] + 2 * y[0] + 2 * y[0] ** 3) / 0.01];
const BOOK_Y0 = [10, 0];
const DBG_VIEW = { x: 0, y: 1, xLabel: "u", yLabel: "u′", xDomain: [-14, 14] as [number, number], yDomain: [-2500, 2500] as [number, number] };
const PG_DOMAIN = { x: [-12, 12] as [number, number], y: [-1300, 1300] as [number, number] };
const PG_LABELS: [string, string] = ["u", "u′"];
const PG_LEVELS = [10, 7, 4, 2].map((u) => 0.5 * 2 * u * u + 0.25 * 2 * u ** 4);

const duffing = (p: Par, T: number): Problem => ({
  f: (_t, y) => [y[1], -(p.c * y[1] + p.k * y[0] + p.d * y[0] * y[0] * y[0]) / p.m],
  jac: (_t, y) => [
    [0, 1],
    [-(p.k + 3 * p.d * y[0] * y[0]) / p.m, -p.c / p.m],
  ],
  y0: [p.u0, 0],
  T,
});

const energy = (p: Par, y: number[]) => 0.5 * p.m * y[1] * y[1] + 0.5 * p.k * y[0] * y[0] + 0.25 * p.d * y[0] ** 4;

/** Local linearisation λ = −c/2m ± i·sqrt(ω² − (c/2m)²), ω² = (k + 3du²)/m. */
function lambdaAt(p: Par, u: number): [number, number] {
  const al = p.c / (2 * p.m);
  const w2 = (p.k + 3 * p.d * u * u) / p.m;
  const disc = w2 - al * al;
  return disc >= 0 ? [-al, Math.sqrt(disc)] : [-al + Math.sqrt(-disc), 0];
}

function runMethod(m: MethodId, prob: Problem, h: number): Solution {
  if (m === "dopri") return solve(m, prob, { rtol: 1e-6, atol: 1e-9, maxSteps: 200000 });
  if (m === "ros") return solve(m, prob, { rtol: 1e-4, atol: 1e-7, maxSteps: 200000 });
  return solve(m, prob, { h: Math.max(h, prob.T / 100000), blowup: 1e8 });
}

export default function T19() {
  const [par, setPar] = useState<Par>(BOOK);
  const [h, setH] = useState(0.01);
  const [T, setT] = useState(10);
  const [win, setWin] = useState(0.6);
  const [methods, setMethods] = useState<MethodId[]>(["euler", "rk4", "ieuler", "trap"]);

  const dPar = useDeferredValue(par);
  const dH = useDeferredValue(h);
  const dT = useDeferredValue(T);
  const set = (key: keyof Par) => (v: number) => setPar((p) => ({ ...p, [key]: v }));

  const problem = useMemo(() => duffing(dPar, dT), [dPar, dT]);
  const ref = useMemo(() => solve("dopri", problem, { rtol: 1e-10, atol: 1e-12, maxSteps: 600000 }), [problem]);
  const refU = useMemo(() => comp(ref, 0), [ref]);
  // the reference between its own nodes — cubic Hermite dense output: linear interpolation would add up to 4·10⁻⁴
  // to |u − u*| (20× the whole error of DOPRI on the cards, ≈ 1.9·10⁻⁵ with the assignment's parameters)
  const refAt = useMemo(() => denseOutput(ref, problem.f), [ref, problem]);
  const refE = useMemo(() => ref.y.map((y) => energy(dPar, y)), [ref, dPar]);
  const tE = Math.min(0.2, dT);
  const eRefAt = energy(dPar, refAt(tE));

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = runMethod(m, problem, dH);
        let err = 0;
        const stride = Math.max(1, Math.floor(s.t.length / 5000));
        for (let k = 0; k < s.t.length; k += stride) {
          const e = Math.abs(s.y[k][0] - refAt(s.t[k])[0]);
          if (!(e <= err)) err = e;
        }
        const E = s.y.map((y) => energy(dPar, y));
        const eRatio = s.failed && s.t[s.t.length - 1] < tE ? NaN : sampleAt(s.t, E, tE) / eRefAt;
        return { m, s, err, E, eRatio };
      }),
    [methods, problem, dH, refAt, dPar, tE, eRefAt],
  );

  const table = useMemo(() => {
    const p = duffing(BOOK, 2);
    const r = solve("dopri", p, { rtol: 1e-10, atol: 1e-12 });
    const rAt = denseOutput(r, p.f);
    const eRef = energy(BOOK, rAt(0.2));
    return H_LIST.map((hh) =>
        TABLE_M.map((m) => {
          const s = solve(m, p, { h: hh, blowup: 1e8 });
          let e = 0;
          s.t.forEach((t, i) => {
            const d = Math.abs(s.y[i][0] - rAt(t)[0]);
            if (!(d <= e)) e = d;
          });
          const se = s.y.map((y) => energy(BOOK, y));
          return { s, e, er: s.failed ? NaN : sampleAt(s.t, se, 0.2) / eRef };
        }),
    );
  }, []);

  const lam0 = lambdaAt(dPar, dPar.u0);
  const z0: [number, number] = [dH * lam0[0], dH * lam0[1]];
  const z0abs = Math.hypot(z0[0], z0[1]);
  const alpha = dPar.c / (2 * dPar.m);
  const eulerR = amp("euler", z0);
  const rk2R = amp("rk2", z0);
  const rk3R = amp("rk3", z0);
  const rk4R = amp("rk4", z0);
  const omega0 = Math.sqrt((dPar.k + 3 * dPar.d * dPar.u0 ** 2) / dPar.m);
  const omegaLin = Math.sqrt(dPar.k / dPar.m);
  const zeta = dPar.c / (2 * Math.sqrt(dPar.k * dPar.m));
  const by = (m: MethodId) => sols.find((x) => x.m === m);
  const eul = by("euler");
  const rk = by("rk4");
  const ie = by("ieuler");
  const tr = by("trap");
  // largest stable explicit-Euler step at u(0): |1 + hλ| ≤ 1 for both eigenvalues
  const hEuler = omega0 ** 2 > alpha * alpha ? (2 * alpha) / omega0 ** 2 : 2 / (alpha + Math.sqrt(alpha * alpha - omega0 ** 2));
  // explicit Euler at amplitude u, ω² = (k + 3du²)/m: for complex λ = −α ± i√(ω² − α²) |1 + hλ|² = 1 − 2hα + h²ω², so
  // |1 + hλ| ≤ 1 ⇔ ω² ≤ 2α/h; for real λ (ω² < α²) the faster one needs h(α + √(α² − ω²)) ≤ 2 ⇔ ω² ≥ 4(α − 1/h)/h.
  // Stable band of ω²: [4(α − 1/h)/h, 2α/h], empty for hα > 2 → amplitudes uEulerLo ≤ |u| ≤ uEuler within [0, u0] (uEuler = 0 — nowhere)
  const w2At = (u: number) => (dPar.k + 3 * dPar.d * u * u) / dPar.m;
  const uAtW2 = (w2: number) => (dPar.d > 0 ? Math.sqrt(Math.max(0, (w2 * dPar.m - dPar.k) / (3 * dPar.d))) : 0);
  const eulerW2Hi = (2 * alpha) / dH;
  const eulerW2Lo = (4 / dH) * (alpha - 1 / dH);
  let uEulerLo = 0;
  let uEuler = 0;
  if (dH * alpha <= 2 && w2At(0) <= eulerW2Hi && w2At(dPar.u0) >= eulerW2Lo) {
    uEulerLo = w2At(0) >= eulerW2Lo ? 0 : uAtW2(eulerW2Lo);
    uEuler = w2At(dPar.u0) <= eulerW2Hi ? dPar.u0 : uAtW2(eulerW2Hi);
  }
  const isBook = par.m === BOOK.m && par.c === BOOK.c && par.k === BOOK.k && par.d === BOOK.d && par.u0 === BOOK.u0;

  const ampPath = useMemo(() => {
    const out: { z: [number, number]; color: string; label: string }[] = [];
    for (const u of [0.75, 0.5, 0.25, 0].map((f) => f * dPar.u0)) {
      const l = lambdaAt(dPar, u);
      const zz: [number, number] = [Math.max(-12, dH * l[0]), Math.min(12, dH * l[1])];
      out.push({ z: zz, color: "#ffffff88", label: `u=${fmt(u, 2)}` });
    }
    return out;
  }, [dPar, dH]);

  return (
    <>
      <AnalogyCard
        emoji="🧺"
        title="Пральна машина на гумових ніжках"
        story={
          <>
            Під час віджиму пральна машина тремтить на гумових ніжках. Гума — незвичайна пружина: легенько стиснута, вона м&apos;яка, а що сильніше її
            придавити, то <b>твердішою</b> стає. Тому на початку, поки машину сильно трусить, ніжки тремтять дуже часто, а коли розгойдування вщухає —
            помітно повільніше. Для чисельного методу це пастка: на старті треба «фотографувати» рух дуже часто, інакше він розгойдає машину до неба.
          </>
        }
        mapping={[
          ["стиск ніжок", <>відхилення u (на старті u = 10)</>],
          ["гума твердне при стиску", <>k + 3du² — кубічна пружина Дуфінга</>],
          ["амортизатор, що гасить тремтіння", <>демпфер c·u′</>],
          ["як часто метод «фотографує» рух", <>крок h = 0.01 с</>],
          ["тремтіння частіше, ніж кадри", <>|hλ| за межею стійкості явних методів</>],
        ]}
      >
        <DuffingWasherScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Прилад на пружній опорі" simpleTitle="Прилад на гумовій опорі">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`m\,u'' + c\,u' + k\,u + d\,u^3 = 0,`}</Tex>
            <Tex block>{String.raw`m = 0.01,\quad c = 0.15,\quad k = d = 2.0,\qquad u(0) = 10,\ \ u'(0) = 0.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/70">
                  Прилад масою 10 г стоїть на гумовій опорі; на старті її стиснули на u = 10 і відпустили. Рахуємо 10 секунд із кроком 0.01. Гума — «хитра»
                  пружина: що сильніше стиснута, то жорсткіша; при u = 10 «кубічна» частина сили в {fmt((dPar.d * dPar.u0 ** 2) / dPar.k, 3)} разів більша за
                  звичайну. Демпфер (амортизатор) поступово гасить коливання — енергія E може лише зменшуватися.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/70">
              10 секунд, крок <Tex>{"h = 0.01"}</Tex>. Це <b>осцилятор Дуфінга</b>: пружина з «жорсткою» кубічною характеристикою{" "}
              <Tex>{"F(u) = ku + du^3"}</Tex> — гумова опора, буфер, віброізолятор. Що сильніше стиснули, то жорсткіше вона відповідає: при{" "}
              <Tex>{"u = 10"}</Tex> кубічний член у {fmt((dPar.d * dPar.u0 ** 2) / dPar.k, 3)} разів більший за лінійний. Демпфер <Tex>{"c\\,u'"}</Tex>{" "}
              гасить коливання.
            </p>
            </Say>
            <Tex block>{String.raw`E = \tfrac12 m u'^2 + \tfrac12 k u^2 + \tfrac14 d u^4,\qquad \frac{dE}{dt} = -c\,u'^2 \le 0.`}</Tex>
          </Card>
          <Card title="Миттєва жорсткість" icon="🔬">
            <Say simple={<p className="text-[14px] leading-relaxed text-white/75">Наскільки «тверда» опора зараз — залежить від того, як сильно її стиснуто:</p>}>
              <p className="text-[14px] leading-relaxed text-white/75">Лінеаризація біля поточного <Tex>{"u"}</Tex>:</p>
            </Say>
            <Tex block>{String.raw`J = \begin{pmatrix}0&1\\ -\frac{k+3du^2}{m} & -\frac{c}{m}\end{pmatrix},\qquad \lambda = -\frac{c}{2m} \pm i\sqrt{\omega^2 - \tfrac{c^2}{4m^2}},\quad \omega^2 = \frac{k+3du^2}{m}.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  При стиску u = {fmt(dPar.u0, 3)} опора тремтить з періодом лише {fmt((2 * Math.PI) / omega0, 3)} с, а біля рівноваги — у{" "}
                  {fmt(omega0 / omegaLin, 3)} разів повільніше. Для чисельного методу це «коливальна» жорсткість: тертя мале проти частоти, і явний Ейлер
                  розгойдує прилад {hEuler > 0 ? `за будь-якого кроку, більшого за ${fmt(hEuler, 2)} с` : "за будь-якого кроку (тертя нуль)"}; RK2 в цьому сенсі не кращий за
                  Ейлера; RK3 витримує, поки за один крок опора проходить менше ніж ~0.28 коливання (h·ω &lt; 1.73), RK4 — менше ніж ~0.45 коливання (h·ω &lt; 2.83).
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              При <Tex>{`u = ${fmt(dPar.u0, 3)}`}</Tex>: <Tex>{`\\omega^2 \\approx ${fmt(omega0 ** 2, 4)}`}</Tex>,{" "}
              <Tex>{`\\lambda \\approx ${fmt(lam0[0], 3)} \\pm ${fmt(lam0[1], 4)}i`}</Tex> — період лише {fmt((2 * Math.PI) / omega0, 3)} с. А біля
              рівноваги <Tex>{`\\omega = \\sqrt{k/m} \\approx ${fmt(omegaLin, 3)}`}</Tex>: частота «пливе» в {fmt(omega0 / omegaLin, 3)} разів. Власні числа
              майже уявні — задача <b>осциляторно жорстка</b>: явний Ейлер і RK2 (їхні області стійкості не містять уявної осі: для RK2 |R(iy)|² = 1 + y⁴/4)
              приречені, RK3 витримує <Tex>{"h|\\lambda| < \\sqrt3 \\approx 1.73"}</Tex>, RK4 — <Tex>{"h|\\lambda| < 2\\sqrt2 \\approx 2.83"}</Tex>.
            </p>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  Демпфер «з&apos;їдає» розмах коливань: за кожну секунду — приблизно в {fmt(Math.exp(alpha), 2)} разів. Тож за {fmt(dT, 3)} с від тремтіння
                  практично нічого не лишається, а енергія (вона ∝ розмаху²) спадає ще швидше.
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Коефіцієнт згасання <Tex>{`\\alpha = c/2m = ${fmt(alpha, 3)}`}</Tex>: обвідна амплітуди спадає як <Tex>{`e^{-${fmt(alpha, 3)}t}`}</Tex>, за 1 с
              — у ~{fmt(Math.exp(alpha), 2)} раз(ів), а енергія за {fmt(dT, 3)} с — приблизно в <Tex>{`e^{-2\\alpha T} \\approx e^{-${fmt(2 * alpha * dT, 3)}}`}</Tex>{" "}
              разів.
            </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Хто чесно гасить коливання, а хто — «зʼїдає» енергію">
        <Lab
          controls={
            <>
              <Chips
                label="Крок h"
                value={H_LIST.includes(h) ? h : -1}
                onChange={(v) => v > 0 && setH(v)}
                options={H_LIST.map((v) => ({ value: v, label: v === 0.01 ? "h = 0.01 (умова)" : `h = ${v}` }))}
              />
              <Slider label="Довільний крок h" value={h} onChange={setH} min={0.0005} max={0.03} log />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Chips
                label="Вікно часу на графіках"
                value={win}
                onChange={setWin}
                options={[
                  { value: 0.2, label: "0.2 с" },
                  { value: 0.6, label: "0.6 с" },
                  { value: 2, label: "2 с" },
                  { value: 0, label: "весь" },
                ]}
              />
              <Slider label="Тривалість T, с" value={T} onChange={setT} min={1} max={10} step={0.5} />
              <div className="space-y-4 rounded-xl border border-white/8 p-3">
                <Slider label="Маса m" value={par.m} onChange={set("m")} min={0.001} max={0.2} log />
                <Slider label="Демпфер c" value={par.c} onChange={set("c")} min={0} max={2} step={0.01} />
                <Slider label="Лінійна жорсткість k" value={par.k} onChange={set("k")} min={0.1} max={10} step={0.1} />
                <Slider label="Кубічна жорсткість d" value={par.d} onChange={set("d")} min={0} max={10} step={0.1} />
                <Slider label="u(0)" value={par.u0} onChange={set("u0")} min={0.5} max={15} step={0.5} />
                {!isBook && (
                  <button onClick={() => setPar(BOOK)} className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/70 hover:bg-white/10">
                    ⟲ параметри з умови
                  </button>
                )}
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Tex>{`h\\lambda(0) = ${fmt(z0[0], 3)} \\pm ${fmt(z0[1], 3)}i`}</Tex>
                <br />
                |R| явного Ейлера: <b className={eulerR > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(eulerR, 3)}</b>, RK2:{" "}
                <b className={rk2R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk2R, 3)}</b>, RK3:{" "}
                <b className={rk3R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk3R, 3)}</b>, RK4:{" "}
                <b className={rk4R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk4R, 3)}</b>
                <br />
                <span className="text-white/50">На уявній осі: Ейлер і RK2 нестійкі завжди, RK3 — до |hλ| = √3 ≈ 1.73, RK4 — до 2√2 ≈ 2.83.</span>
              </div>
            </>
          }
        >
          <Playground sols={sols} ref0={ref} par={dPar} win={win > 0 ? Math.min(win, dT) : dT} />

          <Grid>
            <Card>
              <Plot
                title="Енергія E(t) (лог. шкала) — повинна спадати"
                height={260}
                xLabel="t, с"
                logY
                yDomain={[1e-30, energy(dPar, [dPar.u0, 0]) * 30]}
                series={[
                  { x: ref.t, y: refE.map((e) => Math.max(e, 1e-300)), color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
                  ...sols.map(({ m, s, E }) => ({
                    x: s.t,
                    y: E.map((e) => Math.max(e, 1e-300)),
                    color: METHODS[m].color,
                    label: METHODS[m].short,
                    width: s.failed ? 1 : 1.5,
                    opacity: s.failed ? 0.45 : 1,
                  })),
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="Миттєва частота ω(t) = √((k+3du²)/m) та h·ω"
                height={260}
                xLabel="t, с"
                logY
                xDomain={[0, win > 0 ? Math.min(win, dT) : dT]}
                series={[
                  { x: ref.t, y: refU.map((u) => Math.sqrt((dPar.k + 3 * dPar.d * u * u) / dPar.m)), color: "#8ef0c5", label: "ω(t), рад/с", width: 1.6 },
                  { x: ref.t, y: refU.map((u) => dH * Math.sqrt((dPar.k + 3 * dPar.d * u * u) / dPar.m)), color: "#ffb547", label: "h·ω", width: 1.4 },
                  { x: [0, dT], y: [2.83, 2.83], color: "#ff5d73", label: "межа RK4 ≈ 2.83", width: 1, dash: [5, 4], noRange: true },
                  { x: [0, dT], y: [1.73, 1.73], color: "#b5e853", label: "межа RK3 ≈ 1.73", width: 1, dash: [5, 4], noRange: true },
                ]}
              />
            </Card>
          </Grid>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="ω при u(0)" value={`${fmt(omega0, 4)} рад/с`} sub={`період ${fmt((2000 * Math.PI) / omega0, 3)} мс`} />
            <Stat label="ω біля рівноваги" value={`${fmt(omegaLin, 4)} рад/с`} sub={`ζ = c/(2√km) = ${fmt(zeta, 3)}`} />
            <Stat label="k_eff при u(0)" value={fmt(dPar.k + 3 * dPar.d * dPar.u0 ** 2, 4)} sub={`у ${fmt(1 + (3 * dPar.d * dPar.u0 ** 2) / dPar.k, 3)} раз жорсткіше за k`} />
            <Stat label={`E_еталон(${tE} с)`} value={fmt(eRefAt, 3)} sub={`з E(0) = ${fmt(energy(dPar, [dPar.u0, 0]), 4)}`} />
            {sols.map(({ m, s, err, eRatio }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : fmt(err, 3)}
                sub={s.failed ? s.failed : `max|u−u*| · E/E* = ${fmt(eRatio, 3)} · ${s.steps} кр. · ${fmtMs(s.ms)}`}
                tone={s.failed || err > 3 ? "bad" : err > 0.3 ? "warn" : "good"}
              />
            ))}
          </div>

          {eul?.s.failed && (
            <Insight
              tone="bad"
              title="Явний Ейлер: «розгойдав» прилад до нескінченності"
              simple={
                <>
                  Кожен крок множить розмах у {fmt(eulerR, 3)} рази — за кілька кроків прилад «розгойдано» до нескінченності. Явний Ейлер щоразу трохи
                  «перебільшує» коливання, а слабкий демпфер не встигає це погасити. {hEuler > 0 ? (
                    <>
                      Щоб вижити, йому потрібен крок менший за {fmt(hEuler, 2)} с — це ~{Math.round(dT / hEuler)} кроків на {fmt(dT, 3)} с.{" "}
                      <Relatable kind="steps" n={dT / hEuler} />
                    </>
                  ) : (
                    "Без тертя явний Ейлер нестійкий за будь-якого кроку."
                  )}
                </>
              }
            >
              На старті |1 + hλ| = {fmt(eulerR, 3)} — кожен крок множить амплітуду в {fmt(eulerR, 3)} рази.{" "}
              {omega0 ** 2 > alpha * alpha ? (
                <>
                  Для чисто уявного λ явний Ейлер нестійкий при будь-якому h, а тут демпфування α = {fmt(alpha, 3)} нікчемне проти частоти{" "}
                  {fmt(lam0[1], 3)}
                  {alpha > 0 ? (
                    <>
                      : |1 + hλ|² = 1 − 2hα + h²ω² ≤ 1 лише при h ≤ 2α/ω² = 2α/|λ|² ≈ {fmt(hEuler, 2)}.
                    </>
                  ) : (
                    " — без демпфування стійкого кроку немає."
                  )}
                </>
              ) : (
                <>
                  Тут λ дійсні, і швидше з них, λ = {fmt(-(alpha + Math.sqrt(alpha * alpha - omega0 ** 2)), 3)}, вимагає h|λ| ≤ 2, тобто h ≤ {fmt(hEuler, 2)}.
                </>
              )}
            </Insight>
          )}
          {rk && !rk.s.failed && z0abs > 2 && (
            <Insight
              tone="warn"
              title={rk4R > 1 ? "RK4 вижив за межею стійкості" : "RK4 біля межі стійкості"}
              simple={
                <>
                  За один крок опора встигає пройти {fmt(z0abs / (2 * Math.PI), 2)} коливання — RK4 «бачить» рух лише кілька разів за період.{" "}
                  {rk4R > 1
                    ? "Формально це вже за межею стійкості, але розмах швидко спадає, опора м'якшає, і RK4 рятує справжнє тертя."
                    : "Він ще стійкий, але так близько до межі сам сильно гасить перші коливання — наче додатковий демпфер."}{" "}
                  Промах при цьому великий: до {fmt(rk.err, 3)} при розмаху {fmt(dPar.u0, 3)}.
                </>
              }
            >
              На старті h|λ| = {fmt(z0abs, 3)} ({rk4R > 1 ? "більше за 2.83" : "менше за 2.83"}), |R(hλ)| = {fmt(rk4R, 3)}.{" "}
              {rk4R > 1
                ? "Формально метод нестійкий, але амплітуда і з нею ω швидко падають, hλ «заїжджає» всередину області стійкості — RK4 рятує фізичне загасання, а не власні чесноти."
                : "Метод стійкий, але так близько до межі |R| провалюється до малих значень: перші коливання RK4 гасить сам, значно сильніше за демпфер."}{" "}
              Похибка при цьому велика: max|u − u*| = {fmt(rk.err, 3)}.
            </Insight>
          )}
          {ie && tr && !ie.s.failed && !tr.s.failed && (
            <Insight
              tone="info"
              title="Чисельна дисипація неявного Ейлера"
              simpleTitle="Неявний Ейлер «з'їдає» енергію"
              simple={
                <>
                  Через {tE} с справжня енергія — {fmt(eRefAt, 3)}. У трапецій — {fmt(tr.eRatio, 3)}× від неї, а в неявного Ейлера — лише {fmt(ie.eRatio, 3)}×.
                  Неявний Ейлер не вибухає, але гасить коливання сам, наче в приладі є ще один амортизатор, якого насправді немає. Трапеції штучно не гасять,
                  зате з великим кроком не встигають погасити й справжнє тертя — і трохи «плутають» фазу.
                </>
              }
            >
              На {tE} с еталон має енергію {fmt(eRefAt, 3)}, трапеції — {fmt(tr.eRatio, 3)}× еталона, а неявний Ейлер — лише {fmt(ie.eRatio, 3)}× (|R| =
              {" "}
              {fmt(amp("ieuler", z0), 3)} на крок!). Він стійкий, але «гасить» коливання сам, без жодного демпфера — це числовий артефакт, а не фізика.
              Трапеції (|R| = 1 на уявній осі) не додають штучного тертя, зате при великому h|λ| <i>недогашують</i> справжнє (|R| = {fmt(amp("trap", z0), 3)}{" "}
              проти точного e<sup>−αh</sup> = {fmt(Math.exp(-alpha * dH), 3)} на крок) і зсувають фазу.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Результати" title="Таблиця: max |u − u*| на [0, 2] та E/E* при t = 0.2 (параметри з умови)" simpleTitle="Хто наскільки промахнувся (параметри умови)">
        <Card>
          <Table
            head={["Метод", ...H_LIST.map((v) => `h = ${v}`)]}
            rows={TABLE_M.map((m, j) => [
              <span key={m} style={{ color: METHODS[m].color }}>
                {METHODS[m].name}
              </span>,
              ...H_LIST.map((_, i) => {
                const { s, e, er } = table[i][j];
                if (s.failed) return <span className="text-[#ff5d73]">💥 вибух</span>;
                return (
                  <span className={e > 3 ? "text-[#ff5d73]" : e > 0.3 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>
                    {fmt(e, 3)} <span className="text-white/45">· E {fmt(er, 2)}×</span>
                  </span>
                );
              }),
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Промах ~10 означає, що метод опинився «в протифазі»: розмах 10, а коливання коротші за 26 мс — помилитися легко. Число «E …×» — яка частка
                справжньої енергії лишилась на 0.2 с: менше 1 — метод сам гасить коливання, більше 1 — недогасив.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Максимальна похибка ~10 означає, що метод «потрапив у протифазу»: амплітуда 10 і період 26 мс не залишають права на помилку. Числа E× показують,
            яка частка енергії «вижила» на t = 0.2 с порівняно з еталоном: &lt; 1 — штучна дисипація, &gt; 1 — метод недогасив (у трапецій |R(hλ)| → 1 при
            великих h|λ|, тоді як точний множник e<sup>−αh</sup> &lt; 1).
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Чому так?" title="Шлях hλ при згасанні амплітуди" simpleTitle="Чому з часом методам легшає">
        <Card>
          <StabilityExplorer z={[Math.max(-12, z0[0]), Math.min(12, z0[1])]} range={4} extraPoints={ampPath} />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Яскрава точка — «складність кроку» на старті, білі — коли розмах спаде до 75 %, 50 %, 25 % і нуля: опора м&apos;якшає, і точка сповзає вниз,
                до безпечнішої зони. RK4 на старті на межі своєї зони або за нею, а круг явного Ейлера{" "}
                {uEuler <= 0
                  ? "сюди не дотягується взагалі"
                  : uEulerLo > 0
                    ? `накриває лише розмахи від ${fmt(uEulerLo, 3)} до ${fmt(uEuler, 3)} — біля рівноваги крок для нього знову завеликий`
                    : uEuler >= dPar.u0
                      ? "накриває всі точки — крок досить малий"
                      : `дотягується лише до розмаху ${fmt(uEuler, 3)} — ${
                          uEuler <= 0.3 * dPar.u0 ? "коли коливання вже майже згасли" : `це ${fmt((100 * uEuler) / dPar.u0, 2)} % від початкового`
                        }`}
                .
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Точка — hλ при u = u(0), білі — при зменшенні амплітуди (75 %, 50 %, 25 %, 0). Траєкторія hλ «сповзає» по вертикалі до дійсної осі: на початку
            вона за межами області RK4 або на краю, а круг явного Ейлера |1 + z| ≤ 1 накриває її (для комплексних λ: |1 + hλ|² = 1 − 2hα + h²ω²) лише при{" "}
            <Tex>{"h\\omega^2 \\le c/m"}</Tex>{" "}
            {uEuler <= 0
              ? `— для h = ${fmt(dH, 3)} круг не накриває жодної її точки`
              : uEulerLo > 0
                ? `— для h = ${fmt(dH, 3)} лише при ${fmt(uEulerLo, 3)} ≤ |u| ≤ ${fmt(uEuler, 3)} (ближче до рівноваги λ дійсні, і h|λ|max > 2)`
                : uEuler >= dPar.u0
                  ? `— для h = ${fmt(dH, 3)} це виконано на всій траєкторії`
                  : `— для h = ${fmt(dH, 3)} це |u| ≤ ${fmt(uEuler, 3)}${
                      uEuler <= 0.3 * dPar.u0 ? ", коли коливання вже майже згасли" : ` (${fmt((100 * uEuler) / dPar.u0, 2)} % від u(0))`
                    }`}
            .
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={BOOK_F}
          y0={BOOK_Y0}
          T={0.6}
          view={DBG_VIEW}
          h0={0.01}
          hMin={0.0005}
          hMax={0.03}
          hPresets={H_LIST}
          hint={
            <Say
              simple={
                <>
                  Площина «стиск u — швидкість u′», параметри умови. Справжня траєкторія — спіраль, що закручується до центру. Явний Ейлер з h = 0.01
                  стрибає по дотичній і вже на другому кроці вилітає за межі графіка: за 10 мс опора встигає пройти майже 0.4 коливання, а Ейлер про це не
                  знає. RK2 і RK3 з h = 0.01 теж вибухають за кілька кроків (RK2 — навіть швидше за Ейлера); RK4 з h = 0.01 тримається, а з h = 0.02 вибухає на
                  2-му кроці. Візьміть h = 0.005 — і RK3 уже стійкий. Неявні методи стійкі — порівняйте, хто з них «з&apos;їдає» спіраль найшвидше.
                </>
              }
            >
              Фазова площина (u, u′) для m = 0.01, c = 0.15, k = d = 2, u(0) = 10. При u = 10 hλ ≈ −0.075 ± 2.45i (h = 0.01): |1 + hλ| ≈ 2.6 — явний Ейлер
              вибухає за кілька кроків; RK2 (|R| ≈ 3.1) і RK3 (|R| ≈ 1.9) теж — для майже уявного hλ RK2 нестійкий завжди, а RK3 лише при |hλ| &lt; √3 ≈ 1.73
              (при h = 0.005 він уже стійкий); RK4 стійкий (|R| ≈ 0.36), але при h = 0.02 (|hλ| ≈ 4.9) вибухає за 2 кроки. Для неявних видно ітерації
              Ньютона; неявний Ейлер (|R| ≈ 0.37 на крок) штучно гасить коливання, трапеції — майже ні (|R| ≈ 0.97 проти точного e^(−αh) ≈ 0.93).
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Стукніть по опорі — і подивіться, як вона заспокоюється" report={false}>
        <PhasePlayground
          f={BOOK_F}
          init={BOOK_Y0}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={0.1}
          speedRange={[0.01, 1]}
          trail={0.4}
          strip={[{ comp: 0, label: "u", color: "#8ef0c5" }]}
          window={0.8}
          kicks={[
            { label: "Удар", emoji: "🔨", apply: (y) => [y[0], y[1] + 200], hint: "u′ += 200" },
            { label: "Стиснути до 10", emoji: "🗜️", apply: () => [10, 0], hint: "u = 10, u′ = 0" },
          ]}
          underlay={(ctx, { X, Y }) => {
            ctx.setLineDash([3, 5]);
            ctx.lineWidth = 1.2;
            PG_LEVELS.forEach((E, k) => {
              ctx.strokeStyle = `rgba(255,181,71,${0.55 - k * 0.1})`;
              for (const sg of [1, -1]) {
                ctx.beginPath();
                let started = false;
                for (let j = 0; j <= 240; j++) {
                  const u = -12 + (24 * j) / 240;
                  const r = 2 * (E - u * u - 0.5 * u ** 4);
                  if (r < 0) {
                    started = false;
                    continue;
                  }
                  const v = sg * Math.sqrt(r / 0.01);
                  if (started) ctx.lineTo(X(u), Y(v));
                  else {
                    ctx.moveTo(X(u), Y(v));
                    started = true;
                  }
                }
                ctx.stroke();
              }
            });
            ctx.setLineDash([]);
          }}
          hint={
            <Say
              simple={
                <>
                  Клацніть будь-де, щоб задати стиск і швидкість, або «вдарте» по опорі. Помаранчеві пунктири — рівні енергії: без амортизатора точка бігала б
                  по одному з них вічно. Демпфер щоразу «переводить» її на нижчий рівень — і вона закручується до центру. Зверніть увагу: великі петлі опора
                  пробігає набагато швидше за малі — тверда гума тремтить частіше.
                </>
              }
            >
              Фазова площина (u, u′) осцилятора Дуфінга з параметрами умови; інтегрування — Розенброк у реальному часі (за замовчуванням сповільнено в 10 разів).
              Пунктири — лінії рівня E = ½mu′² + ½ku² + ¼du⁴ для E(u = 10, 7, 4, 2); dE/dt = −cu′² ≤ 0, тож траєкторія перетинає їх лише всередину. Період
              обходу великих петель коротший — частота зростає з амплітудою.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="19"
          questions={[
            {
              id: "euler",
              q: <>Параметри умови, явний Ейлер з кроком h = 0.01. Що станеться? (Демпфер же гасить коливання…)</>,
              options: ["Стійкий — демпфер усе погасить", "Вибухне за кілька кроків", "Стійкий, але неточний", "Вибухне лише десь через 5 с"],
              correct: 1,
              explain: (
                <>
                  При u = 10 hλ ≈ −0.075 ± 2.45i, |1 + hλ| ≈ 2.6: кожен крок множить відхилення в 2.6 раза. Розв&apos;язок перевищує поріг 10⁸ уже при t = 0.06
                  (6 кроків). Стійкість вимагала б |1 + hλ|² = 1 − 2hα + h²ω² ≤ 1, тобто h ≤ 2α/ω² ≈ 2.5·10⁻⁴.
                </>
              ),
              explainSimple: <>Демпфер надто слабкий проти тремтіння з періодом 26 мс: Ейлер кожен крок «перебільшує» розмах у 2.6 раза — і за 6 кроків (0.06 с) вибухає.</>,
              show: {
                label: "Показати Ейлера з h = 0.01",
                run: () => {
                  setPar(BOOK);
                  setT(10);
                  setH(0.01);
                  setMethods((m) => (m.includes("euler") ? m : ["euler", ...m]));
                },
              },
            },
            {
              id: "energy",
              q: <>Неявний Ейлер з h = 0.01 стійкий. А скільки енергії в нього лишиться через 0.2 с порівняно з еталоном?</>,
              options: ["Стільки ж (≈ 1×) — він же стійкий", "У ~25 разів менше", "Більше за еталон", "Нуль — коливання зупиняться одразу"],
              correct: 1,
              explain: (
                <>
                  Перевірка: E/E* ≈ 0.038 на t = 0.2 с. На старті |R(hλ)| ≈ 0.37 на крок проти точного e<sup>−αh</sup> ≈ 0.93: метод гасить коливання сам —
                  числова дисипація. Для порівняння, трапеції при тому ж h дають E/E* ≈ 3.8 (недогашують).
                </>
              ),
              explainSimple: <>Лишиться лише ~4 % справжньої енергії: неявний Ейлер поводиться так, ніби в приладі є ще один потужний амортизатор. Трапеції ж навпаки — недогашують (≈ 3.8×).</>,
              show: {
                label: "Показати неявного Ейлера і трапеції",
                run: () => {
                  setPar(BOOK);
                  setT(10);
                  setH(0.01);
                  setMethods((m) => [...m.filter((x) => x !== "ieuler" && x !== "trap"), "ieuler", "trap"]);
                },
              },
            },
            {
              id: "half",
              q: <>Стиснемо опору вдвічі слабше: u(0) = 5 (решта як в умові). Що станеться з початковою частотою і з RK4 при h = 0.01?</>,
              options: ["Частота не зміниться — пружина та сама", "Частота впаде приблизно вдвічі, і RK4 стане точним", "Частота зросте, RK4 вибухне", "Частота впаде вчетверо, RK4 вибухне"],
              correct: 1,
              explain: (
                <>
                  ω² = (k + 3du²)/m: при u = 10 — 60 200 (ω ≈ 245), при u = 5 — 15 200 (ω ≈ 123), тобто майже вдвічі менше (кубічна пружина!). h|λ| падає з 2.45
                  до 1.23 — далеко від межі 2.83, і max-похибка RK4 на [0, 10] зменшується з ≈ 2.3 до ≈ 0.05.
                </>
              ),
              explainSimple: <>Гума, стиснута слабше, м&apos;якша: тремтить удвічі повільніше (123 замість 245 рад/с). RK4 тепер «фотографує» рух удвічі частіше за коливання — і промах падає з ~2.3 до ~0.05.</>,
              show: {
                label: "Показати u(0) = 5",
                run: () => {
                  setPar({ ...BOOK, u0: 5 });
                  setH(0.01);
                  setMethods((m) => (m.includes("rk4") ? m : ["rk4", ...m]));
                },
              },
            },
          ]}
        />
      </Section>

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="bad"
            title="Явні методи"
            simple={
              <>
                Явний Ейлер з h = 0.01 (умова) вибухає за кілька кроків. RK4 при h = 0.01 ще живий, але перші коливання гасить сам; з кроком 0.012–0.016 він уже
                за межею і виживає лише завдяки тому, що опора швидко м&apos;якшає, з h ≈ 0.017–0.018 виживає вже через раз, а з h = 0.02 — вибухає за 2 кроки.
                RK2 і RK3 з h = 0.01 вибухають, як Ейлер; з h = 0.005 RK3 уже стійкий (промах ≈ 0.8), а RK2 виживає лише завдяки тертю й м&apos;якшанню опори —
                з промахом ≈ 14 і енергією у 8 разів більшою за справжню. Тверда гума — головний ворог явних методів.
              </>
            }
          >
            Явний Ейлер з h = 0.01 (параметри умови) вибухає за кілька кроків (|1+hλ| ≈ 2.6). RK4 при h = 0.01 ще стійкий (h|λ| ≈ 2.45 &lt; 2.83), але
            з |R| ≈ 0.36 — перші коливання він гасить сам; при h ≈ 0.012–0.016 він уже за межею і виживає лише тому, що амплітуда й частота швидко падають;
            біля h ≈ 0.017–0.018 виживання вже випадкове (0.017 і 0.018 вибухають, 0.0175 — ні), а при h = 0.02 його розносить за 2 кроки. RK2 (|R| ≈ 3.1) і RK3
            (|R| ≈ 1.9) з h = 0.01 вибухають, як Ейлер: на уявній осі RK2 нестійкий за будь-якого кроку, RK3 — при |hλ| &gt; √3. З h = 0.005 RK3 уже стійкий (max|u − u*|
            ≈ 0.8), а RK2 формально ще ні (|R| ≈ 1.2): він не вибухає лише завдяки тертю й м&apos;якшанню опори, але дає промах ≈ 14 і E/E* ≈ 8.4 на t = 0.2 с. Для
            всіх явних методів жорстка пружина — головний ворог.
          </Insight>
          <Insight
            tone="good"
            title="Неявні методи"
            simple={
              <>
                Не вибухають за жодного кроку, але помиляються по-різному: неявний Ейлер і BDF2 самі гасять коливання (передчасно), θ = 0.55 — помірно, трапеції
                штучно не гасять, зате з великим кроком недогашують справжнє тертя й плутають фазу. Для коливань найкраще — трапеції з малим кроком або
                адаптивні методи.
              </>
            }
          >
            Стійкі при будь-якому h, але з різним характером похибки: неявний Ейлер і BDF2 — сильна числова дисипація (коливання «вмирають» передчасно), θ
            = 0.55 — помірна, трапеції — без штучної дисипації (|R| = 1 на уявній осі), але при великому h|λ| вони недогашують справжнє демпфування й
            зсувають фазу. Для коливальних задач перевага за трапеціями з малим h (і адаптивними методами).
          </Insight>
          <Insight
            tone="info"
            title="Нелінійна жорсткість"
            simpleTitle="Жорсткість, що м'якшає"
            simple={
              <>
                Частота тремтіння падає від {fmt(omega0, 3)} до {fmt(omegaLin, 3)} рад/с, коли опора заспокоюється. Адаптивні DOPRI і Розенброк це відчувають:
                дрібний крок — лише на початку, далі — ширший. Порівняйте кількість їхніх кроків.
              </>
            }
          >
            Жорсткість тут не стала: ω змінюється від {fmt(omega0, 3)} до {fmt(omegaLin, 3)} рад/с. Адаптивні DOPRI і Розенброк це «відчувають» і
            дрібнять крок лише на початку — порівняйте кількість кроків.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Георг Дуфінг 1918 року написав книжку про коливання з нелінійною пружиною — досліджував вібрації заводських машин. Сьогодні його рівняння описує
                гіроскопи у смартфонах, мости, барабанні перетинки і «дзвін» металевої струни.
              </>
            }
          >
            Георг Дуфінг 1918 року написав книжку про коливання з нелінійною пружиною, досліджуючи… вібрації машин на заводах. Сьогодні рівняння Дуфінга
            описує MEMS-гіроскопи у смартфонах, мости, барабанні перетинки і навіть «стрибки» амплітуди при резонансі — гістерезис, який чують музиканти
            як «дзвін» металевої струни.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function Playground({ sols, ref0, par, win }: { sols: { m: MethodId; s: Solution; err: number }[]; ref0: Solution; par: Par; win: number }) {
  const pb = usePlayback(14);
  const time = pb.progress * win;
  const data = useMemo(() => {
    const u = comp(ref0, 0);
    const v = comp(ref0, 1);
    const ts: Series[] = [
      { x: ref0.t, y: u, color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
      ...sols.map(({ m, s, err }) => ({
        x: s.t,
        y: comp(s, 0),
        color: METHODS[m].color,
        label: METHODS[m].short,
        width: s.failed || err > 3 ? 1 : 1.6,
        opacity: s.failed || err > 3 ? 0.45 : 1,
      })),
    ];
    const i1 = indexAt(ref0.t, win);
    const phase: Series[] = [
      { x: u.slice(0, i1 + 1), y: v.slice(0, i1 + 1), color: "#ffffff", label: "еталон", width: 4, opacity: 0.25 },
      ...sols.map(({ m, s, err }) => {
        const j = indexAt(s.t, win);
        return {
          x: comp(s, 0).slice(0, j + 1),
          y: comp(s, 1).slice(0, j + 1),
          color: METHODS[m].color,
          label: METHODS[m].short,
          width: s.failed || err > 3 ? 1 : 1.3,
          opacity: s.failed || err > 3 ? 0.45 : 0.9,
        };
      }),
    ];
    let vMax = 0;
    for (const x of v) vMax = Math.max(vMax, Math.abs(x));
    return { u, v, ts, phase, vMax };
  }, [ref0, sols, win]);

  const units = [
    { label: "еталон", color: "#ffffff", u: sampleAt(ref0.t, data.u, time), v: sampleAt(ref0.t, data.v, time) },
    ...sols
      .filter(({ m }) => m !== "dopri" && m !== "ros")
      .slice(0, 2)
      .map(({ m, s }) => {
        const alive = !s.failed || s.t[s.t.length - 1] > time;
        return {
          label: METHODS[m].short,
          color: METHODS[m].color,
          u: alive ? sampleAt(s.t, comp(s, 0), time) : NaN,
          v: alive ? sampleAt(s.t, comp(s, 1), time) : 0,
          failed: !alive,
        };
      }),
  ];
  const uNow = units[0].u;
  const uMax = par.u0 * 1.05;
  const forceCurve = useMemo(() => {
    const x: number[] = [];
    for (let k = 0; k <= 200; k++) x.push(-uMax + (2 * uMax * k) / 200);
    return { x, cub: x.map((u) => par.k * u + par.d * u ** 3), lin: x.map((u) => par.k * u) };
  }, [par, uMax]);

  return (
    <>
      <Card title={`Сцена: опора у сповільненні ×${fmt(14 / win, 3)}`} icon="🧲">
        <SpringMountScene units={units} time={time} k={par.k} d={par.d} u0={par.u0} />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${(time * 1000).toFixed(0)} мс`} />
        </div>
        <Say
          simple={
            <p className="mt-2 text-[12.5px] text-white/55">
              Ліворуч — як рухається прилад насправді, праворуч — як його «бачать» два обрані методи з фіксованим кроком. Колір пружини — наскільки тверда
              гума зараз (зелений — м&apos;яко, червоний — твердо). Справа від корпусу — амортизатор.
            </p>
          }
        >
        <p className="mt-2 text-[12.5px] text-white/55">
          Ліворуч — еталонний розв&apos;язок, праворуч — перші два обрані фіксовані методи. Колір пружини — миттєва жорсткість k + 3du² (зелений — м&apos;яка,
          червоний — тверда). Справа від корпусу — демпфер-поршень.
        </p>
        </Say>
      </Card>
      <Card>
        <Plot title="u(t)" height={270} xLabel="t, с" xDomain={[0, win]} yDomain={[-par.u0 * 1.3, par.u0 * 1.3]} cursorX={time} series={data.ts} />
      </Card>
      <Grid>
        <Card>
          <Plot
            title="Фазова траєкторія (u, u′)"
            height={280}
            xLabel="u"
            yLabel="u′"
            sorted={false}
            xDomain={[-par.u0 * 1.3, par.u0 * 1.3]}
            yDomain={[-data.vMax * 1.3, data.vMax * 1.3]}
            markers={[{ x: uNow, y: units[0].v, color: "#ffffff" }]}
            series={data.phase}
          />
        </Card>
        <Card>
          <Plot
            title="Сила пружини: ku + du³ проти лінійної ku"
            height={280}
            xLabel="u"
            yLabel="F"
            markers={[{ x: uNow, y: par.k * uNow + par.d * uNow ** 3, color: "#ffb547" }]}
            series={[
              { x: forceCurve.x, y: forceCurve.cub, color: "#ffb547", label: "ku + du³", width: 2 },
              { x: forceCurve.x, y: forceCurve.lin, color: "#8ef0c5", label: "ku", width: 1.5, dash: [5, 4] },
            ]}
          />
        </Card>
      </Grid>
    </>
  );
}
