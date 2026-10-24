"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import Plot3D from "@/components/plot/Plot3D";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import RosslerVortexScene from "@/components/scenes/RosslerVortexScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider, Toggle } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { lyapunov } from "@/lib/chaos-tools";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, denseOutput, indexAt, isExplicit, sampleAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import { plural } from "@/lib/relatable";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import RosslerForecastScene from "@/components/analogy/RosslerForecastScene";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

const ALL: MethodId[] = ["rk2", "rk3", "rk4", "dopri", "ros"];
const EXPL_BOUND: Partial<Record<MethodId, string>> = { rk2: "2", rk3: "≈ 2.51", rk4: "≈ 2.79" };
const Y0: [number, number, number] = [0, 0.5, 0];
// sandbox: the system of the assignment (a = 0.15, b = 0.4, c = 8.5); stable references
const PG_F = (_t: number, y: number[]) => [-y[1] - y[2], y[0] + 0.15 * y[1], 0.4 + y[2] * (y[0] - 8.5)];
const PG_INIT = [0, 0.5, 0];
const PG_DOMAIN = { x: [-14, 17] as [number, number], y: [-15, 13] as [number, number] };
const PG_LABELS: [string, string] = ["x", "y"];

const PRESETS = [
  { c: 4, label: "c = 4 · цикл" },
  { c: 5.5, label: "5.5 · період-2" },
  { c: 6.7, label: "6.7 · період-4" },
  { c: 7, label: "7.0 · період-8" },
  { c: 8.5, label: "8.5 · хаос (умова)" },
  { c: 9.1, label: "9.1 · вікно період-3" },
  { c: 12, label: "12 · розвинений хаос" },
];

/** Allocation-free RK4 for the Rössler system: collects x- and z-maxima (and min x) after a transient. */
function rosslerScan(a: number, b: number, c: number, y0: number[], h: number, tTrans: number, tKeep: number) {
  let x = y0[0],
    y = y0[1],
    z = y0[2];
  const xMax: number[] = [];
  const zMax: number[] = [];
  let xMin = Infinity;
  const steps = Math.round((tTrans + tKeep) / h);
  const nTrans = Math.round(tTrans / h);
  let xp = x,
    xpp = x,
    zp = z,
    zpp = z;
  for (let s = 0; s < steps; s++) {
    const k1x = -y - z,
      k1y = x + a * y,
      k1z = b + z * (x - c);
    let X = x + 0.5 * h * k1x,
      Y = y + 0.5 * h * k1y,
      Z = z + 0.5 * h * k1z;
    const k2x = -Y - Z,
      k2y = X + a * Y,
      k2z = b + Z * (X - c);
    X = x + 0.5 * h * k2x;
    Y = y + 0.5 * h * k2y;
    Z = z + 0.5 * h * k2z;
    const k3x = -Y - Z,
      k3y = X + a * Y,
      k3z = b + Z * (X - c);
    X = x + h * k3x;
    Y = y + h * k3y;
    Z = z + h * k3z;
    const k4x = -Y - Z,
      k4y = X + a * Y,
      k4z = b + Z * (X - c);
    xpp = xp;
    xp = x;
    zpp = zp;
    zp = z;
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    z += (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
    if (!Number.isFinite(x) || Math.abs(x) > 1e6) break;
    if (s > nTrans) {
      if (x < xMin) xMin = x;
      if (xp > xpp && xp >= x) {
        const den = xpp - 2 * xp + x;
        xMax.push(den ? xp - (0.125 * (xpp - x) * (xpp - x)) / den : xp);
      }
      if (zp > zpp && zp >= z && zp > 0.05) {
        const den = zpp - 2 * zp + z;
        zMax.push(den ? zp - (0.125 * (zpp - z) * (zpp - z)) / den : zp);
      }
    }
  }
  return { xMax, zMax, end: [x, y, z], xMin: Number.isFinite(xMin) ? xMin : 0 };
}

function classify(xMax: number[]): { n: number; label: string; chaos: boolean } {
  const uniq: number[] = [];
  for (const v of xMax) {
    if (!uniq.some((u) => Math.abs(u - v) < 4e-3)) uniq.push(v);
    if (uniq.length > 32) break;
  }
  if (uniq.length > 32) return { n: Infinity, label: "хаос", chaos: true };
  return { n: uniq.length, label: uniq.length === 1 ? "цикл (період-1)" : `період-${uniq.length}`, chaos: false };
}

const fieldOf = (a: number, b: number, c: number) => (_t: number, s: number[]) => {
  const [x, y, z, dx, dy, dz] = s;
  return [-y - z, x + a * y, b + z * (x - c), -dy - dz, dx + a * dy, z * dx + (x - c) * dz];
};

function fixedPoint(a: number, b: number, c: number): [number, number, number] {
  const D = c * c - 4 * a * b;
  if (D < 0) return [0, 0, 0];
  const z = (c - Math.sqrt(D)) / (2 * a);
  return [a * z, -z, z];
}

export default function T5() {
  const [a, setA] = useState(0.15);
  const [b, setB] = useState(0.4);
  const [c, setC] = useState(8.5);
  const [T, setT] = useState(50);
  const [h, setH] = useState(0.01);
  const [delta, setDelta] = useState(1e-6);
  const [methods, setMethods] = useState<MethodId[]>(["rk4", "dopri", "ros"]);
  const [showTwin, setShowTwin] = useState(true);

  const da = useDeferredValue(a);
  const db = useDeferredValue(b);
  const dc = useDeferredValue(c);
  const dT = useDeferredValue(T);
  const dh = useDeferredValue(h);
  const dDelta = useDeferredValue(delta);

  const problem: Problem = useMemo(
    () => ({
      f: (_t, y) => [-y[1] - y[2], y[0] + da * y[1], db + y[2] * (y[0] - dc)],
      jac: (_t, y) => [
        [0, -1, -1],
        [1, da, 0],
        [y[2], 0, y[0] - dc],
      ],
      y0: [...Y0],
      T: dT,
    }),
    [da, db, dc, dT],
  );

  const sols = useMemo(
    () =>
      (methods.length ? methods : (["rk4"] as MethodId[])).map((m) => ({
        m,
        s:
          isExplicit(m)
            ? solve(m, problem, { h: dh, blowup: 1e6 })
            : m === "dopri"
              ? solve(m, problem, { rtol: 1e-6, atol: 1e-9, maxSteps: 200000 })
              : solve(m, problem, { rtol: 1e-4, atol: 1e-7, maxSteps: 200000 }),
      })),
    [methods, problem, dh],
  );

  const Ts = Math.max(dT, 250);
  // Еталон і двійник. Похибка інтегрування з rtol 10⁻¹⁰ діє як збурення ~10⁻¹¹ і «з'їдає» δ ≲ 10⁻¹⁰ (для δ = 10⁻¹² момент
  // розходження виходить 425.5 замість збіжного 401.1), тож для малих δ посилюємо допуск до 10⁻¹² (≈ 2.5× більше кроків).
  const refTol = dDelta < 1e-8 ? 1e-12 : 1e-10;
  const ref = useMemo(() => solve("dopri", { ...problem, T: Ts }, { rtol: refTol, atol: refTol * 1e-2, maxSteps: 400000 }), [problem, Ts, refTol]);
  const twin = useMemo(
    () => solve("dopri", { ...problem, T: Ts, y0: [Y0[0] + dDelta, Y0[1], Y0[2]] }, { rtol: refTol, atol: refTol * 1e-2, maxSteps: 400000 }),
    [problem, Ts, dDelta, refTol],
  );

  // Benettin estimate: 1200 time units, the first 400 (transient) are discarded — periodic windows
  // near the cascade converge slowly, with a shorter transient they would show a spurious λ₁ ≈ 0.01.
  const analysis = useMemo(() => {
    const scan = rosslerScan(da, db, dc, Y0, 0.01, 300, 500);
    const cls = classify(scan.xMax);
    const ly = lyapunov(fieldOf(da, db, dc), [...Y0], 3, 0.01, 1200, 400, 50);
    const zn = scan.zMax.slice(0, -1);
    const zn1 = scan.zMax.slice(1);
    return { cls, L: ly.L, trace: ly.trace, zn, zn1, xMin: scan.xMin };
  }, [da, db, dc]);

  /** λ₁ for the parameters of the assignment (fixed, independent of the sliders). */
  const bookL = useMemo(() => lyapunov(fieldOf(0.15, 0.4, 8.5), [...Y0], 3, 0.01, 1200, 400, 50).L, []);

  const bif = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    let y0: number[] = [...Y0];
    for (let k = 0; k <= 160; k++) {
      const cc = 2 + (10 * k) / 160;
      const r = rosslerScan(da, db, cc, y0, 0.02, k === 0 ? 250 : 120, 150);
      if (r.end.every(Number.isFinite) && Math.abs(r.end[0]) < 1e3) y0 = r.end;
      else y0 = [...Y0];
      for (const v of r.xMax) {
        xs.push(cc);
        ys.push(v);
      }
    }
    return { xs, ys };
  }, [da, db]);

  const presetTable = useMemo(
    () =>
      PRESETS.map((p) => {
        const r = rosslerScan(da, db, p.c, Y0, 0.01, 300, 400);
        const ly = lyapunov(fieldOf(da, db, p.c), [...Y0], 3, 0.02, 1200, 400, 25);
        return { ...p, cls: classify(r.xMax), L: ly.L };
      }),
    [da, db],
  );

  const main = sols[0].s;
  const dist = useMemo(() => {
    // ермітова інтерполяція (O(h⁴)) замість лінійної: еталон і двійник мають різні адаптивні сітки, і похибка лінійної
    // інтерполяції (~10⁻¹¹…10⁻⁹) інакше маскувала б відстань при малих δ
    const R = denseOutput(ref, problem.f);
    const W = denseOutput(twin, problem.f);
    const gap = (tt: number) => {
      const p = R(tt),
        q = W(tt);
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    const t: number[] = [];
    const d: number[] = [];
    const n = 900;
    for (let k = 0; k <= n; k++) {
      const tt = (Ts * k) / n;
      t.push(tt);
      d.push(Math.max(1e-16, gap(tt)));
    }
    // момент першого перетину рівня 1: перебираємо всі вузли еталона (вони густі саме там, де викиди z вузькі, — рівномірна
    // сітка з 901 точки їх пропускала: 243.3 замість 231.1 при δ = 10⁻⁶), а потім уточнюємо бісекцією
    let tHit = NaN;
    const end = twin.t[twin.t.length - 1];
    for (let k = 1; k < ref.t.length && ref.t[k] <= end; k++) {
      const y = ref.y[k],
        q = W(ref.t[k]);
      if (Math.hypot(y[0] - q[0], y[1] - q[1], y[2] - q[2]) > 1) {
        let lo = ref.t[k - 1],
          hi = ref.t[k];
        for (let i = 0; i < 40; i++) {
          const m = 0.5 * (lo + hi);
          if (gap(m) > 1) hi = m;
          else lo = m;
        }
        tHit = hi;
        break;
      }
    }
    return { t, d, tHit };
  }, [ref, twin, Ts, problem]);

  const divergence = useMemo(
    () =>
      sols.map(({ m, s }) => {
        const rx = comp(ref, 0);
        let tDiv = NaN;
        for (let k = 0; k < s.t.length; k += Math.max(1, Math.floor(s.t.length / 3000))) {
          if (Math.abs(s.y[k][0] - sampleAt(ref.t, rx, s.t[k])) > 1) {
            tDiv = s.t[k];
            break;
          }
        }
        return { m, tDiv };
      }),
    [sols, ref],
  );

  const L = analysis.L;
  const chaos = analysis.cls.chaos && L > 0.01;
  const horizon = L > 0.005 ? Math.log(1 / dDelta) / L : Infinity;
  const fp = fixedPoint(da, db, dc);
  const jFast = Math.abs(fp[0] - dc);
  const jEdge = dc - analysis.xMin;
  const explBlown = sols.filter(({ m, s }) => isExplicit(m) && s.failed).map(({ m }) => m);
  const dopriSol = sols.find(({ m }) => m === "dopri")?.s;
  const dopriMedH = dopriSol && dopriSol.hs.length ? [...dopriSol.hs].sort((p, q) => p - q)[dopriSol.hs.length >> 1] : NaN;

  return (
    <>
      <AnalogyCard
        emoji="🌦️"
        title="Два синоптики і сота частка градуса"
        story={
          <>
            Два синоптики мають однакові формули й однаково потужні комп&apos;ютери. Різниця лише в ранковому замірі температури — на{" "}
            <b>соту частку градуса</b>. Перший тиждень їхні прогнози збігаються, а потім один обіцяє спеку, другий — грозу. Ніхто не помилився: просто
            погода — хаотична система, де крихітна різниця <b>росте лавиною</b>. Атрактор Реслера — найпростіша «іграшкова погода» з таким характером.
          </>
        }
        mapping={[
          ["ранковий замір температури", <>початкова умова x(0)</>],
          ["похибка термометра", <>збурення δ</>],
          ["як швидко ростуть розбіжності", <>показник Ляпунова λ₁ ≈ {fmt(bookL, 2)}</>],
          ["«день» погоди", <>один оберт вихору (≈ 6 од. часу)</>],
          ["гроза", <>викид z, коли x перевищує c</>],
        ]}
      >
        <RosslerForecastScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Три рівняння, одна нелінійність" simpleTitle="Вихор, що сам себе перемішує">
        <Grid>
          <Card title="Система з методички" icon="📜">
            <Tex block>{String.raw`\begin{cases} \dot x = -y - z,\\ \dot y = x + 0.15\,y,\\ \dot z = 0.4 + z\,(x - 8.5), \end{cases}\qquad x(0)=z(0)=0,\ \ y(0)=0.5.`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                  Три змінні: x і y — положення частинки, що кружляє на «підлозі», z — її висота. Перші два рівняння розкручують її по спіралі, третє
                  різко підкидає вгору, коли x перевищує c = 8.5. Рахуємо на відрізку t від 0 до 50 (у лабораторії — до 500).
                </p>
              }
            >
            <p className="mt-2 text-[14px] text-white/70">
              Це система Реслера <Tex>{String.raw`\dot x=-y-z,\ \dot y=x+ay,\ \dot z=b+z(x-c)`}</Tex> з параметрами <Tex>{"a=0.15,\\ b=0.4,\\ c=8.5"}</Tex>,
              відрізок <Tex>{"t\\in[0,50]"}</Tex> (у лабораторії — до 500).
            </p>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                  Отто Реслер (1976) шукав <b>найпростіший</b> хаос: тут лише один «хитрий» доданок — добуток z·x. Частинка розкручується по спіралі, а коли
                  відлітає надто далеко, її підкидає вгору й кидає назад до центру. Розтягнути → скласти → повторити — так роблять листкове тісто, і так
                  народжується хаос.
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/70">
              Отто Реслер (1976) шукав <b>найпростішу</b> систему з хаосом: тут лише один нелінійний член <Tex>{"z\\,x"}</Tex>. Рух — розкручування спіраллю в
              площині <Tex>{"(x,y)"}</Tex> (бо <Tex>{"a>0"}</Tex> «підкачує» коливання), а коли <Tex>{"x"}</Tex> перевищує <Tex>{"c"}</Tex>, змінна{" "}
              <Tex>{"z"}</Tex> вибухово зростає і «закидає» траєкторію назад до центру. Розтягнути → скласти → повторити: так тісто листкове робиться, і так
              народжується хаос.
            </p>
            </Say>
          </Card>
          <Card title="Де тут жорсткість?" icon="🔬">
            <p className="text-[14px] leading-relaxed text-white/75">Якобіан системи:</p>
            <Tex block>{String.raw`J=\begin{pmatrix}0&-1&-1\\ 1&a&0\\ z&0&x-c\end{pmatrix}`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Поки частинка кружляє «на підлозі», її висота z прилипає до землі дуже швидко — у ~{fmt(jFast, 2)}–{fmt(jEdge, 2)} разів швидше, ніж
                  частинка повертається на один радіан. Це <b>помірна</b> жорсткість: не тисячі разів, як у «сірника й чайника», а десятки. Головна біда
                  тут інша — <b>чутливість</b>: будь-яка крихітна похибка методу росте лавиною, як розбіжність двох синоптиків.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Поки траєкторія лежить «на підлозі» (<Tex>{"z\\approx 0"}</Tex>), третє власне число <Tex>{"\\approx x-c"}</Tex>: у центрі спіралі ≈{" "}
              <Tex>{`-${fmt(jFast, 3)}`}</Tex>, на дальньому краї «підлоги» (<Tex>{`x\\approx ${fmt(analysis.xMin, 3)}`}</Tex>) — аж до{" "}
              <Tex>{`-${fmt(jEdge, 3)}`}</Tex>; два інші — повільне обертання <Tex>{"\\approx a/2 \\pm i"}</Tex>. Це <b>помірна</b> жорсткість: z-компонента
              швидко «прилипає» до <Tex>{"z\\approx b/(c-x)"}</Tex>. Під час викиду (<Tex>{"x>c"}</Tex>) власне число стає додатним — z росте
              експоненційно. Тут жорсткість не головне — головне <b>чутливість</b>: будь-яка похибка методу підсилюється як <Tex>{"e^{\\lambda_1 t}"}</Tex>.
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="Параметри не «канонічні»"
                simpleTitle="Чому саме такі числа?"
                simple={
                  <>
                    Класичний вихор Реслера має параметри 0.2, 0.2 і 5.7. Методичка взяла свої (0.15, 0.4, 8.5) — але характер той самий: ми перевірили, що
                    дві близькі траєкторії розбігаються (показник розбігання ≈ {fmt(bookL, 2)} &gt; 0). А повзунком c можна пройти весь шлях від спокійного
                    циклу до хаосу.
                  </>
                }
              >
                Класичний атрактор Реслера має <Tex>{"a=b=0.2,\\ c=5.7"}</Tex> (λ₁ ≈ 0.07). Методичка бере <Tex>{"a=0.15,\\ b=0.4,\\ c=8.5"}</Tex> —
                картина та сама: ми перевірили чисельно, що для цих параметрів старший показник Ляпунова додатний (≈ {fmt(bookL, 2)}). А змінюючи{" "}
                <Tex>{"c"}</Tex>, можна пройти весь каскад подвоєння періоду.
              </Insight>
            </div>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Покрутіть c — і спостерігайте народження хаосу">
        <Lab
          controls={
            <>
              <Chips label="Пресети c" value={PRESETS.some((p) => p.c === c) ? c : -1} onChange={(v) => v > 0 && setC(v)} options={PRESETS.map((p) => ({ value: p.c, label: p.label }))} />
              <Slider label="c" value={c} onChange={setC} min={2} max={12} step={0.01} />
              <Slider label="a" value={a} onChange={setA} min={0.05} max={0.3} step={0.005} />
              <Slider label="b" value={b} onChange={setB} min={0.05} max={1} step={0.01} />
              <Chips
                label="Класика"
                value={a === 0.2 && b === 0.2 && c === 5.7 ? 1 : a === 0.15 && b === 0.4 ? 2 : 0}
                onChange={(v) => {
                  if (v === 1) {
                    setA(0.2);
                    setB(0.2);
                    setC(5.7);
                  } else if (v === 2) {
                    setA(0.15);
                    setB(0.4);
                    setC(8.5);
                  }
                }}
                options={[
                  { value: 2, label: "методичка (0.15, 0.4, 8.5)" },
                  { value: 1, label: "Реслер-1976 (0.2, 0.2, 5.7)" },
                ]}
              />
              <Slider label="Кінець відрізка T" value={T} onChange={setT} min={20} max={500} step={10} />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Slider label="Крок RK2/RK3/RK4 h" value={h} onChange={setH} min={0.002} max={0.3} log hint="DOPRI: rtol = 10⁻⁶; Розенброк: rtol = 10⁻⁴" />
              <Slider label="Збурення x(0) = δ" value={delta} onChange={setDelta} min={1e-12} max={1e-2} log format={(v) => fmt(v, 2)} />
              <Toggle label="Показати «двійника» в 3D" value={showTwin} onChange={setShowTwin} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                Режим: <b className="text-white">{analysis.cls.label}</b>, <Tex>{`\\lambda_1 \\approx ${fmt(L, 3)}`}</Tex>
              </div>
            </>
          }
        >
          <Playground sols={sols} twin={showTwin ? twin : null} a={da} b={db} c={dc} regime={analysis.cls.label} T={dT} />

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label="Режим"
              value={analysis.cls.chaos ? "хаос" : analysis.cls.n === 1 ? "цикл" : `P-${analysis.cls.n}`}
              sub={analysis.cls.chaos ? "максимуми x не повторюються" : `${analysis.cls.n} різних максимумів x`}
              tone={analysis.cls.chaos ? "bad" : "good"}
            />
            <Stat label="Показник Ляпунова λ₁" value={fmt(L, 3)} sub={L > 0.01 ? "> 0: експоненційне розбігання" : "≈ 0: регулярний рух"} tone={L > 0.01 ? "warn" : "good"} />
            <Stat label="Горизонт прогнозу" value={Number.isFinite(horizon) ? `t ≈ ${fmt(horizon, 3)}` : "∞"} sub={`ln(1/δ)/λ₁ при δ = ${fmt(dDelta, 2)}`} />
            <Stat label="Двійник відійшов на 1" value={Number.isFinite(dist.tHit) ? `t ≈ ${fmt(dist.tHit, 3)}` : "ніколи"} sub={`за еталоном DOPRI ${refTol < 1e-11 ? "10⁻¹²" : "10⁻¹⁰"}`} tone={Number.isFinite(dist.tHit) ? "warn" : "good"} />
            {sols.map(({ m, s }, k) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : `${s.steps} кр.`}
                sub={
                  s.failed
                    ? s.failed
                    : `${fmtMs(s.ms)} · ${s.rejected} відх. · відхід від еталона ${Number.isFinite(divergence[k].tDiv) ? `t≈${fmt(divergence[k].tDiv, 3)}` : "немає"}`
                }
                tone={s.failed ? "bad" : "default"}
              />
            ))}
          </div>

          {chaos && (
            <Insight
              tone="warn"
              title="Хаос: точність має термін придатності"
              simple={
                <>
                  Похибка тут не просто накопичується — вона <b>множиться</b>: кожні {fmt(1 / L, 3)} од. часу зростає в e ≈ 2.7 раза. За весь відрізок
                  T = {fmt(dT, 3)} це <Relatable kind="growth" n={Math.exp(L * dT)} />. Тому RK4, DOPRI і Розенброк рано чи пізно малюють різні траєкторії — і
                  жоден не «бреше». Довіряти можна формі вихору, а не точному положенню частинки в момент t.
                </>
              }
            >
              λ₁ ≈ {fmt(L, 3)} означає, що похибка зростає в e разів кожні {fmt(1 / L, 3)} одиниць часу. Тому навіть методи з різною, але
              малою похибкою (RK4, DOPRI, Розенброк) неминуче розходяться між собою та з еталоном — подивіться на поле «відхід від еталона». Це не
              баг методів, а властивість задачі: правильна{" "}
              <i>статистика</i> (форма атрактора, мапа максимумів) зберігається, а конкретна траєкторія — ні.
            </Insight>
          )}
          {!analysis.cls.chaos && (
            <Insight
              tone="good"
              title={`Регулярний режим: ${analysis.cls.label}`}
              simpleTitle="Спокійний режим: доріжка, що повторюється"
              simple={
                <>
                  Покружлявши, частинка виходить на замкнену доріжку: {analysis.cls.n} {plural(analysis.cls.n, ["виток", "витки", "витків"])} — і знову
                  спочатку. Крихітні похибки тут не ростуть (показник розбігання ≈ {fmt(L, 2)} ≈ 0), тож усі методи малюють ту саму картинку.
                </>
              }
            >
              Після перехідного процесу траєкторія лягає на замкнений цикл, що обходить центр {analysis.cls.n} раз(и) перш ніж замкнутися. λ₁ ≈{" "}
              {fmt(L, 2)} ≈ 0 (рух уздовж циклу не розтягується і не стискається). Різні методи дають ту саму картинку — похибки не підсилюються.
            </Insight>
          )}
          {explBlown.length > 0 && (
            <Insight
              tone="bad"
              title={`${explBlown.map((m) => METHODS[m].short).join(", ")} ${explBlown.length > 1 ? "вибухнули" : "вибухнув"}`}
              simple={
                <>
                  Крок h = {fmt(dh, 3)} завеликий. Коли частинка пролітає дальній край «підлоги», висота z змінюється в ~{fmt(jEdge, 3)} разів швидше за
                  обертання, і явний метод «перестрибує» правильне значення щоразу дедалі дужче — аж до вибуху. Зменшіть крок.
                </>
              }
            >
              При h = {fmt(dh, 3)} добуток h·|λ| для «швидкого» z-власного числа (|x − c| сягає {fmt(jEdge, 3)} на краю «підлоги», тобто h|λ| ≈{" "}
              {fmt(dh * jEdge, 2)}) вийшов за межу стійкості на дійсній осі ({explBlown.map((m) => `${METHODS[m].short} — ${EXPL_BOUND[m]}`).join(", ")}).
              Зменшіть крок.
            </Insight>
          )}
          {sols.some(({ m, s }) => isExplicit(m) && !s.failed) && dh > 0.08 && (
            <Insight
              tone="warn"
              title="Великий крок явного методу"
              simple={
                <>
                  Крок h = {fmt(dh, 3)} — лише ~{Math.round(6.3 / dh)} кроків на один оберт вихору. Метод ще не вибухнув, але у хаотичному режимі
                  траєкторія швидко відійде від правильної — порівняйте форму вихору з DOPRI.
                </>
              }
            >
              Метод поки не вибухає, але h = {fmt(dh, 3)} — це лише ~{Math.round(6.3 / dh)} кроків на оберт. Порівняйте форму атрактора з DOPRI — на
              хаотичних режимах траєкторії розійдуться дуже швидко.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Чутливість" title="Ефект метелика: дві траєкторії на відстані δ" simpleTitle="Ефект метелика: два синоптики">
        <Grid>
          <Card>
            <Plot
              title="x(t): оригінал і двійник"
              height={260}
              xLabel="t"
              series={[
                { x: ref.t, y: comp(ref, 0), color: "#b18cff", label: "x(0) = 0", width: 1.5 },
                { x: twin.t, y: comp(twin, 0), color: "#ffe66d", label: `x(0) = ${fmt(dDelta, 2)}`, width: 1.2, opacity: 0.85 },
              ]}
            />
          </Card>
          <Card>
            <Plot
              title="Відстань між траєкторіями (лог. шкала)"
              height={260}
              xLabel="t"
              logY
              yDomain={[Math.min(dDelta / 10, 1e-8), 100]}
              series={[
                { x: dist.t, y: dist.d, color: "#ff7ad9", label: "‖Δ(t)‖", width: 1.5 },
                ...(L > 0.005
                  ? [
                      {
                        x: dist.t,
                        y: dist.t.map((t) => dDelta * Math.exp(L * t)),
                        color: "#ffffff",
                        label: `δ·exp(λ₁t), λ₁=${fmt(L, 2)}`,
                        width: 1,
                        dash: [5, 5],
                        opacity: 0.6,
                        noRange: true,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        </Grid>
        <div className="mt-4">
          <Insight
            tone="info"
            title="Як читати графік відстані"
            simple={
              <>
                Вертикальна шкала «стиснута»: кожна поділка — у 10 разів більше за попередню. На такій шкалі лавиноподібне зростання виглядає прямою. Рожева
                крива — відстань між двома «синоптиками»: вона повзе вгору вздовж білої пунктирної прямої, поки не досягне розміру самого вихору (~10), — далі
                рости вже нікуди.
              </>
            }
          >
            На лог-шкалі експонента — пряма. Якщо рожева крива в середньому йде вздовж білої пунктирної, похибка росте як <Tex>{"\\delta e^{\\lambda_1 t}"}</Tex>{" "}
            і насичується на розмірі атрактора (~10). Показник Ляпунова ми рахуємо точніше — методом Бенеттіна (лінеаризоване рівняння{" "}
            <Tex>{"\\dot{\\boldsymbol\\xi} = J\\,\\boldsymbol\\xi"}</Tex> з перенормуванням кожні 50 кроків) на інтервалі 1200 одиниць, відкинувши перші 400
            як перехідний процес.
          </Insight>
        </div>
      </Section>

      <Section kicker="Структура хаосу" title="Мапа максимумів і дерево біфуркацій" simpleTitle="Порядок усередині хаосу">
        <Grid>
          <Card>
            <Plot
              title="Мапа Лоренца: zₙ₊₁ проти zₙ (послідовні максимуми z)"
              height={300}
              xLabel="zₙ"
              yLabel="zₙ₊₁"
              sorted={false}
              series={[
                {
                  x: [0, 30],
                  y: [0, 30],
                  color: "#ffffff",
                  width: 1,
                  dash: [4, 4],
                  opacity: 0.35,
                  noRange: true,
                },
                { x: analysis.zn, y: analysis.zn1, color: "#ff7ad9", dots: true, dotSize: 2.2, label: `${analysis.zn.length} пар` },
              ]}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] text-white/55">
                  Беремо висоти послідовних «викидів» z і питаємо: чи можна за одним викидом передбачити наступний? Для хаосу точки лягають на тонку
                  одногорбу дугу — наступний викид однозначно залежить від попереднього (хоча на довгу дистанцію все одно непередбачуваний). Для циклу — кілька
                  окремих точок.
                </p>
              }
            >
            <p className="mt-2 text-[13px] text-white/55">
              Едвард Лоренц придумав цей трюк у 1963-му: якщо хаотична траєкторія все ж «детермінована», наступний максимум має залежати від
              попереднього. Для хаосу точки лягають на тонку <b>одногорбу криву</b> (як логістичне відображення <Tex>{"x\\mapsto rx(1-x)"}</Tex>), для циклу
              — на кілька ізольованих точок.
            </p>
            </Say>
          </Card>
          <Card>
            <Plot
              title="Біфуркаційна діаграма: максимуми x при c ∈ [2, 12]"
              height={300}
              xLabel="c"
              yLabel="max x"
              cursorX={dc}
              series={[{ x: bif.xs, y: bif.ys, color: "#b18cff", dots: true, dotSize: 0.9, opacity: 0.8 }]}
              sorted={false}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] text-white/55">
                  Кожен вертикальний зріз — які «гребені» x трапляються при цьому c. Одна гілка — цикл, дві — повтор через два оберти, далі 4, 8… і суцільна
                  хмара хаосу з «вікнами» порядку (найпомітніше — повтор через три оберти біля c ≈ 9). Пунктир — поточне c.
                </p>
              }
            >
            <p className="mt-2 text-[13px] text-white/55">
              Кожен вертикальний зріз — це всі різні максимуми <Tex>{"x"}</Tex> на атракторі. Одна гілка → цикл, дві → період-2, потім 4, 8… і
              суцільна «хмара» хаосу з вікнами порядку (найпомітніше — період-3 біля <Tex>{"c\\approx 9"}</Tex>). Пунктир — поточне <Tex>{"c"}</Tex>.
            </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Результати" title="Каскад подвоєння періоду (a, b — як у лабораторії)" simpleTitle="Від циклу до хаосу: таблиця режимів">
        <Card>
          <Table
            head={["c", "Режим (кількість різних max x)", "λ₁ (Бенеттін)", "Висновок"]}
            rows={presetTable.map((p) => [
              <button key={p.c} onClick={() => setC(p.c)} className="text-[var(--accent)] underline-offset-2 hover:underline">
                {p.c}
              </button>,
              <span key="r" className={p.cls.chaos ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>
                {p.cls.label}
              </span>,
              fmt(p.L, 2),
              <span key="v" className="font-sans text-white/65">
                {p.cls.chaos ? (p.L > 0.01 ? "хаос: λ₁ > 0" : "складний квазірегулярний рух") : p.L > 0.02 ? "довгий перехідний процес" : "регулярний цикл, λ₁ ≈ 0"}
              </span>,
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Скільки різних «гребенів» x має траєкторія, коли вже заспокоїлась (перші 300 од. часу відкинуто). Один — простий цикл, 2, 4, 8 — цикл із
                повторами, «хаос» — гребені не повторюються ніколи. Натисніть на значення c, щоб перенести його в лабораторію.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Кількість різних максимумів після відкидання перехідного процесу t &lt; 300 (RK4, h = 0.01). Натисніть на значення c, щоб завантажити
            його в лабораторію.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Методи" title="Крок і жорсткість уздовж траєкторії" simpleTitle="Де методам доводиться дріботіти">
        <Grid>
          <Card>
            <Plot
              title="Крок адаптивних методів h(t)"
              height={260}
              xLabel="t"
              logY
              series={[
                ...sols
                  .filter(({ m }) => !isExplicit(m))
                  .map(({ m, s }) => ({ x: s.t.slice(1), y: s.hs, color: METHODS[m].color, label: METHODS[m].short, width: 1.3 })),
                { x: main.t, y: comp(main, 2).map((v) => Math.max(1e-3, v / 100)), color: "#ffffff", label: "z/100", width: 1, opacity: 0.3 },
              ]}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] text-white/55">
                  Крок адаптивних методів падає саме під час «викидів» z (білий фон): частинку різко підкидає, усе змінюється найшвидше — і метод
                  обережнішає. На «підлозі» він знову крокує широко.
                </p>
              }
            >
            <p className="mt-2 text-[13px] text-white/55">
              Помітно, як крок падає саме під час «викидів» z (білий фон): там розв&apos;язок змінюється найшвидше, а z-власне число стає додатним.
            </p>
            </Say>
          </Card>
          <Card>
            <StiffnessPanel problem={problem} sol={main} />
          </Card>
        </Grid>
      </Section>

      <Section kicker="Пісочниця" title="Клацніть — і киньте частинку у вихор" report={false}>
        <PhasePlayground
          f={PG_F}
          init={PG_INIT}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={6}
          speedRange={[0.5, 30]}
          trail={30}
          strip={[
            { comp: 0, label: "x", color: "#b18cff" },
            { comp: 2, label: "z", color: "#ff7ad9" },
          ]}
          window={60}
          kicks={[
            { label: "Подути вгору", emoji: "🌬️", apply: (y) => [y[0], y[1], y[2] + 3], hint: "z += 3" },
            { label: "Збити вбік", emoji: "👊", apply: (y) => [y[0] + 2, y[1], y[2]], hint: "x += 2" },
          ]}
          event={(prev, cur) => (prev[2] < 3 && cur[2] >= 3 ? "🌪️ викид z!" : null)}
          underlay={(ctx, { X, Y }) => {
            ctx.setLineDash([6, 5]);
            ctx.strokeStyle = "rgba(255,122,217,0.5)";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(X(8.5), Y(-15));
            ctx.lineTo(X(8.5), Y(13));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(255,122,217,0.8)";
            ctx.font = "12px sans-serif";
            ctx.fillText("x = c: тут z злітає", X(8.5) + 6, Y(12));
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(X(0), Y(0), 3.5, 0, Math.PI * 2);
            ctx.fill();
          }}
          hint={
            <Say
              simple={
                <>
                  Вид згори на вихор (x, y); висота z — на стрічці внизу. Клацніть будь-де — частинка почне звідти, але за кілька обертів опиниться на тому
                  самому вихорі. Щоразу, як вона перетинає рожеву лінію x = c, її підкидає вгору (тост «викид z»). Кнопки «дмуть» і «штовхають» частинку —
                  зверніть увагу, як по-різному після цього лягають наступні оберти.
                </>
              }
            >
              Проєкція на площину (x, y) системи з умови (a = 0.15, b = 0.4, c = 8.5), інтегрування — Розенброк у реальному часі. Клік задає нові x, y (z
              зберігається). Будь-яка стартова точка притягується до атрактора; за x &gt; c власне число z-рівняння додатне — відбувається викид. Сірі сліди —
              попередні траєкторії: на хаотичному атракторі сусідні старти швидко розходяться.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="5"
          questions={[
            {
              id: "horizon",
              q: (
                <>
                  Двійник стартує з x(0) = δ. При δ = 10⁻⁶ він відходить від оригіналу на відстань 1 приблизно при t ≈ 231 (параметри умови). Що буде, якщо
                  виміряти старт у мільйон разів точніше, δ = 10⁻¹²?
                </>
              ),
              options: ["Збігатимуться в мільйон разів довше", "Майже вдвічі довше — до t ≈ 400", "Так само, t ≈ 231 — хаос є хаос", "Двійник уже ніколи не відійде"],
              correct: 1,
              explain: (
                <>
                  Відстань росте як δ·e<sup>λ₁t</sup>, тож час до розбіжності ≈ ln(1/δ)/λ₁ — він залежить від δ лише логарифмічно: зменшення δ у 10⁶ разів
                  додає приблизно ln(10⁶)/λ₁ ≈ {fmt(Math.log(1e6) / bookL, 3)} одиниць часу. Збіжний розрахунок (DOPRI, rtol 10⁻¹²; з rtol 10⁻¹⁰ похибка
                  інтегрування вже перевищує δ = 10⁻¹²) дає t ≈ 231 для δ = 10⁻⁶ і t ≈ 401 для δ = 10⁻¹²: на 170 одиниць, тобто у 1.74 раза довше, а не в
                  мільйон. Різниця з оцінкою — бо локальна швидкість розбігання коливається навколо середнього λ₁.
                </>
              ),
              explainSimple: (
                <>
                  Похибка росте лавиною, тож кожне «у 100 разів точніше» купує лише ~57 одиниць часу. Мільйон разів точніше — це t ≈ 401 замість 231, менш ніж
                  удвічі довше.
                </>
              ),
              show: {
                label: "Показати δ = 10⁻¹², T = 500",
                run: () => {
                  setA(0.15);
                  setB(0.4);
                  setC(8.5);
                  setT(500);
                  setDelta(1e-12);
                },
              },
            },
            {
              id: "cycle",
              q: <>Тепер c = 4 (замість 8.5), δ = 10⁻⁶. Що станеться з відстанню між оригіналом і двійником на [0, 250]?</>,
              options: ["Розійдуться ще швидше, ніж при c = 8.5", "Розійдуться за той самий час t ≈ 231", "Так і йтимуть разом: відстань лишиться ~10⁻⁵", "Двійник полетить на нескінченність"],
              correct: 2,
              explain: (
                <>
                  При c = 4 атрактор — простий граничний цикл, λ₁ ≈ 0: збурення вздовж циклу не росте, впоперек — гасне. Еталонний розрахунок дає найбільшу
                  відстань ≈ 1.2·10⁻⁵ на всьому [0, 250] — «двійник» ніколи не відходить.
                </>
              ),
              explainSimple: <>При c = 4 вихор спокійний — частинка ходить по замкненій доріжці. Тут похибки не ростуть: двійник за весь час відходить лише на ~0.00001.</>,
              show: {
                label: "Показати c = 4",
                run: () => {
                  setA(0.15);
                  setB(0.4);
                  setC(4);
                  setDelta(1e-6);
                },
              },
            },
            {
              id: "rk4h",
              q: <>Задача «не дуже жорстка». За якого кроку RK4 вперше вибухне на [0, 50] (параметри умови)?</>,
              options: ["Уже при h = 0.01", "Біля h ≈ 0.2", "Лише при h ≈ 1", "Ніколи — жорсткості ж майже нема"],
              correct: 1,
              explain: (
                <>
                  Найшвидше власне число — z-рівняння, ≈ x − c: на дальньому краї «підлоги» (x ≈ −11.5) воно ≈ −20. Межа RK4 на дійсній осі h|λ| ≈ 2.8 дає
                  h ≈ 0.14, але там траєкторія буває недовго, тож перевірка показує: h = 0.18 ще дораховує, а h = 0.2 вибухає при t ≈ 46.
                </>
              ),
              explainSimple: (
                <>
                  Навіть «помірна» жорсткість ставить стелю: z-процес у ~20 разів швидший за обертання. З кроком 0.18 RK4 ще живий, а з кроком 0.2 — вибухає
                  десь на 46-й одиниці часу.
                </>
              ),
              show: {
                label: "Показати RK4 з h = 0.2",
                run: () => {
                  setA(0.15);
                  setB(0.4);
                  setC(8.5);
                  setT(50);
                  setH(0.2);
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
            tone="info"
            title="Шлях до хаосу — подвоєння періоду"
            simpleTitle="Шлях до хаосу — подвоєння"
            simple={
              <>
                Збільшуйте c — і доріжка подвоюється: 1 виток → 2 → 4 → 8 … Кожне наступне подвоєння настає дедалі швидше (проміжки скорочуються в ~3–4.5
                раза, прямуючи до числа Фейгенбаума 4.669), і вже при c ≈ 7.06 подвоєння «злипаються» в хаос.
              </>
            }
          >
            Зі зростанням c цикл подвоюється: 1 → 2 → 4 → 8 → 16 → … Інтервали між подвоєннями скорочуються: для a = 0.15, b = 0.4 ми знайшли (бісекцією за
            кількістю різних максимумів x, після перехідного процесу 6000 одиниць) c ≈ 4.812, 6.419, 6.915, 7.027, 7.052, а вже при c ≈ 7.06 каскад
            «згущується» в хаос. Відношення сусідніх інтервалів 1.607/0.496 ≈ 3.2, 0.496/0.112 ≈ 4.4, 0.112/0.025 ≈ 4.5 — прямують до універсальної
            сталої Фейгенбаума δ ≈ 4.669!
          </Insight>
          <Insight
            tone="warn"
            title="Похибки в хаосі"
            simple={
              <>
                За параметрів умови похибка в одну стомільйонну (10⁻⁸) доростає до 1 вже за t ≈ {fmt(Math.log(1e8) / bookL, 2)}. Тож порівнювати методи «точка в
                точку» безглуздо — порівнюють форму вихору, мапу «викидів» і швидкість розбігання.
              </>
            }
          >
            Для хаотичного режиму розбіжність методів неминуча: при λ₁ ≈ {fmt(bookL, 2)} (параметри умови) похибка 10⁻⁸ виростає до 1 за t ≈ ln(10⁸)/λ₁ ≈{" "}
            {fmt(Math.log(1e8) / bookL, 2)}. Порівнювати методи тут треба за інваріантами (форма атрактора, мапа максимумів, λ₁), а не поточково.
          </Insight>
          <Insight
            tone="good"
            title="Жорсткість — помірна"
            simple={
              <>
                Тут немає «сірника й чайника» з тисячократною різницею темпів: найшвидший процес лише в ~10–20 разів швидший за обертання. Звичайний RK4 з
                h = 0.01 чудово справляється (на [0, 500] це 50 000 кроків — <Relatable kind="steps" n={50000} />), а неявний Розенброк виграшу не дає.
              </>
            }
          >
            Швидке z-власне число ≈ x − c ~ −10…−20 при обертанні з частотою ~1: коефіцієнт жорсткості лише ~10–20. RK4 з h = 0.01 чудово працює,
            DOPRI (rtol 10⁻⁶) бере кроки ~{Number.isFinite(dopriMedH) ? fmt(dopriMedH, 2) : "0.08"} (медіана), а Розенброк (2-й порядок) навіть при слабшій
            точності rtol 10⁻⁴ робить більше кроків, ніж DOPRI — неявні методи тут не виграють.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Реслера надихнула машина для витягування іриски: маса розтягується, складається навпіл — і знову. Так само «місить» траєкторії його вихор, і
                саме так народжується хаос.
              </>
            }
          >
            Реслер придумав систему, надихаючись… машиною для витягування іриски (taffy puller): маса розтягується, складається навпіл і знову
            розтягується. Саме така «кухонна» геометрія розтягування й складання породжує подвоєння періоду і хаос, а число Фейгенбаума δ ≈ 4.669 у
            каскаді однакове і для іриски, і для логістичного відображення, і для крапель з крана.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function Playground({ sols, twin, a, b, c, regime, T }: { sols: { m: MethodId; s: Solution }[]; twin: Solution | null; a: number; b: number; c: number; regime: string; T: number }) {
  const pb = usePlayback(24);
  const main = sols[0].s;
  const tEnd = main.t[main.t.length - 1];
  const time = pb.progress * tEnd;

  const pts = useMemo(() => {
    const stride = Math.max(1, Math.ceil(main.y.length / 6000));
    const out: [number, number, number][] = [];
    for (let i = 0; i < main.y.length; i += stride) out.push([main.y[i][0], main.y[i][1], main.y[i][2]]);
    return out;
  }, [main]);
  const twinPts = useMemo(() => {
    if (!twin) return null;
    const out: [number, number, number][] = [];
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const tt = (k / Math.max(1, n - 1)) * tEnd;
      const i = indexAt(twin.t, tt);
      out.push([twin.y[i][0], twin.y[i][1], twin.y[i][2]]);
    }
    return out;
  }, [twin, pts.length, tEnd]);

  const sceneData = useMemo(() => {
    const spikes: number[] = [];
    const cum: number[] = [0];
    let ang = 0;
    for (let i = 1; i < main.y.length; i++) {
      let d = Math.atan2(main.y[i][1], main.y[i][0]) - Math.atan2(main.y[i - 1][1], main.y[i - 1][0]);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      ang += d;
      cum.push(Math.abs(ang) / (2 * Math.PI));
      if (i < main.y.length - 1 && main.y[i][2] > 1 && main.y[i][2] > main.y[i - 1][2] && main.y[i][2] >= main.y[i + 1][2]) spikes.push(main.t[i]);
    }
    return { spikes, cum };
  }, [main]);

  const k = indexAt(main.t, time);
  const cur = main.y[k];
  const series = useMemo(() => {
    const ts = [
      { x: main.t, y: comp(main, 0), color: "#b18cff", label: "x", width: 1.4 },
      { x: main.t, y: comp(main, 1), color: "#5cc8ff", label: "y", width: 1.2, opacity: 0.8 },
      { x: main.t, y: comp(main, 2), color: "#ff7ad9", label: "z", width: 1.4 },
    ];
    const proj = (j: number) =>
      sols.map(({ m, s }, i) => ({ x: comp(s, 0), y: comp(s, j), color: METHODS[m].color, label: METHODS[m].short, width: i ? 0.8 : 1.1, opacity: i ? 0.5 : 1, fade: i === 0 }));
    return { ts, xy: proj(1), xz: proj(2) };
  }, [main, sols]);

  return (
    <>
      <Card title="Атрактор у 3D (тягніть мишею)" icon="🌀" right={<span className="text-[12px] text-white/50">{METHODS[sols[0].m].name}</span>}>
        <Plot3D
          curves={[
            { pts, colors: ["#4b2fb8", "#ff7ad9"] },
            ...(twinPts ? [{ pts: twinPts, colors: ["#6b5a00", "#ffe66d"] as [string, string], width: 1 }] : []),
          ]}
          progress={Math.max(0.002, pb.progress)}
          height={400}
        />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${time.toFixed(1)}`} />
        </div>
        {twinPts && (
          <Say simple={<p className="mt-2 text-[12px] text-white/45">Жовта — «синоптик Б», що стартував на крихту інакше. Спершу йдуть разом, потім — кожен своєю дорогою (якщо режим хаотичний).</p>}>
            <p className="mt-2 text-[12px] text-white/45">Жовта — «двійник» зі збуреним x(0). Спершу йдуть разом, потім — кожна своєю дорогою (якщо режим хаотичний).</p>
          </Say>
        )}
      </Card>
      <Card title="Сцена: вир Реслера" icon="🌪️">
        <RosslerVortexScene t={main.t} ys={main.y} time={time} fixedPoint={fixedPoint(a, b, c)} spikes={sceneData.spikes} cumTurns={sceneData.cum} regime={regime} />
        <Say
          simple={
            <p className="mt-2 text-[12.5px] text-white/55">
              Частинка кружляє на «підлозі», щоразу відлітаючи трохи далі від центру. Коли відлітає надто далеко (x &gt; c), її підкидає вгору — і кидає назад
              до центру, щоб усе почалося знову. У хаотичному режимі ніхто не скаже наперед, на якому оберті станеться наступний «викид».
            </p>
          }
        >
        <p className="mt-2 text-[12.5px] text-white/55">
          Частинка кружляє на «підлозі» (площина x–y, z ≈ 0), розкручуючись від нестійкого фокуса. Коли x перевалює за c, її підкидає вгору (викид z),
          і вона падає ближче до центру — щоб почати все знову. У хаотичному режимі моменти викидів непередбачувані.
        </p>
        </Say>
      </Card>
      <Card>
        <Plot
          title="Часові ряди"
          height={240}
          xLabel="t"
          cursorX={time}
          xDomain={[0, T]}
          series={series.ts}
        />
      </Card>
      <Grid>
        <Card>
          <Plot
            title="Проєкція x–y"
            height={280}
            xLabel="x"
            yLabel="y"
            sorted={false}
            equalAspect
            markers={cur ? [{ x: cur[0], y: cur[1], color: "#ffffff" }] : []}
            series={series.xy}
          />
        </Card>
        <Card>
          <Plot
            title="Проєкція x–z"
            height={280}
            xLabel="x"
            yLabel="z"
            sorted={false}
            markers={cur ? [{ x: cur[0], y: cur[2], color: "#ffffff" }] : []}
            series={series.xz}
          />
        </Card>
      </Grid>
    </>
  );
}
