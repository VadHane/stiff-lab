"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import Plot3D from "@/components/plot/Plot3D";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import FlaskBZScene from "@/components/scenes/FlaskBZScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { cached } from "@/lib/stiffc-cache";
import { isAdaptive, isExplicit, solve, stiffnessAt, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import ChameleonScene from "@/components/analogy/ChameleonScene";
import { Say } from "@/components/mode/Mode";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { useTaskExport } from "@/components/share/TaskActions";
import { exportT24 } from "@/components/share/TaskExports";
import { methodsIn, numOneOf, useUrlNum } from "@/components/share/TaskUrl";
import { useUrlState } from "@/lib/url-state";

const S = 77.27,
  Q = 8.375e-6,
  W = 0.161;
const ALL: MethodId[] = ["ros", "dopri", "thetaA", "ieuler", "bdf2", "theta", "trap", "euler", "rk2", "rk3", "rk4"];
const T_LIST = [100, 360, 720];
const H_LIST = [0.001, 0.002, 0.004, 0.01];
const MAX_N = 100000;
const STIFF_SAMPLES = 240;
const NAMES = ["u₁ = HBrO₂", "u₂ = Br⁻", "u₃ = Ce(IV)"];
const COLS = ["#ff6b9a", "#ffe66d", "#5cc8ff"];

const f = (_t: number, u: number[]) => [S * (u[1] + u[0] * (1 - Q * u[0] - u[1])), (u[2] - (1 + u[0]) * u[1]) / S, W * (u[0] - u[2])];
const jac = (_t: number, u: number[]) => [
  [S * (1 - 2 * Q * u[0] - u[1]), S * (1 - u[0]), 0],
  [-u[1] / S, -(1 + u[0]) / S, 1 / S],
  [W, 0, -W],
];
const prob = (T: number): Problem => ({ f, jac, y0: [4, 1.1, 4], T });

type Run = { s: Solution };

function run(m: MethodId, T: number, h: number, tol: number): Run {
  if (isAdaptive(m))
    return cached(`T24|${m}|${T}|${tol}`, () => ({
      s: solve(m, prob(T), { rtol: tol, atol: tol * 1e-3, maxSteps: m === "ros" ? 200000 : 60000, blowup: 1e8 }),
    }));
  const he = Math.max(h, T / MAX_N);
  return cached(`T24|${m}|${T}|${he}`, () => ({ s: solve(m, prob(T), { h: he, blowup: 1e8 }) }));
}

function peaksOf(s: Solution): number[] {
  const out: number[] = [];
  for (let i = 1; i < s.t.length - 1; i++) {
    const v = s.y[i][0];
    if (v > 1e3 && v >= s.y[i - 1][0] && v > s.y[i + 1][0] && (out.length === 0 || s.t[i] - out[out.length - 1] > 10)) out.push(s.t[i]);
  }
  return out;
}
const periodOf = (p: number[]) => (p.length >= 2 ? (p[p.length - 1] - p[0]) / (p.length - 1) : NaN);
const posArr = (a: number[]) => a.map((v) => (v > 0 ? v : NaN));
/** Loop-based extrema: fixed-step runs hold up to 10⁵ points, more than spread arguments allow in some browsers. */
function maxOf(a: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}
function minOf(a: ArrayLike<number>): number {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
  return m;
}

export default function T24() {
  const [T, setT] = useUrlState("T", 100, numOneOf(T_LIST));
  const [h, setH] = useUrlNum("h", 0.004, 5e-4, 0.1);
  const [tol, setTol] = useUrlNum("rtol", 1e-4, 1e-7, 1e-2);
  const [methods, setMethods] = useUrlState<MethodId[]>("m", ["ros", "dopri", "thetaA", "bdf2"], methodsIn(ALL));
  const [ci, setCi] = useState(0);
  const dh = useDeferredValue(h);
  const dtol = useDeferredValue(tol);
  const hEff = Math.max(dh, T / MAX_N);
  const ensureMethods = (...ms: MethodId[]) => setMethods((cur) => [...cur, ...ms.filter((m) => !cur.includes(m))]);
  useTaskExport(exportT24({ T, h: Math.max(h, T / MAX_N), tol, methods }));

  const problem = useMemo(() => prob(T), [T]);
  const ref = useMemo(() => cached(`T24|ref|${T}`, () => solve("ros", prob(T), { rtol: 1e-8, atol: 1e-10, maxSteps: 400000 })), [T]);
  const refPeaks = useMemo(() => peaksOf(ref), [ref]);
  const refPeriod = periodOf(refPeaks);

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const r = run(m, T, hEff, dtol);
        const pk = peaksOf(r.s);
        return { m, ...r, pk, per: periodOf(pk), maxU1: maxOf(r.s.y.map((v) => v[0])) };
      }),
    [methods, T, hEff, dtol],
  );

  /** Extremes of Re λ along the reference (index-uniform sampling: the adaptive grid is dense exactly where λ changes fast). */
  const eig = useMemo(() => {
    let posMax = 0,
      negMax = 0,
      tNeg = 0,
      tPos = 0;
    const n = ref.t.length;
    const N = 1500;
    for (let k = 0; k < N; k++) {
      const i = Math.floor((k / (N - 1)) * (n - 1));
      for (const e of stiffnessAt(problem, ref.t[i], ref.y[i]).ev) {
        if (e.re > posMax) {
          posMax = e.re;
          tPos = ref.t[i];
        }
        if (-e.re > negMax) {
          negMax = -e.re;
          tNeg = ref.t[i];
        }
      }
    }
    // on the quiet branch u₁ ≈ 1 and the Jacobian is triangular: slow modes are exactly −2/s and −w
    return { posMax, negMax, tNeg, tPos, slow: 2 / S };
  }, [ref, problem]);
  /**
   * The stiffness panel's own coefficient: max over its samples of max|Re λ| / min|Re λ| (|Re λ| ≤ 10⁻¹¹·max dropped as zero).
   * On a spike front one eigenvalue changes sign; a sample that lands next to that crossing inflates the ratio.
   */
  const panelRatio = useMemo(() => {
    let r = 0,
      tR = 0;
    const n = ref.t.length;
    for (let k = 0; k < STIFF_SAMPLES; k++) {
      const i = Math.floor((k / (STIFF_SAMPLES - 1)) * (n - 1));
      const a = stiffnessAt(problem, ref.t[i], ref.y[i]).ev.map((e) => Math.abs(e.re));
      const top = Math.max(...a);
      const m = a.filter((v) => v > 1e-300 && v > 1e-11 * top);
      if (m.length && Math.max(...m) / Math.min(...m) > r) {
        r = Math.max(...m) / Math.min(...m);
        tR = ref.t[i];
      }
    }
    return { r, tR, inflated: r > 1.5 * (eig.negMax / eig.slow) };
  }, [ref, problem, eig]);
  /** Critical fixed step for implicit methods: h·β·λ⁺ = 1 makes I − hβJ singular (β = weight of f_{n+1}). */
  const hCrit = useMemo(
    () =>
      ({ ieuler: 1, bdf2: 2 / 3, theta: 0.55, trap: 0.5 }) as Record<string, number>,
    [],
  );

  const refSeries = useMemo(() => [0, 1, 2].map((i) => ({ x: ref.t, y: posArr(ref.y.map((v) => v[i])), color: COLS[i], width: 2, label: NAMES[i] })), [ref]);
  const compSeries = useMemo(
    () => [
      { x: ref.t, y: posArr(ref.y.map((v) => v[ci])), color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      ...sols.map(({ m, s }) => ({
        x: s.t,
        y: posArr(s.y.map((v) => v[ci])),
        color: METHODS[m].color,
        label: METHODS[m].short,
        width: s.failed ? 1 : 1.5,
        opacity: s.failed ? 0.5 : 1,
      })),
    ],
    [ref, sols, ci],
  );
  const phase = useMemo(
    () => [
      { x: posArr(ref.y.map((v) => v[0])), y: posArr(ref.y.map((v) => v[1])), color: "#ff6b9a", width: 2.4, fade: true, label: "еталон" },
      ...sols
        .filter(({ m }) => m !== "ros")
        .map(({ m, s }) => ({ x: posArr(s.y.map((v) => v[0])), y: posArr(s.y.map((v) => v[1])), color: METHODS[m].color, width: 1, opacity: 0.55 })),
    ],
    [ref, sols],
  );
  const curves3d = useMemo(() => {
    const step = Math.max(1, Math.floor(ref.t.length / 4000));
    const pts: [number, number, number][] = [];
    for (let i = 0; i < ref.t.length; i += step) pts.push([ref.y[i][0], ref.y[i][1], ref.y[i][2]]);
    return [{ pts, colors: ["#ff6b9a", "#5cc8ff"] as [string, string], width: 2 }];
  }, [ref]);
  const stepSeries = useMemo(
    () => [
      ...sols.filter(({ m }) => isAdaptive(m)).map(({ m, s }) => ({ x: s.t.slice(1), y: s.hs, color: METHODS[m].color, label: METHODS[m].short, width: 1.4 })),
      ...(sols.some(({ m }) => !isAdaptive(m)) ? [{ x: [0, T], y: [hEff, hEff], color: "#ffffff", width: 1, dash: [5, 4], opacity: 0.6, label: "фіксований h" }] : []),
    ],
    [sols, T, hEff],
  );

  const ros = sols.find((r) => r.m === "ros");
  const dop = sols.find((r) => r.m === "dopri");
  const fixedFail = sols.filter(({ m, s }) => !isAdaptive(m) && !isExplicit(m) && s.failed);
  const explFail = sols.filter(({ m, s }) => isExplicit(m) && s.failed);

  const analogy = useMemo(
    () => (
      <>
        <AnalogyCard
          emoji="🦎"
          title="Хімічний хамелеон: хвилину червоний — і раптом синій"
          story={
            <>
              У реакції Білоусова–Жаботинського розчин у колбі сам по собі змінює колір: довго стоїть червоним, потім <b>за частку секунди</b> синіє, кілька секунд
              тримається синім — і знову червоніє. Ніхто нічого не доливає. Усередині йде «перетягування»: бромід (Br⁻) гальмує реакцію, а HBrO₂ сам себе
              розганяє. Тиша тягнеться довго, а спалах триває мить — ідеальний приклад жорсткої задачі.
            </>
          }
          mapping={[
            ["«паливо» спалаху, що саме себе розганяє", <>HBrO₂, u₁ (від ~1 до ~1.2·10⁵)</>],
            ["«гальмо» реакції", <>бромід Br⁻, u₂</>],
            ["колір розчину", <>Ce(IV)/фероїн, u₃: мало — червоний, багато — синій</>],
            ["довга тиша і мить спалаху", <>власні числа від ~−0.026 до ~−1.4·10⁵</>],
            ["один «вдих» хамелеона", <>період ≈ 303 одиниці часу моделі</>],
          ]}
        >
          <ChameleonScene />
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
        <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
          <QuizBlock
            taskId="24"
            questions={[
              {
                id: "dopri",
                q: <>T = 100, rtol = 10⁻⁴. DOPRI — адаптивний метод 5-го порядку, але явний; ліміт — 60 000 кроків. Що з ним буде?</>,
                options: ["Дійде до кінця за ~650 кроків, як Розенброк", "Дійде, але кроків буде в ~10 разів більше", "Вичерпає ліміт при t ≈ 7.8 — лише 8 % шляху", "Вибухне на першому спалаху"],
                correct: 2,
                explain: (
                  <>
                    58 435 прийнятих + 1 565 відхилених кроків — і зупинка при t ≈ 7.82. Перший спалах (t ≈ 1.25) DOPRI проходить, але далі його крок прикутий до межі
                    стійкості ~3.3/|λ|: ≈ 2–3·10⁻³ одразу після піку, а на «тихій» ділянці (u₁ ≈ 1, |λ| сягає ~8·10⁴) — лише ≈ 4·10⁻⁵, хоча
                    розв&apos;язок там ледь змінюється. Розенброк проходить [0, 100]
                    за 653 кроки.
                  </>
                ),
                explainSimple: <>Явний DOPRI мусить крокувати під найшвидший процес навіть у «тиші», тож 60 000 кроків вистачає лише до t ≈ 7.8. Розенброку на весь відрізок — 653.</>,
                show: {
                  label: "Показати DOPRI і Розенброка",
                  run: () => {
                    setT(100);
                    setTol(1e-4);
                    ensureMethods("ros", "dopri");
                  },
                },
              },
              {
                id: "bdf2",
                q: <>BDF2 (метод Гіра) — неявний і A-стійкий. Візьмемо фіксований крок h = 0.04 на [0, 100]. Що буде?</>,
                options: ["Пройде без проблем — A-стійкість же", "Метод Ньютона не впорається ще до першого піку (t ≈ 1)", "💥 Вибухне, як явний Ейлер", "Пройде, але з хибним періодом"],
                correct: 1,
                explain: (
                  <>
                    Ньютон не збігається при t ≈ 1.0 (на 26-му кроці, після 25 успішних), ще до піку u₁ при t ≈ 1.25. На фронті вибуху є додатне власне число до ≈ +64; щойно hβλ⁺
                    наближається до 1 (β = 2/3 для BDF2, h* ≈ 1/(⅔·64) ≈ 0.023), матриця I − hβJ вироджується, і рівняння кроку втрачає «правильний» корінь. З h =
                    0.02 BDF2 проходить увесь відрізок; неявний Ейлер, θ-метод і трапеції з h = 0.04 теж ламаються (t ≈ 0.9…1.04).
                  </>
                ),
                explainSimple: <>A-стійкість рятує від процесів, що швидко згасають, а тут під час спалаху «паливо» справді вибухово росте. З кроком 0.04 рівняння, яке метод розв&apos;язує на кожному кроці, втрачає правильну відповідь — Ньютон здається при t ≈ 1. З h = 0.02 усе гаразд.</>,
                show: {
                  label: "Показати BDF2 з h = 0.04",
                  run: () => {
                    setT(100);
                    setH(0.04);
                    ensureMethods("bdf2");
                  },
                },
              },
              {
                id: "tol",
                q: <>Розенброк на [0, 100] з rtol = 10⁻⁴ робить ≈ 650 кроків. Підвищимо точність у 100 разів (rtol = 10⁻⁶). Скільки кроків знадобиться?</>,
                options: ["≈ 65 000 — у 100 разів більше", "≈ 3 500 — у ~5 разів більше", "≈ 650 — стільки ж", "≈ 1 300 — удвічі більше"],
                correct: 1,
                explain: (
                  <>
                    653 → 3 554 кроки (×5.4). Розенброк (ode23s) — 2-го порядку: локальна похибка ~h³, тож крок масштабується як rtol^(1/3), і 100-кратна точність
                    коштує ∛100 ≈ 4.6 рази більше кроків — близько до виміряних 5.4.
                  </>
                ),
                explainSimple: <>У 100 разів точніше — не означає в 100 разів довше: метод 2-го порядку дрібнить крок лише в ∛100 ≈ 4.6 раза. Насправді вийшло 653 → 3 554 (×5.4).</>,
                show: {
                  label: "Показати rtol = 10⁻⁶",
                  run: () => {
                    setT(100);
                    setTol(1e-6);
                    ensureMethods("ros");
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

      <Section kicker="Постановка" title="Хімічний годинник у колбі">
        <Grid>
          <Card title="Орегонатор (модель Філда–Кьороша–Нойєса)" icon="📜">
            <Tex block>{String.raw`\begin{aligned} u_1' &= 77.27\,\bigl(u_2 + u_1(1 - 8.375\cdot10^{-6}u_1 - u_2)\bigr),\\ u_2' &= \frac{u_3 - (1+u_1)\,u_2}{77.27},\\ u_3' &= 0.161\,(u_1 - u_3), \end{aligned}`}</Tex>
            <Say
              simple={
                <p className="mt-1 text-[14px] leading-relaxed text-white/75">
                  Три речовини (у зручних одиницях): u₁ — HBrO₂, «паливо», що саме себе розганяє; u₂ — бромід Br⁻, «гальмо»; u₃ — церій Ce(IV), від якого залежить
                  колір. Старт (4, 1.1, 4), рахуємо до t = 100 (або 360 і 720 — щоб побачити кілька циклів по ≈ 300). Числа 77.27 і 1/77.27 у рівняннях роблять
                  одну речовину в тисячі разів «нетерплячішою» за іншу.
                </p>
              }
            >
            <p className="mt-1 text-[14px] leading-relaxed text-white/75">
              <Tex>{"u_1(0)=4,\\ u_2(0)=1.1,\\ u_3(0)=4"}</Tex>, <Tex>{"t\\in[0,100]"}</Tex> (дозволяємо 360 і 720 — щоб побачити кілька періодів ≈ 300). Змінні — масштабовані
              концентрації: <Tex>{"u_1"}</Tex> — бромистої кислоти HBrO₂ (автокаталізатор), <Tex>{"u_2"}</Tex> — бромід-іона Br⁻ (інгібітор), <Tex>{"u_3"}</Tex> — окисненого церію
              Ce(IV) (індикатор кольору).
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="info"
                title="Механізм «на пальцях»"
                simple={
                  <>
                    Поки «гальма» (Br⁻) багато, «паливо» (HBrO₂) не розгориться. Щойно гальмо вичерпалось — паливо <b>вибухово</b> множиться, окиснює церій, і розчин
                    синіє. Церій повільно відновлює гальмо, і реакція затихає — розчин червоніє. І так по колу, без жодного втручання.
                  </>
                }
              >
                Поки Br⁻ багато, він душить HBrO₂. Коли бром вичерпано, HBrO₂ <b>вибухово</b> самопідсилюється (<Tex>{"u_1' \\approx 77u_1"}</Tex>), окиснює церій — розчин
                синіє. Ce(IV) повільно регенерує Br⁻, бромід знову гасить реакцію — розчин червоніє. І так по колу.
              </Insight>
            </div>
          </Card>
          <Card title="Наскільки вона жорстка" icon="🔬">
            <Tex block>{String.raw`J = \begin{pmatrix} s(1-2qu_1-u_2) & s(1-u_1) & 0\\ -u_2/s & -(1+u_1)/s & 1/s \\ w & 0 & -w\end{pmatrix},\quad s=77.27,\ q=8.375\cdot10^{-6},\ w=0.161 .`}</Tex>
            <p className="text-[14px] leading-relaxed text-white/75">
              <Say simple={<>Матриця вище (якобіан) каже, як швидко система відповідає на поштовх. Її числа вздовж розв&apos;язку на [0, {T}]:</>}>
                Уздовж еталонної траєкторії на <Tex>{`[0, ${T}]`}</Tex>:
              </Say>
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="найшвидше Re λ" value={`−${fmt(eig.negMax, 3)}`} sub={`при t ≈ ${fmt(eig.tNeg, 3)}: максимум Br⁻ після спалаху`} tone="warn" />
              <Stat label="повільні моди" value={`−${fmt(eig.slow, 3)}, −${W}`} sub="−2/s і −w на «тихій» гілці (u₁ ≈ 1)" />
              <Stat label="max Re λ > 0" value={`+${fmt(eig.posMax, 3)}`} sub={`при t ≈ ${fmt(eig.tPos, 3)}: автокаталітичний вибух`} tone="bad" />
            </div>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  Найшвидший процес у ~{fmt(eig.negMax / eig.slow, 2)} разів швидший за найповільніший. <Relatable kind="ratio" n={eig.negMax / eig.slow} /> А самі
                  концентрації гуляють від тисячних до ~120 000. Червона картка — «розганяльний» процес під час спалаху: це справжній вибух у хімії, а не похибка
                  методу; там крок обмежує точність, а не стійкість.
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Коефіцієнт жорсткості <Tex>{`${fmt(eig.negMax, 3)}/${fmt(eig.slow, 3)} \\approx ${fmt(eig.negMax / eig.slow, 2)}`}</Tex> — понад{" "}
              <b>{Math.floor(Math.log10(eig.negMax / eig.slow))} порядків</b>; самі розв&apos;язки змінюються від <Tex>{"3\\cdot10^{-3}"}</Tex> до <Tex>{"1.2\\cdot10^5"}</Tex>. Додатні
              власні числа означають справжню (фізичну) нестійкість — фронт вибуху, де крок обмежує вже точність, а не стійкість.
            </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Розенброк проти всіх" simpleTitle="Розумний неявний метод проти всіх">
        <Lab
          controls={
            <>
              <Chips label="Відрізок [0, T]" value={T} onChange={setT} options={T_LIST.map((v) => ({ value: v, label: `T = ${v}` }))} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Slider label="Точність rtol (адаптивні)" value={tol} onChange={setTol} min={1e-7} max={1e-2} log format={(v) => fmt(v, 2)} />
              <Chips label="Крок h (фіксовані)" value={H_LIST.includes(h) ? h : -1} onChange={(v) => v > 0 && setH(v)} options={H_LIST.map((v) => ({ value: v, label: `${v}` }))} />
              <Slider
                label="Довільний крок h"
                value={h}
                onChange={setH}
                min={5e-4}
                max={0.1}
                log
                format={(v) => fmt(v, 3)}
                hint={hEff > dh ? `обмежено до T/${MAX_N} = ${fmt(hEff, 3)} (≤ ${MAX_N / 1000}k кроків)` : `${Math.round(T / hEff).toLocaleString("uk-UA")} кроків`}
              />
              <Chips label="Компонента на графіку методів" value={ci} onChange={setCi} options={NAMES.map((n, i) => ({ value: i, label: n.split(" ")[0] }))} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Say
                  simple={
                    <>
                      Еталон (дуже точний Розенброк) зробив {ref.steps.toLocaleString("uk-UA")} кроків. Спалахи — при t ≈ {refPeaks.map((p) => fmt(p, 4)).join(", ")};
                      один цикл {Number.isFinite(refPeriod) ? `≈ ${fmt(refPeriod, 4)}` : "видно лише при T ≥ 360"}.
                    </>
                  }
                >
                Еталон: Розенброк, rtol = 10⁻⁸ — {ref.steps.toLocaleString("uk-UA")} кроків. Спалахи u₁ при t ≈ {refPeaks.map((p) => fmt(p, 4)).join(", ")}; період{" "}
                {Number.isFinite(refPeriod) ? `≈ ${fmt(refPeriod, 4)}` : "— (потрібно T ≥ 360)"}.
                </Say>
              </div>
            </>
          }
        >
          <Card>
            <Plot title="Еталон: усі три концентрації (лог. шкала)" height={280} logY xLabel="t" yDomain={[1e-4, 3e5]} series={refSeries} />
          </Card>
          <Card>
            <Plot title={`${NAMES[ci]}: методи проти еталону`} height={260} logY xLabel="t" yDomain={ci === 1 ? [1e-4, 1e4] : [0.3, 3e5]} series={compSeries} />
          </Card>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, per }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? (s.failed.includes("ліміт") ? "⛔" : "💥") : `${s.steps.toLocaleString("uk-UA")} кр.`}
                sub={
                  s.failed
                    ? `${s.failed} · ${s.steps.toLocaleString("uk-UA")} кр.`
                    : `${isAdaptive(m) ? `відхил. ${s.rejected} · ` : ""}${fmtMs(s.ms)}${Number.isFinite(per) ? ` · період ${fmt(per, 4)}` : ""}`
                }
                tone={s.failed ? "bad" : Number.isFinite(per) && Number.isFinite(refPeriod) && Math.abs(per - refPeriod) > 0.02 * refPeriod ? "warn" : "good"}
              />
            ))}
          </div>
          <Grid>
            <Card>
              <Plot title="Фазовий портрет (u₁, u₂), log–log" height={280} logX logY sorted={false} xLabel="u₁" yLabel="u₂" series={phase} />
            </Card>
            <Card>
              <Plot title="Крок адаптивних методів h(t)" height={280} logY xLabel="t" yLabel="h" series={stepSeries} />
            </Card>
          </Grid>

          {ros && dop && (
            <Insight
              tone={dop.s.failed ? "bad" : "info"}
              title="Розенброк vs DOPRI"
              simple={
                <>
                  Розенброк: {ros.s.steps.toLocaleString("uk-UA")} кроків за {fmtMs(ros.s.ms)}.{" "}
                  {dop.s.failed ? (
                    <>
                      DOPRI здався: {dop.s.failed}. Він явний, тож мусить крокувати під найшвидший процес (крок ≈ {fmt(3.3 / eig.negMax, 1)} одразу після спалаху),
                      навіть коли в колбі «тиша». На один цикл йому знадобилося б ~2 мільйони кроків. <Relatable kind="steps" n={2e6} />
                    </>
                  ) : (
                    <>DOPRI: {dop.s.steps.toLocaleString("uk-UA")} кроків — у {fmt(dop.s.steps / Math.max(1, ros.s.steps), 3)} разів більше.</>
                  )}
                </>
              }
            >
              Розенброк: {ros.s.steps.toLocaleString("uk-UA")} кроків за {fmtMs(ros.s.ms)}.{" "}
              {dop.s.failed
                ? `DOPRI: ${dop.s.failed} — за ${fmtMs(dop.s.ms)} він ледь вибрався за перший спалах (найменший крок ${fmt(minOf(dop.s.hs), 2)}). Його крок прикутий до межі стійкості ~3.3/|λ|: ≈ ${fmt(3.3 / eig.negMax, 1)} одразу після спалаху і ≲ 10⁻³ на решті «тихої» ділянки, хоча розв'язок там майже не змінюється.`
                : `DOPRI: ${dop.s.steps.toLocaleString("uk-UA")} кроків — у ${fmt(dop.s.steps / Math.max(1, ros.s.steps), 3)} разів більше.`}
            </Insight>
          )}
          {fixedFail.length > 0 && (
            <Insight
              tone="warn"
              title="Неявні методи з фіксованим кроком теж спотикаються"
              simple={
                <>
                  {fixedFail.map(({ m }) => METHODS[m].short).join(", ")}: метод Ньютона не знайшов наступну точку. Неявність рятує від «нетерплячих» процесів, що
                  швидко згасають, але не від справжнього вибуху: на фронті спалаху паливо множиться з темпом до +{fmt(eig.posMax, 2)}, і з великим кроком рівняння
                  кроку просто втрачає правильний розв&apos;язок. З кроком h ≤ 0.01 усі чотири неявні методи проходять увесь відрізок.
                </>
              }
            >
              {fixedFail.map(({ m, s }) => `${METHODS[m].short}: ${s.failed}`).join("; ")}. Неявність рятує від жорсткості (великих від&apos;ємних λ), але не від фізичної нестійкості:
              на фронті вибуху <Tex>{`\\operatorname{Re}\\lambda^+ \\approx +${fmt(eig.posMax, 2)}`}</Tex>, і щойно <Tex>{"h\\beta\\lambda^+"}</Tex> досягає 1 (<Tex>{"\\beta"}</Tex> —
              вага <Tex>{"f_{n+1}"}</Tex> у формулі методу), матриця <Tex>{"I - h\\beta J"}</Tex> вироджується, а рівняння кроку втрачає «правильний» корінь — Ньютон не збігається ще
              до піку. Критичні кроки <Tex>{"h^* = 1/(\\beta\\lambda^+)"}</Tex>:{" "}
              {(["ieuler", "bdf2", "theta", "trap"] as MethodId[]).map((m) => `${METHODS[m].short} ≈ ${fmt(1 / (hCrit[m] * eig.posMax), 2)}`).join(", ")}. З кроком{" "}
              <Tex>{"h \\le 0.01"}</Tex> усі чотири методи проходять увесь відрізок.
            </Insight>
          )}
          {explFail.length > 0 && (
            <Insight
              tone="bad"
              title="Явні методи з фіксованим кроком"
              simple={
                <>
                  {explFail.map(({ m }) => METHODS[m].short).join(", ")} вибухнули на першому ж спалаху. Після нього найшвидший процес має темп ~{fmt(eig.negMax, 2)},
                  тож явному методу потрібен крок, менший за {fmt(2 / eig.negMax, 2)}, — це {fmt(T / (2 / eig.negMax), 2)} кроків на весь відрізок.{" "}
                  <Relatable kind="steps" n={T / (2 / eig.negMax)} />
                </>
              }
            >
              {explFail.map(({ m, s }) => `${METHODS[m].short}: ${s.failed}`).join("; ")}. Після першого спалаху <Tex>{`|\\lambda| \\sim ${fmt(eig.negMax, 2)}`}</Tex>, тож
              потрібен <Tex>{`h < 2/|\\lambda| \\approx ${fmt(2 / eig.negMax, 2)}`}</Tex> — це {fmt(T / (2 / eig.negMax), 2)} кроків на весь відрізок.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Колба, що змінює колір">
        <Card>
          <FlaskBZScene sol={ref} peaks={refPeaks} />
          <p className="mt-3 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Колір залежить від кількості церію u₃: мало — червоний, багато — синій. Анімація пришвидшує «тихі» ділянки й сповільнює спалахи в сотні разів —
                  так само, як адаптивний метод дрібнить крок лише там, де щось відбувається.
                </>
              }
            >
            Колір визначає <Tex>{"\\lg u_3"}</Tex> (Ce(IV)/фероїн: червоний ↔ синій). Анімація йде не рівномірно в часі, а пропорційно «довжині дуги» розв&apos;язку в лог-координатах: швидкі
            спалахи програються в уповільненому режимі (×сотні), а довгі «тихі» ділянки пролітають швидко — точно так само, як працює адаптивний крок.
            </Say>
          </p>
        </Card>
      </Section>

      <Section kicker="3D" title="Траєкторія в лог-просторі (u₁, u₂, u₃)" simpleTitle="Один цикл у 3D (осі — порядки величин)">
        <Card>
          <Plot3D curves={curves3d} labels={["lg u₁", "lg u₂", "lg u₃"]} logAxes={[true, true, true]} height={400} />
          <p className="mt-2 text-[12.5px] text-white/50">
            <Say simple={<>Перетягуйте мишею. Петля — це один цикл хамелеона: довгий повільний шлях і майже миттєвий «перекид» через 5 порядків величини.</>}>
              Перетягуйте мишею. Петля — граничний цикл: довгий повільний відрізок і майже миттєвий «перекид» через 5 порядків.
            </Say>
          </p>
        </Card>
      </Section>

      <Section kicker="Результати" title={`Порівняння вибраних методів на [0, ${T}]`} simpleTitle={`Хто скільки кроків зробив на [0, ${T}]`}>
        <Card>
          <Table
            head={["Метод", "Статус", "Кроки", "Відхилені", "f-обчисл.", "Якобіани", "Час", "Період", "max u₁"]}
            rows={sols.map(({ m, s, per, maxU1 }) => [
              <span key={m} style={{ color: METHODS[m].color }}>
                {METHODS[m].name}
                {!isAdaptive(m) && <span className="text-white/40"> h={fmt(hEff, 3)}</span>}
              </span>,
              s.failed ? <span className="text-[#ff5d73]">{s.failed.includes("ліміт") ? "⛔ ліміт кроків" : s.failed.includes("Ньютона") ? "✗ Ньютон" : "💥 вибух"}</span> : <span className="text-[#3ee6a8]">✓</span>,
              s.steps.toLocaleString("uk-UA"),
              isAdaptive(m) ? s.rejected : "—",
              s.fevals.toLocaleString("uk-UA"),
              s.jevals.toLocaleString("uk-UA"),
              fmtMs(s.ms),
              Number.isFinite(per) ? fmt(per, 5) : "—",
              fmt(maxU1, 3),
            ])}
          />
          <p className="mt-3 text-[13px] text-white/55">
            <Say
              simple={
                <>
                  Еталонний цикл {Number.isFinite(refPeriod) ? fmt(refPeriod, 5) : "— (виберіть T = 360 або 720)"}; найбільше «палива» u₁ ={" "}
                  {fmt(maxOf(ref.y.map((v) => v[0])), 4)} — майже рівно 1/q = {fmt(1 / Q, 4)}: на піку розгін і гальмування зрівнюються.
                </>
              }
            >
            Еталонний період {Number.isFinite(refPeriod) ? fmt(refPeriod, 5) : "— (виберіть T = 360 або 720)"}; еталонний max u₁ = {fmt(maxOf(ref.y.map((v) => v[0])), 4)} (≈ 1/q = {fmt(1 / Q, 4)}, бо на піку <Tex>{"u_1' \\approx 0 \\Leftrightarrow 1 - qu_1 \\approx 0"}</Tex>).
            </Say>
          </p>
        </Card>
      </Section>

      <Section kicker="Жорсткість" title="Власні числа вздовж траєкторії" simpleTitle="Наскільки швидкі процеси в кожен момент">
        <Card>
          <StiffnessPanel problem={problem} sol={ref} samples={STIFF_SAMPLES} />
          <p className="mt-2 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Під час спалаху один із процесів «розганяльний» (темп до +{fmt(eig.posMax, 2)}) — це справжній хімічний вибух. Одразу після піку, коли гальма Br⁻
                  найбільше (~1 800), найшвидший процес згасає з темпом до {fmt(eig.negMax, 2)}.
                  {panelRatio.inflated && (
                    <>
                      {" "}
                      Картка «коеф. жорсткості» тут показує більше — {fmt(panelRatio.r, 2)}: одна з точок графіка (t ≈ {fmt(panelRatio.tR, 5)}) влучила в мить
                      спалаху, коли один із процесів міняє напрям і його темп проходить через нуль. Це не справжній «повільний процес», тож чесна оцінка жорсткості —
                      ≈ {fmt(eig.negMax / eig.slow, 2)} (вище).
                    </>
                  )}
                </>
              }
            >
            Панель показує модулі дійсних частин: під час вибуху одне з власних чисел додатне (фізичне зростання, до <Tex>{`+${fmt(eig.posMax, 2)}`}</Tex>), а після піку, коли Br⁻
            сягає максимуму ≈ 1.8·10³, швидке власне число <Tex>{"\\approx s(1-u_2)"}</Tex> опускається до <Tex>{`-${fmt(eig.negMax, 2)}`}</Tex>.
            {panelRatio.inflated &&
              ` «Коеф. жорсткості» панелі (max/min |Re λ| по ${STIFF_SAMPLES} точках) тут ${fmt(panelRatio.r, 2)}: точка t ≈ ${fmt(panelRatio.tR, 5)} лежить на фронті спалаху, де одне з власних чисел змінює знак і проходить поблизу нуля. Це не повільна мода, тож змістовний коефіцієнт жорсткості — ${fmt(eig.negMax, 3)}/${fmt(eig.slow, 3)} ≈ ${fmt(eig.negMax / eig.slow, 2)}.`}
            </Say>
          </p>
        </Card>
      </Section>

      {extras}

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="good"
            title="Адаптивний неявний — єдиний розумний вибір"
            simple={
              <>
                Розенброк робить сотні кроків за цикл, DOPRI потрібні б мільйони, а фіксованому кроку довелося б бути дрібним усюди, хоча дрібність потрібна лише
                на спалахах. Крок Розенброка за один цикл змінюється в 10–100 тисяч разів.
              </>
            }
          >
            Розенброк робить сотні кроків за період там, де DOPRI потрібні мільйони (<Tex>{"\\int_0^{T}|\\lambda|\\,dt/3.3 \\approx 2\\cdot10^6"}</Tex> за період), а фіксований крок мусить бути дрібним
            скрізь, хоча потрібен лише на фронтах. Крок Розенброка змінюється на 4–5 порядків за період.
          </Insight>
          <Insight
            tone="warn"
            title="Жорсткість + нестійкість"
            simpleTitle="Тут є справжній вибух"
            simple={
              <>
                Тут є не лише процеси, що швидко згасають, а й справжній вибух — спалах «палива». Неявні методи з кроком ≳ 0.02 ламаються саме на ньому: рівняння
                кроку втрачає розв&apos;язок, хоча жодна «область стійкості» тут ні до чого.
              </>
            }
          >
            Орегонатор — не «нудна» жорстка задача, що просто згасає: тут є фази з додатними власними числами. Неявні методи з великим кроком (<Tex>{"h \\gtrsim 0.02"}</Tex>) тут
            ламаються через вироджену <Tex>{"I-h\\beta J"}</Tex> на фронті вибуху, а не через області стійкості.
          </Insight>
          <Insight
            tone="info"
            title="Логарифмічні шкали обов'язкові"
            simple={
              <>
                Концентрації гуляють від тисячних до сотні тисяч — на звичайному графіку видно лише вузькі піки. Тому й точність треба задавати відносну («у
                відсотках»), а не в абсолютних одиницях.
              </>
            }
          >
            Концентрації змінюються від <Tex>{"10^{-3}"}</Tex> до <Tex>{"10^5"}</Tex>; на лінійному графіку видно лише вузькі піки. Тому і контроль похибки треба вести з
            відносною точністю (rtol), а atol — малим.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Білоусов відкрив реакцію в 1951 р., але журнали не вірили: «рівновага не може коливатися!». Лише в 1960-х Жаботинський її відтворив і пояснив, а
                модель назвали «орегонатором» на честь Університету Орегону. Білоусову посмертно присудили Ленінську премію (1980).
              </>
            }
          >
            Б. П. Білоусов відкрив коливальну реакцію в 1951 р., але журнали відмовлялися її друкувати: «хімічна рівновага не може коливатися!». Лише в 1960-х А. М. Жаботинський
            відтворив і пояснив її, а Філд, Кьорош і Нойєс у 1972–74 рр. побудували механізм і «орегонатор» (на честь Університету Орегону). У 1980 р. Білоусову посмертно
            присудили Ленінську премію.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
