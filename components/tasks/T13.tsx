"use client";

import { useDeferredValue, useMemo } from "react";
import Plot from "@/components/plot/Plot";
import GiantStepsScene from "@/components/scenes/GiantStepsScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, Slider, Toggle } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { sampleAt, solve, type Problem } from "@/lib/ode";
import { thetaTrace } from "@/lib/t13-theta";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import GpsScene from "@/components/analogy/GpsScene";
import { Say } from "@/components/mode/Mode";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { useTaskExport } from "@/components/share/TaskActions";
import { exportT13 } from "@/components/share/TaskExports";
import { intIn, useUrlNum } from "@/components/share/TaskUrl";
import { codecs, useUrlState } from "@/lib/url-state";
import { duration } from "@/lib/relatable";

interface Cfg {
  id: string;
  label: string;
  title: string;
  problem: Omit<Problem, "T">;
  Ts: number[];
  atolF: number;
  refAtol: number;
  comps: { i: number; label: string; scale: number }[];
  logX: boolean;
  about: string;
}

const COLORS = ["#ffe66d", "#ff7ad9", "#5cc8ff"];

const PROBLEMS: Cfg[] = [
  {
    id: "rob",
    label: "Робертсон (№12)",
    title: "Кінетика Робертсона",
    problem: {
      f: (_t, y) => [-0.04 * y[0] + 1e4 * y[1] * y[2], 0.04 * y[0] - 1e4 * y[1] * y[2] - 3e7 * y[1] * y[1], 3e7 * y[1] * y[1]],
      jac: (_t, y) => [
        [-0.04, 1e4 * y[2], 1e4 * y[1]],
        [0.04, -1e4 * y[2] - 6e7 * y[1], -1e4 * y[1]],
        [0, 6e7 * y[1], 0],
      ],
      y0: [1, 0, 0],
    },
    Ts: [40, 4e5, 1e11],
    atolF: 1e-6,
    refAtol: 1e-14,
    comps: [
      { i: 0, label: "u₁", scale: 1 },
      { i: 1, label: "u₂·10⁴", scale: 1e4 },
      { i: 2, label: "u₃", scale: 1 },
    ],
    logX: true,
    about: "A → B → C із константами від 0.04 до 3·10⁷: власні числа якобіана від ~10⁻² до ~10⁴. Класичний тест жорстких розв'язувачів.",
  },
  {
    id: "t1",
    label: "Струми (№1)",
    title: "Струми в колі, λ₂/λ₁ ≈ 1000",
    problem: {
      f: (_t, y) => [-1001 * y[0] + y[1] + 1000, y[0] - y[1]],
      jac: () => [
        [-1001, 1],
        [1, -1],
      ],
      y0: [0, 0],
    },
    Ts: [5, 20],
    atolF: 1e-3,
    refAtol: 1e-12,
    comps: [
      { i: 0, label: "u₁", scale: 1 },
      { i: 1, label: "u₂", scale: 1 },
    ],
    logX: true,
    about: "Лінійна система із задачі 1: примежовий шар ~0.001 с, потім повільне наближення до 1.",
  },
  {
    id: "t3",
    label: "λ = −1, −500 (№3)",
    title: "Лінійна система з λ₁ = −1, λ₂ = −500",
    problem: {
      f: (_t, y) => [1525 * y[0] + 1350 * y[1], -2289 * y[0] - 2026 * y[1]],
      jac: () => [
        [1525, 1350],
        [-2289, -2026],
      ],
      y0: [1, 1],
    },
    Ts: [10],
    atolF: 1e-3,
    refAtol: 1e-12,
    comps: [
      { i: 0, label: "u₁", scale: 1 },
      { i: 1, label: "u₂", scale: 1 },
    ],
    logX: true,
    about: "Різкий перехідний процес (компоненти до ±7.5 за 0.01 с), далі — e^{−t}.",
  },
  {
    id: "bru",
    label: "Брюсселятор A=50, B=80",
    title: "Брюсселятор A = 50, B = 80",
    problem: {
      f: (_t, y) => [50 + y[0] * y[0] * y[1] - 81 * y[0], 80 * y[0] - y[0] * y[0] * y[1]],
      jac: (_t, y) => [
        [2 * y[0] * y[1] - 81, y[0] * y[0]],
        [80 - 2 * y[0] * y[1], -y[0] * y[0]],
      ],
      y0: [50, 80],
    },
    Ts: [10, 100],
    atolF: 1e-3,
    refAtol: 1e-10,
    comps: [
      { i: 0, label: "u₁", scale: 1 },
      { i: 1, label: "u₂", scale: 1 },
    ],
    logX: true,
    about: "Рівновага (50, 1.6) стійка, власні числа ≈ −2420 і ≈ −1.03: жорсткість ~2300.",
  },
  {
    id: "vdp",
    label: "Ван дер Поль μ = 1000",
    title: "Ван дер Поль, μ = 1000",
    problem: {
      f: (_t, y) => [y[1], 1000 * (1 - y[0] * y[0]) * y[1] - y[0]],
      jac: (_t, y) => [
        [0, 1],
        [-2000 * y[0] * y[1] - 1, 1000 * (1 - y[0] * y[0])],
      ],
      y0: [2, 0],
    },
    Ts: [3000],
    atolF: 1e-3,
    refAtol: 1e-10,
    comps: [{ i: 0, label: "u", scale: 1 }],
    logX: false,
    about: "Релаксаційні коливання з періодом ≈ 1600: довгі повільні ділянки і миттєві стрибки.",
  },
];

const TOLS = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6];
const BLOWUP = 1e6;

function relErr(t: number[], y: number[][], ref: { t: number[]; y: number[][] }, comps: number[]) {
  const scale = comps.map((i) => ref.y.reduce((m, v) => Math.max(m, Math.abs(v[i])), 0) || 1);
  const series = comps.map((i) => ref.y.map((v) => v[i]));
  let m = 0;
  t.forEach((tt, k) => {
    comps.forEach((i, j) => {
      const d = Math.abs(y[k][i] - sampleAt(ref.t, series[j], tt)) / scale[j];
      if (!(d <= m)) m = d;
    });
  });
  return m;
}

/** Moments when component 0 crosses zero downwards (relaxation jumps of Van der Pol). */
function downCrossings(t: number[], y: number[][]) {
  const out: number[] = [];
  for (let k = 1; k < t.length; k++) if (y[k - 1][0] > 0 && y[k][0] <= 0) out.push(t[k - 1] + ((t[k] - t[k - 1]) * y[k - 1][0]) / (y[k - 1][0] - y[k][0]));
  return out;
}

/** Max shift of the jump moments vs the reference, relative to T (for relaxation oscillations max|Δu| is meaningless). */
function jumpShift(t: number[], y: number[][], ref: { t: number[]; y: number[][] }, T: number) {
  const a = downCrossings(t, y);
  const b = downCrossings(ref.t, ref.y);
  if (a.length !== b.length) return Infinity;
  let m = 0;
  a.forEach((v, i) => (m = Math.max(m, Math.abs(v - b[i]))));
  return m / T;
}

export default function T13() {
  const [pid, setPid] = useUrlState("p", "rob", codecs.enum(PROBLEMS.map((p) => p.id)));
  const [Ti, setTi] = useUrlState("Ti", 1, intIn(0, 2));
  const [rtol, setRtol] = useUrlNum("rtol", 1e-3, 1e-6, 1e-2);
  const [theta, setTheta] = useUrlNum("theta", 0.55, 0.5, 1);
  const [showDop, setShowDop] = useUrlState("dop", true);
  const cfg = PROBLEMS.find((p) => p.id === pid)!;
  const T = cfg.Ts[Math.min(Ti, cfg.Ts.length - 1)];
  const dT = useDeferredValue(T);
  const dr = useDeferredValue(rtol);
  const dth = useDeferredValue(theta);
  const dcfg = useDeferredValue(cfg);
  const pb = usePlayback(16);
  useTaskExport(exportT13({ pid, T, rtol, atolF: cfg.atolF, theta, showDop }));

  const problem: Problem = useMemo(() => ({ ...dcfg.problem, T: dT }), [dcfg, dT]);
  const ci = dcfg.comps.map((c) => c.i);
  const ref = useMemo(() => solve("ros", problem, { rtol: 1e-8, atol: dcfg.refAtol, maxSteps: 400000 }), [problem, dcfg]);
  // for relaxation oscillations max|Δu| only measures the shift of the jump moments — so measure that shift directly
  const byJumps = dcfg.id === "vdp";
  const errOf = (t: number[], y: number[][]) => (byJumps ? jumpShift(t, y, ref, dT) : relErr(t, y, ref, ci));

  const tr = useMemo(() => thetaTrace(problem, { theta: dth, rtol: dr, atol: dr * dcfg.atolF, blowup: BLOWUP, maxFevals: 700000 }), [problem, dth, dr, dcfg]);
  const ros = useMemo(() => solve("ros", problem, { rtol: dr, atol: dr * dcfg.atolF }), [problem, dr, dcfg]);
  const dop = useMemo(() => (showDop ? solve("dopri", problem, { rtol: dr, atol: dr * dcfg.atolF, maxSteps: 50000 }) : null), [problem, dr, dcfg, showDop]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const errTheta = useMemo(() => errOf(tr.t, tr.y), [tr, ref]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const errRos = useMemo(() => errOf(ros.t, ros.y), [ros, ref]);

  const sweep = useMemo(
    () =>
      TOLS.map((tol) => {
        const a = thetaTrace(problem, { theta: dth, rtol: tol, atol: tol * dcfg.atolF, blowup: BLOWUP, maxFevals: 250000 });
        const r = solve("ros", problem, { rtol: tol, atol: tol * dcfg.atolF });
        const d = solve("dopri", problem, { rtol: tol, atol: tol * dcfg.atolF, maxSteps: 30000 });
        return { tol, a, r, d, ea: errOf(a.t, a.y), er: errOf(r.t, r.y) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [problem, dth, dcfg, ref],
  );

  const hMin = tr.hs.length ? tr.hs.reduce((a, b) => Math.min(a, b), Infinity) : NaN;
  const hMax = tr.hs.length ? tr.hs.reduce((a, b) => Math.max(a, b), -Infinity) : NaN;
  const nFixed = dT / hMin;
  const tMin = Math.max(hMin, dT * 1e-12);

  const att = tr.attempts;
  const k = Math.min(att.length - 1, Math.floor(pb.progress * att.length));
  const cur = att[Math.max(0, k)];
  const tCur = cur ? cur.t + (cur.accepted ? cur.h : 0) : 0;

  const accIdx: number[] = [];
  const accR: number[] = [];
  const rejIdx: number[] = [];
  const rejR: number[] = [];
  const rejT: number[] = [];
  const rejH: number[] = [];
  att.forEach((a, i) => {
    const r = Number.isFinite(a.ratio) ? Math.max(a.ratio, 1e-8) : 1e3;
    if (a.accepted) {
      accIdx.push(i + 1);
      accR.push(r);
    } else {
      rejIdx.push(i + 1);
      rejR.push(r);
      rejT.push(a.t + a.h);
      rejH.push(a.h);
    }
  });

  const solSeries = dcfg.comps.flatMap((c, j) => [
    { x: ref.t.slice(1), y: ref.y.slice(1).map((v) => v[c.i] * c.scale), color: COLORS[j], width: 3, opacity: 0.25, label: `${c.label} еталон` },
    {
      x: tr.t.slice(1),
      y: tr.y.slice(1).map((v) => v[c.i] * c.scale),
      color: COLORS[j],
      label: `${c.label} θ-адапт.`,
      ...(tr.steps <= 500 ? { dots: true, dotSize: 2.4 } : { width: 1.4 }),
    },
  ]);

  const growth = hMax / hMin;
  const rosRatio = ros.steps / Math.max(1, tr.steps);

  const robDefaults = (tol: number) => {
    setPid("rob");
    setTi(1);
    setTheta(0.55);
    setRtol(tol);
  };

  return (
    <>
      <AnalogyCard
        emoji="🧭"
        title="GPS-навігатор: у місті щосекунди, на трасі — раз на годину"
        story={
          <>
            Навігатор у місті перераховує маршрут постійно: повороти, світлофори, все змінюється за секунди. На трасі він може мовчати годинами — дорога пряма,
            нічого не відбувається. Адаптивний метод поводиться так само: дрібні кроки там, де розв&apos;язок стрімко змінюється, і величезні — там, де він ледь
            рухається. А A-стійкість гарантує, що навіть дуже довгий крок не «зірве» розрахунок: крок обмежує лише точність, а не стійкість.
          </>
        }
        mapping={[
          ["один перерахунок маршруту", <>один прийнятий крок θ-методу</>],
          ["місто: перерахунок щомиті", <>стрімкий старт, крок ~2.5·10⁻⁷</>],
          ["траса: раз на кілька годин", <>повільна стадія, крок до ~10⁴–10⁵</>],
          ["«ой, не туди» — перерахувати заново", <>відхилений крок: оцінка похибки більша за допуск</>],
          ["точність навігатора", <>допуск rtol</>],
        ]}
      >
        <GpsScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Метод, що вміє міняти крок" simpleTitle="Метод, що сам обирає крок">
        <Grid>
          <Card title="Умова з методички" icon="📜">
            <p className="text-[14px] text-white/75">«В умовах задачі 9 застосувати А-стійкий лінійний однокроковий метод зі змінним кроком</p>
            <Tex block>{String.raw`y_n = y_{n-1} + h_n\big(0.55\,f_n + 0.45\,f_{n-1}\big),\qquad n=1,2,\dots\text{»}`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Це вже знайомий θ-метод з θ = 0.55: він не вибухає за жодного кроку (A-стійкий), але має лише перший порядок точності. Раз стійкість крок
                  більше не обмежує, його обмежує тільки точність — тож крок можна й треба змінювати: дрібний там, де розв&apos;язок стрімко змінюється, і
                  величезний там, де він ледь рухається.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Це θ-метод з <Tex>{"\\theta=0.55"}</Tex>: функція підсилення <Tex>{"R(z)=\\frac{1+0.45z}{1-0.55z}"}</Tex>, <Tex>{"|R|\\le1"}</Tex> на всій лівій
              півплощині (A-стійкість), порядок 1 (бо <Tex>{"\\theta\\ne\\tfrac12"}</Tex>). Стійкість більше не обмежує крок — його обмежує лише точність. А отже,
              крок можна й треба змінювати: дрібний там, де розв&apos;язок стрімко змінюється, і величезний там, де він ледь рухається.
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="Задачі №9 у переліку немає"
                simple={
                  <>
                    Задачі №9 у методичці немає, тож за замовчуванням беремо найпоказовішу жорстку задачу — хімію Робертсона (№12) на відрізку до 4·10⁵, де
                    крок має вирости більш ніж у 10¹⁰ разів. Інші задачі (№1, №3, брюсселятор, Ван дер Поль μ = 1000) — у перемикачі.
                  </>
                }
              >
                Тому за замовчуванням застосовуємо метод до найпоказовішої жорсткої задачі — кінетики Робертсона (№12) на довгому інтервалі{" "}
                <Tex>{"[0,4\\cdot10^5]"}</Tex>, де крок має вирости більш ніж на 10 порядків. Інші задачі (№1, №3, брюсселятор, Ван дер Поль μ = 1000) — у
                перемикачі.
              </Insight>
            </div>
          </Card>
          <Card title="Як метод сам обирає крок" icon="⚙️">
            <Say
              simple={
                <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-white/75">
                  <li>Робимо один крок довжини h і, окремо, два кроки по h/2 (на кожному розв&apos;язуємо рівняння кроку методом Ньютона).</li>
                  <li>Різниця між цими двома відповідями — оцінка похибки (оцінка Річардсона): якщо вони майже збігаються, крок «безпечний».</li>
                  <li>Похибка вклалася в допуск (rtol, atol) — крок приймаємо і беремо точнішу відповідь; не вклалася — відкидаємо й пробуємо менший крок.</li>
                  <li>
                    Наступний крок обираємо за тим, наскільки «із запасом» вклалися: до 4 разів більший, якщо похибка мізерна, і до 5 разів менший, якщо ледь не
                    вклалися. Якщо Ньютон не впорався — крок відкидаємо й беремо вчетверо менший.
                  </li>
                </ol>
              }
            >
            <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-white/75">
              <li>
                Робимо один крок <Tex>{"h"}</Tex> → <Tex>{"y_h"}</Tex> і два кроки <Tex>{"h/2"}</Tex> → <Tex>{"y_{h/2,h/2}"}</Tex> (подвоєння кроку). Неявне рівняння
                розв&apos;язуємо методом Ньютона з якобіаном <Tex>{"(I-\\theta hJ)\\,\\Delta=-G"}</Tex>.
              </li>
              <li>
                Оцінка Річардсона для методу порядку <Tex>{"p"}</Tex>: <Tex>{String.raw`\text{err}\approx\dfrac{y_{h/2,h/2}-y_h}{2^p-1}`}</Tex>.
              </li>
              <li>
                Масштабована норма <Tex>{String.raw`\|\text{err}\|=\max_i\frac{|\text{err}_i|}{\text{atol}+\text{rtol}\max(|y_{n-1,i}|,|y_{n,i}|)}`}</Tex>. Якщо{" "}
                <Tex>{"\\le1"}</Tex> — крок прийнято (беремо <Tex>{"y_{h/2,h/2}"}</Tex>), інакше — відхилено і повторено з меншим h.
              </li>
              <li>
                Новий крок: <Tex>{String.raw`h_{\text{new}}=h\cdot\min\!\Big(4,\ \max\big(0.2,\ 0.9\,\|\text{err}\|^{-1/(p+1)}\big)\Big)`}</Tex>; якщо Ньютон не
                збігся — крок відхилено і <Tex>{"h\\to h/4"}</Tex>.
              </li>
            </ol>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Від мурахи до велетня">
        <Lab
          controls={
            <>
              <Chips label="Задача" value={pid} onChange={(v) => { setPid(v); setTi(v === "rob" ? 1 : 0); }} options={PROBLEMS.map((p) => ({ value: p.id, label: p.label }))} />
              <div className="text-[12px] text-white/50">{cfg.about}</div>
              {cfg.Ts.length > 1 && (
                <Chips label="Інтервал [0, T]" value={Math.min(Ti, cfg.Ts.length - 1)} onChange={setTi} options={cfg.Ts.map((v, i) => ({ value: i, label: `T = ${fmt(v, 2)}` }))} />
              )}
              <Slider label="Точність rtol" value={rtol} onChange={setRtol} min={1e-6} max={1e-2} log hint={`atol = rtol · ${fmt(cfg.atolF, 1)}`} />
              <Slider label="Параметр θ" value={theta} onChange={setTheta} min={0.5} max={1} step={0.01} hint="0.55 — з умови; 0.5 — трапеції; 1 — неявний Ейлер" />
              <button
                onClick={() => {
                  setTheta(0.55);
                  setRtol(1e-3);
                }}
                className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/70 hover:bg-white/10"
              >
                ⟲ θ = 0.55, rtol = 10⁻³
              </button>
              <Toggle label="порівняти з DOPRI45 (явний)" value={showDop} onChange={setShowDop} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                Крок виріс у <b className="text-white">{fmt(growth, 3)}</b> разів: від {fmt(hMin, 3)} до {fmt(hMax, 3)}.
                {Number.isFinite(growth) && growth > 1 && (
                  <Say simple={<> Якби найкоротший крок тривав 1 секунду, найдовший тривав би {duration(growth)}.</>}>{null}</Say>
                )}
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title={`${dcfg.title}: розв'язок (точки — кроки θ-методу)`}
              xLabel="t"
              logX={dcfg.logX}
              xDomain={dcfg.logX ? [tMin, dT] : [0, dT]}
              cursorX={tCur > 0 ? tCur : undefined}
              series={solSeries}
            />
          </Card>
          <Card>
            <Plot
              title="Крок h(t): θ-метод, відхилені спроби, Розенброк і DOPRI"
              height={300}
              xLabel="t"
              logX={dcfg.logX}
              logY
              xDomain={dcfg.logX ? [tMin, dT] : [0, dT]}
              cursorX={tCur > 0 ? tCur : undefined}
              series={[
                ...(dop ? [{ x: dop.t.slice(1), y: dop.hs, color: METHODS.dopri.color, label: `DOPRI45 (${dop.steps})`, width: 1, opacity: 0.7 }] : []),
                { x: ros.t.slice(1), y: ros.hs, color: METHODS.ros.color, label: `Розенброк (${ros.steps})`, width: 1.5, opacity: 0.8 },
                { x: tr.t.slice(1), y: tr.hs, color: METHODS.thetaA.color, label: `θ-адапт. (${tr.steps})`, width: 2.2 },
                ...(tr.steps <= 800 ? [{ x: tr.t.slice(1), y: tr.hs, color: METHODS.thetaA.color, dots: true, dotSize: 2.2 }] : []),
                { x: rejT, y: rejH, color: "#ff5d73", label: `відхилено (${tr.rejected})`, dots: true, dotSize: 3.2 },
              ]}
              markers={cur ? [{ x: Math.max(cur.t + cur.h, tMin), y: cur.h, color: cur.accepted ? "#ffffff" : "#ff5d73", r: 6 }] : undefined}
            />
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Контролер: ‖err‖/tol для кожної спроби"
                height={240}
                xLabel="№ спроби"
                logY
                yDomain={[1e-6, 1e3]}
                cursorX={k + 1}
                series={[
                  { x: [1, Math.max(2, att.length)], y: [1, 1], color: "#ffffff66", width: 1, dash: [5, 4] },
                  { x: accIdx, y: accR, color: "#3ee6a8", label: "прийнято", dots: true, dotSize: 2.4 },
                  { x: rejIdx, y: rejR, color: "#ff5d73", label: "відхилено", dots: true, dotSize: 3 },
                ]}
              />
            </Card>
            <div className="grid grid-cols-2 content-start gap-2">
              <Stat label="θ-адапт.: кроки" value={tr.failed ? "💥" : tr.steps} sub={tr.failed ?? `відхилено ${tr.rejected} · ${fmtMs(tr.ms)}`} tone={tr.failed ? "bad" : "good"} />
              <Stat label="f / Якобіанів / Ньютон" value={`${tr.fevals} / ${tr.jevals}`} sub={`ітерацій Ньютона ${tr.newton}`} />
              <Stat
                label={byJumps ? "Зсув моментів стрибків θ" : "Відносна похибка θ"}
                value={fmt(errTheta, 3)}
                sub={byJumps ? "max |Δt стрибка| / T — для релаксаційних коливань max|Δu| не показовий" : "max по траєкторії, до масштабу компоненти"}
                tone={errTheta > 0.05 ? "warn" : "good"}
              />
              <Stat label="Сталий крок h_min" value={fmt(nFixed, 3)} sub={`кроків знадобилося б (×${fmt(nFixed / Math.max(1, tr.steps), 2)})`} tone="warn" />
              <Stat label="Розенброк" value={ros.failed ? "💥" : ros.steps} sub={`відхилено ${ros.rejected} · похибка ${fmt(errRos, 2)} · ${fmtMs(ros.ms)}`} />
              {dop && (
                <Stat
                  label="DOPRI45"
                  value={dop.failed ? "⛔" : dop.steps}
                  sub={dop.failed ? dop.failed : `відхилено ${dop.rejected} · ${fmtMs(dop.ms)}`}
                  tone={dop.failed ? "bad" : dop.steps > 20 * tr.steps ? "warn" : "default"}
                />
              )}
            </div>
          </Grid>
          {tr.failed && (
            <Insight tone="bad" title="θ-метод не дійшов до кінця" simple={<>{tr.failed}. Метод не впорався з такою точністю — спробуйте послабити rtol.</>}>
              {tr.failed}. Спробуйте послабити точність.
            </Insight>
          )}
          {growth > 1e4 && (
            <Insight
              tone="good"
              title={`Крок виріс на ${Math.round(Math.log10(growth))} порядків`}
              simple={
                <>
                  Найдрібніший крок {fmt(hMin, 2)} знадобився лише на самому старті, де все стрімко змінюється. Далі розв&apos;язок гладкий, і крок росте, поки
                  дозволяє точність. Зі сталим найдрібнішим кроком знадобилося б {fmt(nFixed, 3)} кроків замість {tr.steps}. <Relatable kind="steps" n={nFixed} />
                </>
              }
            >
              Найдрібніший крок {fmt(hMin, 2)} знадобився лише на старті, у швидкому перехідному процесі. Далі розв&apos;язок гладкий, а A-стійкість дозволяє кроку
              рости, доки дозволяє точність. Зі сталим кроком h<sub>min</sub> довелося б зробити {fmt(nFixed, 3)} кроків — замість {tr.steps}.
            </Insight>
          )}
          {dop && dop.failed && (
            <Insight
              tone="bad"
              title="DOPRI45 «здувся»"
              simple={
                <>
                  Явний адаптивний метод теж уміє міняти крок, але не може перескочити межу стійкості: його крок не росте понад ~3.3/|λ<sub>max</sub>|. Він
                  вичерпав 50 000 кроків і доїхав лише до t ≈ {fmt(dop?.t[dop.t.length - 1] ?? NaN, 3)} з {fmt(dT, 3)}.
                </>
              }
            >
              Явний адаптивний метод теж вміє змінювати крок, але не може вийти з області стійкості: <Tex>{"h\\lesssim3.3/|\\lambda_{max}|"}</Tex>. Ліміт 50 000
              кроків вичерпано, а пройдено лише до t ≈ {fmt(dop.t[dop.t.length - 1], 3)} із {fmt(dT, 3)}.
            </Insight>
          )}
          {dop && !dop.failed && dop.steps > 10 * tr.steps && (
            <Insight
              tone="warn"
              title={`DOPRI45 зробив у ${fmt(dop.steps / tr.steps, 3)} разів більше кроків`}
              simple={
                <>
                  Подивіться на його h(t): крок уперся в «стелю стійкості» і стоїть на місці, хоча розв&apos;язок майже не змінюється. Високий (5-й) порядок тут не
                  рятує.
                </>
              }
            >
              Подивіться на його h(t): він вперся в стелю стійкості і «дріботить» сталим кроком навіть там, де розв&apos;язок майже не змінюється. Його 5-й порядок
              тут не рятує.
            </Insight>
          )}
          {dth < 0.52 && (
            <Insight
              tone="warn"
              title="θ ≈ 0.5: трапеції — точніші, але «дзвінкі»"
              simple={
                <>
                  При θ = 0.5 (трапеції) метод має 2-й порядок, тож кроків зазвичай навіть менше (тут {tr.steps}, відхилено {tr.rejected}). Але швидкі складові він
                  не гасить, а «перевертає» з множником, близьким до −1: будь-який різкий поштовх довго «дзвенить». θ = 0.55 гасить такий дзвін ціною першого
                  порядку.
                </>
              }
            >
              При <Tex>{"\\theta=0.5"}</Tex> метод має 2-й порядок, тож за тієї ж точності кроків зазвичай менше (тут {tr.steps}, відхилено {tr.rejected}). Але{" "}
              <Tex>{"R(-\\infty)=-1"}</Tex>: жорсткі компоненти не гасяться, а «дзвенять» зі зміною знака, і будь-яке різке збурення живе довго. θ = 0.55 дає{" "}
              <Tex>{"|R(-\\infty)|\\approx0.82"}</Tex> — дзвін згасає ціною першого порядку.
            </Insight>
          )}
          {!dop?.failed && rosRatio < 0.8 && (
            <Insight
              tone="info"
              title="Розенброк ефективніший"
              simple={
                <>
                  Розенброк зробив {ros.steps} кроків проти {tr.steps}: у нього вищий (2-й) порядок, тож за тієї ж точності кроки ширші. θ-метод першого порядку за
                  кожен додатковий знак точності (у 10 разів меншу загальну похибку) платить приблизно вдесятеро більшою кількістю кроків.
                </>
              }
            >
              Розенброк 2-го порядку зробив {ros.steps} кроків проти {tr.steps}: вищий порядок дозволяє ширші кроки за тієї ж точності. θ-метод — 1-го порядку, тож за
              кожен додатковий знак точності платить ~10× кроків.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Кроки велетня">
        <Card>
          <GiantStepsScene attempts={att} k={k} tMin={tMin} T={dT} logX={dcfg.logX} hLo={hMin} hHi={hMax} />
          <div className="mt-3">
            <PlaybackBar pb={pb} label={`спроба ${k + 1}/${att.length}`} />
          </div>
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Кожен слід — прийнятий крок; що більший слід, то довший крок. Червоний ✗ — невдала спроба: похибка вийшла завеликою (або Ньютон не впорався), і
                метод повторює крок, зменшивши його. Мандрівник росте від мурахи до динозавра разом із кроком.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Кожен слід — прийнятий крок; що більший слід, то довший крок (лог-шкала від h<sub>min</sub> до h<sub>max</sub>). Червоний ✗ — відхилена спроба: оцінка
            похибки перевищила допуск (або Ньютон не збігся), і метод повторює крок із меншим h (h × fac, fac {"<"} 1). Мандрівник росте від мурахи до динозавра
            разом із кроком.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Результати" title={`Ціна точності: ${dcfg.title}, T = ${fmt(dT, 3)}`} simpleTitle={`Скільки коштує точність: ${dcfg.title}`}>
        <Card>
          <Table
            head={["rtol", "θ-адапт.: кроки / відхил.", "f-обчислень", byJumps ? "зсув стрибків θ" : "похибка θ", "Розенброк: кроки", byJumps ? "зсув стрибків Р." : "похибка Р.", "DOPRI45: кроки"]}
            rows={sweep.map(({ tol, a, r, d, ea, er }) => [
              fmt(tol, 1),
              <span key="a" className="text-[#4dd0e1]">
                {a.failed ? "💥" : `${a.steps} / ${a.rejected}`}
              </span>,
              a.fevals,
              fmt(ea, 2),
              r.failed ? "💥" : r.steps,
              fmt(er, 2),
              d.failed ? <span className="text-[#ff5d73]">⛔ &gt;30 000 (t ≈ {fmt(d.t[d.t.length - 1], 2)})</span> : d.steps,
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                {byJumps
                  ? "Тут розв'язок стрибає, тож порівнюємо моменти стрибків з еталоном: наскільки метод запізнився чи поспішив (частка від T). "
                  : "Похибка — найбільше відхилення від дуже точного еталона (Розенброк, rtol = 10⁻⁸), у частках розміру кожної компоненти. "}
                Що менший допуск rtol, то більше кроків. Але метод стежить лише за похибкою одного кроку (вона ∝ h²), тож у 10 разів менший rtol дає лише ~3×
                більше кроків — і загальна похибка теж зменшується лише ~в 3 рази, а не в 10.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            {byJumps
              ? "Для релаксаційних коливань порівнюємо моменти стрибків (переходів u через нуль униз) з еталоном (Розенброк, rtol = 10⁻⁸): максимальний зсув, поділений на T. "
              : "Похибка — максимальне відхилення від еталону (Розенброк, rtol = 10⁻⁸) по всіх точках, віднесене до масштабу кожної компоненти. "}
            Зверніть увагу: контролюється лише <b>локальна</b> похибка кроку, для θ-методу вона ∝ h², тож зменшення rtol у 10 разів дає лише ~√10 ≈ 3× більше кроків — і
            глобальна похибка (∝ h) теж спадає лише в ~3 рази, а не в 10.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="13"
          questions={[
            {
              id: "growth",
              q: <>Робертсон на [0, 4·10⁵], rtol = 10⁻³, θ = 0.55. У скільки разів найдовший крок більший за найкоротший?</>,
              options: ["~10 разів", "~1000 разів", "~мільйон разів", "понад 10¹⁰ разів"],
              correct: 3,
              explain: (
                <>
                  h<sub>min</sub> = 2.5·10⁻⁷ (самий старт), h<sub>max</sub> ≈ 7.4·10⁴ (наприкінці): відношення ≈ 3.0·10¹¹. Зі сталим h<sub>min</sub> знадобилося б
                  1.6·10¹² кроків замість 83.
                </>
              ),
              explainSimple: <>Якби перший крок тривав секунду, найдовший тривав би ~9 тисяч років: від «місто, щомиті» до «траса, раз на тисячоліття».</>,
              show: { label: "Показати Робертсона, rtol = 10⁻³", run: () => robDefaults(1e-3) },
            },
            {
              id: "tol",
              q: <>Зменшимо rtol у 10 разів: 10⁻³ → 10⁻⁴ (Робертсон, θ = 0.55). Як зміниться кількість прийнятих кроків?</>,
              options: ["Зросте приблизно в 10 разів", "Зросте приблизно в 3 рази", "Не зміниться", "Зменшиться"],
              correct: 1,
              explain: (
                <>
                  83 → 228 кроків (×2.7). Контролюється локальна похибка, яка для методу 1-го порядку ∝ h², тож h ∝ √rtol: у 10 разів менший допуск — кроки в
                  √10 ≈ 3.2 раза дрібніші.
                </>
              ),
              explainSimple: <>Навігатор став у 10 разів прискіпливішим, а перерахунків побільшало лише втричі: 83 → 228. Бо похибка одного кроку росте як квадрат його довжини.</>,
              show: { label: "Показати rtol = 10⁻⁴", run: () => robDefaults(1e-4) },
            },
            {
              id: "dopri",
              q: <>Явний адаптивний DOPRI45 (5-й порядок!) на тій самій задачі, rtol = 10⁻³. Що буде?</>,
              options: ["Обжене θ-метод — у нього ж 5-й порядок", "Зробить приблизно стільки ж кроків", "Вичерпає 50 000 кроків і не дійде до кінця", "Вибухне на першому кроці"],
              correct: 2,
              explain: (
                <>
                  Межа стійкості явного методу h ≲ 3.3/|λ<sub>max</sub>| — для Робертсона ~10⁻³. За 50 000 кроків DOPRI45 доходить лише до t ≈ 52 з 4·10⁵. Високий
                  порядок не допомагає, коли крок обмежує стійкість, а не точність.
                </>
              ),
              explainSimple: <>Явний навігатор боїться «зірватися» і на трасі перераховує так само часто, як у місті. За 50 000 перерахунків він проїхав лише 52 секунди з 4.6 доби.</>,
              show: {
                label: "Показати DOPRI45",
                run: () => {
                  robDefaults(1e-3);
                  setShowDop(true);
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
            title="A-стійкість + змінний крок = ефективність"
            simple={
              <>
                Для Робертсона на [0, 4·10⁵] при rtol = 10⁻³ θ-методу вистачає кількох десятків кроків, а крок росте від ~2·10⁻⁷ до ~10⁴–10⁵. Зі сталим
                найдрібнішим кроком знадобилися б трильйони кроків (для поточних налаштувань — {fmt(nFixed, 2)}).
              </>
            }
          >
            Для Робертсона на <Tex>{"[0,4\\cdot10^5]"}</Tex> при rtol = 10⁻³ θ-метод обходиться кількома десятками кроків, а крок росте від ~2·10⁻⁷ (стартовий) до
            ~10⁴–10⁵. Зі сталим кроком h<sub>min</sub> знадобилися б трильйони кроків (для поточних налаштувань — {fmt(nFixed, 2)}).
          </Insight>
          <Insight
            tone="bad"
            title="Явний адаптивний метод не рятує"
            simple={
              <>
                DOPRI45 теж змінює крок, але на жорсткій задачі крок упирається в межу стійкості (для Робертсона ~10⁻³). Тож до t = 4·10⁵ він не доходить навіть
                за 50 000 кроків.
              </>
            }
          >
            DOPRI45 теж змінює крок, але на жорсткій задачі той упирається в межу стійкості ~<Tex>{"3.3/|\\lambda_{max}|"}</Tex>. Для Робертсона це ~10⁻³, тож до t =
            4·10⁵ він не доходить навіть за 50 000 кроків.
          </Insight>
          <Insight
            tone="info"
            title="Чому θ = 0.55, а не 0.5"
            simple={
              <>
                Трапеції (θ = 0.5) точніші і в нашій реалізації роблять навіть менше кроків (Робертсон, rtol = 10⁻³: 75 проти 83). Але швидкі складові вони не
                гасять, а «перевертають»: будь-який різкий поштовх довго «дзвенить». θ = 0.55 гасить цей дзвін ціною першого порядку точності.
              </>
            }
          >
            Трапеції точніші (2-й порядок) і в нашій реалізації роблять навіть менше кроків (Робертсон, rtol = 10⁻³: 75 проти 83). Але{" "}
            <Tex>{"R(-\\infty)=-1"}</Tex>: швидкі моди не гасяться, а «дзвенять» зі зміною знака, тож будь-яке різке збурення (стрибок правої частини, неузгоджені
            початкові дані) живе довго. Невеликий зсув до 0.55 дає <Tex>{"|R(-\\infty)|=0.82<1"}</Tex> — і такий дзвін згасає ціною першого порядку.
          </Insight>
          <Insight
            tone="note"
            title="Ціна подвоєння кроку"
            simple={
              <>
                Щоб оцінити похибку подвоєнням кроку, на кожну спробу доводиться тричі розв&apos;язувати рівняння кроку (один крок h і два по h/2). У «справжніх»
                програмах (Розенброк 2(3), RADAU5) похибку оцінюють дешевше — вбудованою формулою.
              </>
            }
          >
            Оцінка Річардсона потребує трьох розв&apos;язань неявного рівняння на кожну спробу (один крок h і два h/2). Вбудовані оцінки похибки (як у Розенброка 2(3)
            чи RADAU5) дешевші — тому в реальних програмах використовують саме їх.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Задачу Робертсона запропонував 1966 року Г. Г. Робертсон, і вона досі є в кожному наборі тестів для жорстких розв&apos;язувачів. На відрізку до 10¹¹ (~3000
                років, якщо t у секундах!) крок розумного методу перевищує 10¹⁰ — понад 300 років за один крок.
              </>
            }
          >
            Задачу Робертсона запропонував 1966 року Г. Г. Робертсон (H. H. Robertson), і вона досі в кожному наборі тестів для жорстких розв&apos;язувачів. На
            інтервалі до 10¹¹ (це ~3000 років, якщо t у секундах!) крок розумного методу перевищує 10¹⁰.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
