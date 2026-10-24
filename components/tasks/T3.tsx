"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot, { type Transform } from "@/components/plot/Plot";
import StabilityExplorer, { amp, type StabMethod } from "@/components/plot/StabilityExplorer";
import TightropeScene from "@/components/scenes/TightropeScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import Gauge from "@/components/ui/Gauge";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, linear2Exact, maxError, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import SteeringScene from "@/components/analogy/SteeringScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

const A = [
  [1525, 1350],
  [-2289, -2026],
];
const EX = linear2Exact(A, [0, 0], [1, 1]);
const L1 = -1;
const L2 = -500;
const BOOK = (t: number) => [(-450 / 807) * Math.exp(-t) + (719 / 269) * Math.exp(-500 * t), (1526 / 807) * Math.exp(-t) - (719 / 807) * Math.exp(-500 * t)];

const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];
const H_LIST = [0.04, 0.004, 0.002];
const T_LATE = 0.05;
// stable references for the debugger / playground
const F = (_t: number, y: number[]) => [1525 * y[0] + 1350 * y[1], -2289 * y[0] - 2026 * y[1]];
const Y0 = [1, 1];
const DBG_VIEW = { x: 0, y: 1, xLabel: "u₁", yLabel: "u₂", xDomain: [-3, 14] as [number, number], yDomain: [-18, 4] as [number, number] };
const PG_DOMAIN = { x: [-8, 10] as [number, number], y: [-11, 9] as [number, number] };
const PG_LABELS: [string, string] = ["u₁", "u₂"];

const pgUnderlay = (ctx: CanvasRenderingContext2D, { X, Y }: { X: (x: number) => number; Y: (y: number) => number }) => {
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(124,242,156,0.6)";
  ctx.beginPath();
  ctx.moveTo(X(-675 * 0.02), Y(763 * 0.02));
  ctx.lineTo(X(675 * 0.02), Y(-763 * 0.02));
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,93,115,0.4)";
  ctx.beginPath();
  ctx.moveTo(X(-2 * 5), Y(3 * 5));
  ctx.lineTo(X(2 * 5), Y(-3 * 5));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#3ee6a8";
  ctx.beginPath();
  ctx.arc(X(0), Y(0), 5, 0, Math.PI * 2);
  ctx.fill();
};

const R: Record<string, (z: number) => number> = {
  euler: (z) => 1 + z,
  rk2: (z) => 1 + z + (z * z) / 2,
  rk3: (z) => 1 + z + (z * z) / 2 + (z * z * z) / 6,
  rk4: (z) => 1 + z + (z * z) / 2 + (z * z * z) / 6 + (z * z * z * z) / 24,
  ieuler: (z) => 1 / (1 - z),
  theta: (z) => (1 + 0.45 * z) / (1 - 0.55 * z),
  trap: (z) => (1 + 0.5 * z) / (1 - 0.5 * z),
};

function lateMax(s: Solution, err: number[][], tl: number) {
  let m = 0;
  s.t.forEach((t, k) => {
    if (t < tl) return;
    for (const e of err) if (!(e[k] <= m)) m = e[k];
  });
  return m;
}

const eigenUnderlay = (ctx: CanvasRenderingContext2D, tr: Transform) => {
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(124,242,156,0.55)";
  ctx.beginPath();
  ctx.moveTo(tr.X(-675 * 0.02), tr.Y(763 * 0.02));
  ctx.lineTo(tr.X(675 * 0.02), tr.Y(-763 * 0.02));
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,93,115,0.55)";
  ctx.beginPath();
  ctx.moveTo(tr.X(1 - 2 * 6), tr.Y(1 + 3 * 6));
  ctx.lineTo(tr.X(1 + 2 * 6), tr.Y(1 - 3 * 6));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "11px var(--font-sans), sans-serif";
  ctx.fillStyle = "rgba(124,242,156,0.85)";
  ctx.fillText("повільний напрям v₁ (λ₁ = −1)", tr.X(1.2), tr.Y(-0.4));
  ctx.fillStyle = "rgba(255,93,115,0.85)";
  ctx.fillText("швидкий напрям v₂ (λ₂ = −500)", tr.X(3.6), tr.Y(-4.6));
  ctx.restore();
};

export default function T3() {
  const [h, setH] = useState(0.004);
  const [T, setT] = useState(10);
  const [methods, setMethods] = useState<MethodId[]>(["euler", "rk4", "ieuler", "trap"]);
  const [ci, setCi] = useState(0);
  const [hero, setHero] = useState<MethodId>("euler");
  const dh = useDeferredValue(h);
  const dT = useDeferredValue(T);
  const pb = usePlayback(14);

  const problem: Problem = useMemo(
    () => ({
      f: (_t, y) => [1525 * y[0] + 1350 * y[1], -2289 * y[0] - 2026 * y[1]],
      jac: () => A,
      y0: [1, 1],
      T: dT,
    }),
    [dT],
  );

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = solve(m, problem, { h: dh, blowup: 1e6 });
        const e = maxError(s, EX.at);
        return { m, s, e, late: lateMax(s, e.err, T_LATE) };
      }),
    [methods, problem, dh],
  );

  const exactT = useMemo(() => {
    const n = 1500;
    const t: number[] = [];
    for (let i = 0; i <= n; i++) t.push(1e-5 * Math.pow(dT / 1e-5, i / n));
    const y = t.map(EX.at);
    return { t: [0, ...t], u1: [1, ...y.map((v) => v[0])], u2: [1, ...y.map((v) => v[1])] };
  }, [dT]);
  const transT = useMemo(() => {
    const t: number[] = [];
    for (let i = 0; i <= 800; i++) t.push((0.05 * i) / 800);
    const y = t.map(EX.at);
    return { t, u: [y.map((v) => v[0]), y.map((v) => v[1])] };
  }, []);

  const table = useMemo(
    () =>
      H_LIST.map((hh) =>
        ALL.map((m) => {
          const s = solve(m, { ...problem, T: 10 }, { h: hh, blowup: 1e8 });
          const e = maxError(s, EX.at);
          return { s, e, late: lateMax(s, e.err, T_LATE) };
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const z = dh * L2;
  const eulerR = Math.abs(R.euler(z));
  const rk4R = Math.abs(R.rk4(z));
  const rk2R = Math.abs(R.rk2(z));
  const rk3R = Math.abs(R.rk3(z));

  const heroM = methods.includes(hero) ? hero : (methods[0] ?? "euler");
  const heroSol = useMemo(() => solve(heroM, { ...problem, T: Math.min(dT, 200 * dh) }, { h: dh, blowup: 1e6 }), [heroM, problem, dT, dh]);
  const heroErrs = useMemo(() => heroSol.t.map((t, k) => heroSol.y[k][ci] - EX.at(t)[ci]), [heroSol, ci]);
  const heroR = amp(heroM as StabMethod, [z, 0]);
  const Nshow = Math.max(1, Math.round(Math.min(dT, 200 * dh) / dh));
  const nNow = Math.min(Nshow, Math.floor(pb.progress * (Nshow + 6)));
  const tNow = nNow * dh;

  const blown = (s: Solution, err: number) => !!s.failed || err > 30;
  const sers = (src: { t: number[]; u: number[] }, logx = false) => [
    { x: src.t, y: src.u, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
    ...sols.map(({ m, s, e }) => ({
      x: logx ? s.t.slice(1) : s.t,
      y: logx ? comp(s, ci).slice(1) : comp(s, ci),
      color: METHODS[m].color,
      label: METHODS[m].short,
      width: blown(s, e.max) ? 1 : 1.7,
      opacity: blown(s, e.max) ? 0.45 : 1,
    })),
  ];

  const eu = sols.find((x) => x.m === "euler");
  const want = (m: MethodId) => setMethods((ms) => (ms.includes(m) ? ms : [...ms, m]));

  return (
    <>
      <AnalogyCard
        emoji="🚗"
        title="Кермувати, дивлячись на дорогу раз на h"
        story={
          <>
            Уявіть водія, який дивиться на дорогу лише раз на h секунд, а в проміжках їде наосліп і кермує за тим, що бачив востаннє. Дорога плавно
            повертає — це повільна частина задачі (секунди). Але кермо надчутливе: машина відгукується за <b>дві мілісекунди</b> — це швидка частина. Якщо
            водій дивиться рідко й щоразу різко викручує кермо, він перескакує центр смуги: зигзаг, ще ширший зигзаг — і кювет. Явний Ейлер робить те саме.
          </>
        }
        mapping={[
          ["плавний поворот дороги (секунди)", <>повільна мода, λ₁ = −1</>],
          ["надчутливе кермо (1/500 с)", <>швидка мода, λ₂ = −500</>],
          ["як часто водій дивиться на дорогу", <>крок h</>],
          ["одним рухом у центр / вічний зигзаг / кювет", <>R = 1 + hλ₂ = 0 (h = 0.002) / −1 (h = 0.004) / −19 (h = 0.04)</>],
          ["обережний водій, що не перекермовує", <>неявний Ейлер, R = 1/(1 − hλ₂)</>],
        ]}
      >
        <SteeringScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Дві моди: повільна λ₁ = −1 і шалена λ₂ = −500" simpleTitle="Дві швидкості: спокійна і шалена">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`\begin{cases} u_1' = 1525\,u_1 + 1350\,u_2, & u_1(0)=1,\\ u_2' = -2289\,u_1 - 2026\,u_2, & u_2(0)=1, \end{cases}\qquad t\in[0,10].`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] text-white/70">
                  Кроки з умови h = 0.04, 0.004, 0.002. Коефіцієнти страшні (тисячі, ще й 1525 &gt; 0, ніби щось має рости), але вся система зводиться до двох
                  «темпів»: спокійного −1 (згасає за секунди) і шаленого −500 (за мілісекунди) — у 500 разів швидшого. <Relatable kind="ratio" n={500} />
                </p>
              }
            >
            <p className="mt-2 text-[14px] text-white/70">
              Кроки <Tex>{"h=0.04,\\ 0.004,\\ 0.002"}</Tex>. Коефіцієнти величезні (і <Tex>{"a_{11}=1525>0"}</Tex>), але слід матриці <Tex>{"-501"}</Tex>, а визначник{" "}
              <Tex>{"1525\\cdot(-2026)+1350\\cdot2289 = 500"}</Tex>. Тож
            </p>
            </Say>
            <Tex block>{String.raw`\lambda^2+501\lambda+500=0\ \Rightarrow\ \lambda_1=-1,\quad \lambda_2=-500,\qquad \frac{|\lambda_2|}{|\lambda_1|}=500.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] text-white/70">
                  Кожен темп має свій «напрям руху» на площині (u₁, u₂): спокійний — уздовж v₁ = (675, −763), шалений — уздовж v₂ = (2, −3). Розклавши старт
                  (1, 1) за цими напрямами, отримуємо точну формулу:
                </p>
              }
            >
            <p className="text-[14px] text-white/70">
              Власні вектори <Tex>{"v_1=(675,-763)"}</Tex> і <Tex>{"v_2=(2,-3)"}</Tex>. Розклад початкової умови за ними дає точний розв&apos;язок:
            </p>
            </Say>
            <Tex block>{String.raw`u_1=\frac{3375\,e^{-t}-2876\,e^{-500t}}{499},\qquad u_2=\frac{-3815\,e^{-t}+4314\,e^{-500t}}{499}.`}</Tex>
          </Card>
          <Card title="Що тут цікавого" icon="🎢">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Обидві частини згасають, але старт вражає: за ≈ 0.012 с u₁ злітає з 1 до ≈ 6.67, а u₂ падає до ≈ −7.53. Це шалена частина за мить «скидає»
                  розв&apos;язок на спокійний напрям v₁. Далі обидві компоненти просто тануть, як e<sup>−t</sup>.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Обидві моди згасають, але <b>перехідний процес</b> вражає: за ≈ 0.012 с <Tex>{"u_1"}</Tex> злітає з 1 до ≈ 6.67, а <Tex>{"u_2"}</Tex> падає до ≈ −7.53
              — так сильна швидка мода «скидає» розв&apos;язок на повільний напрям <Tex>{"v_1"}</Tex>. Далі обидві компоненти спокійно згасають як{" "}
              <Tex>{"e^{-t}"}</Tex>.
            </p>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  Явний Ейлер стійкий лише при h &lt; 2/500 = 0.004. Крок з умови h = 0.004 — <b>рівно на межі</b> (множник для шаленої частини −1), а h = 0.002
                  дає множник 0: шалена частина зникає за один крок!
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Межа явного Ейлера: <Tex>{"h<2/500=0.004"}</Tex>. Крок з умови <Tex>{"h=0.004"}</Tex> — <b>рівно на межі</b> (<Tex>{"1+h\\lambda_2=-1"}</Tex>), а{" "}
              <Tex>{"h=0.002"}</Tex> дає <Tex>{"1+h\\lambda_2=0"}</Tex>: швидку моду вбито за один крок!
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="«Точний» розв'язок з методички не відповідає задачі"
                simple={
                  <>
                    Формула «точного» розв&apos;язку з методички не підходить до цієї задачі: вона дає u₁(0) ≈ {fmt(BOOK(0)[0], 4)} замість 1, а її повільна
                    частина «дивиться» не в тому напрямку. Схоже, це розв&apos;язок іншої системи. Ми використовуємо формулу вище й перевіряємо її підстановкою.
                  </>
                }
              >
                Там <Tex>{String.raw`u_1=-\tfrac{450}{807}e^{-t}+\tfrac{719}{269}e^{-500t}`}</Tex>,{" "}
                <Tex>{String.raw`u_2=\tfrac{1526}{807}e^{-t}-\tfrac{719}{807}e^{-500t}`}</Tex>. Він дає <Tex>{`u_1(0)\\approx${fmt(BOOK(0)[0], 4)}\\ne1`}</Tex>, а
                відношення коефіцієнтів при <Tex>{"e^{-t}"}</Tex> (−0.295) не збігається з власним вектором <Tex>{"v_1"}</Tex> (−0.885) — тобто це розв&apos;язок
                іншої системи. Ми використовуємо формулу вище (вона ж — <code>linear2Exact</code>) і перевіряємо її підстановкою.
              </Insight>
            </div>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Ходіння по канату h = 0.004" simpleTitle="Крутіть крок: хто зірветься з межі h = 0.004?">
        <Lab
          controls={
            <>
              <Chips
                label="Крок з умови"
                value={H_LIST.includes(h) ? h : -1}
                onChange={(v) => v > 0 && setH(v)}
                options={H_LIST.map((v) => ({ value: v, label: `h = ${v}` }))}
              />
              <Slider label="Довільний крок h" value={h} onChange={setH} min={0.0002} max={0.05} log />
              <Slider label="Кінець відрізка T" value={T} onChange={setT} min={0.1} max={10} step={0.1} />
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
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Gauge value={eulerR} label="явний Ейлер |1+hλ₂|" />
                <Gauge value={rk4R} label="RK4 |R(hλ₂)|" />
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Tex>{`h\\lambda_2 = ${fmt(z, 4)}`}</Tex>. Межі: Ейлер і RK2 <Tex>{"h<0.004"}</Tex>, RK3 <Tex>{"h<0.00503"}</Tex>, RK4{" "}
                <Tex>{"h<0.00557"}</Tex>. Зараз RK2 |R| = <span className={rk2R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk2R, 4)}</span>, RK3 |R| ={" "}
                <span className={rk3R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk3R, 4)}</span>. Повільна мода <Tex>{`h\\lambda_1=${fmt(-dh, 3)}`}</Tex> —
                безпечна для всіх.
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title={`Перехідний процес ${ci ? "u₂" : "u₁"}(t), перші 0.05 с`}
              xLabel="t"
              xDomain={[0, 0.05]}
              yDomain={[-9.5, 8.5]}
              cursorX={tNow <= 0.05 ? tNow : undefined}
              series={sers({ t: transT.t, u: transT.u[ci] })}
            />
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Увесь відрізок (лог. шкала часу)"
                height={240}
                xLabel="t"
                logX
                xDomain={[1e-4, dT]}
                yDomain={[-9.5, 8.5]}
                series={sers({ t: exactT.t.slice(1), u: (ci ? exactT.u2 : exactT.u1).slice(1) }, true)}
              />
            </Card>
            <Card>
              <Plot
                title="Похибка |u − u_точн| (лог. шкала)"
                height={240}
                xLabel="t"
                logY
                yDomain={[1e-12, 1e4]}
                series={sols.map(({ m, s, e }) => ({
                  x: s.t,
                  y: e.err[ci].map((v) => Math.max(v, 1e-16)),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: 1.4,
                }))}
              />
            </Card>
          </Grid>
          <Card>
            <Plot
              title="Фазова площина: стрибок уздовж v₂, потім повзання вздовж v₁ до нуля"
              height={300}
              sorted={false}
              xLabel="u₁"
              yLabel="u₂"
              xDomain={[-2, 9]}
              yDomain={[-10, 3]}
              underlay={eigenUnderlay}
              series={[
                { x: exactT.u1, y: exactT.u2, color: "#ffffff", label: "точний", width: 4, opacity: 0.4 },
                ...sols.map(({ m, s, e }) => ({
                  x: comp(s, 0),
                  y: comp(s, 1),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: blown(s, e.max) ? 1 : 1.4,
                  opacity: blown(s, e.max) ? 0.45 : 0.9,
                })),
              ]}
              markers={[{ x: 1, y: 1, color: "#ffffff", r: 4 }]}
            />
          </Card>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, e, late }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : fmt(e.max, 3)}
                sub={s.failed ? s.failed : `max похибка · при t ≥ ${T_LATE}: ${fmt(late, 2)} · ${s.steps} кроків · ${fmtMs(s.ms)}`}
                tone={s.failed || late > 1 ? "bad" : late > 1e-2 ? "warn" : "good"}
              />
            ))}
          </div>
          {eu && !eu.s.failed && Math.abs(eulerR - 1) < 0.01 && (
            <Insight
              tone="warn"
              title="Канатоходець: |1 + hλ₂| = 1"
              simpleTitle="Вічний зигзаг: множник рівно −1"
              simple={
                <>
                  Для шаленої частини множник Ейлера рівно −1: вона не згасає і не росте, а щокроку перескакує на інший бік з тією самою амплітудою ≈{" "}
                  {fmt(eu.late, 3)}. Точний розв&apos;язок давно забув про старт, а Ейлер — ні. Трохи більший крок — і падіння.
                </>
              }
            >
              Швидка мода в Ейлера не згасає і не росте: її амплітуда ≈ {fmt(eu.late, 3)} просто щокроку міняє знак. Від точного розв&apos;язку (де вона давно
              нуль) лишається вічна «пилка». Трохи більший крок — і канатоходець падає.
            </Insight>
          )}
          {eu && !eu.s.failed && Math.abs(1 + z) < 0.05 && (
            <Insight
              tone="good"
              title="Ідеальний крок для Ейлера"
              simple={
                <>
                  Множник {fmt(1 + z, 3)} ≈ 0: як водій, що одним рухом ставить машину точно в центр смуги, — шалена частина зникає за один крок. Далі похибку дає
                  лише спокійна частина, а для неї такий крок мізерний.
                </>
              }
            >
              <Tex>{`1+h\\lambda_2=${fmt(1 + z, 3)}\\approx0`}</Tex> — швидка мода зникає за один крок. Тому після першого кроку похибка Ейлера визначається лише
              повільною модою, де <Tex>{"h|\\lambda_1|"}</Tex> мізерне.
            </Insight>
          )}
          {eu && eu.s.failed && (
            <Insight
              tone="bad"
              title="Падіння з канату"
              simple={
                <>
                  Множник {fmt(eulerR, 3)} більший за 1: похибка щокроку зростає в {fmt(eulerR, 3)} раза. Якби рахувати до кінця відрізка:{" "}
                  <Relatable kind="growth" n={Math.pow(eulerR, dT / dh)} />
                </>
              }
            >
              <Tex>{`|1+h\\lambda_2|=${fmt(eulerR, 3)}`}</Tex>: похибка множиться на {fmt(eulerR, 3)} щокроку. {eu.s.failed}.
            </Insight>
          )}
          {sols.some((x) => (x.m === "trap" || x.m === "theta") && x.late > 0.1) && (
            <Insight
              tone="info"
              title="Трапеції та θ = 0.55: стійкі, але з «відлунням»"
              simple={
                <>
                  Вони не вибухають, але при великому кроці їхні множники близькі до −1 (трапеції {fmt(R.trap(z), 3)}, θ = 0.55 {fmt(R.theta(z), 3)}): невідпрацьований
                  старт довго «дзвенить», перескакуючи з боку на бік. Неявний Ейлер (множник {fmt(R.ieuler(z), 3)}) гасить його одразу.
                </>
              }
            >
              <Tex>{`R_{trap}(h\\lambda_2)=${fmt(R.trap(z), 3)},\\ R_{0.55}(h\\lambda_2)=${fmt(R.theta(z), 3)}`}</Tex>. При великому h ці множники близькі до −1, тож
              нерозв&apos;язаний перехідний процес довго «дзвенить» зі зміною знака. Неявний Ейлер (<Tex>{`R=${fmt(R.ieuler(z), 3)}`}</Tex>) гасить його одразу.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Канатоходець на межі стійкості" simpleTitle="Канатоходець: хитнеться чи впаде?">
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Chips
              label="Хто йде по канату"
              value={heroM}
              onChange={setHero}
              options={methods.map((m) => ({ value: m, label: METHODS[m].short }))}
            />
          </div>
          <TightropeScene
            errs={heroErrs}
            n={nNow}
            color={METHODS[heroM].color}
            label={`${METHODS[heroM].name}, h = ${fmt(dh, 3)}`}
            R={heroR}
            failAt={heroSol.failed ? heroSol.t.length - 1 : undefined}
          />
          <div className="mt-3">
            <PlaybackBar pb={pb} label={`n = ${nNow}, t = ${fmt(tNow, 3)}`} />
          </div>
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Нахил жердини — похибка обраного методу на n-му кроці (компонента {ci ? "u₂" : "u₁"}, перші {Nshow} кроків). Щокроку похибка в «шаленому»
                напрямку множиться на те саме число R: |R| &lt; 1 — канатоходець заспокоюється, R = −1 — вічно хитається вліво-вправо, |R| &gt; 1 — падає.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Нахил жердини — похибка <Tex>{"e_n=u^{(n)}-u(t_n)"}</Tex> компоненти {ci ? "u₂" : "u₁"} на n-му кроці (перші {Nshow} кроків). Для лінійної задачі похибка
            у швидкому напрямку множиться на <Tex>{"R(h\\lambda_2)"}</Tex> кожного кроку: <Tex>{"|R|<1"}</Tex> — канатоходець заспокоюється,{" "}
            <Tex>{"R=-1"}</Tex> — вічно хитається вліво-вправо, <Tex>{"|R|>1"}</Tex> — падає в сітку.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Результати" title="Максимальні похибки на [0, 10]" simpleTitle="Хто наскільки промахнувся на [0, 10]">
        <Card>
          <Table
            head={["Метод", ...H_LIST.map((v) => `h = ${v} (hλ₂ = ${fmt(v * L2, 3)})`)]}
            rows={ALL.map((m, j) => [
              <span key={m} style={{ color: METHODS[m].color }}>
                {METHODS[m].name}
              </span>,
              ...H_LIST.map((_, i) => {
                const { s, e, late } = table[i][j];
                if (s.failed) return <span className="text-[#ff5d73]">💥 вибух</span>;
                const c = late > 1 ? "text-[#ff5d73]" : late > 1e-2 ? "text-[#ffb547]" : "text-[#3ee6a8]";
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
                Перше число — найбільший промах на всьому відрізку (майже завжди — у стрімкому старті, перші мілісекунди). Друге — найбільший промах при t ≥{" "}
                {T_LATE}, коли в точному розв&apos;язку від шаленої частини вже нічого не лишилось: воно показує, чи метод «забув» старт.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Перше число — max похибка на всьому відрізку (майже завжди її дає перехідний процес у перші мілісекунди), друге — max похибка при t ≥ {T_LATE}, коли
            швидка мода в точному розв&apos;язку вже згасла як <Tex>{"e^{-25}"}</Tex>.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Чому так?" title="Де лежить hλ₂ на карті стійкості" simpleTitle="Карта «вибухне чи ні»">
        <Card>
          <StabilityExplorer
            z={[Math.max(z, -24), 0]}
            onZ={(zz) => setH(Math.min(0.05, Math.max(0.0002, Math.abs(zz[0] / L2))))}
            range={6}
            extraPoints={H_LIST.map((v) => ({ z: [Math.max(v * L2, -24), 0] as [number, number], color: "#ffffff88", label: `h=${v}` }))}
          />
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={F}
          y0={Y0}
          T={3}
          view={DBG_VIEW}
          h0={0.004}
          hMin={0.0005}
          hMax={0.05}
          hPresets={H_LIST}
          hint={
            <Say
              simple={
                <>
                  Площина (u₁, u₂). Точка з (1, 1) має за мілісекунди стрибнути до (6.7, −7.5), а потім повільно повзти до нуля. Явний Ейлер з h = 0.004
                  стрибає між (1, 1) і (12.5, −16.3) — туди-сюди, ані ближче, ані далі: множник рівно −1. Поставте h = 0.002 — і він першим же кроком
                  потрапить куди треба. А з h = 0.04 вилетить за межі графіка за один крок.
                </>
              }
            >
              Фазова площина (u₁, u₂). Швидкий власний вектор v₂ = (2, −3) і повільний v₁ = (675, −763) майже паралельні (кут ≈ 8°), тому старт (1, 1) дає
              великий перехідний процес. При h = 0.004 множник явного Ейлера для швидкої моди 1 + hλ₂ = −1: точки стрибають туди-сюди вздовж v₂, а повільна
              складова тим часом множиться на 1 + hλ₁ = 1 − h. Пунктир — точний розв&apos;язок задачі Коші з (tₙ, yₙ) на [tₙ, tₙ + h].
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Клацніть будь-де — і подивіться, як система падає на повільний напрям" simpleTitle="Клацніть будь-де — і подивіться, куди «впаде» точка" report={false}>
        <PhasePlayground
          f={F}
          init={Y0}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={0.5}
          speedRange={[0.02, 5]}
          trail={8}
          strip={[
            { comp: 0, label: "u₁", color: "#ffd84d" },
            { comp: 1, label: "u₂", color: "#5cc8ff" },
          ]}
          window={6}
          kicks={[
            { label: "Поштовх уздовж v₂", emoji: "⚡", apply: (y) => [y[0] + 2, y[1] - 3], hint: "u += (2, −3)" },
            { label: "Поштовх проти v₂", emoji: "↩️", apply: (y) => [y[0] - 2, y[1] + 3], hint: "u −= (2, −3)" },
            { label: "Легкий поштовх (−0.5, −0.5)", emoji: "🎯", apply: (y) => [y[0] - 0.5, y[1] - 0.5], hint: "u += (−0.5, −0.5)" },
          ]}
          underlay={pgUnderlay}
          hint={
            <Say
              simple={
                <>
                  Клацніть будь-де: точка за мілісекунди «стрибає» паралельно червоному пунктиру (шалений напрям) на зелену пряму (спокійний напрям) — і далі
                  повільно повзе по ній до нуля. «⚡/↩️» штовхають уздовж шаленого напрямку — і точка миттєво повертається на те саме місце. А крихітний
                  «🎯» поштовх (−0.5, −0.5) зсуває її вздовж зеленої прямої аж на ~5 одиниць: напрямки майже паралельні, і це підсилює будь-яку зміну.
                </>
              }
            >
              Траєкторії за час ~5/|λ₂| = 0.01 потрапляють на пряму v₁ (повільна мода, зелений пунктир), рухаючись паралельно v₂ (червоний пунктир), і далі
              згасають як e^(−t). Поштовх уздовж v₂ змінює лише швидку компоненту — вона згасає, і стан повертається в ту саму точку на v₁. Поштовх (−0.5, −0.5)
              має повільну компоненту ≈ −0.005·v₁ ≈ (−3.4, 3.8): через майже паралельні власні вектори мале збурення дає великий зсув.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="3"
          questions={[
            {
              id: "edge",
              q: <>Явний Ейлер з h = 0.004 (крок з умови). Що буде з похибкою при t ≥ 0.05, коли точний перехідний процес уже згас?</>,
              options: ["Згасне, як e^(−500t)", "Вічна «пилка» сталої амплітуди", "Вибухне за кілька кроків", "Зникне після першого ж кроку"],
              correct: 1,
              explain: (
                <>
                  1 + hλ₂ = 1 − 2 = −1: швидка компонента похибки щокроку змінює знак, але не зменшується. Максимальна похибка при t ≥ 0.05 ≈ 8.65 — і так до
                  t = 10 (див. таблицю).
                </>
              ),
              explainSimple: <>Водій щоразу перекермовує рівно настільки, наскільки збився: зигзаг не росте, але й ніколи не стихає (амплітуда ≈ 8.7).</>,
              show: {
                label: "Показати h = 0.004",
                run: () => {
                  setH(0.004);
                  want("euler");
                },
              },
            },
            {
              id: "kill",
              q: <>А якщо зменшити крок удвічі, h = 0.002? Що станеться зі швидкою модою в явного Ейлера?</>,
              options: ["Згасатиме, але вдвічі повільніше", "Зникне вже після першого кроку", "Лишиться пилка, тільки вдвічі менша", "Вибухне"],
              correct: 1,
              explain: (
                <>
                  1 + hλ₂ = 1 − 1 = 0: швидка компонента множиться на нуль і зникає за один крок. Далі похибка — лише від повільної моди: ≈ 2.8·10⁻³ при t ≥
                  0.05, як у неявного Ейлера з тим самим кроком.
                </>
              ),
              explainSimple: (
                <>Як водій, що одним рухом ставить машину точно в центр смуги: множник 0, шалена частина зникає одразу, і лишається тільки маленька похибка ≈ 0.003.</>
              ),
              show: {
                label: "Показати h = 0.002",
                run: () => {
                  setH(0.002);
                  want("euler");
                },
              },
            },
            {
              id: "rk4",
              q: <>RK4 з тим самим «межовим» кроком h = 0.004 — вибухне?</>,
              options: [
                "Так — межа стійкості в усіх явних методів однакова",
                "Ні — стійкий, швидка мода помітно згасає щокроку",
                "Буде вічна «пилка», як в Ейлера",
                "Вибухне, але повільніше, ніж Ейлер",
              ],
              correct: 1,
              explain: (
                <>
                  Для RK4 R(z) = 1 + z + z²/2 + z³/6 + z⁴/24, і R(−2) = 1/3: швидка мода зменшується втричі за крок. Межа RK4 на дійсній осі ≈ −2.785, тобто
                  h &lt; 0.00557. Похибка при t ≥ 0.05 — лише ~5·10⁻⁶. У кожного явного методу межа своя: RK2 має R(−2) = 1 і, як Ейлер, лишається на межі
                  (похибка не міняє знак, а просто завмирає на ≈ 8.6), а RK3 з R(−2) = −1/3 уже стійкий.
                </>
              ),
              explainSimple: (
                <>
                  У RK4 «запас стійкості» більший: при тому самому кроці шалена частина щоразу слабне втричі. Його межа — h ≈ 0.0056, а не 0.004. У RK3 межа h ≈
                  0.005 — теж стійкий; а от у RK2 межа така сама, як в Ейлера, і він так само застрягає на старті.
                </>
              ),
              show: {
                label: "Показати RK4, h = 0.004",
                run: () => {
                  setH(0.004);
                  want("rk4");
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
            title="h = 0.04: явні методи падають"
            simple={
              <>
                При h = 0.04 Ейлер множить похибку на 19, RK2 — на 181, RK3 — на ≈ 1.15 тисячі, RK4 — на ≈ 5.5 тисячі щокроку. Вибух за кілька кроків, хоча сам
                розв&apos;язок після t ≈ 0.01 — спокійна гладенька крива e<sup>−t</sup>.
              </>
            }
          >
            <Tex>{"h\\lambda_2=-20"}</Tex>: Ейлер множить похибку на 19, RK2 — на 181, RK3 — на ≈ 1.15 тисячі, RK4 — на ≈ 5.5 тисячі щокроку. Розв&apos;язок вибухає за кілька кроків, хоча сам розв&apos;язок
            при <Tex>{"t>0.01"}</Tex> — гладенька експонента <Tex>{"e^{-t}"}</Tex>.
          </Insight>
          <Insight
            tone="warn"
            title="h = 0.004: рівно на межі"
            simple={
              <>
                Ейлер має множник −1: не вибухає, але й не забуває старт — зигзаг амплітудою ~6–9 живе до кінця. RK2 має множник рівно 1 — теж застрягає, тільки
                без зигзагу (похибка просто завмирає на ≈ 8.6). RK3 (множник −1/3) і RK4 (1/3) з тим самим кроком уже стійкі: у кожного методу своя межа.
              </>
            }
          >
            Ейлер має <Tex>{"R=-1"}</Tex>: він не вибухає, але й не забуває перехідний процес — пилка амплітудою ~6–9 живе до кінця. RK2 має <Tex>{"R(-2)=1"}</Tex>{" "}
            — теж на межі, але без зміни знака: похибка завмирає на ≈ 8.6. RK3 (<Tex>{"R(-2)=-1/3"}</Tex>) і RK4 (<Tex>{"R(-2)=1/3"}</Tex>) з тим самим кроком уже
            стійкі.
          </Insight>
          <Insight
            tone="good"
            title="Неявні методи стійкі при будь-якому h"
            simple={
              <>
                Неявний Ейлер і BDF2 гасять шалену частину навіть при h = 0.04. Помиляються вони лише тому, що великий крок «проскакує» стрімкий старт; далі
                похибка тане.
              </>
            }
          >
            Неявний Ейлер і BDF2 гасять швидку моду навіть при h = 0.04. Похибка там лише від того, що крок «проскочив» перехідний процес; потім вона спадає.
          </Insight>
          <Insight
            tone="info"
            title="Перевіряйте «точні» розв'язки"
            simple={<>Формула з методички не проходить навіть найпростішу перевірку — підставити t = 0 і порівняти з початковою умовою. Один рядок коду — і помилку знайдено.</>}
          >
            Формула з методички не задовольняє початкову умову. Найпростіша перевірка будь-якого точного розв&apos;язку — підставити <Tex>{"t=0"}</Tex> і
            порахувати залишок рівняння. Тут вистачило одного рядка коду.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Шарль Блонден 1859 року пройшов канатом над Ніагарою з жердиною 12 м і вагою ~18 кг. Довга важка жердина робить нахили повільнішими — по суті,
                зменшує «|R|» балансу. Нашому Ейлеру при h = 0.004 такої жердини бракує.
              </>
            }
          >
            Шарль Блонден 1859 року пройшов канатом над Ніагарою з жердиною 12 м і вагою ~18 кг. Жердина збільшує момент інерції, тому нахили наростають повільніше —
            по суті, вона зменшує «|R|» балансу. Нашому Ейлеру при h = 0.004 такої жердини не вистачає.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
