"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import FeatherScene from "@/components/scenes/FeatherScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider, Toggle } from "@/components/ui/controls";
import Gauge from "@/components/ui/Gauge";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, indexAt, maxError, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import CoffeeScene from "@/components/analogy/CoffeeScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { useTaskExport } from "@/components/share/TaskActions";
import { exportT2 } from "@/components/share/TaskExports";
import { methodsIn, useUrlNum } from "@/components/share/TaskUrl";
import { useUrlState } from "@/lib/url-state";

const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];
const H_LIST = [0.01, 0.02, 0.05];
const D0 = -0.5;
const EPS0 = 0.01;
// stable references for the debugger / playground (parameters from the problem statement)
const F = (_t: number, y: number[]) => [D0 * y[0] - y[1] / EPS0, -y[1] / EPS0];
const Y0 = [1, 1];
const DBG_VIEW = { x: 0, y: 1, xLabel: "u₁", yLabel: "u₂", xDomain: [-4, 4] as [number, number], yDomain: [-4, 4] as [number, number] };
const PG_DOMAIN = { x: [-2.2, 2.2] as [number, number], y: [-0.4, 1.6] as [number, number] };
const PG_LABELS: [string, string] = ["u₁", "u₂"];

const exactOf = (d: number, eps: number) => {
  const k = 1 + d * eps;
  return (t: number) => [(d * eps * Math.exp(d * t) + Math.exp(-t / eps)) / k, Math.exp(-t / eps)];
};
const bookOf = (d: number, eps: number) => (t: number) => [Math.exp(d * t) + (eps * Math.exp(d * t) - Math.exp(-t / eps)) / (1 + d * eps), Math.exp(-t / eps)];

const rk2R = (z: number) => 1 + z + (z * z) / 2;
const rk3R = (z: number) => 1 + z + (z * z) / 2 + (z * z * z) / 6;
const rk4R = (z: number) => 1 + z + (z * z) / 2 + (z * z * z) / 6 + (z * z * z * z) / 24;
const thetaR = (z: number) => (1 + 0.45 * z) / (1 - 0.55 * z);
const trapR = (z: number) => (1 + 0.5 * z) / (1 - 0.5 * z);

function lateMax(s: Solution, err: number[][], tl: number) {
  let m = 0;
  s.t.forEach((t, k) => {
    if (t < tl) return;
    for (const e of err) if (!(e[k] <= m)) m = e[k];
  });
  return m;
}

export default function T2() {
  const [h, setH] = useUrlNum("h", 0.02, 0.001, 0.1);
  const [eps, setEps] = useUrlNum("eps", EPS0, 1e-4, 0.3);
  const [d, setD] = useUrlNum("d", D0, -2, 1);
  const [methods, setMethods] = useUrlState<MethodId[]>("m", ["euler", "ieuler", "theta", "trap"], methodsIn(ALL));
  const [ci, setCi] = useState(0);
  const [book, setBook] = useState(true);
  const dh = useDeferredValue(h);
  const de = useDeferredValue(eps);
  const dd = useDeferredValue(d);
  const T = 10;
  const pb = usePlayback(12);
  useTaskExport(exportT2({ h, eps, d, methods }));

  const exact = useMemo(() => exactOf(dd, de), [dd, de]);
  const problem: Problem = useMemo(
    () => ({
      f: (_t, y) => [dd * y[0] - y[1] / de, -y[1] / de],
      jac: () => [
        [dd, -1 / de],
        [0, -1 / de],
      ],
      y0: [1, 1],
      T,
    }),
    [dd, de],
  );
  const tLate = Math.min(T / 2, Math.max(0.5, 50 * de));

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = solve(m, problem, { h: dh, blowup: 1e6 });
        const e = maxError(s, exact);
        return { m, s, e, late: lateMax(s, e.err, tLate) };
      }),
    [methods, problem, dh, exact, tLate],
  );

  const tMin = Math.min(1e-4, de / 50);
  const grid = useMemo(() => {
    const n = 1600;
    const t: number[] = [];
    for (let i = 0; i <= n; i++) t.push(tMin * Math.pow(T / tMin, i / n));
    const ex = t.map(exact);
    const bk = t.map(bookOf(dd, de));
    return { t, u1: ex.map((v) => v[0]), u2: ex.map((v) => v[1]), b1: bk.map((v) => v[0]) };
  }, [exact, tMin, dd, de]);

  const slow = useMemo(() => {
    const t0 = Math.min(8 * de, T / 4);
    const t: number[] = [];
    for (let i = 0; i <= 600; i++) t.push(t0 + ((T - t0) * i) / 600);
    const y = t.map((x) => exact(x)[ci]);
    let lo = Math.min(...y),
      hi = Math.max(...y);
    const pad = Math.max((hi - lo) * 0.6, Math.abs(hi) * 0.5, 2e-3);
    lo -= pad;
    hi += pad;
    return { t, y, t0, dom: [lo, hi] as [number, number] };
  }, [exact, ci, de]);

  const table = useMemo(
    () =>
      H_LIST.map((hh) =>
        ALL.map((m) => {
          const s = solve(m, problem, { h: hh, blowup: 1e8 });
          const e = maxError(s, exact);
          return { s, e, late: lateMax(s, e.err, tLate) };
        }),
      ),
    [problem, exact, tLate],
  );

  const z = -dh / de;
  const eR = Math.abs(1 + z);
  const kR = Math.abs(rk4R(z));
  const k2R = Math.abs(rk2R(z));
  const k3R = Math.abs(rk3R(z));
  const ratio = 1 / (Math.abs(dd) * de);

  const tNow = tMin * Math.pow(T / tMin, pb.progress);
  const lanes = [
    { label: "точний", color: "#ffffff", u1: exact(tNow)[0], u2: exact(tNow)[1] },
    ...sols.slice(0, 4).map(({ m, s }) => {
      const k = indexAt(s.t, tNow);
      const y = s.t[k] <= tNow ? s.y[k] : s.y[0];
      return { label: METHODS[m].short, color: METHODS[m].color, u1: y[0], u2: y[1] };
    }),
  ];

  const blown = (s: Solution, err: number) => !!s.failed || err > 2;
  const layerDom = useMemo((): [number, number] => {
    const y = ci ? grid.u2 : grid.u1;
    let lo = Infinity,
      hi = -Infinity;
    for (const v of y) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const pad = 0.1 * (hi - lo);
    return [Math.min(-0.35, lo - pad), Math.max(1.35, hi + pad)];
  }, [grid, ci]);
  const series = (logx: boolean) => [
    ...(logx && book && ci === 0
      ? [{ x: grid.t, y: grid.b1, color: "#ff9f43", label: "«точний» з методички", width: 1.5, dash: [5, 4], noRange: true }]
      : []),
    { x: grid.t, y: ci ? grid.u2 : grid.u1, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
    ...sols.map(({ m, s, e }) => ({
      x: s.t,
      y: comp(s, ci),
      color: METHODS[m].color,
      label: METHODS[m].short,
      width: blown(s, e.max) ? 1 : 1.8,
      opacity: blown(s, e.max) ? 0.45 : 1,
    })),
  ];

  const eu = sols.find((x) => x.m === "euler");
  const th = sols.find((x) => x.m === "theta" || x.m === "trap");
  const want = (m: MethodId) => setMethods((ms) => (ms.includes(m) ? ms : [...ms, m]));
  const bookParams = () => {
    setEps(EPS0);
    setD(D0);
  };

  return (
    <>
      <AnalogyCard
        emoji="☕"
        title="Кава з молоком"
        story={
          <>
            Вливаєте холодне молоко в гарячу каву: білий вихор розмішується за <b>секунди</b>, а сама кава холоне <b>пів години</b>. Два процеси з дуже
            різним темпом в одній чашці — саме це описує наша система. Малий параметр ε — «час розмішування»: що він менший, то жорсткіша задача. А
            чисельний метод — бариста, що заглядає в чашку раз на h. Заглядає рідше, ніж раз на 2ε, — і йому ввижається вихор, який не вщухає.
          </>
        }
        mapping={[
          ["вихор молока, що зникає за секунди", <>швидка мода u₂ = e^(−t/ε), λ₂ = −1/ε = −100</>],
          ["кава повільно холоне", <>повільна мода e^(dt), λ₁ = d = −0.5</>],
          ["«час розмішування»", <>малий параметр ε; вихор живе ~5ε (примежовий шар)</>],
          ["як часто бариста заглядає в чашку", <>крок h</>],
          ["баристі ввижається вічний вихор", <>|1 − h/ε| ≥ 1: явний Ейлер на межі (h = 2ε) чи за нею</>],
        ]}
      >
        <CoffeeScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Пір'їнка, що падає двома швидкостями" simpleTitle="Що розв'язуємо: швидке і повільне разом">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`\begin{cases} u_1' = d\,u_1 - \dfrac{u_2}{\varepsilon}, & u_1(0)=1,\\[2mm] u_2' = -\dfrac{u_2}{\varepsilon}, & u_2(0)=1, \end{cases}\qquad t\in[0,10].`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] text-white/70">
                  Параметри з умови: d = −0.5, ε = 0.01, кроки h = 0.01, 0.02, 0.05. Друга змінна u₂ — «вихор молока»: вона просто згасає, причому за
                  одиницю часу аж у e<sup>100</sup> разів. Перша, u₁, — «температура»: у неї свій повільний темп d, але вихор «тягне» її через доданок −u₂/ε.
                  Усе цікаве відбувається за перші кілька ε (≈ 0.05): u₁ падає від 1 майже до нуля. Цей тонкий відрізок часу називають{" "}
                  <b>примежовим шаром</b>. Далі лишається лише повільний хвостик.
                </p>
              }
            >
            <p className="mt-2 text-[14px] text-white/70">
              Параметри <Tex>{"d=-0.5,\\ \\varepsilon=0.01"}</Tex>, кроки <Tex>{"h=0.01,\\ 0.02,\\ 0.05"}</Tex>. Малий параметр <Tex>{"\\varepsilon"}</Tex> стоїть
              у знаменнику — це класична <b>сингулярно збурена</b> система: при <Tex>{"\\varepsilon\\to0"}</Tex> друге рівняння «вироджується» в{" "}
              <Tex>{"u_2=0"}</Tex>, а початкова умова <Tex>{"u_2(0)=1"}</Tex> перестає виконуватись. Розв&apos;язок «рятується» тонким{" "}
              <b>примежовим шаром</b> завтовшки кілька <Tex>{"\\varepsilon"}</Tex>.
            </p>
            </Say>
            <div className="mt-2 text-[13px] text-white/60">Правильний точний розв&apos;язок:</div>
            <Tex block>{String.raw`u_1(t)=\frac{d\varepsilon\,e^{dt}+e^{-t/\varepsilon}}{1+d\varepsilon},\qquad u_2(t)=e^{-t/\varepsilon}.`}</Tex>
          </Card>
          <Card title="Анатомія жорсткості" icon="🔬">
            <p className="text-[14px] leading-relaxed text-white/75">
              Матриця <Tex>{String.raw`A=\begin{pmatrix}d&-1/\varepsilon\\0&-1/\varepsilon\end{pmatrix}`}</Tex> трикутна, тож власні числа видно одразу:
            </p>
            <Tex block>{`\\lambda_1=d=${fmt(d, 3)},\\qquad \\lambda_2=-1/\\varepsilon=${fmt(-1 / eps, 4)}`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Повільний темп d = {fmt(d, 3)}, швидкий −1/ε = {fmt(-1 / eps, 4)} — вони різняться в {fmt(ratio, 4)} разів.{" "}
                  <Relatable kind="ratio" n={ratio} /> Вихор зникає за 5ε = {fmt(5 * eps, 3)}, але явний метод мусить «заглядати в чашку» частіше, ніж раз на
                  2ε = {fmt(2 * eps, 3)}, — і так до самого кінця, навіть коли вихору давно немає. Крок з умови h = 0.02 — <b>рівно на межі</b>, h = 0.05 —
                  за нею.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Коефіцієнт жорсткості <Tex>{`|\\lambda_2/\\lambda_1| = ${fmt(ratio, 4)}`}</Tex>. Швидка мода <Tex>{"e^{-t/\\varepsilon}"}</Tex> вмирає за{" "}
              <Tex>{`5\\varepsilon=${fmt(5 * eps, 3)}`}</Tex>, а явний Ейлер усе одно мусить тримати <Tex>{`h<2\\varepsilon=${fmt(2 * eps, 3)}`}</Tex>. Крок з умови{" "}
              <Tex>{"h=0.02"}</Tex> — <b>рівно на межі</b>, <Tex>{"h=0.05"}</Tex> — за межею.
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="«Точний» розв'язок у методичці — з помилкою"
                simple={
                  <>
                    Формула «точного» розв&apos;язку в методичці хибна: вже на старті вона дає u₁(0) ≈ {fmt(bookOf(D0, EPS0)(0)[0], 3)} замість 1 і не
                    задовольняє саме рівняння. Ми вивели правильну (вона трохи вище) і перевірили підстановкою. Помаранчевий пунктир на графіку — версія з
                    методички, щоб було видно різницю.
                  </>
                }
              >
                Там наведено <Tex>{String.raw`u_1=e^{dt}+\frac{\varepsilon e^{dt}-e^{-t/\varepsilon}}{1+d\varepsilon}`}</Tex>. Але при <Tex>{"t=0"}</Tex> він дає{" "}
                <Tex>{`u_1(0)=\\tfrac{\\varepsilon(1+d)}{1+d\\varepsilon}\\approx ${fmt(bookOf(D0, EPS0)(0)[0], 3)}\\ne1`}</Tex> (для d = −0.5, ε = 0.01), та й
                рівняння не задовольняє (швидка частина має не той знак). Підстановка <Tex>{"u_1=Ce^{dt}+Ke^{-t/\\varepsilon}"}</Tex> дає{" "}
                <Tex>{"K=1/(1+d\\varepsilon)"}</Tex>, <Tex>{"C=d\\varepsilon/(1+d\\varepsilon)"}</Tex> — формулу вище. Помаранчевий пунктир на графіку — версія з
                методички.
              </Insight>
            </div>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Перестрибнути шар чи загрузнути в ньому?" simpleTitle="Крутіть крок і ε — хто встигне за вихором?">
        <Lab
          controls={
            <>
              <Chips
                label="Крок з умови"
                value={H_LIST.includes(h) ? h : -1}
                onChange={(v) => v > 0 && setH(v)}
                options={H_LIST.map((v) => ({ value: v, label: `h = ${v}` }))}
              />
              <Slider label="Довільний крок h" value={h} onChange={setH} min={0.001} max={0.1} log />
              <Slider
                label={<>Малий параметр ε</>}
                value={eps}
                onChange={setEps}
                min={1e-4}
                max={0.3}
                log
                hint="менше ε — тонший шар і жорсткіша задача"
              />
              <Slider label="Повільний показник d" value={d} onChange={setD} min={-2} max={1} step={0.05} hint="d > 0 — повільна мода росте" />
              <button
                onClick={() => {
                  setH(0.02);
                  setEps(EPS0);
                  setD(D0);
                }}
                className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/70 hover:bg-white/10"
              >
                ⟲ параметри з умови
              </button>
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Chips
                label="Компонента"
                value={ci}
                onChange={setCi}
                options={[
                  { value: 0, label: "u₁(t)" },
                  { value: 1, label: "u₂(t)" },
                ]}
              />
              <Toggle label="формула з методички" value={book} onChange={setBook} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Gauge value={eR} label="явний Ейлер |1 − h/ε|" />
                <Gauge value={kR} label="RK4 |R(−h/ε)|" />
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Tex>{`h\\lambda_2 = -h/\\varepsilon = ${fmt(z, 4)}`}</Tex>. Крок проти товщини шару: <Tex>{`h/\\varepsilon=${fmt(-z, 3)}`}</Tex>
                {-z > 1 ? " — шар коротший за один крок!" : " — шар розв'язується кроками."}
                <div className="mt-1.5 text-white/55">
                  Межі явних методів: Ейлер і RK2 — h/ε &lt; 2, RK3 — &lt; 2.51, RK4 — &lt; 2.79. Зараз RK2 |R| ={" "}
                  <span className={k2R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(k2R, 4)}</span>, RK3 |R| ={" "}
                  <span className={k3R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(k3R, 4)}</span>.
                </div>
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title={`Примежовий шар: ${ci ? "u₂" : "u₁"}(t), логарифмічний час`}
              xLabel="t"
              logX
              xDomain={[tMin, T]}
              yDomain={layerDom}
              cursorX={tNow}
              series={series(true)}
            />
          </Card>
          <Grid>
            <Card>
              <Plot
                title={`Повільна стадія, t ≥ ${fmt(slow.t0, 2)}`}
                height={240}
                xLabel="t"
                xDomain={[slow.t0, T]}
                yDomain={slow.dom}
                series={[
                  { x: slow.t, y: slow.y, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
                  ...sols.map(({ m, s, e }) => ({
                    x: s.t,
                    y: comp(s, ci),
                    color: METHODS[m].color,
                    width: blown(s, e.max) ? 1 : 1.6,
                    opacity: blown(s, e.max) ? 0.45 : 1,
                  })),
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="Похибка |u − u_точн| (лог. шкали)"
                height={240}
                xLabel="t"
                logX
                logY
                xDomain={[Math.min(dh, tMin * 10), T]}
                yDomain={[1e-14, 1e4]}
                series={sols.map(({ m, s, e }) => ({
                  x: s.t,
                  y: e.err[ci].map((v) => Math.max(v, 1e-16)),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: 1.5,
                }))}
              />
            </Card>
          </Grid>
          <Card>
            <Plot
              title="Фазова площина (u₁, u₂): стрімкий спуск на повільний многовид u₂ = 0"
              height={260}
              sorted={false}
              xLabel="u₁"
              yLabel="u₂"
              xDomain={[-1.3, 1.3]}
              yDomain={[-1.2, 1.2]}
              series={[
                { x: grid.u1, y: grid.u2, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
                ...sols.map(({ m, s, e }) => ({
                  x: comp(s, 0),
                  y: comp(s, 1),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: blown(s, e.max) ? 1 : 1.5,
                  opacity: blown(s, e.max) ? 0.5 : 0.9,
                })),
              ]}
              markers={lanes.map((l) => ({ x: l.u1, y: l.u2, color: l.color, r: 4 }))}
            />
          </Card>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, e, late }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : fmt(e.max, 3)}
                sub={s.failed ? s.failed : `max похибка · після шару ${fmt(late, 2)} · ${s.steps} кроків · ${fmtMs(s.ms)}`}
                tone={s.failed || e.max > 1 ? "bad" : late > 1e-3 ? "warn" : "good"}
              />
            ))}
          </div>
          {eu && !eu.s.failed && Math.abs(eR - 1) < 0.02 && (
            <Insight
              tone="warn"
              title="Ейлер на лезі: h = 2ε"
              simpleTitle="Бариста на самій межі: h = 2ε"
              simple={
                <>
                  Ейлер заглядає рівно раз на 2ε, і множник для вихору 1 − h/ε = {fmt(1 + z, 3)}. Вихор у його розрахунку не слабне, а щокроку просто
                  змінює напрям: +1, −1, +1… Пір&apos;їнка у сцені нижче вічно підстрибує, а промах після шару так і лишається {fmt(eu.late, 2)}.
                </>
              }
            >
              Множник швидкої моди <Tex>{`1-h/\\varepsilon=${fmt(1 + z, 3)}`}</Tex>: замість згасати, <Tex>{"u_2"}</Tex> щокроку просто міняє знак —
              <Tex>{"u_2^{(n)}=(-1)^n"}</Tex>. Пір&apos;їнка у сцені нижче вічно підстрибує між підлогою і стелею, а похибка після шару так і лишається{" "}
              {fmt(eu.late, 2)}.
            </Insight>
          )}
          {eu && eu.s.failed && (
            <Insight
              tone="bad"
              title="Ейлер вибухнув"
              simple={
                <>
                  Множник {fmt(eR, 3)} більший за 1: вихор, що мав зникнути за {fmt(5 * de, 2)}, у розрахунку Ейлера щокроку зростає в {fmt(eR, 3)} раза.
                  Якби рахувати до t = 10: <Relatable kind="growth" n={Math.pow(eR, T / dh)} />
                </>
              }
            >
              <Tex>{`|1-h/\\varepsilon| = ${fmt(eR, 3)} > 1`}</Tex> — швидка мода, яка мала б зникнути за {fmt(5 * de, 2)} с, множиться на {fmt(eR, 3)} кожен крок.{" "}
              {eu.s.failed}.
            </Insight>
          )}
          {eu && !eu.s.failed && eR < 0.98 && -z > 1 && (
            <Insight
              tone="info"
              title="Ейлер стійкий, але «скаче»"
              simple={
                <>
                  Множник 1 − h/ε = {fmt(1 + z, 3)} від&apos;ємний, але за модулем менший за 1: вихор згасає, хоч щоразу й змінює напрям. Збільште h трохи понад{" "}
                  {fmt(2 * de, 3)} — і почнеться розгойдування.
                </>
              }
            >
              <Tex>{`1-h/\\varepsilon = ${fmt(1 + z, 3)} < 0`}</Tex>: швидка мода згасає зі зміною знаку. Спробуйте h трохи більше {fmt(2 * de, 3)} — і почнеться
              розгойдування.
            </Insight>
          )}
          {th && -z > 2.5 && (
            <Insight
              tone="info"
              title={`${METHODS[th.m].short}: стійко, але з мерехтінням`}
              simple={
                <>
                  {METHODS[th.m].short} не вибухає, але залишок вихору гасить не одразу: множник {fmt(th.m === "trap" ? trapR(z) : thetaR(z), 3)} від&apos;ємний,
                  тож вихор щокроку змінює напрям і слабне тим повільніше, що більший крок. Неявний Ейлер (множник {fmt(1 / (1 - z), 3)}) гасить його майже
                  за один крок.
                </>
              }
            >
              <Tex>{`R(-h/\\varepsilon)=${fmt(th.m === "trap" ? trapR(z) : thetaR(z), 3)}`}</Tex> — від&apos;ємне (при <Tex>{"h/\\varepsilon\\to\\infty"}</Tex>{" "}
              прямує до {th.m === "trap" ? "−1" : "−0.82"}). Неявний метод не вибухає, але залишок швидкої моди згасає зі зміною знака — тим повільніше, що більший
              крок. Неявний Ейлер (<Tex>{`R=${fmt(1 / (1 - z), 3)}`}</Tex>) гасить шар майже миттєво.
            </Insight>
          )}
          {dd > 0 && (
            <Insight
              tone="fun"
              title="d > 0 — повільна мода росте"
              simple={<>При d &gt; 0 «кава» не холоне, а сама нагрівається: після шару розв&apos;язок росте. Але швидкий вихор нікуди не подівся — задача так само жорстка.</>}
            >
              Тепер <Tex>{"\\lambda_1>0"}</Tex>, і розв&apos;язок після шару експоненційно росте. Задача все одно жорстка: швидка мода −1/ε нікуди не ділась.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Пір'їнка в логарифмічному часі" simpleTitle="Пір'їнка: перші миті крупним планом">
        <Card>
          <FeatherScene lanes={lanes} t={tNow} eps={de} tMin={tMin} T={T} clock={pb.progress * 12} />
          <div className="mt-3">
            <PlaybackBar pb={pb} label={`t = ${fmt(tNow, 3)} = ${fmt(tNow / de, 3)}ε`} />
          </div>
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Висота пір&apos;їнки — u₁, світна кулька поруч — «вихор» u₂. Час в анімації розтягнутий на початку: перша половина — лише перші ~5ε, де все й
                відбувається. Кольорові пір&apos;їнки — числові методи; вони рухаються «сходинками», бо знають розв&apos;язок лише в точках своїх кроків.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Висота пір&apos;їнки — <Tex>{"u_1"}</Tex>, світна кулька поруч — швидка мода <Tex>{"u_2"}</Tex>. Час іде логарифмічно: перша половина анімації — це
            мізерні <Tex>{"t\\lesssim 5\\varepsilon"}</Tex>, де все й відбувається. Числові методи показано «сходинками» — значеннями на останньому зробленому кроці.
          </p>
          </Say>
        </Card>
      </Section>

      <Section
        kicker="Результати"
        title={`Похибки на [0, 10] при ε = ${fmt(de, 3)}, d = ${fmt(dd, 3)}`}
        simpleTitle={`Хто наскільки промахнувся (ε = ${fmt(de, 3)}, d = ${fmt(dd, 3)})`}
      >
        <Card>
          <Table
            head={["Метод", ...H_LIST.map((v) => `h = ${v} (h/ε = ${fmt(v / de, 3)})`)]}
            rows={ALL.map((m, j) => [
              <span key={m} style={{ color: METHODS[m].color }}>
                {METHODS[m].name}
              </span>,
              ...H_LIST.map((_, i) => {
                const { s, e, late } = table[i][j];
                if (s.failed) return <span className="text-[#ff5d73]">💥 вибух</span>;
                const c = e.max > 1 || late > 0.1 ? "text-[#ff5d73]" : late > 1e-3 ? "text-[#ffb547]" : "text-[#3ee6a8]";
                return (
                  <span className={c}>
                    {fmt(e.max, 3)} <span className="text-white/40">/ {fmt(late, 2)}</span>
                  </span>
                );
              }),
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Перше число — найбільший промах на всьому відрізку: майже завжди це перший крок, де розв&apos;язок за мить падає з 1 до ≈0. Друге (сіре) —
                найбільший промах після шару, при t ≥ {fmt(tLate, 2)}: воно показує, чи «пам&apos;ятає» метод вихор, якого вже давно немає.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Перше число — максимальна похибка на всьому відрізку (її майже завжди дає шар: за перший крок розв&apos;язок падає від 1 до ≈0), друге (сіре) —
            максимальна похибка після шару, при t ≥ {fmt(tLate, 2)}. Саме друге число показує, чи «пам&apos;ятає» метод про швидку моду.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={F}
          y0={Y0}
          T={3}
          view={DBG_VIEW}
          h0={0.025}
          hMin={0.002}
          hMax={0.1}
          hPresets={H_LIST}
          hint={
            <Say
              simple={
                <>
                  Площина (u₁, u₂), параметри з умови. Точка стартує з (1, 1) і має за мить «впасти» по діагоналі на вісь u₂ = 0 (вихор розмішався), а потім
                  повільно доповзти до нуля. Явний Ейлер з h = 0.025 перестрибує через вісь: u₂ = −1.5, +2.25, −3.4… — кожен стрибок у півтора раза більший.
                  Перемкніть на неявного Ейлера: він падає на вісь за один-два кроки навіть з h = 0.05.
                </>
              }
            >
              Фазова площина (u₁, u₂) при d = −0.5, ε = 0.01. Швидкий власний вектор (1, 1 + dε) — майже діагональ, повільний многовид — вісь u₂ = 0. При h =
              0.025 &gt; 2ε множник явного Ейлера 1 − h/ε = −1.5: кожен крок перекидає точку через многовид і віддаляє в 1.5 раза. Пунктир — точний
              розв&apos;язок задачі Коші з (tₙ, yₙ) на [tₙ, tₙ + h].
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Долийте молока — і подивіться, як система «падає» на повільний многовид" simpleTitle="Долийте молока — і подивіться, що буде" report={false}>
        <PhasePlayground
          f={F}
          init={Y0}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={0.5}
          speedRange={[0.02, 5]}
          trail={6}
          strip={[
            { comp: 0, label: "u₁", color: "#ffd84d" },
            { comp: 1, label: "u₂", color: "#5cc8ff" },
          ]}
          window={8}
          kicks={[
            { label: "Долити молока", emoji: "🥛", apply: (y) => [y[0], y[1] + 1], hint: "u₂ += 1" },
            { label: "Підігріти", emoji: "🔥", apply: (y) => [y[0] + 1, y[1]], hint: "u₁ += 1" },
            { label: "Остудити", emoji: "🧊", apply: (y) => [y[0] - 1, y[1]], hint: "u₁ −= 1" },
          ]}
          underlay={(ctx, { X, Y }) => {
            ctx.setLineDash([6, 5]);
            ctx.strokeStyle = "rgba(255,216,77,0.6)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(X(-2.2), Y(0));
            ctx.lineTo(X(2.2), Y(0));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#3ee6a8";
            ctx.beginPath();
            ctx.arc(X(0), Y(0), 5, 0, Math.PI * 2);
            ctx.fill();
          }}
          hint={
            <Say
              simple={
                <>
                  Клацніть будь-де: точка <b>блискавично</b> ковзає по діагоналі вниз до жовтої осі u₂ = 0 (молоко розмішалось), а потім <b>повільно</b> повзе
                  вздовж неї до зеленої точки (кава вихолола до кімнатної). «🥛 Долити молока» підкидає u₂ на 1 — і знову миттєвий спуск, тепер на одиницю
                  лівіше; «🔥/🧊» зсувають u₁ — і лише повільне сповзання назад.
                </>
              }
            >
              Будь-яка траєкторія за ~5ε = 0.05 потрапляє на повільний многовид u₂ = 0 (жовтий пунктир), рухаючись майже паралельно швидкому власному вектору
              (1, 1 + dε), а далі згасає як e^(dt). Рівновага (0, 0) — стійкий вузол з власними числами d = −0.5 і −1/ε = −100. Параметри — з умови.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="2"
          questions={[
            {
              id: "edge",
              q: <>Явний Ейлер з кроком h = 0.02 (з умови, ε = 0.01). Що буде зі швидкою компонентою u₂ на [0, 10]?</>,
              options: [
                "Згасне за ~5ε, як у точному розв'язку",
                "Вічно стрибатиме: +1, −1, +1, … — не росте і не згасає",
                "Вибухне за кілька десятків кроків",
                "Стане рівно нулем після першого кроку",
              ],
              correct: 1,
              explain: (
                <>
                  Для u₂ явний Ейлер — це множення на 1 − h/ε = 1 − 2 = −1 щокроку, тож u₂⁽ⁿ⁾ = (−1)ⁿ. Точне u₂ = e^(−t/ε) давно нуль, а похибка після шару
                  так і лишається ≈ 1 (у таблиці: 1.0 для h = 0.02).
                </>
              ),
              explainSimple: <>Бариста заглядає рівно раз на 2ε, і щоразу вихор у його розрахунку просто змінює напрям: +1, −1, +1… Не росте, але й не зникає ніколи.</>,
              show: {
                label: "Показати h = 0.02",
                run: () => {
                  bookParams();
                  setH(0.02);
                  want("euler");
                },
              },
            },
            {
              id: "eps",
              q: <>Зменшимо ε у 10 разів (ε = 0.001), а крок лишимо h = 0.01. Що станеться з явним Ейлером?</>,
              options: ["Стане точнішим — шар же тонший", "Нічого не зміниться — крок той самий", "Вибухне: похибка множиться на |1 − h/ε| = 9 щокроку", "Мерехтітиме ±1, як при h = 2ε"],
              correct: 2,
              explain: (
                <>
                  h/ε = 10, тож |1 − h/ε| = 9: похибка множиться на 9 щокроку, і поріг 10⁶ перетинається вже на 7-му кроці (t ≈ 0.07). Тонший шар — жорсткіша
                  задача: межа стійкості стає h &lt; 2ε = 0.002.
                </>
              ),
              explainSimple: (
                <>
                  Що швидше розмішується молоко, то частіше мусить заглядати бариста: при ε = 0.001 — частіше ніж раз на 0.002. А він заглядає раз на 0.01, і
                  вихор у його розрахунку щоразу зростає вдев&apos;ятеро.
                </>
              ),
              show: {
                label: "Показати ε = 0.001, h = 0.01",
                run: () => {
                  setD(D0);
                  setEps(0.001);
                  setH(0.01);
                  want("euler");
                },
              },
            },
            {
              id: "trap",
              q: <>Трапеції з кроком h = 0.05 (h/ε = 5, параметри з умови). Як поведеться залишок швидкої моди u₂?</>,
              options: [
                "Монотонно згасне, як у неявного Ейлера",
                "Згасатиме, але щокроку змінюватиме знак",
                "Вибухне — для явних методів цей крок теж за межею",
                "Залишиться рівно 1 назавжди",
              ],
              correct: 1,
              explain: (
                <>
                  R(−5) = (1 − 2.5)/(1 + 2.5) ≈ −0.43: u₂ = 1, −0.43, 0.18, −0.079, … — згасає в ~2.3 раза щокроку зі зміною знака. Трапеції A-стійкі (не
                  вибухають), але не L-стійкі: R(−∞) = −1, тож при ще більших h/ε зигзаг згасав би ще повільніше.
                </>
              ),
              explainSimple: <>Трапеції не вибухають, але вихор гасять не одразу: він слабне приблизно вдвічі щокроку й щоразу змінює напрям — зигзаг.</>,
              show: {
                label: "Показати трапеції, h = 0.05",
                run: () => {
                  bookParams();
                  setH(0.05);
                  setCi(1);
                  want("trap");
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
            title="Явні методи бачать шар навіть там, де його вже нема"
            simpleTitle="Явні методи бачать вихор, якого вже нема"
            simple={
              <>
                Для параметрів з умови через 0.05 (5ε) від вихору лишається 0.7 %, а через 1 одиницю часу — e<sup>−100</sup> ≈ 4·10⁻⁴⁴, тобто нічого. Проте
                явний Ейлер з h = 0.05 вибухає: його стійкість визначає швидкий темп −100, а не те, що видно на графіку. З h = 0.02 він на самій межі —
                похибка не росте, але й не зникає. RK2 з тим самим кроком теж на межі (його множник рівно 1: залишок вихору не стрибає, а просто завмирає), а
                RK3 і RK4 уже гасять його. З h = 0.05 вибухають усі чотири явні методи.
              </>
            }
          >
            Для параметрів з умови (ε = 0.01): через 0.05 с від <Tex>{"e^{-t/\\varepsilon}"}</Tex> лишається <Tex>{"e^{-5}\\approx0.007"}</Tex>, а через 1 с —{" "}
            <Tex>{"e^{-100}\\approx4\\cdot10^{-44}"}</Tex>. Проте явний Ейлер при h = 0.05 вибухає, бо стійкість визначає <Tex>{"\\lambda_2=-100"}</Tex>, а не те,
            що бачимо на графіку. При h = 0.02 він рівно на межі: похибка не росте, але й не згасає. RK2 при h = 0.02 має <Tex>{"R(-2)=1"}</Tex> — теж на межі,
            тільки залишок швидкої моди не міняє знак, а «застигає»; RK3 і RK4 (<Tex>{"R(-2)=-1/3"}</Tex> і <Tex>{"1/3"}</Tex>) його вже гасять. При h = 0.05
            (h/ε = 5) вибухають усі чотири явні методи.
          </Insight>
          <Insight
            tone="good"
            title="Неявні методи «перестрибують» шар"
            simple={
              <>
                Неявний Ейлер і BDF2 з кроком 0.05 (у 5 разів більшим за товщину шару!) промахуються на ~0.16 лише на першому кроці, а після шару — на
                ~10⁻⁵. Деталей розмішування вони не бачать, але й не потребують: повільну частину вони рахують точно.
              </>
            }
          >
            Неявний Ейлер і BDF2 з h = 0.05 (у 5 разів більше товщини шару!) дають похибку ~0.16 лише на першому кроці, а після шару — <Tex>{"\\sim10^{-5}"}</Tex>{" "}
            (див. таблицю). Деталі шару вони не бачать, але й не потребують: для повільної стадії вони точні.
          </Insight>
          <Insight
            tone="info"
            title="θ = 0.55 і трапеції — чесні, але «дзвінкі»"
            simple={
              <>
                Вони не вибухають, але залишок вихору не глушать, а «перевертають»: при дуже великому кроці множник прямує до −0.82 (θ = 0.55) і −1
                (трапеції). На фазовій площині це видно як зигзаг навколо прямої u₂ = 0.
              </>
            }
          >
            Їх <Tex>{"R(-\\infty)"}</Tex> = −0.82 і −1, тому при <Tex>{"h\\gg\\varepsilon"}</Tex> швидка мода не зникає, а повільно затухає зі зміною знака. На
            фазовій площині це видно як «зигзаг» навколо прямої <Tex>{"u_2=0"}</Tex>.
          </Insight>
          <Insight
            tone="note"
            title="Мораль про примежовий шар"
            simpleTitle="Мораль"
            simple={
              <>
                Тут живуть два світи: швидкий (масштаб ε — розмішування) і повільний (масштаб 1/|d| — охолодження). Явний метод змушений жити в швидкому
                світі весь час, неявний — лише поки вихор справді є.
              </>
            }
          >
            Сингулярно збурена задача — це два світи: швидкий (масштаб ε) і повільний (масштаб 1/|d|). Явному методу доводиться жити в швидкому світі завжди, неявному —
            лише поки шар реально існує.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Назву «примежовий шар» увів Людвіг Прандтль 1904 року — у коротенькій (8 сторінок) доповіді про тонкий шар біля поверхні тіла, яке обтікає
                повітря чи рідина. З неї виросли аеродинаміка літаків і теорія сингулярних збурень — та сама, що описує нашу каву й пір&apos;їнку.
              </>
            }
          >
            Термін «примежовий шар» увів Людвіг Прандтль 1904 року в доповіді на 8 сторінок про тонкий шар повітря біля крила. Ця ідея породила аеродинаміку
            літаків і теорію сингулярних збурень — ту саму, що описує нашу пір&apos;їнку.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
