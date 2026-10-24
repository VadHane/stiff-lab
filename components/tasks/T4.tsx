"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import StabilityExplorer from "@/components/plot/StabilityExplorer";
import BlowupBarsScene from "@/components/scenes/BlowupBarsScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import Gauge from "@/components/ui/Gauge";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { maxError, solve, type MethodId, type Problem } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import DepositScene from "@/components/analogy/DepositScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

type OneStep = "euler" | "ieuler" | "theta" | "trap" | "rk2" | "rk3" | "rk4";
const RF: Record<OneStep, (z: number) => number> = {
  euler: (z) => 1 + z,
  ieuler: (z) => 1 / (1 - z),
  theta: (z) => (1 + 0.45 * z) / (1 - 0.55 * z),
  trap: (z) => (1 + 0.5 * z) / (1 - 0.5 * z),
  rk2: (z) => 1 + z + (z * z) / 2,
  rk3: (z) => 1 + z + (z * z) / 2 + (z * z * z) / 6,
  rk4: (z) => 1 + z + (z * z) / 2 + (z * z * z) / 6 + (z * z * z * z) / 24,
};
const isOne = (m: MethodId): m is OneStep => m in RF;

const ALL: MethodId[] = ["euler", "ieuler", "theta", "trap", "rk2", "rk3", "rk4", "bdf2"];
const BOOK: OneStep[] = ["euler", "ieuler", "theta"];
const LAMS = [-1, -10, -20];
const HS = [0.01, 0.05, 0.1, 0.2, 0.5];
const T = 5;
// stable references for the debugger (f depends on λ via useMemo)
const DBG_Y0 = [1];
const DBG_VIEW = { x: "t" as const, y: 0, xLabel: "t", yLabel: "y", xDomain: [0, 2] as [number, number], yDomain: [-2.6, 2.6] as [number, number] };

function analyticMax(m: OneStep, lam: number, h: number) {
  const N = Math.round(T / h);
  const r = RF[m](h * lam);
  let y = 1,
    e = 0;
  for (let n = 1; n <= N; n++) {
    y *= r;
    const d = Math.abs(y - Math.exp(lam * n * h));
    if (!(d <= e)) e = d;
    if (!Number.isFinite(y)) return Infinity;
  }
  return e;
}

// Квіз «hmax»: розв'язувач робить N = round(T/h) рівних кроків, тож при h = 0.11 фактичний крок — T/N = 5/45 ≈ 0.1111,
// множник R = 1 − 20·T/N ≈ −1.222, а максимальна похибка ≈ |R|^45 ≈ 8.35·10³ (а не «сирі» 1.2^45 ≈ 3.7·10³ для h = 0.11).
const Q_H = 0.11;
const Q_N = Math.round(T / Q_H);
const Q_HEFF = T / Q_N;
const Q_R = RF.euler(-20 * Q_HEFF);
const Q_ERR = analyticMax("euler", -20, Q_HEFF);

type Kind = "boom" | "flip" | "mono" | "edge";
const KIND: Record<Kind, { label: string; icon: string; tone: "good" | "bad" | "warn" }> = {
  boom: { label: "Вибухне", icon: "💥", tone: "bad" },
  edge: { label: "Вічне ±: |R| = 1", icon: "🔁", tone: "warn" },
  flip: { label: "Згасне зі зміною знака", icon: "〰️", tone: "warn" },
  mono: { label: "Згасне монотонно", icon: "📉", tone: "good" },
};
const classify = (r: number): Kind => (Math.abs(Math.abs(r) - 1) < 1e-9 ? "edge" : Math.abs(r) > 1 ? "boom" : r < 0 ? "flip" : "mono");

export default function T4() {
  const [lam, setLam] = useState(-10);
  const [h, setH] = useState(0.1);
  const [methods, setMethods] = useState<MethodId[]>(["euler", "ieuler", "theta"]);
  const [gm, setGm] = useState<OneStep>("theta");
  const [guess, setGuess] = useState<{ key: string; kind: Kind } | null>(null);
  const [score, setScore] = useState({ ok: 0, all: 0 });
  const dl = useDeferredValue(lam);
  const dh = useDeferredValue(h);
  const pb = usePlayback(9);
  const [dbgLam, setDbgLam] = useState(-20);
  const dbgF = useMemo(() => (_t: number, y: number[]) => [dbgLam * y[0]], [dbgLam]);
  const want = (m: MethodId) => setMethods((ms) => (ms.includes(m) ? ms : [...ms, m]));

  const exact = useMemo(() => (t: number) => [Math.exp(dl * t)], [dl]);
  const problem: Problem = useMemo(() => ({ f: (_t, y) => [dl * y[0]], jac: () => [[dl]], y0: [1], T }), [dl]);
  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = solve(m, problem, { h: dh, blowup: 1e12 });
        return { m, s, e: maxError(s, exact) };
      }),
    [methods, problem, dh, exact],
  );
  const dense = useMemo(() => {
    const t: number[] = [];
    for (let i = 0; i <= 800; i++) t.push((T * i) / 800);
    return { t, y: t.map((x) => Math.exp(dl * x)) };
  }, [dl]);

  // the solver uses N = round(T/h) equal steps, so the step actually taken is T/N
  const N = Math.max(1, Math.round(T / dh));
  const hEff = T / N;
  const z = hEff * dl;
  const zc = Math.max(z, -40);
  const rCurve = useMemo(() => {
    const zs: number[] = [];
    for (let i = 0; i <= 1200; i++) zs.push(-40 + (40 * i) / 1200);
    return { zs, r: Object.fromEntries((Object.keys(RF) as OneStep[]).map((m) => [m, zs.map(RF[m])])) as Record<OneStep, number[]>, ex: zs.map(Math.exp) };
  }, []);

  const table = useMemo(() => LAMS.map((l) => BOOK.map((m) => HS.map((hh) => analyticMax(m, l, hh)))), []);

  // game
  const gr = RF[gm](z);
  const gKind = classify(gr);
  const key = `${gm}|${dl}|${dh}`;
  const game = useMemo(() => {
    const n0 = Math.min(32, N);
    const ys: number[] = [];
    const ex: number[] = [];
    let y = 1;
    for (let n = 0; n <= n0; n++) {
      ys.push(y);
      ex.push(Math.exp(dl * n * hEff));
      y *= gr;
    }
    return { ys, ex };
  }, [gr, dl, hEff, N]);
  const shown = Math.min(game.ys.length, Math.floor(pb.progress * (game.ys.length + 8)) + 1);
  const myGuess = guess && guess.key === key ? guess.kind : null;
  const shownEff = myGuess ? shown : 1;
  const done = shownEff >= game.ys.length;
  const makeGuess = (k: Kind) => {
    if (myGuess) return;
    setGuess({ key, kind: k });
    setScore((s) => ({ ok: s.ok + (k === gKind ? 1 : 0), all: s.all + 1 }));
    pb.setProgress(0);
    pb.setPlaying(true);
  };
  const randomChallenge = () => {
    const ls = [-1, -2, -5, -10, -20, -50];
    const l = ls[Math.floor(Math.random() * ls.length)];
    const hh = Number(Math.pow(10, -2 + 2 * Math.random()).toPrecision(2));
    const ms: OneStep[] = ["euler", "ieuler", "theta", "trap", "rk2", "rk3", "rk4"];
    setLam(l);
    setH(hh);
    setGm(ms[Math.floor(Math.random() * ms.length)]);
    pb.setProgress(0);
    pb.setPlaying(false);
  };

  const range = Math.min(30, Math.max(3, Math.abs(z) / 1.5));
  const eulerR = Math.abs(1 + z);
  const thR = RF.theta(z);
  const errOf = (m: MethodId) => sols.find((x) => x.m === m)?.e.max;
  const eE = errOf("euler"),
    eT = errOf("theta");

  return (
    <>
      <AnalogyCard
        emoji="🏦"
        title="Вклад, що тане: складні відсотки навпаки"
        story={
          <>
            Покладіть 1000 ₴ у дивний банк, де гроші не ростуть, а «згорають» зі ставкою λ &lt; 0. Насправді вклад мав би танути плавно, як e<sup>λt</sup>.
            Але банк нараховує не щомиті, а раз на h — множить баланс на одне й те саме число. Банк «Ейлер» рахує з суми <b>на початку</b> періоду: якщо
            період довгий, він знімає більше, ніж у вас було, — і ви в боргу, а далі «відсотки на борг» перекидають вас у ще більший плюс. Банк «Неявний»
            рахує з суми <b>в кінці</b> періоду — і ніколи не заганяє в мінус.
          </>
        }
        mapping={[
          ["баланс після n-го нарахування", <>yₙ</>],
          ["«ставка згорання» (на рік)", <>λ &lt; 0</>],
          ["як часто нараховують", <>крок h</>],
          ["у скільки разів змінюється баланс за період", <>функція підсилення R(hλ): 1 + hλ, 1/(1 − hλ), (1 + 0.45hλ)/(1 − 0.55hλ)</>],
          ["банк знімає більше, ніж було, — борг", <>R &lt; 0: зміна знака; |R| &gt; 1 — вибух</>],
        ]}
      >
        <DepositScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Найважливіше рівняння числових методів" simpleTitle="Одне рівняння, щоб зрозуміти всі методи">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`u' = \lambda u,\qquad u(0)=1,\qquad u(t)=e^{\lambda t},\qquad t\in[0,5].`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] text-white/70">
                  Завдання: розв&apos;язати це рівняння трьома методами — явним Ейлером, неявним Ейлером і θ-методом (θ = 0.55) — і порівняти похибки для λ = −1,
                  −10, −20. Ось як робить крок θ-метод:
                </p>
              }
            >
            <p className="mt-2 text-[14px] text-white/70">
              Розв&apos;язати явним і неявним методами Ейлера та A-стійким θ-методом і проаналізувати похибку для <Tex>{"\\lambda=-1,\\ -10,\\ -20"}</Tex>:
            </p>
            </Say>
            <Tex block>{String.raw`y_{n+1}=y_n+h\big(0.55\,f_{n+1}+0.45\,f_n\big)\ \Rightarrow\ y_{n+1}=\frac{1+0.45\,h\lambda}{1-0.55\,h\lambda}\,y_n .`}</Tex>
            <Say
              simple={
                <p className="text-[14px] text-white/70">
                  Головне: для цього рівняння кожен метод на кожному кроці просто множить yₙ на одне й те саме число R — «множник за період», як банк з
                  аналогії. Тож yₙ = Rⁿ, а правильна відповідь — (e<sup>hλ</sup>)ⁿ. Порівняти метод із правдою = порівняти два числа: R і e<sup>hλ</sup>.
                </p>
              }
            >
            <p className="text-[14px] text-white/70">
              Для цього рівняння кожен однокроковий метод — просто множення на <b>функцію підсилення</b> <Tex>{"R(z)"}</Tex>, де <Tex>{"z=h\\lambda"}</Tex>:{" "}
              <Tex>{"y_n=R(z)^n"}</Tex>, тоді як точно <Tex>{"u(t_n)=(e^{z})^n"}</Tex>.
            </p>
            </Say>
          </Card>
          <Card title="Три функції підсилення" icon="🧮">
            <Tex block>{String.raw`R_{\text{Ейлер}}=1+z,\qquad R_{\text{неявн.}}=\frac{1}{1-z},\qquad R_{0.55}=\frac{1+0.45z}{1-0.55z}.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Метод не вибухає, якщо |R| ≤ 1. Для явного Ейлера це означає h ≤ 2/|λ|: 2, 0.2 і 0.1 для наших λ. Неявні методи не вибухають за будь-якого
                  кроку (це називають <b>A-стійкістю</b>).
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Метод стійкий, якщо <Tex>{"|R(z)|\\le1"}</Tex>. Для Ейлера це <Tex>{"-2\\le z\\le 0"}</Tex>, тобто <Tex>{"h\\le 2/|\\lambda|"}</Tex>: 2, 0.2 і 0.1
              для наших λ. Неявні методи стійкі для всіх <Tex>{"z<0"}</Tex> (<b>A-стійкість</b>).
            </p>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  Але є нюанс: при дуже великому кроці множник θ-методу прямує до −0.818. Тоді розв&apos;язок не гасне одразу, а щокроку <b>міняє знак</b> і тане
                  повільно. Неявний Ейлер при великому кроці дає множник ≈ 0 — просто гасить усе (це називають <b>L-стійкістю</b>).
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Але є нюанс: <Tex>{"R_{0.55}(-\\infty)=-0.45/0.55\\approx-0.818"}</Tex>. При великому <Tex>{"h|\\lambda|"}</Tex> θ-метод не гасить розв&apos;язок, а{" "}
              <b>перекидає знак</b> і згасає повільно — він не <b>L-стійкий</b>. Неявний Ейлер має <Tex>{"R(-\\infty)=0"}</Tex>.
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="Крок не задано"
                simple={
                  <>
                    У методичці крок не вказано, тож даємо слайдер h від 0.01 до 1 і таблицю для h = 0.01, 0.05, 0.1, 0.2, 0.5. Розв&apos;язки, пораховані
                    загальним розв&apos;язувачем, збігаються з формулою Rⁿ до останнього знака.
                  </>
                }
              >
                У методичці крок не вказано, тож даємо слайдер h ∈ [0.01, 1] і таблицю для h = 0.01, 0.05, 0.1, 0.2, 0.5. Розв&apos;язки рахуються загальним
                розв&apos;язувачем і збігаються з формулою <Tex>{"R^n"}</Tex> до машинної точності.
              </Insight>
            </div>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Один множник вирішує все" simpleTitle="Крутіть λ і h — усе вирішує один множник">
        <Lab
          controls={
            <>
              <Chips label="λ з умови" value={LAMS.includes(lam) ? lam : 0} onChange={(v) => v && setLam(v)} options={LAMS.map((v) => ({ value: v, label: `λ = ${v}` }))} />
              <Slider label="Довільне λ" value={-lam} onChange={(v) => setLam(-v)} min={0.1} max={100} log format={(v) => fmt(-v, 3)} />
              <Chips label="Крок з таблиці" value={HS.includes(h) ? h : -1} onChange={(v) => v > 0 && setH(v)} options={HS.map((v) => ({ value: v, label: `${v}` }))} />
              <Slider label="Крок h" value={h} onChange={setH} min={0.01} max={1} log />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Gauge value={eulerR} label="явний Ейлер |1+hλ|" />
                <Gauge value={Math.abs(thR)} label="θ = 0.55 |R(hλ)|" />
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Tex>{`z=h\\lambda=${fmt(z, 4)}`}</Tex>, точний множник <Tex>{`e^{z}=${fmt(Math.exp(z), 4)}`}</Tex>. Кроків до T = 5: N = {N}
                {Math.abs(hEff - dh) > 1e-12 ? ` (фактичний крок h = T/N = ${fmt(hEff, 4)})` : ""}.
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title={`Розв'язки, λ = ${fmt(dl, 3)}, h = ${fmt(dh, 3)}`}
              xLabel="t"
              yDomain={[-1.25, 1.25]}
              series={[
                { x: dense.t, y: dense.y, color: "#ffffff", label: "e^{λt}", width: 4, opacity: 0.35 },
                ...sols.flatMap(({ m, s, e }) => {
                  const bad = e.max > 1.5;
                  const line = { x: s.t, y: s.y.map((v) => v[0]), color: METHODS[m].color, label: METHODS[m].short, width: bad ? 1 : 1.7, opacity: bad ? 0.45 : 1 };
                  return s.t.length <= 120 ? [line, { x: s.t, y: s.y.map((v) => v[0]), color: METHODS[m].color, dots: true, dotSize: 2.6, opacity: bad ? 0.5 : 1 }] : [line];
                }),
              ]}
            />
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Похибка |yₙ − e^{λtₙ}| (лог. шкала)"
                height={250}
                xLabel="t"
                logY
                yDomain={[1e-14, 1e8]}
                series={sols.map(({ m, s, e }) => ({
                  x: s.t,
                  y: e.err[0].map((v) => Math.max(v, 1e-16)),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: 1.5,
                }))}
              />
            </Card>
            <Card>
              <Plot
                title="Функції підсилення R(z), z ∈ [−40, 0]"
                height={250}
                xLabel="z = hλ"
                xDomain={[-40, 0]}
                yDomain={[-1.6, 1.6]}
                series={[
                  { x: [-40, 0], y: [1, 1], color: "#ffffff55", width: 1, dash: [4, 4], noRange: true },
                  { x: [-40, 0], y: [-1, -1], color: "#ffffff55", width: 1, dash: [4, 4], noRange: true },
                  { x: rCurve.zs, y: rCurve.ex, color: "#ffffff", label: "eᶻ", width: 3, opacity: 0.4 },
                  ...(["euler", "ieuler", "theta", "trap", "rk2", "rk3", "rk4"] as OneStep[]).map((m) => ({
                    x: rCurve.zs,
                    y: rCurve.r[m],
                    color: METHODS[m].color,
                    label: METHODS[m].short,
                    width: methods.includes(m) ? 2 : 1,
                    opacity: methods.includes(m) ? 1 : 0.3,
                  })),
                ]}
                cursorX={zc}
                markers={methods.filter(isOne).map((m) => ({ x: zc, y: Math.max(-1.6, Math.min(1.6, RF[m](z))), color: METHODS[m].color, r: 5 }))}
              />
            </Card>
          </Grid>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {sols.map(({ m, s, e }) => {
              const r = isOne(m) ? RF[m](z) : NaN;
              return (
                <Stat
                  key={m}
                  label={METHODS[m].short}
                  value={s.failed ? "💥" : fmt(e.max, 3)}
                  sub={s.failed ? s.failed : `max похибка · ${isOne(m) ? `R = ${fmt(r, 4)} · ` : ""}${s.steps} кроків · ${fmtMs(s.ms)}`}
                  tone={s.failed || e.max > 1 ? "bad" : e.max > 0.05 ? "warn" : "good"}
                />
              );
            })}
          </div>
          {methods.includes("euler") && eulerR > 1 + 1e-9 && (
            <Insight
              tone="bad"
              title="Явний Ейлер вибухає"
              simple={
                <>
                  Множник |1 + hλ| = {fmt(eulerR, 4)} більший за 1. Через {N} кроків замість ≈ {fmt(Math.exp(5 * dl), 2)} маємо ≈ {fmt(Math.pow(1 + z, N), 3)}:{" "}
                  <Relatable kind="growth" n={Math.pow(eulerR, N)} /> Щоб не вибухало, потрібно h &lt; {fmt(2 / -dl, 3)}.
                </>
              }
            >
              <Tex>{`|1+h\\lambda| = ${fmt(eulerR, 4)} > 1`}</Tex>. Через {N} кроків розв&apos;язок, що мав би бути{" "}
              <Tex>{`e^{${fmt(5 * dl, 3)}}\\approx${fmt(Math.exp(5 * dl), 2)}`}</Tex>, дорівнює <Tex>{`(${fmt(1 + z, 3)})^{${N}}`}</Tex> ≈{" "}
              {fmt(Math.pow(1 + z, N), 3)}. Потрібно <Tex>{`h<2/|\\lambda|=${fmt(2 / -dl, 3)}`}</Tex>.
            </Insight>
          )}
          {methods.includes("euler") && Math.abs(eulerR - 1) <= 1e-9 && (
            <Insight
              tone="warn"
              title="Рівно на межі: hλ = −2"
              simple={
                <>
                  Ейлер видає 1, −1, 1, −1… — вічна «пилка» замість згасання. Як банк, що за період знімає рівно 200 % балансу: ви в мінусі на ту саму суму, потім
                  знову в плюсі. Спробуйте λ = −20 і h = 0.1.
                </>
              }
            >
              Ейлер видає <Tex>{"1,-1,1,-1,\\dots"}</Tex> — вічна «пилка» замість згасання. Спробуйте λ = −20 і h = 0.1.
            </Insight>
          )}
          {methods.includes("theta") && thR < -0.3 && (
            <Insight
              tone="warn"
              title={`θ = 0.55: стійкий, але знак скаче (R = ${fmt(thR, 3)})`}
              simple={
                <>
                  При h·|λ| = {fmt(-z, 3)} (більше за 2.22) множник θ-методу від&apos;ємний: yₙ щокроку міняє знак і тане як {fmt(Math.abs(thR), 3)}
                  <sup>n</sup>, а мав би — як {fmt(Math.exp(z), 3)}
                  <sup>n</sup>. Що більший крок, то повільніше гасне: множник прямує до −0.818.
                </>
              }
            >
              При <Tex>{`h|\\lambda|=${fmt(-z, 3)} > 1/0.45\\approx2.22`}</Tex> множник від&apos;ємний: <Tex>{"y_n"}</Tex> щокроку міняє знак і згасає як{" "}
              {fmt(Math.abs(thR), 3)}
              <sup>n</sup> замість <Tex>{`e^{z}=${fmt(Math.exp(z), 3)}`}</Tex>. Межа <Tex>{"R(-\\infty)=-0.818"}</Tex>: що більший крок, то повільніше згасання.
            </Insight>
          )}
          {eE !== undefined && eT !== undefined && eE < 0.5 && eT > 0 && (
            <Insight
              tone="info"
              title="Точність при малому кроці"
              simple={
                <>
                  При малому кроці θ = 0.55 майже як трапеції: його промах на одному кроці приблизно в 10 разів менший, ніж у Ейлера. Тут відношення похибок «Ейлер / θ» ={" "}
                  {fmt(eE / eT, 3)}.
                </>
              }
            >
              θ = 0.55 близький до трапецій: головний член локальної похибки <Tex>{"(\\theta-\\tfrac12)z^2"}</Tex> замість <Tex>{"\\tfrac12z^2"}</Tex> у Ейлера — у{" "}
              <b>10 разів</b> менший. Тут похибка Ейлера / θ-методу = {fmt(eE / eT, 3)}.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Гра" title="Вибухне чи ні?" simpleTitle="Гра: вибухне чи ні?">
        <Card>
          <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Chips label="Метод для гри" value={gm} onChange={setGm} options={(Object.keys(RF) as OneStep[]).map((m) => ({ value: m, label: METHODS[m].short }))} />
              <Say
                simple={
                  <div className="text-[13px] text-white/65">
                    Параметри — з лабораторії: λ = {fmt(dl, 3)}, h = {fmt(dh, 3)}, hλ = {fmt(z, 3)}. Що робитиме yₙ = Rⁿ, якщо щокроку множити на той самий
                    множник R?
                  </div>
                }
              >
              <div className="text-[13px] text-white/65">
                Параметри беруться з лабораторії: <Tex>{`\\lambda=${fmt(dl, 3)},\\ h=${fmt(dh, 3)},\\ z=${fmt(z, 3)}`}</Tex>. Як поведе себе послідовність{" "}
                <Tex>{"y_n=R(z)^n"}</Tex>?
              </div>
              </Say>
            </div>
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="font-mono text-lg text-white">
                🏆 {score.ok}/{score.all}
              </div>
              <button onClick={randomChallenge} className="rounded-full border border-[var(--accent)] px-3 py-1 text-[12.5px] text-white hover:bg-[var(--accent)]/15">
                🎲 випадковий виклик
              </button>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(KIND) as Kind[]).map((k) => {
              const picked = myGuess === k;
              const right = done && myGuess && k === gKind;
              return (
                <button
                  key={k}
                  onClick={() => makeGuess(k)}
                  disabled={!!myGuess}
                  className={`rounded-xl border px-3 py-2 text-[13px] transition-all ${
                    right ? "border-[#3ee6a8] bg-[#3ee6a8]/15 text-white" : picked ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-white/10 bg-white/[0.03] text-white/75 hover:border-white/30"
                  } ${myGuess && !picked && !right ? "opacity-50" : ""}`}
                >
                  {KIND[k].icon} {KIND[k].label}
                </button>
              );
            })}
          </div>
          <BlowupBarsScene
            ys={game.ys}
            exact={game.ex}
            shown={shownEff}
            color={METHODS[gm].color}
            title={`${METHODS[gm].name}: R(${fmt(z, 3)}) = ${myGuess && done ? fmt(gr, 4) : "?"}`}
            reveal={!!myGuess && done}
            verdict={
              myGuess
                ? {
                    text: `${myGuess === gKind ? "✅ Вгадали!" : "❌ Не вгадали."} Відповідь: ${KIND[gKind].icon} ${KIND[gKind].label}`,
                    tone: myGuess === gKind ? "good" : "bad",
                  }
                : undefined
            }
          />
          <div className="mt-3">
            <PlaybackBar pb={pb} label={myGuess ? `n = ${shownEff - 1} / ${game.ys.length - 1}` : "робіть ставку"} />
          </div>
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Кольорові стовпчики — те, що порахував метод (yₙ), білі риски — правильна відповідь e<sup>λtₙ</sup>. До ±1.2 шкала звичайна, вище — стиснута
                (логарифмічна), інакше вибух не влізе в екран. Робіть ставку до того, як стовпчики виростуть!
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Кольорові стовпчики — числові <Tex>{"y_n"}</Tex>, білі риски — точне <Tex>{"e^{\\lambda t_n}"}</Tex>. Шкала лінійна до ±1.2, а вище — логарифмічна (інакше
            вибух не влізе в екран). Зробіть ставку до того, як стовпчики виростуть!
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Результати" title="Максимальні похибки на [0, 5]" simpleTitle="Хто наскільки промахнувся на [0, 5]">
        <Card>
          <Table
            head={["λ", "Метод", ...HS.map((v) => `h = ${v}`)]}
            rows={LAMS.flatMap((l, i) =>
              BOOK.map((m, j) => [
                j === 0 ? <b key="l">{l}</b> : "",
                <span key={m} style={{ color: METHODS[m].color }}>
                  {METHODS[m].name}
                </span>,
                ...HS.map((hh, k) => {
                  const e = table[i][j][k];
                  const r = RF[m](hh * l);
                  const tag = r < 0 && Math.abs(r) <= 1 ? " ±" : "";
                  if (!Number.isFinite(e) || e > 1e6) return <span className="text-[#ff5d73]">💥</span>;
                  return (
                    <span className={e > 1 ? "text-[#ff5d73]" : e > 0.05 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>
                      {fmt(e, 3)}
                      <span className="text-white/40">{tag}</span>
                    </span>
                  );
                }),
              ]),
            )}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                «±» — множник від&apos;ємний: розв&apos;язок не вибухає, але щокроку міняє знак. Червоні числа &gt; 1 — вибух (Ейлер при h &gt; 2/|λ|). Наприклад,
                λ = −20, h = 0.5 дає (1 − 10)¹⁰ ≈ 3.5·10⁹. <Relatable kind="growth" n={Math.pow(9, 10)} />
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            «±» — множник R від&apos;ємний: розв&apos;язок стійкий, але щокроку міняє знак. Червоні значення &gt; 1 означають нестійкість (Ейлер при h &gt; 2/|λ|):
            наприклад, λ = −20, h = 0.5 дає <Tex>{"(1-10)^{10}\\approx 3.5\\cdot10^9"}</Tex>.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Чому так?" title="Область стійкості і точка z = hλ" simpleTitle="Карта «вибухне чи ні»">
        <Card>
          <StabilityExplorer
            methods={["euler", "ieuler", "theta", "trap", "rk2", "rk3", "rk4", "bdf2"]}
            z={[Math.max(z, -1.8 * range), 0]}
            onZ={(zz) => {
              const nz = Math.min(-1e-3, zz[0]);
              setH(Math.min(1, Math.max(0.01, nz / dl)));
            }}
            range={range}
            extraPoints={LAMS.map((l) => ({ z: [Math.max(dh * l, -1.8 * range), 0] as [number, number], color: "#ffffff88", label: `λ=${l}` }))}
          />
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <div className="mb-3">
          <Chips label="λ для мікроскопа" value={dbgLam} onChange={setDbgLam} options={LAMS.map((v) => ({ value: v, label: `λ = ${v}` }))} />
        </div>
        <StepDebugger
          f={dbgF}
          y0={DBG_Y0}
          T={2}
          view={DBG_VIEW}
          h0={0.15}
          hMin={0.01}
          hMax={1}
          hPresets={HS}
          hPresetsLabel="Кроки для порівняння"
          hint={
            <Say
              simple={
                <>
                  Сірі рисочки — «поле нахилів»: куди тягне рівняння в кожній точці (для λ = −20 — дуже круто до нуля). Явний Ейлер з h = 0.15 бере нахил на
                  старті й іде по ньому весь крок — і перелітає нуль: 1 → −2 → 4 → … Неявний Ейлер бере нахил у кінці кроку і не перелітає: 1 → 0.25 → 0.06 → …
                  Спробуйте й RK2, RK3, RK4: при такому кроці вони теж вибухають (RK2 і RK4 — без зміни знака, RK3 — зі зміною).
                </>
              }
            >
              Поле нахилів рівняння y′ = λy (вісь x — час). При λ = −20, h = 0.15 маємо z = −3: R<sub>Ейлер</sub> = −2 (вибух зі зміною знака), R<sub>RK2</sub> =
              2.5 і R<sub>RK4</sub> = 1.375 (монотонний вибух — z за межами −2 і −2.785), R<sub>RK3</sub> = −2 (межа −2.513 теж позаду), R<sub>неявн</sub> = 0.25,
              R<sub>θ</sub> = −0.132, R<sub>трап</sub> = −0.2. Пунктир — точний
              розв&apos;язок з (tₙ, yₙ) на [tₙ, tₙ + h].
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="4"
          questions={[
            {
              id: "theta",
              q: <>θ-метод (θ = 0.55), λ = −20, крок h = 0.5 (тобто hλ = −10). Як поведеться yₙ?</>,
              options: ["Монотонно згасне, як e^(λt)", "Згасатиме, щокроку міняючи знак", "Вибухне", "Вічно стрибатиме ±1"],
              correct: 1,
              explain: (
                <>
                  R(−10) = (1 − 4.5)/(1 + 5.5) = −3.5/6.5 ≈ −0.538: yₙ = 1, −0.54, 0.29, −0.16, … Метод A-стійкий (|R| &lt; 1), але не L-стійкий — тому знак
                  скаче. Максимальна похибка ≈ 0.54 — уже на першому кроці, бо точне e<sup>−10</sup> ≈ 0.
                </>
              ),
              explainSimple: <>Банк «θ» за такий довгий період знімає більше, ніж було: баланс стає −54 %, потім +29 %, −16 %… Тане, але з перекиданням знака.</>,
              show: {
                label: "Показати λ = −20, h = 0.5",
                run: () => {
                  setLam(-20);
                  setH(0.5);
                  want("theta");
                },
              },
            },
            {
              id: "hmax",
              q: <>Явний Ейлер, λ = −20. Який найбільший крок, за якого він ще не вибухає?</>,
              options: ["h = 2", "h = 0.2", "h = 0.1", "h = 0.01"],
              correct: 2,
              explain: (
                <>
                  |1 + hλ| ≤ 1 ⇔ h ≤ 2/|λ| = 0.1. Рівно при h = 0.1 маємо R = −1 (вічна пилка ±1, похибка ≈ 1.14), а вже при h = {Q_H} розв&apos;язувач робить
                  N = round(5/{Q_H}) = {Q_N} кроків довжиною T/N ≈ {fmt(Q_HEFF, 4)}: R = 1 − 20·{fmt(Q_HEFF, 4)} ≈ {fmt(Q_R, 4)}, і похибка на [0, 5] сягає ≈{" "}
                  {fmt(Q_ERR, 3)} (≈ |R|<sup>{Q_N}</sup>).
                </>
              ),
              explainSimple: (
                <>Банк «Ейлер» не заганяє вклад у нескінченний борг, лише поки за період знімає не більше 200 %: h·20 ≤ 2, тобто h ≤ 0.1. При 0.1 — вічні ±1000 ₴, трохи більше — вибух.</>
              ),
              show: {
                label: "Показати λ = −20, h = 0.1",
                run: () => {
                  setLam(-20);
                  setH(0.1);
                  want("euler");
                },
              },
            },
            {
              id: "acc",
              q: <>λ = −1, крок h = 0.5 — тут усі методи стійкі. Хто точніший: неявний Ейлер чи θ = 0.55?</>,
              options: ["Неявний Ейлер — він же L-стійкий", "θ = 0.55 — у десятки разів точніший", "Однаково — обидва першого порядку", "Обидва вибухнуть"],
              correct: 1,
              explain: (
                <>
                  Максимальні похибки на [0, 5]: неявний Ейлер ≈ 0.077, θ = 0.55 ≈ 0.0016 — у ~48 разів менша. Головний член локальної похибки θ-методу (θ −
                  ½)z² у 10 разів менший, ніж ½z² в Ейлерів; L-стійкість важлива лише при великих h|λ|.
                </>
              ),
              explainSimple: (
                <>При помірному кроці θ-метод — майже трапеції: промах ≈ 0.0016 проти ≈ 0.077 у неявного Ейлера. Вміння «гасити все» корисне лише для дуже швидких процесів.</>
              ),
              show: {
                label: "Показати λ = −1, h = 0.5",
                run: () => {
                  setLam(-1);
                  setH(0.5);
                  setMethods((ms) => Array.from(new Set([...ms, "ieuler", "theta"])) as MethodId[]);
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
            title="Явний Ейлер: умовна стійкість"
            simple={
              <>
                Не вибухає лише при h ≤ 2/|λ|. Для λ = −20 це h ≤ 0.1: при h = 0.1 — вічна пилка ±1, при 0.2 і 0.5 — вибух. Що швидше «тане» розв&apos;язок, то
                дрібніший крок потрібен — навіть коли від розв&apos;язку давно лишився нуль.
              </>
            }
          >
            Стійкий лише при <Tex>{"h\\le2/|\\lambda|"}</Tex>. Для λ = −20 це h ≤ 0.1: при h = 0.1 — вічна пилка ±1, при h = 0.2 і 0.5 — вибух. Ціна кроку
            зростає разом із |λ|, навіть коли сам розв&apos;язок давно «помер».
          </Insight>
          <Insight
            tone="good"
            title="Неявний Ейлер: L-стійкий"
            simpleTitle="Неявний Ейлер: ніколи не заганяє в борг"
            simple={
              <>
                Його множник завжди між 0 і 1: розв&apos;язок тане монотонно за будь-якого кроку. Плата — невисока точність і «перегасання» при великому кроці
                (λ = −1, h = 0.5: похибка ≈ 0.08).
              </>
            }
          >
            <Tex>{"0<R(z)<1"}</Tex> для всіх <Tex>{"z<0"}</Tex>: розв&apos;язок завжди монотонно згасає. Плата — перший порядок і надмірне «гасіння» при великих h
            (для λ = −1, h = 0.5 похибка ~0.08).
          </Insight>
          <Insight
            tone="warn"
            title="θ = 0.55: A-стійкий, але не L-стійкий"
            simpleTitle="θ = 0.55: точний, але «дзвінкий»"
            simple={
              <>
                При малому кроці він точніший за обидва Ейлери. Але при h·|λ| &gt; 2.22 множник від&apos;ємний, а при дуже великому кроці прямує до −0.818: швидкі
                процеси не гаснуть одразу, а «дзвенять». Тому θ беруть трохи більшим за ½ — щоб дзвін хоча б згасав.
              </>
            }
          >
            При малих h він точніший за обидва Ейлери (майже трапеції). Але при <Tex>{"h|\\lambda|>2.22"}</Tex> множник від&apos;ємний і прямує до −0.818: швидкі моди
            не гасяться, а «дзвенять». Саме тому θ береться трохи більшим за ½ — щоб |R(−∞)| &lt; 1 і дзвін хоча б згасав.
          </Insight>
          <Insight
            tone="info"
            title="Мораль"
            simple={<>Для будь-якої лінійної задачі вся поведінка методу — в одному числі R(hλ). Знаєте його — знаєте, вибухне метод, дзвенітиме чи слухняно згасне.</>}
          >
            Для будь-якої лінійної задачі вся поведінка методу закодована в одній функції <Tex>{"R(z)"}</Tex>. Подивіться на її графік — і ви вже знаєте, вибухне
            метод, дзвенітиме чи слухняно згасне.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Герман Дальквіст 1963 року довів: A-стійкий лінійний багатокроковий метод не може мати порядок вище 2, а найточніший серед них — трапеції. Відтоді
                рівняння u′ = λu називають його ім&apos;ям.
              </>
            }
          >
            Герман Дальквіст 1963 року довів «другий бар&apos;єр»: A-стійкий лінійний багатокроковий метод не може мати порядок вище 2, а найточніший із них — саме
            трапеції. Тестове рівняння <Tex>{"u'=\\lambda u"}</Tex> відтоді носить його ім&apos;я.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
