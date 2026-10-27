"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Plot from "@/components/plot/Plot";
import StabilityExplorer from "@/components/plot/StabilityExplorer";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import Gauge from "@/components/ui/Gauge";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, linear2Exact, maxError, solve, type MethodId, type Problem } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import ChargerScene from "@/components/analogy/ChargerScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { useTaskExport } from "@/components/share/TaskActions";
import { exportT1 } from "@/components/share/TaskExports";
import { methodsIn, useUrlNum } from "@/components/share/TaskUrl";
import { useUrlState } from "@/lib/url-state";

const A = [
  [-1001, 1],
  [1, -1],
];
const B = [1000, 0];
const EX = linear2Exact(A, B, [0, 0]);
const [L1, L2] = EX.lambda; // -0.999000001…, -1001.000999999…
/** Нев'язка першого рівняння для формули методички з множниками (1 − λᵢ): u₁(0) = 0 виконано, але u₁′(0) = −λ₁λ₂ = −1000
 *  замість +1000, тож r₁(0) = −2λ₁λ₂ = −2000; далі r₁(t) = −2λ₁λ₂·e^{λ₁t} лише згасає — максимум на [0, 5] саме при t = 0. */
const BOOK_R0 = 2 * L1 * L2;

const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];
// stable references for the debugger / playground
const F = (_t: number, y: number[]) => [-1001 * y[0] + y[1] + 1000, y[0] - y[1]];
const Y0 = [0, 0];
const DBG_VIEW = { x: 0, y: 1, xLabel: "u₁", yLabel: "u₂", xDomain: [-0.4, 2.4] as [number, number], yDomain: [-0.2, 1.3] as [number, number] };
const PG_DOMAIN = { x: [-0.6, 1.8] as [number, number], y: [-0.6, 1.6] as [number, number] };
const PG_LABELS: [string, string] = ["u₁", "u₂"];
const H_LIST = [0.02, 0.005, 0.002];
// Карта стійкості: геометрія вікна StabilityExplorer — центр −0.35·range, напіввисота 0.75·range, напівширина = напіввисота·(w/h).
// Range підбираємо за фактичною шириною полотна, щоб ліва межа сягала STAB_LEFT і точка hλ₂ = −20.02 (h = 0.02) була видна.
const STAB_H = 380; // висота полотна StabilityExplorer за замовчуванням
const STAB_LEFT = -22.5;
const STAB_RANGE_MAX = 24; // на дуже вузьких екранах далекі точки притискаються до краю з підписом справжнього z

export default function T1() {
  const [h, setH] = useUrlNum("h", 0.002, 0.0002, 0.03);
  const [T, setT] = useUrlNum("T", 5, 1, 20);
  const [methods, setMethods] = useUrlState<MethodId[]>("m", ["euler", "ieuler", "theta", "bdf2"], methodsIn(ALL));
  const [ci, setCi] = useState(0);
  const dh = useDeferredValue(h);
  const dT = useDeferredValue(T);
  useTaskExport(exportT1({ h, T, methods }));

  const problem: Problem = useMemo(
    () => ({
      f: (_t, y) => [-1001 * y[0] + y[1] + 1000, y[0] - y[1]],
      jac: () => A,
      y0: [0, 0],
      T: dT,
    }),
    [dT],
  );

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = solve(m, problem, { h: dh, blowup: 1e6 });
        return { m, s, err: maxError(s, EX.at) };
      }),
    [methods, problem, dh],
  );

  const exactT = useMemo(() => {
    const n = 1500;
    const t: number[] = [];
    // denser near 0 to resolve the boundary layer
    for (let i = 0; i <= n; i++) t.push(dT * Math.pow(i / n, 2.2));
    return { t, y: t.map((x) => EX.at(x)[ci]) };
  }, [dT, ci]);

  const table = useMemo(
    () =>
      H_LIST.map((hh) =>
        ALL.map((m) => {
          const s = solve(m, { ...problem, T: 5 }, { h: hh, blowup: 1e8 });
          return { s, e: maxError(s, EX.at) };
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // «грубий» крок h = 0.1 для тези висновків: точність, якої вистачає, дає лише L-стійкий метод
  const coarseIE = useMemo(() => maxError(solve("ieuler", { f: F, jac: () => A, y0: Y0, T: 5 }, { h: 0.1 }), EX.at).max, []);

  const z = dh * L2;
  const eulerR = Math.abs(1 + z);

  const stabWrap = useRef<HTMLDivElement>(null);
  const [stabW, setStabW] = useState(600);
  useEffect(() => {
    const cv = stabWrap.current?.querySelector("canvas");
    if (!cv) return;
    const ro = new ResizeObserver(([e]) => setStabW(Math.floor(e.contentRect.width)));
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);
  const stab = useMemo(() => {
    const k = 0.35 + (0.75 * stabW) / STAB_H; // ліва межа вікна: x0 = −range·k
    const range = Math.min(STAB_RANGE_MAX, Math.max(6, -STAB_LEFT / k));
    const px = STAB_H / (1.5 * range); // пікселів на одиницю z
    const edge = -range * k + 14 / px; // 14 px від лівого краю
    // на вузькому полотні (телефон) точки h = 0.005 і 0.002 стоять ближче (~32 px), ніж довжина підпису «h=0.005», — тоді підписи без «h=»
    const compact = Math.abs((H_LIST[1] - H_LIST[2]) * L2) * px < 48;
    const pts: { z: [number, number]; color: string; label?: string }[] = H_LIST.map((v, i) => {
      const zz = v * L2;
      return zz < edge
        ? { z: [edge, 0] as [number, number], color: "#ffffff88", label: `◀ h=${v} (z = ${fmt(zz, 4)})` }
        : { z: [zz, 0] as [number, number], color: "#ffffff88", label: compact && i > 0 ? `${v}` : `h=${v}` };
    });
    return { range, px, edge, pts };
  }, [stabW]);
  // поточна точка передається без обрізання (панель |R| праворуч рахує саме її); якщо вона за лівим краєм — показуємо маркер на краю
  // нейтрального кольору (стійкість залежить від методу, вибраного на карті). Притиснуті до краю точки кроків з умови тоді не малюємо,
  // а точкам у перших ~110 px від краю (h = 0.02 при −20.02) прибираємо підпис, щоб він не накладався на підпис маркера
  const stabPoints = useMemo(() => {
    if (z >= stab.edge) return stab.pts;
    const free = stab.edge + 110 / stab.px;
    return [
      ...stab.pts.filter((p) => p.z[0] > stab.edge).map((p) => (p.z[0] < free ? { z: p.z, color: p.color } : p)),
      { z: [stab.edge, 0] as [number, number], color: "#ffffff", label: `◀ hλ₂ = ${fmt(z, 4)}` },
    ];
  }, [stab, z]);
  const rk2R = Math.abs(1 + z + (z * z) / 2);
  const rk3R = Math.abs(1 + z + (z * z) / 2 + (z * z * z) / 6);
  const rk4R = Math.abs(1 + z + (z * z) / 2 + (z * z * z) / 6 + (z * z * z * z) / 24);

  return (
    <>
      <AnalogyCard
        emoji="🔌"
        title="Вмикаємо зарядку ноутбука"
        story={
          <>
            Встромляєте блок живлення в розетку — за <b>тисячні частки секунди</b> проскакує іскра (заряджаються конденсатори), а потім струм ще кілька{" "}
            <b>секунд</b> плавно виходить на сталий. У колі одночасно живуть дуже швидкий і дуже повільний процеси. Рівняння задачі — саме такий випадок. А
            чисельний метод — це прилад, що «опитує» коло через кожні h секунд: опитує рідко — і показує нісенітницю.
          </>
        }
        mapping={[
          ["іскра в розетці (мілісекунди)", <>швидка мода, λ₂ ≈ −1001</>],
          ["вихід на сталий струм (секунди)", <>повільна мода, λ₁ ≈ −1</>],
          ["як часто прилад опитує коло", <>крок h</>],
          ["стрілка б'є по упорах", <>нестійкість явного методу, |1 + hλ₂| &gt; 1</>],
        ]}
      >
        <ChargerScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Що розв'язуємо" simpleTitle="Що відбувається в колі">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`\begin{cases} u_1' = -1001\,u_1 + u_2 + 1000,\\ u_2' = u_1 - u_2, \end{cases}\qquad u_1(0)=u_2(0)=0.`}</Tex>
            <p className="mt-2 text-[14px] text-white/70">
              Відрізок <Tex>{"[0,5]"}</Tex>, кроки <Tex>{"h = 0.02,\\ 0.002,\\ 0.005"}</Tex>. Порівнюємо з точним розв&apos;язком (стан рівноваги{" "}
              <Tex>{"(1,1)"}</Tex> плюс дві моди вздовж власних векторів <Tex>{"(1+\\lambda_i,\\ 1)"}</Tex>):
            </p>
            <Tex block>{String.raw`u_1(t)=\frac{\lambda_2(1+\lambda_1)}{\lambda_1-\lambda_2}e^{\lambda_1 t}+\frac{\lambda_1(1+\lambda_2)}{\lambda_2-\lambda_1}e^{\lambda_2 t}+1`}</Tex>
            <Tex block>{String.raw`u_2(t)=\frac{\lambda_2}{\lambda_1-\lambda_2}e^{\lambda_1 t}+\frac{\lambda_1}{\lambda_2-\lambda_1}e^{\lambda_2 t}+1`}</Tex>
            <div className="mt-3">
              <Insight tone="note" title="Дві неточності в умові">
                У методичці в <Tex>{"u_1(t)"}</Tex> стоять множники <Tex>{"(1-\\lambda_1)"}</Tex> і <Tex>{"(1-\\lambda_2)"}</Tex> — така функція не
                задовольняє рівняння: початкову умову <Tex>{"u_1(0)=0"}</Tex> вона виконує, але дає <Tex>{"u_1'(0)=-\\lambda_1\\lambda_2=-1000"}</Tex> замість{" "}
                <Tex>{"+1000"}</Tex>, тож нев&apos;язка першого рівняння сягає {fmt(Math.abs(BOOK_R0), 4)} уже при <Tex>{"t=0"}</Tex> (далі згасає як{" "}
                <Tex>{"e^{\\lambda_1 t}"}</Tex>). Правильно — <Tex>{"(1+\\lambda_i)"}</Tex>, бо власний вектор для <Tex>{"\\lambda_i"}</Tex> є{" "}
                <Tex>{"(1+\\lambda_i,\\,1)"}</Tex>. Крім того, <Tex>{"\\lambda_1 \\approx -0.9890"}</Tex> у методичці — друкарська помилка: точне значення{" "}
                <Tex>{`${L1.toFixed(4)}`}</Tex> (<Tex>{"\\lambda_1\\lambda_2 = \\det A = 1000"}</Tex>). На сторінці всюди використано перевірений
                розв&apos;язок.
              </Insight>
            </div>
          </Card>
          <Card title="Анатомія жорсткості" icon="🔬">
            <p className="text-[14px] leading-relaxed text-white/75">
              Матриця системи <Tex>{String.raw`A=\begin{pmatrix}-1001&1\\1&-1\end{pmatrix}`}</Tex> має власні числа
            </p>
            <Tex block>{`\\lambda_1 \\approx ${L1.toFixed(6)},\\qquad \\lambda_2 \\approx ${L2.toFixed(6)}`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Розв&apos;язок складається з двох «доданків»: один згасає за тисячну частку секунди (іскра), другий — за кілька секунд (вихід на режим).
                  Їхні темпи відрізняються в ~{fmt(L2 / L1, 4)} разів. <Relatable kind="ratio" n={L2 / L1} /> Явний метод мусить крокувати під
                  найшвидший процес — дрібніше за {fmt(2 / -L2, 3)} с — увесь час, навіть коли іскра давно згасла.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Характерний час повільної моди <Tex>{"1/|\\lambda_1| \\approx 1"}</Tex> с (повністю згасає за ~5 с), швидкої —{" "}
              <Tex>{"1/|\\lambda_2| \\approx 0.001"}</Tex> с. Коефіцієнт жорсткості{" "}
              <Tex>{`|\\lambda_2/\\lambda_1| \\approx ${fmt(L2 / L1, 4)}`}</Tex>. Швидка компонента згасає за мить, але явний метод
              «пам'ятає» про неї до самого кінця і мусить тримати <Tex>{`h < 2/|\\lambda_2| \\approx ${fmt(2 / -L2, 4)}`}</Tex>.
            </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Крутіть крок — дивіться, хто вибухне" simpleTitle="Крутіть крок — дивіться, хто вибухне">
        <Lab
          controls={
            <>
              <Chips
                label="Крок з умови"
                value={H_LIST.includes(h) ? h : -1}
                onChange={(v) => v > 0 && setH(v)}
                options={H_LIST.map((v) => ({ value: v, label: `h = ${v}` }))}
              />
              <Slider label="Довільний крок h" value={h} onChange={setH} min={0.0002} max={0.03} log />
              <Slider label="Кінець відрізка T" value={T} onChange={setT} min={1} max={20} step={0.5} />
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
                <Tex>{`h\\lambda_2 = ${z.toFixed(4)}`}</Tex>. Межа явного Ейлера і RK2: <Tex>{"h\\lambda_2 \\ge -2"}</Tex>, для RK3 —{" "}
                <Tex>{"\\approx -2.513"}</Tex>, для RK4 — <Tex>{"\\approx -2.785"}</Tex>. Зараз |R(hλ₂)|: RK2 ={" "}
                <span className={rk2R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk2R, 4)}</span>, RK3 ={" "}
                <span className={rk3R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk3R, 4)}</span>.
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title={`Розв'язок ${ci ? "u₂" : "u₁"}(t)`}
              xLabel="t"
              yDomain={[-0.25, 1.35]}
              series={[
                { x: exactT.t, y: exactT.y, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
                ...sols.map(({ m, s, err }) => ({
                  x: s.t,
                  y: comp(s, ci),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: err.max > 1 ? 1 : 1.8,
                  opacity: err.max > 1 ? 0.45 : 1,
                })),
              ]}
            />
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Примежовий шар (лог. шкала часу)"
                height={240}
                xLabel="t"
                logX
                xDomain={[1e-4, dT]}
                yDomain={[-0.25, 1.35]}
                series={[
                  { x: exactT.t.slice(1), y: exactT.y.slice(1), color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
                  ...sols.map(({ m, s, err }) => ({
                    x: s.t.slice(1),
                    y: comp(s, ci).slice(1),
                    color: METHODS[m].color,
                    width: err.max > 1 ? 1 : 1.6,
                    opacity: err.max > 1 ? 0.45 : 1,
                  })),
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="Похибка |u − u_точн| (лог. шкала)"
                height={240}
                xLabel="t"
                logY
                yDomain={[1e-12, 1e3]}
                series={sols.map(({ m, s, err }) => ({
                  x: s.t,
                  y: err.err[ci].map((v) => Math.max(v, 1e-16)),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: 1.5,
                }))}
              />
            </Card>
          </Grid>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, err }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : fmt(err.max, 3)}
                sub={s.failed ? s.failed : `max похибка · ${s.steps} кроків · ${fmtMs(s.ms)}`}
                tone={s.failed || err.max > 1 ? "bad" : err.max > 0.05 ? "warn" : "good"}
              />
            ))}
          </div>
          {eulerR > 1 && eulerR < 1.01 && methods.includes("euler") && (
            <Insight
              tone="warn"
              title="Ходіння по лезу"
              simple={
                <>
                  Крок {fmt(dh)} — майже рівно межа: на кожному кроці похибка множиться лише на {fmt(eulerR, 5)}. Здається, дрібниця, але за{" "}
                  {Math.round(dT / dh)} кроків — <Relatable kind="growth" n={Math.pow(eulerR, dT / dh)} />. Збільште T до 20 — і прилад зашкалить.
                </>
              }
            >
              При h = {fmt(dh)} множник явного Ейлера |1 + hλ₂| = {fmt(eulerR, 5)} — трохи більше одиниці! Похибка росте дуже повільно, як{" "}
              {fmt(eulerR, 5)}
              <sup>n</sup>: за {Math.round(dT / dh)} кроків — у {fmt(Math.pow(eulerR, dT / dh), 3)} рази. Збільште T до 20 — і побачите, як розв&apos;язок
              таки вибухає.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Результати" title="Максимальні похибки на [0, 5]" simpleTitle="Хто наскільки промахнувся на [0, 5]">
        <Card>
          <Table
            head={["Метод", ...H_LIST.map((v) => `h = ${v}`)]}
            rows={ALL.map((m, j) => [
              <span key={m} style={{ color: METHODS[m].color }}>
                {METHODS[m].name}
              </span>,
              ...H_LIST.map((_, i) => {
                const { s, e } = table[i][j];
                if (s.failed) return <span className="text-[#ff5d73]">💥 вибух</span>;
                return <span className={e.max > 1 ? "text-[#ff5d73]" : e.max > 0.05 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>{fmt(e.max, 3)}</span>;
              }),
            ])}
          />
          <p className="mt-3 text-[13px] text-white/55">
            Максимальна похибка по обох компонентах. Для неявних методів її дає перший крок: за одну «сходинку» h розв&apos;язок злітає від 0 до ≈1, і жоден метод
            з кроком h ≫ 1/|λ₂| ≈ 0.001 цей стрибок точно не відтворить. Далі похибка швидко зменшується.
          </p>
        </Card>
      </Section>

      <Section kicker="Чому так?" title="Області абсолютної стійкості" simpleTitle="Карта «вибухне чи ні»">
        <Card>
          <div ref={stabWrap}>
            <StabilityExplorer
              z={[z, 0]}
              onZ={(zz) => setH(Math.min(0.03, Math.max(0.0002, Math.abs(zz[0] / L2))))}
              range={stab.range}
              extraPoints={stabPoints}
            />
          </div>
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={F}
          y0={Y0}
          T={5}
          view={DBG_VIEW}
          h0={0.0025}
          hMin={0.0002}
          hMax={0.05}
          hPresets={H_LIST}
          hint={
            <Say
              simple={
                <>
                  Тут видно, <b>що саме</b> робить метод на кожному кроці. Площина (u₁, u₂): біла пунктирна — куди насправді веде задача з поточної точки.
                  Спробуйте явного Ейлера з h = 0.0025: він перестрибує через «долину» туди-сюди, і стрибки ростуть. А неявний Ейлер з h = 0.02 одним
                  кроком падає на дно долини.
                </>
              }
            >
              Фазова площина (u₁, u₂). На кожному кроці показано, як будується yₙ₊₁: дотична (Ейлер), дві, три або чотири стадії (RK2, RK3, RK4) або
              ітерації Ньютона для неявного рівняння (θ-методи, BDF2). Пунктир — точний розв&apos;язок задачі Коші з (tₙ, yₙ) на [tₙ, tₙ + h].
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Клацніть будь-де — і подивіться, куди потече струм" report={false}>
        <PhasePlayground
          f={F}
          init={Y0}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={1}
          speedRange={[0.05, 5]}
          trail={8}
          strip={[
            { comp: 0, label: "u₁", color: "#ffd84d" },
            { comp: 1, label: "u₂", color: "#5cc8ff" },
          ]}
          window={6}
          kicks={[
            { label: "Стрибок напруги", emoji: "⚡", apply: (y) => [y[0] + 0.7, y[1]], hint: "u₁ += 0.7" },
            { label: "Розрядити", emoji: "🔋", apply: (y) => [y[0], 0], hint: "u₂ = 0" },
            { label: "Вимкнути живлення", emoji: "🔌", apply: () => [0, 0], hint: "u₁ = u₂ = 0" },
          ]}
          underlay={(ctx, { X, Y }) => {
            ctx.setLineDash([6, 5]);
            ctx.strokeStyle = "rgba(255,216,77,0.55)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            // повільний інваріантний многовид: пряма через (1, 1) уздовж власного вектора (1 + λ₁, 1)
            ctx.moveTo(X(1 + (1 + L1) * (-0.6 - 1)), Y(-0.6));
            ctx.lineTo(X(1 + (1 + L1) * (1.6 - 1)), Y(1.6));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#3ee6a8";
            ctx.beginPath();
            ctx.arc(X(1), Y(1), 5, 0, Math.PI * 2);
            ctx.fill();
          }}
          hint={
            <Say
              simple={
                <>
                  Клацніть у будь-яку точку: траєкторія <b>миттєво</b> стрибає вбік до жовтої пунктирної лінії (іскра згасає за мілісекунду), а потім{" "}
                  <b>повільно</b> повзе вздовж неї до зеленої точки (1, 1). Оце «миттєво + повільно» і є жорсткість. Кнопки вгорі «штовхають» коло.
                </>
              }
            >
              Будь-яка траєкторія за час ~1/|λ₂| ≈ 1 мс потрапляє на повільний многовид — пряму u₁ − 1 = (1 + λ₁)(u₂ − 1) уздовж власного вектора
              повільної моди (жовтий пунктир; на око вона збігається з нульклиною u₁′ = 0, тобто u₁ = (1000 + u₂)/1001: нахили відрізняються на 0.1 %) — і
              далі рухається по ньому з темпом λ₁ ≈ −1 до рівноваги (1, 1).
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="1"
          questions={[
            {
              id: "edge",
              q: <>Явний Ейлер з кроком h = 0.002 (один із кроків з умови). Що станеться з розв&apos;язком на [0, 5]?</>,
              options: ["Усе буде точно", "Похибка повільно розхитується зі зміною знака", "Миттєвий вибух за кілька кроків", "Метод видасть рівно нуль"],
              correct: 1,
              explain: (
                <>
                  |1 + hλ₂| = |1 − 2.002| = 1.002 — трохи більше одиниці. Швидка мода множиться на −1.002 щокроку: за 2500 кроків — у ≈148 разів, зі
                  зміною знака. Це не миттєвий вибух, але й не стійкість.
                </>
              ),
              explainSimple: <>Крок майже рівно на межі: кожен крок похибка множиться на 1.002 і міняє знак. За 2500 кроків це ×148 — повільне розхитування.</>,
              show: { label: "Показати h = 0.002", run: () => setH(0.002) },
            },
            {
              id: "hmax",
              q: <>Який найбільший крок дозволяє явному Ейлеру не вибухати в цій задачі?</>,
              options: ["≈ 2 (як для повільної моди)", "≈ 0.02", "≈ 0.002", "Будь-який — задача ж стійка"],
              correct: 2,
              explain: (
                <>
                  Потрібно |1 + hλ| ≤ 1 для <b>обох</b> мод, тобто h ≤ 2/|λ₂| = 2/1001.001 ≈ 0.001998. Повільна мода дозволила б h ≤ 2, але вирішує
                  найшвидша.
                </>
              ),
              explainSimple: <>Вирішує найшвидший процес (іскра): опитувати треба частіше, ніж раз на ~0.002 с, хоча іскра давно згасла.</>,
              show: { label: "Показати h = 0.0019", run: () => setH(0.0019) },
            },
            {
              id: "where",
              q: <>Неявний Ейлер з h = 0.02 стійкий. Але де в нього найбільша похибка?</>,
              options: ["У кінці відрізка, при t = 5", "На першому кроці", "Рівномірно по всьому відрізку", "Похибки немає зовсім"],
              correct: 1,
              explain: (
                <>
                  Максимум 0.0475 досягається вже при t = h = 0.02: за один крок метод не може відтворити стрибок u₁ від 0 до ≈1, що триває ~0.001 с.
                  Далі похибка лише зменшується — L-стійкий метод гасить швидку моду.
                </>
              ),
              explainSimple: <>Найбільший промах — на першому кроці: іскра триває мілісекунду, а метод стрибає одразу на 0.02 с. Далі він тільки точнішає.</>,
              show: { label: "Показати h = 0.02", run: () => setH(0.02) },
            },
          ]}
        />
      </Section>

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="bad"
            title="Явні методи (Ейлер, RK2, RK3, RK4)"
            simple={
              <>
                Явні методи питають систему «куди ти рухаєшся <b>зараз</b>?» і йдуть туди на крок h. Для швидкої іскри це занадто рідко: вони
                перестрибують рівновагу, і кожен перестрибок більший за попередній — як чутка, яку щоразу переказують голосніше.
              </>
            }
          >
            При h = 0.02 і 0.005 добуток hλ₂ = −20 та −5 лежить далеко за межами області стійкості будь-якого з чотирьох явних методів — розв&apos;язок вибухає за лічені кроки (поріг 10⁸ досягається за 3–14 кроків). При h = 0.002
            явний Ейлер має |R| ≈ 1.002 і повільно розхитується; RK2 має ту саму межу hλ = −2 і те саме |R| ≈ 1.002 (1 − 2.002 + 2.002²/2); RK3 (межа ≈ −2.513) і RK4 (межа ≈ −2.785) уже стійкі.
          </Insight>
          <Insight
            tone="good"
            title="Неявні методи"
            simple={
              <>
                Неявні методи питають «а <b>куди ти прийдеш</b> через крок?» — і тому не перестрибують. Ціна: на кожному кроці доводиться розв&apos;язувати
                рівняння (метод Ньютона), зате кроки можна робити в десятки разів більші.
              </>
            }
          >
            Неявний Ейлер, BDF2 і θ-метод стійкі при будь-якому h — бо їхні області стійкості містять усю ліву півплощину. Похибка визначається лише
            апроксимацією, а не стійкістю.
          </Insight>
          <Insight
            tone="info"
            title="Тонкощі θ = 0.55 і трапецій"
            simple={
              <>
                θ-метод і трапеції не вибухають, але швидку іскру не глушать, а «перевертають»: вона мерехтить то вгору, то вниз. Неявний Ейлер її просто
                гасить — тому на великих кроках він тут точніший.
              </>
            }
          >
            <Tex>{"R(-\\infty) = -0.45/0.55 \\approx -0.82"}</Tex> для θ-методу і <Tex>{"-1"}</Tex> для трапецій: швидка мода не гаситься, а
            «мерехтить» зі зміною знака. Тому на великих кроках у них більша похибка, ніж у неявного Ейлера (<Tex>{"R(-\\infty)=0"}</Tex>, L-стійкість).
          </Insight>
          <Insight
            tone="fun"
            title="Мораль"
            simple={
              <>
                Жорсткість — це не «складна відповідь», а незручне поєднання швидкого й повільного. Тут відповідь нудна (усе прямує до 1), але явний метод
                змушений дріботіти до самого кінця: неявному Ейлеру h = 0.1 вистачає (промах ≈ {fmt(coarseIE, 2)}), а явний вимагає h &lt; 0.002.
              </>
            }
          >
            Жорсткість — це не «складність» розв&apos;язку (тут він нудно прямує до 1), а властивість задачі, що змушує явні методи робити крихітні кроки.
            Розв&apos;язку вистачило б h ≈ 0.1 — для L-стійкого методу (неявний Ейлер з h = 0.1 має похибку ≈ {fmt(coarseIE, 2)}), а явний Ейлер вимагає h
            &lt; 0.002 — у 50 разів дрібніше.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
