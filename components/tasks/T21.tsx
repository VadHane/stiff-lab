"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import StabilityExplorer, { amp, type StabMethod } from "@/components/plot/StabilityExplorer";
import CarShockScene, { type CarLane } from "@/components/scenes/CarShockScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import Gauge from "@/components/ui/Gauge";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, indexAt, maxError, solve, type MethodId, type Problem } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import BumpScene from "@/components/analogy/BumpScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { useTaskExport } from "@/components/share/TaskActions";
import { exportT21 } from "@/components/share/TaskExports";
import { methodsIn, useUrlNum } from "@/components/share/TaskUrl";
import { useUrlState } from "@/lib/url-state";

const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];
const H_LIST = [0.005, 0.01, 0.02, 0.03, 0.05];

interface Params {
  m: number;
  c: number;
  k: number;
  u0: number;
}
const BOOK: Params = { m: 1.25, c: 10, k: 1500, u0: 0.5 };
// stable references for the debugger / playground (parameters from the problem statement)
const F = (_t: number, y: number[]) => [y[1], -(10 * y[1] + 1500 * y[0]) / 1.25];
const Y0 = [0.5, 0];
const DBG_VIEW = { x: 0, y: 1, xLabel: "u", yLabel: "u′", xDomain: [-1.6, 1.6] as [number, number], yDomain: [-50, 50] as [number, number] };
const PG_DOMAIN = { x: [-0.6, 0.6] as [number, number], y: [-22, 22] as [number, number] };
const PG_LABELS: [string, string] = ["u", "u′"];
const PRESETS: { id: string; label: string; p: Params }[] = [
  { id: "book", label: "З умови", p: BOOK },
  { id: "sport", label: "Спорткар", p: { m: 1.25, c: 40, k: 6000, u0: 0.5 } },
  { id: "broken", label: "Убитий амортизатор", p: { m: 1.25, c: 1, k: 1500, u0: 0.5 } },
  { id: "crit", label: "Критичне загасання", p: { m: 1.25, c: 2 * Math.sqrt(1500 * 1.25), k: 1500, u0: 0.5 } },
  { id: "truck", label: "Вантажівка", p: { m: 5, c: 60, k: 1500, u0: 0.5 } },
];

/** Critical damping a² = ω₀² up to round-off (e.g. c = 2√(km) gives a² − ω₀² ≈ −5·10⁻¹³, not 0). Shared by exactOf and the page display. */
const isCritical = (a: number, w2: number) => Math.abs(a * a - w2) < 1e-9 * w2;

/** Exact solution of m u'' + c u' + k u = 0, u(0)=u0, u'(0)=v0 → [u, u']. */
function exactOf({ m, c, k, u0 }: Params, v0 = 0) {
  const a = c / (2 * m);
  const w2 = k / m;
  const disc = a * a - w2;
  if (isCritical(a, w2)) {
    const B = v0 + a * u0;
    return (t: number) => {
      const e = Math.exp(-a * t);
      return [(u0 + B * t) * e, (B - a * (u0 + B * t)) * e];
    };
  }
  if (disc < 0) {
    const b = Math.sqrt(-disc);
    const A = u0,
      B = (v0 + a * u0) / b;
    return (t: number) => {
      const e = Math.exp(-a * t),
        cs = Math.cos(b * t),
        sn = Math.sin(b * t);
      return [e * (A * cs + B * sn), e * ((-a * A + b * B) * cs + (-a * B - b * A) * sn)];
    };
  }
  const s = Math.sqrt(disc);
  const r1 = -a + s,
    r2 = -a - s;
  const C1 = (v0 - r2 * u0) / (r1 - r2),
    C2 = u0 - C1;
  return (t: number) => [C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t), r1 * C1 * Math.exp(r1 * t) + r2 * C2 * Math.exp(r2 * t)];
}

/**
 * 2 % settling time of the exact solution (u′(0) = 0): the last moment when |u(t)| > 0.02·|u(0)|.
 * With damped oscillations (β > 0) |u| peaks exactly at t_n = nπ/β with |u(t_n)| = |u₀|e^{−a t_n}: take the last peak above 2 % and bisect
 * on the following half-period, where |u| > 2 % holds up to one crossing and never again. Without oscillations (critical damping, overdamping)
 * u(t) decreases monotonically to 0, so a plain bisection on u works. The textbook 4/|Re λ| is only the envelope estimate (e^{−4} ≈ 1.8 %):
 * at critical damping u = u₀(1 + at)e^{−at}, and the true time is ≈ 5.83/a.
 */
function settleTime(u0: number, a: number, beta: number, slowRate: number, u: (t: number) => number[]): number {
  const lim = 0.02 * Math.abs(u0);
  let lo = 0,
    hi: number;
  if (beta > 0) {
    const n = Math.max(0, Math.ceil((Math.log(50) * beta) / (a * Math.PI)) - 1);
    lo = (n * Math.PI) / beta;
    hi = lo + Math.PI / beta;
  } else {
    hi = 4 / slowRate;
    for (let i = 0; i < 60 && Math.abs(u(hi)[0]) > lim; i++) {
      lo = hi;
      hi *= 2;
    }
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(u(mid)[0]) > lim) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Largest h such that |R(hλ)| ≤ 1 for all eigenvalues (scan along the rays). */
function hCrit(method: StabMethod, lams: [number, number][]) {
  let h = 1e-5;
  while (h < 20) {
    if (lams.some(([re, im]) => amp(method, [h * re, h * im]) > 1 + 1e-12)) return h;
    h *= 1.004;
  }
  return Infinity;
}

const comfort = (z: number) =>
  z < 0.05
    ? { t: "батут 🤸", tone: "bad" as const }
    : z < 0.2
      ? { t: "гойдалка 🎢", tone: "warn" as const }
      : z < 0.5
        ? { t: "спортивна 🏎️", tone: "good" as const }
        : z < 0.95
          ? { t: "комфорт 🛋️", tone: "good" as const }
          : z < 1.05
            ? { t: "критична ⚖️", tone: "good" as const }
            : { t: "дубова 🪵", tone: "warn" as const };

export default function T21() {
  // the parameters live in the address one by one (?mass=5&c=60&k=1500&u0=0.5), the page works with the object p
  const [pm, setPm] = useUrlNum("mass", BOOK.m, 0.2, 10);
  const [pc, setPc] = useUrlNum("c", BOOK.c, 0.1, 300);
  const [pk, setPk] = useUrlNum("k", BOOK.k, 50, 20000);
  const [pu0, setPu0] = useUrlNum("u0", BOOK.u0, 0.05, 1);
  const p = useMemo<Params>(() => ({ m: pm, c: pc, k: pk, u0: pu0 }), [pm, pc, pk, pu0]);
  const setP = (q: Params) => {
    setPm(q.m);
    setPc(q.c);
    setPk(q.k);
    setPu0(q.u0);
  };
  const [h, setH] = useUrlNum("h", 0.02, 0.001, 0.08);
  const [T, setT] = useUrlNum("T", 3, 0.5, 10);
  const [methods, setMethods] = useUrlState<MethodId[]>("m", ["euler", "rk4", "ieuler", "trap"], methodsIn(ALL));
  const [hero, setHero] = useState<MethodId>("euler");
  const dp = useDeferredValue(p);
  const dh = useDeferredValue(h);
  const dT = useDeferredValue(T);
  const pb = usePlayback(10);
  useTaskExport(exportT21({ ...p, T, h, methods }));

  const a = dp.c / (2 * dp.m);
  const w2 = dp.k / dp.m;
  const w0 = Math.sqrt(w2);
  const zeta = dp.c / (2 * Math.sqrt(dp.k * dp.m));
  const disc = a * a - w2;
  // same tolerance as exactOf: at critical damping λ is a double real root and there are no oscillations
  const critical = isCritical(a, w2);
  const lams: [number, number][] = critical
    ? [
        [-a, 0],
        [-a, 0],
      ]
    : disc < 0
      ? [
          [-a, Math.sqrt(-disc)],
          [-a, -Math.sqrt(-disc)],
        ]
      : [
          [-a + Math.sqrt(disc), 0],
          [-a - Math.sqrt(disc), 0],
        ];
  const beta = !critical && disc < 0 ? Math.sqrt(-disc) : 0;

  const exact = useMemo(() => exactOf(dp), [dp]);
  const problem: Problem = useMemo(
    () => ({
      f: (_t, y) => [y[1], -(dp.c * y[1] + dp.k * y[0]) / dp.m],
      jac: () => [
        [0, 1],
        [-dp.k / dp.m, -dp.c / dp.m],
      ],
      y0: [dp.u0, 0],
      T: dT,
    }),
    [dp, dT],
  );
  const E = (u: number, v: number) => 0.5 * dp.m * v * v + 0.5 * dp.k * u * u;
  const E0 = E(dp.u0, 0);

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = solve(m, problem, { h: dh, blowup: 1e6 });
        const e = maxError(s, exact);
        return { m, s, e, err: e.perComp[0], blown: !!s.failed || e.perComp[0] > 3 * Math.abs(dp.u0) };
      }),
    [methods, problem, dh, exact, dp.u0],
  );

  const dense = useMemo(() => {
    const n = 1500;
    const t: number[] = [];
    for (let i = 0; i <= n; i++) t.push((dT * i) / n);
    const y = t.map(exact);
    return { t, u: y.map((v) => v[0]), v: y.map((v) => v[1]) };
  }, [exact, dT]);
  const uMax = Math.max(...dense.u.map(Math.abs)) * 1.35;
  const vMax = Math.max(...dense.v.map(Math.abs), 1e-6) * 1.35;

  const table = useMemo(
    () =>
      H_LIST.map((hh) =>
        ALL.map((m) => {
          const s = solve(m, problem, { h: hh, blowup: 1e8 });
          return { s, e: maxError(s, exact).perComp[0] };
        }),
      ),
    [problem, exact],
  );

  const hE = hCrit("euler", lams);
  const hR2 = hCrit("rk2", lams);
  const hR3 = hCrit("rk3", lams);
  const hR = hCrit("rk4", lams);
  // h = 0.02 column of the table: who eats the oscillation and who is the best implicit method
  const col002 = table[H_LIST.indexOf(0.02)];
  const relAt002 = (m: MethodId) => col002[ALL.indexOf(m)].e / Math.abs(dp.u0);
  const bestImplicit = (["ieuler", "theta", "trap", "bdf2"] as MethodId[]).reduce((a, b) => (relAt002(b) < relAt002(a) ? b : a));
  const slowRate = Math.min(-lams[0][0], -lams[1][0]);
  const tSettle = useMemo(() => settleTime(dp.u0, a, beta, slowRate, exact), [dp.u0, a, beta, slowRate, exact]);

  const zMain: [number, number] = [dh * lams[0][0], dh * lams[0][1]];
  const zAlt: [number, number] = [dh * lams[1][0], dh * lams[1][1]];
  const eulerR = amp("euler", zMain);
  const rk2R = amp("rk2", zMain);
  const rk3R = amp("rk3", zMain);
  const rk4R = amp("rk4", zMain);
  const zoomR = Math.min(12, Math.max(1.5, Math.hypot(...zAlt) * 1.2));

  const tNow = pb.progress * dT;
  const heroM = methods.includes(hero) ? hero : (methods[0] ?? "rk4");
  const heroSol = sols.find((x) => x.m === heroM);
  const accOf = (u: number, v: number) => Math.abs((dp.c * v + dp.k * u) / dp.m) / Math.max(1e-9, (dp.k * Math.abs(dp.u0)) / dp.m);
  const ex = exact(tNow);
  const lanes: CarLane[] = [{ label: "Точний розв'язок", color: "#cfd6ff", u: ex[0], acc: accOf(ex[0], ex[1]) }];
  if (heroSol) {
    const i = indexAt(heroSol.s.t, tNow);
    const y = heroSol.s.y[i];
    const past = !!heroSol.s.failed && tNow > heroSol.s.t[heroSol.s.t.length - 1];
    lanes.push({ label: METHODS[heroM].name, color: METHODS[heroM].color, u: y[0], acc: accOf(y[0], y[1]), blown: past || Math.abs(y[0]) > 3 * Math.abs(dp.u0) });
  }

  const cf = comfort(zeta);
  const eu = sols.find((x) => x.m === "euler");
  const ie = sols.find((x) => x.m === "ieuler");
  const tp = sols.find((x) => x.m === "trap");
  const stepDamp = (m: StabMethod) => amp(m, zMain);
  const want = (m: MethodId) => setMethods((ms) => (ms.includes(m) ? ms : [...ms, m]));

  return (
    <>
      <AnalogyCard
        emoji="🛑"
        title="Лежачий поліцейський і яма на дорозі"
        story={
          <>
            Машина переїжджає лежачого поліцейського: колесо підкидає, кузов кілька разів гойдається на пружинах і заспокоюється — амортизатор «з&apos;їдає»
            енергію. Наша задача саме про це: маса на пружині з амортизатором, кузов відпустили зі зміщенням 0.5. Пружина гойдає <b>швидко</b> (≈ 5.5 разів
            на секунду), а амортизатор гасить <b>повільно</b> (за ~1 с). Для явних методів це найгірше поєднання: швидке гойдання і слабке згасання.
          </>
        }
        mapping={[
          ["кузов на пружинах (маса 1.25)", <>u — зміщення кузова, m = 1.25</>],
          ["пружина", <>сила −k·u, k = 1500</>],
          ["амортизатор", <>тертя −c·u′, c = 10 → згасання e^(−4t)</>],
          ["≈ 5.5 гойдань на секунду", <>уявна частина λ ≈ ±34.4i</>],
          ["машину «розгойдує до неба»", <>явний Ейлер при h = 0.02: |1 + hλ| ≈ 1.149 &gt; 1</>],
        ]}
      >
        <BumpScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Машина після вибоїни" simpleTitle="Кузов на пружині з амортизатором">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`1.25\,u'' + 10\,u' + 1.5\cdot10^{3}\,u = 0,\qquad u(0)=0.5,\ \ u'(0)=0,`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] text-white/70">
                  крок h = 0.02. Тут m = 1.25 — маса кузова (на одне колесо), c = 10 — сила амортизатора, k = 1500 — жорсткість пружини, u — наскільки кузов
                  зміщено від рівноваги. Рівняння другого порядку переписуємо як два рівняння першого: для зміщення u і швидкості v = u′:
                </p>
              }
            >
            <p className="mt-2 text-[14px] text-white/70">
              крок <Tex>{"h=0.02"}</Tex>. Тут <Tex>{"m=1.25"}</Tex> — маса (на колесо, у відповідних одиницях), <Tex>{"c=10"}</Tex> — коефіцієнт амортизатора,{" "}
              <Tex>{"k=1500"}</Tex> — жорсткість пружини, <Tex>{"u"}</Tex> — вертикальне зміщення кузова. Як систему:
            </p>
            </Say>
            <Tex block>{String.raw`u' = v,\qquad v' = -\frac{c}{m}v-\frac{k}{m}u = -8v-1200u.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] text-white/70">
                  Розв&apos;язок — коливання, що згасають. Їхні «темпи» λ дає характеристичне рівняння λ² + 8λ + 1200 = 0 — звідси і точна формула:
                </p>
              }
            >
            <p className="text-[14px] text-white/70">
              Характеристичне рівняння <Tex>{"\\lambda^2+8\\lambda+1200=0"}</Tex>:
            </p>
            </Say>
            <Tex block>{String.raw`\lambda=-4\pm i\sqrt{1184}\approx-4\pm34.41\,i,\qquad u(t)=e^{-4t}\Big(0.5\cos\beta t+\frac{2}{\beta}\sin\beta t\Big),\ \ \beta=\sqrt{1184}.`}</Tex>
            <div className="mt-2">
              <Insight
                tone="note"
                title="Чого немає в умові"
                simple={
                  <>
                    Кінець відрізка T в умові не задано — даємо слайдер (за замовчуванням 3 с: за цей час коливання стихають у e¹² ≈ 160 000 разів). Формулу точного
                    розв&apos;язку перевірено: вона дає u(0) = 0.5 і u′(0) = 0.
                  </>
                }
              >
                Кінець відрізка T не задано — даємо слайдер (за замовчуванням 3 с, за цей час коливання згасають у <Tex>{"e^{12}"}</Tex> разів). Формулу точного
                розв&apos;язку перевірено: <Tex>{"u(0)=0.5"}</Tex>, <Tex>{"u'(0)=-4\\cdot0.5+\\beta\\cdot2/\\beta=0"}</Tex>.
              </Insight>
            </div>
          </Card>
          <Card title="Чому це жорстко для явних методів" icon="🔬">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Тут λ — комплексні числа: дійсна частина −4 означає слабке згасання, уявна ≈ 34.4 — швидке гойдання (період 0.18 с). Явний Ейлер не
                  вибухає, лише якщо
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Власні числа <b>комплексні</b>: слабке загасання <Tex>{"\\mathrm{Re}\\,\\lambda=-4"}</Tex> і швидке обертання <Tex>{"\\mathrm{Im}\\,\\lambda\\approx34.4"}</Tex>{" "}
              (період 0.18 с). Для явного Ейлера
            </p>
            </Say>
            <Tex block>{String.raw`|1+h\lambda|^2=(1-4h)^2+1184h^2\le1\iff h\le\frac{8}{1200}\approx0.0067.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  При h = 0.02 Ейлер щокроку множить амплітуду на ≈ 1.149 — додає 15 %, і машину «розгойдує до неба». RK4 множить на ≈ 0.923 — майже як
                  справжнє e<sup>−0.08</sup> = 0.923 (RK2 — на ≈ 0.934, RK3 — на ≈ 0.914: не вибухають, але згасання передають гірше). Неявні методи не
                  вибухають, але кожен по-своєму спотворює згасання.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              При <Tex>{"h=0.02"}</Tex>: <Tex>{"|1+h\\lambda|\\approx1.149"}</Tex> — кожен крок підсилює коливання на 15 %, і машину «розгойдує до неба». RK4 має
              більшу область стійкості (<Tex>{"|R|\\approx0.923"}</Tex>, майже як точне <Tex>{"e^{-0.08}=0.923"}</Tex>); RK2 і RK3 при цьому кроці теж стійкі (
              <Tex>{"|R|\\approx0.934"}</Tex> і <Tex>{"0.914"}</Tex>), хоч і передають згасання гірше. Неявні методи стійкі, але кожен по-своєму спотворює загасання.
            </p>
            </Say>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="Коеф. демпфування ζ" value={fmt(zeta, 3)} sub={<Tex>{"\\zeta=c/(2\\sqrt{km})"}</Tex>} />
              <Stat label="Комфорт" value={cf.t} tone={cf.tone} />
            </div>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Налаштуй підвіску — і подивись, хто не впорається">
        <Lab
          controls={
            <>
              <Chips
                label="Пресети"
                value={PRESETS.find((x) => x.p.m === p.m && x.p.c === p.c && x.p.k === p.k && x.p.u0 === p.u0)?.id ?? ""}
                onChange={(id) => setP(PRESETS.find((x) => x.id === id)!.p)}
                options={PRESETS.map((x) => ({ value: x.id, label: x.label }))}
              />
              <Slider label="Маса m" value={p.m} onChange={(m) => setP({ ...p, m })} min={0.2} max={10} log />
              <Slider label="Амортизатор c" value={p.c} onChange={(c) => setP({ ...p, c })} min={0.1} max={300} log />
              <Slider label="Жорсткість пружини k" value={p.k} onChange={(k) => setP({ ...p, k })} min={50} max={20000} log />
              <Slider label="Висота вибоїни u(0)" value={p.u0} onChange={(u0) => setP({ ...p, u0 })} min={0.05} max={1} step={0.05} />
              <Chips label="Крок" value={H_LIST.includes(h) ? h : -1} onChange={(v) => v > 0 && setH(v)} options={H_LIST.map((v) => ({ value: v, label: `${v}` }))} />
              <Slider label="Крок h" value={h} onChange={setH} min={0.001} max={0.08} log />
              <Slider label="Кінець відрізка T" value={T} onChange={setT} min={0.5} max={10} step={0.5} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Gauge value={eulerR} label="явний Ейлер |1+hλ|" />
                <Gauge value={rk4R} label="RK4 |R(hλ)|" />
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Tex>
                  {critical
                    ? `\\lambda_1=\\lambda_2=${fmt(-a, 4)}`
                    : `\\lambda=${fmt(lams[0][0], 4)}${lams[0][1] ? `\\pm${fmt(Math.abs(lams[0][1]), 4)}i` : `,\\ ${fmt(lams[1][0], 4)}`}`}
                </Tex>
                {critical && " (кратне)"}. Межа стійкості:
                Ейлер <Tex>{`h<${fmt(hE, 3)}`}</Tex>, RK2 <Tex>{`h<${fmt(hR2, 3)}`}</Tex>, RK3 <Tex>{`h<${fmt(hR3, 3)}`}</Tex>, RK4 <Tex>{`h<${fmt(hR, 3)}`}</Tex>.
                <div className="mt-1 text-white/55">
                  Зараз |R(hλ)|: RK2 = <span className={rk2R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk2R, 4)}</span>, RK3 ={" "}
                  <span className={rk3R > 1 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>{fmt(rk3R, 4)}</span>.
                </div>
              </div>
            </>
          }
        >
          <Card>
            <Plot
              title="Зміщення кузова u(t)"
              xLabel="t, с"
              yDomain={[-uMax, uMax]}
              cursorX={tNow}
              series={[
                { x: dense.t, y: dense.u, color: "#ffffff", label: "точний", width: 4, opacity: 0.35 },
                ...sols.map(({ m, s, blown }) => ({
                  x: s.t,
                  y: comp(s, 0),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: blown ? 1 : 1.8,
                  opacity: blown ? 0.45 : 1,
                })),
              ]}
            />
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Похибка |u − u_точн| (лог. шкала)"
                height={250}
                xLabel="t, с"
                logY
                yDomain={[1e-10, 1e4]}
                series={sols.map(({ m, s, e }) => ({
                  x: s.t,
                  y: e.err[0].map((v) => Math.max(v, 1e-16)),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: 1.4,
                }))}
              />
            </Card>
            <Card>
              <Plot
                title="Енергія E/E₀ = (½mv² + ½ku²)/E₀ (лог. шкала)"
                height={250}
                xLabel="t, с"
                logY
                yDomain={[1e-12, 1e6]}
                series={[
                  { x: dense.t, y: dense.u.map((u, i) => Math.max(E(u, dense.v[i]) / E0, 1e-30)), color: "#ffffff", label: "точна", width: 4, opacity: 0.35 },
                  ...sols.map(({ m, s }) => ({
                    x: s.t,
                    y: s.y.map((v) => Math.max(E(v[0], v[1]) / E0, 1e-30)),
                    color: METHODS[m].color,
                    label: METHODS[m].short,
                    width: 1.5,
                  })),
                ]}
              />
            </Card>
          </Grid>
          <Card>
            <Plot
              title="Фазова площина (u, u′): спіраль до нуля — чи від нуля"
              height={280}
              sorted={false}
              xLabel="u"
              yLabel="u′"
              xDomain={[-uMax, uMax]}
              yDomain={[-vMax, vMax]}
              series={[
                { x: dense.u, y: dense.v, color: "#ffffff", label: "точний", width: 3.5, opacity: 0.35 },
                ...sols.map(({ m, s, blown }) => ({
                  x: comp(s, 0),
                  y: comp(s, 1),
                  color: METHODS[m].color,
                  label: METHODS[m].short,
                  width: blown ? 1 : 1.4,
                  opacity: blown ? 0.5 : 0.9,
                  fade: true,
                })),
              ]}
              markers={[{ x: ex[0], y: ex[1], color: "#ffffff", r: 5 }]}
            />
          </Card>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, err, blown }) => {
              const r = amp(m as StabMethod, zMain);
              return (
                <Stat
                  key={m}
                  label={METHODS[m].short}
                  value={s.failed ? "💥" : fmt(err, 3)}
                  sub={s.failed ? s.failed : `max |Δu| · |R| = ${fmt(r, 4)} · ${s.steps} кроків · ${fmtMs(s.ms)}`}
                  tone={blown ? "bad" : err > 0.05 * Math.abs(dp.u0) ? "warn" : "good"}
                />
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Власна частота ω₀" value={`${fmt(w0, 4)} рад/с`} sub={`${fmt(w0 / (2 * Math.PI), 3)} Гц`} />
            <Stat
              label="Період коливань"
              value={beta ? `${fmt((2 * Math.PI) / beta, 3)} с` : "—"}
              sub={beta ? "2π/β" : critical ? "критичне загасання: λ кратне" : "аперіодичний рух"}
            />
            <Stat
              label="Час заспокоєння"
              value={`${fmt(tSettle, 3)} с`}
              sub={`далі |u| < 2 % від u(0) · оцінка 4/|Re λ| = ${fmt(4 / slowRate, 3)} с`}
            />
            <Stat label="Точний множник за крок" value={fmt(Math.exp(-dh * slowRate), 4)} sub="e^{h·Re λ} — з ним порівнюйте |R| методів" />
          </div>
          {eu && eu.blown && (
            <Insight
              tone="bad"
              title="Ейлер розгойдав машину"
              simple={
                <>
                  Множник {fmt(eulerR, 4)} більший за 1: кожен крок Ейлер <i>додає</i> {fmt((eulerR - 1) * 100, 3)} % амплітуди, хоча амортизатор насправді забирає{" "}
                  {fmt((1 - Math.exp(dh * lams[0][0])) * 100, 3)} %. Потрібно h &lt; {fmt(hE, 3)}. За весь відрізок: <Relatable kind="growth" n={Math.pow(eulerR, dT / dh)} />
                </>
              }
            >
              <Tex>{`|1+h\\lambda|=${fmt(eulerR, 4)}>1`}</Tex>: кожен крок <i>додає</i> {fmt((eulerR - 1) * 100, 3)} % амплітуди, хоча фізика забирає{" "}
              {fmt((1 - Math.exp(dh * lams[0][0])) * 100, 3)} %. Потрібно <Tex>{`h<${fmt(hE, 3)}`}</Tex>. {eu.s.failed ?? ""}
            </Insight>
          )}
          {ie && !ie.blown && stepDamp("ieuler") < Math.exp(dh * lams[0][0]) - 0.01 && (
            <Insight
              tone="warn"
              title="Неявний Ейлер — «надто м'який» амортизатор"
              simpleTitle="Неявний Ейлер гасить сильніше, ніж треба"
              simple={
                <>
                  За крок він множить амплітуду на {fmt(stepDamp("ieuler"), 3)} замість справжніх {fmt(Math.exp(dh * lams[0][0]), 3)}: гасить у{" "}
                  {fmt(Math.log(stepDamp("ieuler")) / (dh * lams[0][0]), 3)} раза сильніше, ніж реальний амортизатор. Це «числове тертя» — машина заспокоюється
                  нечесно швидко (див. графік енергії).
                </>
              }
            >
              За крок він множить амплітуду на <Tex>{`|R|=${fmt(stepDamp("ieuler"), 3)}`}</Tex> замість <Tex>{`e^{h\\,\\mathrm{Re}\\lambda}=${fmt(Math.exp(dh * lams[0][0]), 3)}`}</Tex>
              . Це <b>числова дисипація</b>: ефективне загасання в {fmt(Math.log(stepDamp("ieuler")) / (dh * lams[0][0]), 3)} разу сильніше за справжнє — машина
              заспокоюється «нечесно» швидко (див. графік енергії).
            </Insight>
          )}
          {tp && !tp.blown && (
            <Insight
              tone="good"
              title="Трапеції — найчесніший неявний метод"
              simple={
                <>
                  Множник трапецій {fmt(stepDamp("trap"), 4)} проти справжнього {fmt(Math.exp(dh * lams[0][0]), 4)}: амплітуда майже правильна, лише коливання трохи
                  «відстають» за фазою. На фазовій площині спіраль трапецій лягає на точну.
                </>
              }
            >
              <Tex>{`|R|=${fmt(stepDamp("trap"), 4)}`}</Tex> проти точного {fmt(Math.exp(dh * lams[0][0]), 4)}: амплітуда майже правильна, лишається лише фазова похибка
              (коливання трохи «відстають»). На фазовій площині спіраль трапецій лягає на точну.
            </Insight>
          )}
          {critical ? (
            <Insight
              tone="info"
              title="Критичне загасання"
              simple={
                <>
                  ζ = 1 — межа між гойданням і повзанням: з усіх режимів без коливань цей повертає кузов на місце найшвидше. Обидва темпи згасання
                  однакові ({fmt(-a, 4)}), тож жорсткості тут немає.
                </>
              }
            >
              ζ = 1: <Tex>{"a^2=\\omega_0^2"}</Tex>, власне число кратне й дійсне, <Tex>{`\\lambda_1=\\lambda_2=-a=${fmt(-a, 4)}`}</Tex>, розв&apos;язок{" "}
              <Tex>{"u(t)=\\big(u_0+(v_0+a u_0)\\,t\\big)e^{-at}"}</Tex>. Коливань немає (період не визначений), жорсткості теж: обидві моди згасають з однаковим темпом.
            </Insight>
          ) : (
            zeta >= 1 && (
              <Insight
                tone="info"
                title="Аперіодичний режим"
                simple={
                  <>
                    ζ = {fmt(zeta, 3)} ≥ 1 — коливань немає, кузов плавно повертається на місце. А при дуже сильному амортизаторі задача стає жорсткою: два темпи
                    згасання {fmt(lams[0][0], 3)} і {fmt(lams[1][0], 3)} різняться в {fmt(lams[1][0] / lams[0][0], 3)} разів.
                  </>
                }
              >
                ζ = {fmt(zeta, 3)} ≥ 1 — коливань немає, кузов плавно повертається. При великому c система стає жорсткою: власні числа {fmt(lams[0][0], 3)} і{" "}
                {fmt(lams[1][0], 3)} різняться в {fmt(lams[1][0] / lams[0][0], 3)} разів.
              </Insight>
            )
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Тест-драйв: точний розв'язок проти числового методу" simpleTitle="Тест-драйв: справжня машина проти «порахованої»">
        <Card>
          <div className="mb-3">
            <Chips label="Хто за кермом другої машини" value={heroM} onChange={setHero} options={methods.map((m) => ({ value: m, label: METHODS[m].short }))} />
          </div>
          <CarShockScene lanes={lanes} t={tNow} u0={dp.u0} />
          <div className="mt-3">
            <PlaybackBar pb={pb} label={`t = ${fmt(tNow, 3)} с`} />
          </div>
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Машина щойно наїхала на вибоїну: кузов зміщено на u(0) і відпущено. Кузов рухається за u(t); обличчя пасажира реагує на те, як різко його
                трясе (вертикальне прискорення): 😊 → 🤢. Друга машина рухається так, як її «бачить» обраний метод.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Машина щойно наїхала на вибоїну: кузов зміщено на u(0) і відпущено. Зміщення кузова — u(t) у масштабі; обличчя пасажира реагує на вертикальне прискорення{" "}
            <Tex>{"|u''|"}</Tex> (😊 → 🤢). Друга машина рухається так, як її «бачить» обраний метод.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Результати" title="Максимальна похибка зміщення max|u − u_точн| на [0, T]" simpleTitle="Хто наскільки промахнувся із зміщенням кузова">
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
                const rel = e / Math.abs(dp.u0);
                return <span className={rel > 1 ? "text-[#ff5d73]" : rel > 0.1 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>{fmt(e, 3)}</span>;
              }),
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Для поточної підвіски і T = {fmt(dT, 3)} с. Неявні методи не вибухають за жодного кроку, але неявний Ейлер при h = 0.02 промахується на{" "}
                {fmt(100 * relAt002("ieuler"), 2)} % від початкового зміщення — «з&apos;їдає» коливання. Найточніший неявний при цьому кроці —{" "}
                {METHODS[bestImplicit].name} ({fmt(100 * relAt002(bestImplicit), 2)} %), RK4{" "}
                {col002[ALL.indexOf("rk4")].s.failed ? "вибухає" : `промахується на ${fmt(100 * relAt002("rk4"), 2)} %`}.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Для поточних параметрів підвіски і T = {fmt(dT, 3)} с. Неявні методи стійкі при будь-якому h, але неявний Ейлер при h = 0.02 помиляється на{" "}
            {fmt(100 * relAt002("ieuler"), 2)} % амплітуди u(0) — він «з&apos;їдає» коливання; найкращий серед неявних при цьому кроці — {METHODS[bestImplicit].name} (
            {fmt(100 * relAt002(bestImplicit), 2)} %), RK4 {col002[ALL.indexOf("rk4")].s.failed ? "вибухає" : `помиляється на ${fmt(100 * relAt002("rk4"), 2)} %`}.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Чому так?" title="Комплексні точки hλ на карті стійкості" simpleTitle="Карта «вибухне чи ні» — тепер на площині">
        <Card>
          <StabilityExplorer
            z={zMain}
            onZ={(zz) => {
              const r = Math.hypot(zz[0], zz[1]) / Math.hypot(lams[0][0], lams[0][1]);
              setH(Math.min(0.08, Math.max(0.001, r)));
            }}
            range={zoomR}
            extraPoints={[{ z: zAlt, color: "#ffffffaa", label: "hλ₂" }]}
          />
          <Say
            simple={
              <p className="mt-2 text-[12.5px] text-white/50">
                {beta
                  ? "Тут λ — пара комплексних чисел, тож точок hλ дві: симетрично над і під дійсною віссю. "
                  : critical
                    ? "Зараз коливань немає, і обидві точки hλ лежать на дійсній осі — у критичному режимі вони збігаються. "
                    : "Зараз коливань немає, і обидві точки hλ лежать на дійсній осі. "}
                Перетягування змінює лише крок h (точка ковзає вздовж променя). Коло явного Ейлера «зачіпає» точку вже при h ≈ {fmt(hE, 2)}.
              </p>
            }
          >
          <p className="mt-2 text-[12.5px] text-white/50">
            {beta ? (
              <>
                Пара власних чисел комплексно-спряжена, тому точки <Tex>{"h\\lambda_{1,2}"}</Tex> лежать симетрично відносно дійсної осі.
              </>
            ) : critical ? (
              <>
                Власне число кратне й дійсне (критичне загасання), тому точки <Tex>{"h\\lambda_{1,2}"}</Tex> збігаються на дійсній осі.
              </>
            ) : (
              <>
                Власні числа дійсні (аперіодичний режим), тому обидві точки <Tex>{"h\\lambda_{1,2}"}</Tex> лежать на дійсній осі.
              </>
            )}{" "}
            Перетягування змінює лише h (точка рухається вздовж променя). Помітно, що коло явного Ейлера «зачіпає» точку вже при h ≈ {fmt(hE, 2)}.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={F}
          y0={Y0}
          T={1}
          view={DBG_VIEW}
          h0={0.02}
          hMin={0.001}
          hMax={0.08}
          hPresets={[0.005, 0.01, 0.02, 0.05]}
          hPresetsLabel="Кроки для порівняння"
          hint={
            <Say
              simple={
                <>
                  Площина (u, u′), параметри з умови: справжній рух — спіраль, що закручується до центру. Явний Ейлер з h = 0.02 іде по дотичній і щоразу
                  «вилітає» назовні: спіраль розкручується, амплітуда росте на 15 % за крок. Перемкніть на RK4 — він тримається спіралі; неявний Ейлер
                  закручується всередину швидше, ніж треба.
                </>
              }
            >
              Фазова площина (u, u′) для параметрів з умови. Для λ = −4 ± 34.4i явний Ейлер за крок h = 0.02 множить відстань до центру на |1 + hλ| ≈ 1.149 і
              повертає на arg(1 + hλ) ≈ 37°: ~10 кроків на оберт, амплітуда росте ×4 за оберт. Для порівняння |R|: RK2 ≈ 0.934, RK3 ≈ 0.914, RK4 ≈ 0.923, неявний
              Ейлер ≈ 0.781, трапеції ≈ 0.931 проти точного e^(−0.08) ≈ 0.923. Пунктир — точний розв&apos;язок з (tₙ, yₙ) на [tₙ, tₙ + h].
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Поганяйте машину по ямах" report={false}>
        <PhasePlayground
          f={F}
          init={Y0}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={0.25}
          speedRange={[0.02, 2]}
          trail={1.5}
          strip={[{ comp: 0, label: "u — зміщення кузова", color: "#5cc8ff" }]}
          window={2}
          kicks={[
            { label: "Яма", emoji: "🕳️", apply: (y) => [y[0], y[1] - 8], hint: "u′ −= 8" },
            { label: "Лежачий поліцейський", emoji: "🛑", apply: (y) => [y[0], y[1] + 8], hint: "u′ += 8" },
            { label: "Завантажили багажник", emoji: "🧳", apply: (y) => [y[0] - 0.2, y[1]], hint: "u −= 0.2" },
          ]}
          underlay={(ctx, { X, Y }) => {
            ctx.fillStyle = "#3ee6a8";
            ctx.beginPath();
            ctx.arc(X(0), Y(0), 5, 0, Math.PI * 2);
            ctx.fill();
          }}
          hint={
            <Say
              simple={
                <>
                  Клацніть будь-де: кузов почне гойдатися — спіраль закручується до центру, бо амортизатор забирає енергію. «🕳️ Яма» і «🛑 Лежачий поліцейський»
                  різко штовхають кузов униз чи вгору, «🧳 Багажник» просаджує його на 0.2. Кожен поштовх стихає приблизно за 1 с часу моделі (≈ 5–6
                  гойдань). Повзунок унизу сповільнює чи пришвидшує час.
                </>
              }
            >
              Стійкий фокус (0, 0): λ = −4 ± 34.4i. Кожен поштовх задає нові початкові умови; рух — спіраль з обвідною e^(−4t) і періодом 2π/β ≈ 0.183 с.
              Поштовх u′ ± 8 дає амплітуду ≈ 8/β ≈ 0.23 (параметри з умови).
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="21"
          questions={[
            {
              id: "euler",
              q: <>Явний Ейлер з кроком з умови h = 0.02 (параметри підвіски з умови). Що станеться з «машиною»?</>,
              options: ["Заспокоїться, лише трохи повільніше", "Розгойдається: амплітуда росте щокроку", "Заспокоїться миттєво", "Гойдатиметься з незмінною амплітудою"],
              correct: 1,
              explain: (
                <>
                  |1 + hλ| = |1 − 0.08 + 0.688i| ≈ 1.149: кожен крок додає ~15 % амплітуди. За 3 с (150 кроків) це ×10⁹; поріг 10⁶ розв&apos;язок перетинає вже
                  при t ≈ 1.6.
                </>
              ),
              explainSimple: <>Ейлер щокроку додає 15 % амплітуди, хоча амортизатор мав би забирати 8 %. Уже за 1.6 с розв&apos;язок «вилітає за мільйон» — машину розгойдало до неба.</>,
              show: {
                label: "Показати Ейлера, h = 0.02",
                run: () => {
                  setP(BOOK);
                  setH(0.02);
                  want("euler");
                },
              },
            },
            {
              id: "ieuler",
              q: <>Неявний Ейлер з h = 0.02 стійкий. А наскільки правильно він «бачить» амортизатор?</>,
              options: ["Точно, як справжній", "Гасить приблизно втричі сильніше за справжній", "Гасить слабше за справжній", "Розгойдує, як явний Ейлер"],
              correct: 1,
              explain: (
                <>
                  |R| = 1/|1 − hλ| ≈ 0.781 за крок проти точного e^(−0.08) ≈ 0.923: ефективне загасання ln 0.781 / (−0.08) ≈ 3.1 раза сильніше (числова
                  дисипація). Максимальна похибка u на [0, 3] ≈ 0.22 — майже половина початкового зміщення.
                </>
              ),
              explainSimple: <>За крок він лишає 78 % амплітуди замість 92 %: до справжнього амортизатора додається «числове тертя», і машина заспокоюється втричі швидше, ніж насправді.</>,
              show: {
                label: "Показати неявного Ейлера, h = 0.02",
                run: () => {
                  setP(BOOK);
                  setH(0.02);
                  want("ieuler");
                },
              },
            },
            {
              id: "hmax",
              q: <>Параметри з умови. Який найбільший крок, за якого явний Ейлер не розгойдує машину?</>,
              options: ["≈ 0.5 (= 2/|Re λ|)", "≈ 0.058 (= 2/|λ|)", "≈ 0.0067", "Будь-який — система ж сама згасає"],
              correct: 2,
              explain: (
                <>
                  |1 + hλ|² = (1 − 4h)² + 1184h² ≤ 1 ⇔ h ≤ 8/1200 ≈ 0.00667. «Наївні» межі 2/|Re λ| = 0.5 чи 2/|λ| ≈ 0.058 тут не працюють: точка hλ лежить
                  майже на уявній осі, а коло Ейлера торкається її лише в нулі.
                </>
              ),
              explainSimple: <>Треба «заглядати» частіше ніж раз на ~0.0067 с — утричі частіше, ніж крок з умови. Слабке згасання + швидке гойдання — найгірше поєднання для Ейлера.</>,
              show: {
                label: "Показати h = 0.0065",
                run: () => {
                  setP(BOOK);
                  setH(0.0065);
                  want("euler");
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
            title="Слабке загасання — смерть для явного Ейлера"
            simple={
              <>
                Зона «не вибухне» в Ейлера — круг радіуса 1 з центром у −1. Наша точка hλ має велику уявну частину (швидке гойдання) і малу дійсну (слабке
                згасання), тож лежить поза кругом, якщо крок не мізерний (тут h &lt; 0.0067). Тому навіть «нежорстка» з вигляду система при h = 0.02 вибухає.
              </>
            }
          >
            Область стійкості Ейлера — коло радіуса 1 з центром −1. Точка <Tex>{"h\\lambda"}</Tex> з великою уявною частиною і малою дійсною лежить поза ним, якщо
            крок не мізерний (тут h &lt; 0.0067). Тому навіть нежорстка за звичайними мірками система при h = 0.02 вибухає.
          </Insight>
          <Insight
            tone="good"
            title="RK4 — несподіваний чемпіон"
            simple={
              <>
                Зона стійкості RK4 сягає вздовж уявної осі до ±2.83, тож |hλ| ≈ 0.69 для нього дрібниця, а 4-й порядок дає похибку ~3·10⁻³ (h = 0.02, параметри з
                умови). RK3 (зона до ±1.73) теж стійкий, але промахується на ≈ 2·10⁻², а RK2, як і Ейлер, на уявній осі зони не має — його рятує лише справжнє
                згасання (межа h ≈ 0.032), і промах уже ≈ 0.14, тобто 27 % амплітуди. Для слабко загасних коливань RK4 — часто найкращий вибір.
              </>
            }
          >
            Область стійкості RK4 сягає уявної осі до ±2.83, тож <Tex>{"|h\\lambda|\\approx0.69"}</Tex> для нього дрібниця, а 4-й порядок дає похибку ~3·10⁻³ (при
            h = 0.02 для параметрів з умови). RK3 (уявна вісь до ±√3 ≈ 1.73) при тому ж кроці стійкий, але з похибкою ≈ 2·10⁻²; RK2, як і Ейлер, не містить уявної
            осі (|R(iy)|² = 1 + y⁴/4) і тримається лише завдяки Re λ = −4 (межа h ≈ 0.032) — його похибка ≈ 0.14 (27 % амплітуди). Для слабко загасних коливань RK4
            — часто найкращий вибір.
          </Insight>
          <Insight
            tone="warn"
            title="Неявний Ейлер штучно гасить"
            simple={
              <>
                Він стійкий завжди, але гасить коливання сильніше, ніж справжній амортизатор: до реального тертя додається «числове». Для інженера це небезпечно —
                модель обіцяє комфорт, якого немає.
              </>
            }
          >
            Він стійкий завжди, але <Tex>{"|1/(1-h\\lambda)|"}</Tex> помітно менше за <Tex>{"e^{h\\mathrm{Re}\\lambda}"}</Tex>: числова в&apos;язкість додається до
            справжнього амортизатора. Для інженера це небезпечно — модель обіцяє комфорт, якого немає.
          </Insight>
          <Insight
            tone="info"
            title="Трапеції зберігають амплітуду"
            simple={
              <>
                Правило трапецій не гасить і не розгойдує незагасні коливання — лише трохи зсуває фазу. Тому трапеції (і метод Ньюмарка в механіці) — стандарт для
                коливальних систем.
              </>
            }
          >
            Правило трапецій відображає уявну вісь на одиничне коло — консервативні коливання не гасяться і не ростуть. Тому трапеції (і метод Ньюмарка в механіці)
            — стандарт для коливальних систем.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Типовий легковик має ζ ≈ 0.2–0.4: трохи «пружинить», щоб не трясло. Наша модель має ζ ≈ 0.12 — як старе авто з утомленими амортизаторами. А
                гідравлічні амортизатори стали масовими лише у 1920–30-х — до того машини гойдались, як човни.
              </>
            }
          >
            Типовий легковик має ζ ≈ 0.2–0.4: трохи «пружинить», щоб не трясло. Наша модель має ζ ≈ 0.12 — ближче до старого авто з утомленими амортизаторами.
            А гідравлічні амортизатори стали масовими лише у 1920–30-х — до того машини гойдались, як човни.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
