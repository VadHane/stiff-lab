"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Plot, { type Transform } from "@/components/plot/Plot";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import ChemClockScene from "@/components/scenes/ChemClockScene";
import { drawCurve, drawField } from "@/components/scenes/PhaseField";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider, Toggle } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { solveImplicit } from "@/lib/implicit-full-newton";
import { eigenvalues } from "@/lib/linalg";
import { METHODS } from "@/lib/methods";
import { comp, sampleAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import { traceStep } from "@/lib/step-trace";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import BlinkingFlaskScene from "@/components/analogy/BlinkingFlaskScene";
import StepDebugger from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";
import { plural } from "@/lib/relatable";

const ALL: MethodId[] = ["euler", "rk4", "ieuler", "trap", "theta", "bdf2", "dopri", "ros"];

/** «у N разів» with the right Ukrainian form */
function times(x: number) {
  const r = x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
  return `${r >= 1000 ? r.toLocaleString("uk-UA") : String(r)} ${Number.isInteger(r) ? plural(r, ["раз", "рази", "разів"]) : "раза"}`;
}
const FIXED_EXPLICIT: MethodId[] = ["euler", "rk4"];

// stable references for the debugger (A = 50, B = 80) and the playground (A = 1, B = 3)
const F_DBG = (_t: number, y: number[]) => {
  const q = y[0] * y[0] * y[1];
  return [50 + q - 81 * y[0], 80 * y[0] - q];
};
const Y0_DBG = [50, 80];
const DBG_VIEW = { x: 0, y: 1, xLabel: "u₁", yLabel: "u₂", xDomain: [35, 145] as [number, number], yDomain: [-15, 88] as [number, number] };
const F_PG = (_t: number, y: number[]) => {
  const q = y[0] * y[0] * y[1];
  return [1 + q - 4 * y[0], 3 * y[0] - q];
};
const Y0_PG = [1, 1];
const PG_DOMAIN = { x: [0, 8] as [number, number], y: [0, 7.5] as [number, number] };
const PG_LABELS: [string, string] = ["u₁ (X)", "u₂ (Y)"];

function pgUnderlay(ctx: CanvasRenderingContext2D, { X, Y }: { X: (x: number) => number; Y: (y: number) => number }) {
  const curve = (g: (x: number) => number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    for (let k = 0; k <= 200; k++) {
      const x = 0.05 + (7.95 * k) / 200;
      const y = Math.min(50, g(x));
      if (k) ctx.lineTo(X(x), Y(y));
      else ctx.moveTo(X(x), Y(y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  curve((x) => (4 * x - 1) / (x * x), "rgba(255,179,71,0.75)");
  curve((x) => 3 / x, "rgba(127,155,255,0.75)");
  ctx.fillStyle = "#ff5d73";
  ctx.beginPath();
  ctx.arc(X(1), Y(3), 5, 0, Math.PI * 2);
  ctx.fill();
}

interface Params {
  A: number;
  B: number;
  u10: number;
  u20: number;
  T: number;
}

const PRESETS = [
  { key: "b50", label: "A=50, B=50", A: 50, B: 50, u10: 50, u20: 50, T: 10, h: 0.1 },
  { key: "b80", label: "A=50, B=80", A: 50, B: 80, u10: 50, u20: 80, T: 10, h: 0.1 },
  { key: "b120", label: "A=50, B=120", A: 50, B: 120, u10: 50, u20: 120, T: 10, h: 0.1 },
  { key: "clock", label: "⏰ годинник A=1, B=3", A: 1, B: 3, u10: 1, u20: 1, T: 50, h: 0.1 },
  { key: "relax", label: "⚡ стрибки A=1, B=10", A: 1, B: 10, u10: 1, u20: 1, T: 150, h: 0.1 },
] as const;

function brusselator({ A, B, u10, u20, T }: Params): Problem {
  return {
    f: (_t, y) => {
      const q = y[0] * y[0] * y[1];
      return [A + q - (B + 1) * y[0], B * y[0] - q];
    },
    jac: (_t, y) => [
      [2 * y[0] * y[1] - (B + 1), y[0] * y[0]],
      [B - 2 * y[0] * y[1], -y[0] * y[0]],
    ],
    y0: [u10, u20],
    T,
  };
}

const effectiveH = (h: number, T: number) => Math.max(h, T / 40000);

function run(m: MethodId, p: Problem, h: number, tol: number): Solution {
  const hh = effectiveH(h, p.T);
  if (m === "euler" || m === "rk4") return solve(m, p, { h: hh, blowup: 1e6 });
  if (m === "ieuler" || m === "trap" || m === "theta" || m === "bdf2") return solveImplicit(m, p, { h: hh, blowup: 1e6 });
  return solve(m, p, { rtol: tol, atol: tol * 1e-2, blowup: 1e6, maxSteps: 60000 });
}

function errVsRef(s: Solution, ref: Solution, r1: number[], r2: number[]) {
  let e = 0;
  for (let k = 0; k < s.t.length; k++) {
    const d = Math.max(Math.abs(s.y[k][0] - sampleAt(ref.t, r1, s.t[k])), Math.abs(s.y[k][1] - sampleAt(ref.t, r2, s.t[k])));
    if (!(d <= e)) e = d;
  }
  return e;
}

function equilibrium(A: number, B: number) {
  const J = [
    [B - 1, A * A],
    [-B, -A * A],
  ];
  const ev = eigenvalues(J);
  const tr = B - 1 - A * A;
  const det = A * A;
  const disc = tr * tr - 4 * det;
  const kind =
    tr > 0 ? (disc < 0 ? "нестійкий фокус → граничний цикл" : "нестійкий вузол → граничний цикл") : disc < 0 ? "стійкий фокус" : "стійкий вузол";
  return { ev, tr, det, kind, stable: tr < 0 };
}

// eigenvalues in the equilibrium for the condition's A = 50, B = 80 (quoted in the «Рівновага, Хопф і жорсткість» card)
const EQ80 = (() => {
  const [l1, l2] = equilibrium(50, 80)
    .ev.map((e) => e.re)
    .sort((a, b) => a - b);
  return { l1, l2, ratio: Math.round(l1 / l2) };
})();

/** fast eigenvalue min Re λ(J) along a reference trajectory, from the peak of u₁ to the end */
function fastAfterPeak(p: Problem, sol: Solution) {
  let kPeak = 0;
  for (let k = 1; k < sol.t.length; k++) if (sol.y[k][0] > sol.y[kPeak][0]) kPeak = k;
  let lo = Infinity,
    hi = -Infinity;
  for (let k = kPeak; k < sol.t.length; k++) {
    const f = Math.min(...eigenvalues(p.jac!(sol.t[k], sol.y[k])).map((e) => e.re));
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  return { lo, hi };
}

function periodOf(sol: Solution, A: number) {
  const u = comp(sol, 0);
  const n = u.length;
  const tail = Math.floor(n * 0.3);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = tail; i < n; i++) {
    lo = Math.min(lo, u[i]);
    hi = Math.max(hi, u[i]);
  }
  if (hi - lo < 0.05 * Math.max(A, 1e-3)) return { period: NaN, amp: hi - lo };
  const thr = (hi + lo) / 2;
  const cr: number[] = [];
  for (let i = 1; i < n; i++) if (u[i - 1] < thr && u[i] >= thr) cr.push(sol.t[i]);
  if (cr.length < 3) return { period: NaN, amp: hi - lo };
  return { period: (cr[cr.length - 1] - cr[1]) / (cr.length - 2), amp: hi - lo };
}

export default function T18() {
  const [P, setP] = useState<Params>({ A: 50, B: 80, u10: 50, u20: 80, T: 10 });
  const [h, setH] = useState(0.1);
  const [tol, setTol] = useState(1e-4);
  const [methods, setMethods] = useState<MethodId[]>(["euler", "ieuler", "trap", "bdf2", "ros"]);
  const dP = useDeferredValue(P);
  const dh = useDeferredValue(h);
  const dtol = useDeferredValue(tol);
  const set = (k: keyof Params) => (v: number) => setP((p) => ({ ...p, [k]: v }));
  const preset = PRESETS.find((q) => q.A === P.A && q.B === P.B && q.u10 === P.u10 && q.u20 === P.u20 && q.T === P.T)?.key ?? "";

  const problem = useMemo(() => brusselator(dP), [dP]);
  const ref = useMemo(() => solve("ros", problem, { rtol: 1e-8, atol: 1e-10, maxSteps: 400000 }), [problem]);
  const r1 = useMemo(() => comp(ref, 0), [ref]);
  const r2 = useMemo(() => comp(ref, 1), [ref]);
  const eq = useMemo(() => equilibrium(dP.A, dP.B), [dP.A, dP.B]);
  const per = useMemo(() => periodOf(ref, dP.A), [ref, dP.A]);
  const lamTraj = useMemo(() => {
    let neg = 0,
      pos = 0;
    for (let k = 0; k < ref.t.length; k++) {
      for (const e of eigenvalues(problem.jac!(ref.t[k], ref.y[k]))) {
        if (-e.re > neg) neg = -e.re;
        if (e.re > pos) pos = e.re;
      }
    }
    return { neg, pos };
  }, [ref, problem]);

  const sols = useMemo(
    () =>
      methods
        .slice()
        .sort((a, b) => ALL.indexOf(a) - ALL.indexOf(b))
        .map((m) => {
          const s = run(m, problem, dh, dtol);
          return { m, s, err: errVsRef(s, ref, r1, r2) };
        }),
    [methods, problem, dh, dtol, ref, r1, r2],
  );

  const race = useMemo(
    () =>
      (["dopri", "ros"] as MethodId[]).map((m) => {
        const hit = sols.find((x) => x.m === m);
        return { m, s: hit ? hit.s : run(m, problem, dh, dtol) };
      }),
    [sols, problem, dh, dtol],
  );

  const range = useMemo(() => {
    let a1 = Infinity,
      b1 = -Infinity,
      a2 = Infinity,
      b2 = -Infinity;
    for (let i = 0; i < r1.length; i++) {
      a1 = Math.min(a1, r1[i]);
      b1 = Math.max(b1, r1[i]);
      a2 = Math.min(a2, r2[i]);
      b2 = Math.max(b2, r2[i]);
    }
    const p1 = (b1 - a1) * 0.12 + 0.05,
      p2 = (b2 - a2) * 0.12 + 0.05;
    return { u1: [Math.max(0, a1 - p1), b1 + p1] as [number, number], u2: [Math.max(0, a2 - p2), b2 + p2] as [number, number], max1: b1, max2: b2 };
  }, [r1, r2]);

  const { A, B } = dP;
  const hEff = effectiveH(dh, dP.T);
  const lamFast = Math.min(...eq.ev.map((e) => e.re));
  const fastReal = eq.ev.every((e) => Math.abs(e.im) < 1e-9);
  const evMag = eq.ev.map((e) => Math.abs(e.re));
  const stiffRatio = fastReal ? Math.max(...evMag) / Math.min(...evMag) : NaN;
  const hopfB = 1 + A * A;
  const hEuler = 2 / lamTraj.neg;

  const underlay = useCallback(
    (ctx: CanvasRenderingContext2D, tr: Transform) => {
      drawField(ctx, tr, (x, y) => {
        const q = x * x * y;
        return [A + q - (B + 1) * x, B * x - q];
      });
      drawCurve(ctx, tr, (x) => ((B + 1) * x - A) / (x * x), "#ffb347", { label: "u₁′ = 0" });
      drawCurve(ctx, tr, (x) => B / x, "#7f9bff", { label: "u₂′ = 0" });
    },
    [A, B],
  );

  const hopfUnderlay = useCallback((ctx: CanvasRenderingContext2D, tr: Transform) => {
    ctx.save();
    ctx.beginPath();
    let first = true;
    for (let px = tr.left; px <= tr.left + tr.width; px += 2) {
      const a = tr.invX(px);
      const py = tr.Y(1 + a * a);
      if (first) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      first = false;
    }
    ctx.lineTo(tr.left + tr.width, tr.top);
    ctx.lineTo(tr.left, tr.top);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,209,102,0.10)";
    ctx.fill();
    ctx.fillStyle = "rgba(255,209,102,0.85)";
    ctx.font = "12px var(--font-sans), system-ui, sans-serif";
    ctx.fillText("граничний цикл (годинник цокає)", tr.left + 10, tr.top + 18);
    ctx.fillStyle = "rgba(62,230,168,0.85)";
    ctx.textAlign = "right";
    ctx.fillText("стійка рівновага (тиша)", tr.left + tr.width - 10, tr.top + tr.height - 12);
    ctx.restore();
  }, []);

  const parab = useMemo(() => {
    const x: number[] = [],
      y: number[] = [];
    for (let i = 0; i <= 200; i++) {
      const a = Math.pow(10, -1 + (3 * i) / 200);
      x.push(a);
      y.push(1 + a * a);
    }
    return { x, y };
  }, []);

  const table = useMemo(() => {
    const Bs = [50, 80, 120];
    return Bs.map((b) => {
      const p = brusselator({ A: 50, B: b, u10: 50, u20: b, T: 10 });
      const rf = solve("ros", p, { rtol: 1e-8, atol: 1e-10, maxSteps: 400000 });
      const a1 = comp(rf, 0),
        a2 = comp(rf, 1);
      const cells = (["euler", "rk4", "ieuler", "trap", "theta", "bdf2"] as MethodId[]).map((m) => {
        const s = run(m, p, 0.1, 1e-4);
        return { s, e: errVsRef(s, rf, a1, a2) };
      });
      const ad = (["dopri", "ros"] as MethodId[]).map((m) => run(m, p, 0.1, 1e-4));
      return { b, cells, ad, fast: fastAfterPeak(p, rf) };
    });
  }, []);

  // numbers for the step-debugger hint (A = 50, B = 80, start (50, 80), h = 0.1)
  const dbg = useMemo(() => {
    const ev0 = eigenvalues(brusselator({ A: 50, B: 80, u10: 50, u20: 80, T: 10 }).jac!(0, Y0_DBG))
      .map((e) => e.re)
      .sort((a, b) => b - a);
    const f0 = F_DBG(0, Y0_DBG);
    const e1 = Y0_DBG.map((v, i) => v + 0.1 * f0[i]);
    const f1 = F_DBG(0.1, e1);
    const e2 = e1.map((v, i) => v + 0.1 * f1[i]);
    // u₁·u₂ after the first step (the slow manifold is u₁u₂ ≈ B = 80); θ = 0.55 as in the debugger
    const prod = (m: "ieuler" | "trap" | "theta") => {
      const y = traceStep(m, F_DBG, 0, Y0_DBG, 0.1).y1;
      return y ? y[0] * y[1] : NaN;
    };
    return {
      ev0,
      du1: f0[0],
      euler1: e1[0],
      euler2: Math.max(...e2.map(Math.abs)),
      ieProd: prod("ieuler"),
      trapProd: prod("trap"),
      thetaProd: prod("theta"),
      fast: table.find((r) => r.b === 80)!.fast,
    };
  }, [table]);

  const blown = sols.filter((x) => x.s.failed && FIXED_EXPLICIT.includes(x.m));
  const newtonFail = sols.filter((x) => x.s.failed && x.s.failed.includes("Ньютона"));
  const flicker = sols.filter((x) => (x.m === "trap" || x.m === "theta") && !x.s.failed && x.err > 0.1 * Math.max(range.max1, 1));
  const dopriS = race[0].s,
    rosS = race[1].s;

  return (
    <>
      <AnalogyCard
        emoji="🚦"
        title="Хімічний світлофор"
        story={
          <>
            Змішайте кілька реактивів — і розчин у колбі почне <b>сам</b> блимати: помаранчевий → синій → помаранчевий, рівно, як світлофор. Ніхто нічого не
            перемикає: проміжна речовина X «розмножується», поїдаючи Y, а Y знову набирається з подачі B. Але годинник заводиться не завжди — поки подачі B
            замало (<b>B ≤ 1 + A²</b>), колір просто завмирає. У задачі з умови (A = 50) годинник якраз стоїть, зате одразу після змішування концентрації
            стрибають за <b>тисячні</b> частки секунди, а потім секундами повзуть до спокою — і цей стрибок ламає явні методи.
          </>
        }
        mapping={[
          ["колір розчину", <>співвідношення X і Y — концентрації u₁ та u₂</>],
          ["кран подачі B", <>параметр B; годинник вмикається при B &gt; 1 + A² (біфуркація Хопфа)</>],
          ["рівний ритм блимання", <>граничний цикл: при A = 1, B = 3 період ≈ 7.2</>],
          ["миттєвий спалах після змішування", <>швидка мода λ ≈ −2420 (A = 50, B = 80)</>],
          ["тихе сповзання до спокою", <>повільна мода λ ≈ −1</>],
        ]}
      >
        <BlinkingFlaskScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Модель «Брюсселятор»" simpleTitle="Реакція, що вміє цокати">
        <Grid>
          <Card title="Рівняння з методички" icon="📜">
            <Tex block>{String.raw`\begin{cases} \dfrac{du_1}{dt} = A + u_1^2u_2 - (B+1)\,u_1,\\[2mm] \dfrac{du_2}{dt} = B\,u_1 - u_1^2 u_2, \end{cases}\qquad h = 0.1.`}</Tex>
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Параметри <Tex>{"A = 50"}</Tex>, <Tex>{"B = 50,\\ 80,\\ 120"}</Tex>; початкові умови <Tex>{"u_1(0) = A,\\ u_2(0) = B"}</Tex>. Це
              схема Пригожина–Лефевра (Брюссель, 1968) — найпростіша модель хімічної реакції, що може «тікати» сама собою:
            </p>
            <Tex block>{String.raw`A \to X,\quad B + X \to Y + D,\quad 2X + Y \to 3X,\quad X \to E.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Простими словами: у колбу безперервно подають речовини A і B. З A утворюється X, з B і X — Y, а найцікавіше — реакція{" "}
                  <b>2X + Y → 3X</b>: X «розмножує сам себе», поїдаючи Y. Через цю «ланцюгову реакцію» концентрації X (u₁) і Y (u₂) можуть стрибати й навіть
                  коливатися. Задача: порахувати u₁(t) і u₂(t) на відрізку [0, 10] з кроком 0.1 для A = 50 і трьох значень B.
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                <Tex>{"u_1"}</Tex> — концентрація проміжної речовини X, <Tex>{"u_2"}</Tex> — Y. Ключ до всього — автокаталіз{" "}
                <Tex>{"2X + Y \\to 3X"}</Tex>: X сам себе розмножує, «поїдаючи» Y (доданок <Tex>{"u_1^2u_2"}</Tex>).
              </p>
            </Say>
          </Card>
          <Card title="Рівновага, Хопф і жорсткість" icon="🔬">
            <p className="text-[14px] leading-relaxed text-white/75">
              Єдина рівновага <Tex>{"(u_1^*, u_2^*) = (A,\\ B/A)"}</Tex>. Якобіан у ній:
            </p>
            <Tex block>{String.raw`J^* = \begin{pmatrix} B-1 & A^2\\ -B & -A^2\end{pmatrix},\quad \operatorname{tr}J^* = B-1-A^2,\quad \det J^* = A^2 > 0.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Є один стан спокою: X = A, Y = B/A. Годинник «заводиться», лише коли подача B перевищує 1 + A². Для A = 50 це B &gt; 2501, тож усі три
                  варіанти з умови (B = 50, 80, 120) — без коливань.
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Отже, рівновага втрачає стійкість (біфуркація Хопфа) при <Tex>{"B > 1 + A^2"}</Tex>. Для <Tex>{"A = 50"}</Tex> поріг{" "}
                <Tex>{"B = 2501"}</Tex>, тож усі три варіанти з умови — стійкі. Але власні числа (для <Tex>{"B = 80"}</Tex>):
              </p>
            </Say>
            <Tex block>{`\\lambda_1 \\approx ${fmt(EQ80.l1, 6)},\\qquad \\lambda_2 \\approx ${fmt(EQ80.l2, 4)},\\qquad \\frac{|\\lambda_1|}{|\\lambda_2|} \\approx ${EQ80.ratio}.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Зате тут живуть два дуже різні темпи: один процес закінчується за тисячні частки секунди, інший — за секунди, у ≈{EQ80.ratio}{" "}
                  {plural(EQ80.ratio, ["раз", "рази", "разів"])} повільніше. <Relatable kind="ratio" n={EQ80.ratio} /> Явний метод із кроком 0.1 «перестрибує»
                  швидкий процес і розлітається з першого ж кроку.
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Повільна мода живе секунди, швидка — тисячні. При <Tex>{"h = 0.1"}</Tex> маємо <Tex>{"h\\lambda_1 \\approx -242"}</Tex>: явний Ейлер (межа −2)
                і RK4 (−2.785) вибухають з першого ж кроку. І це ще в рівновазі: на піку початкового стрибка (<Tex>{"u_1 \\approx 130"}</Tex>) швидке власне
                число якобіана <Tex>{"\\approx -u_1^2 \\approx -1.7\\cdot10^4"}</Tex>.
              </p>
            </Say>
          </Card>
        </Grid>
        <div className="mt-4">
          <Insight
            tone="note"
            title="Як ми трактуємо умову"
            simpleTitle="Що ми зробили з умовою"
            simple={
              <>
                Методи з кроком 0.1 рахуємо «як написано». Але неявним методам на кожному кроці треба розв&apos;язати складне рівняння (на старті швидкість зміни
                u₁ сягає ≈ 200 000!), і звичайний метод Ньютона там губиться — тому ми розв&apos;язуємо його обережніше, «підкрадаючись» до відповіді. Ще
                додали два пресети з A = 1, де годинник справді цокає.
              </>
            }
          >
            Явні та неявні методи з кроком <Tex>{"h = 0.1"}</Tex> розв&apos;язуються «як написано». Для неявних схем рівняння{" "}
            <Tex>{"y_{n+1} = c + h\\beta f(y_{n+1})"}</Tex> тут сильно нелінійне (для <Tex>{"A = 50,\\ B = 80"}</Tex> уже <Tex>{"u_1'(0) \\approx 2\\cdot10^5"}</Tex>!), тому ми розв&apos;язуємо
            його повним методом Ньютона з демпфуванням і продовженням за параметром — інакше ітерації просто губляться. Додатково — два «класичні»
            пресети з малим <Tex>{"A"}</Tex>, де <Tex>{"B > 1 + A^2"}</Tex> і реакція перетворюється на справжній хімічний годинник.
          </Insight>
        </div>
      </Section>

      <Section kicker="Лабораторія" title="Зварімо годинник">
        <Lab
          controls={
            <>
              <Chips
                label="Пресети"
                value={preset}
                onChange={(k) => {
                  const q = PRESETS.find((x) => x.key === k);
                  if (!q) return;
                  setP({ A: q.A, B: q.B, u10: q.u10, u20: q.u20, T: q.T });
                  setH(q.h);
                }}
                options={PRESETS.map((q) => ({ value: q.key as string, label: q.label }))}
              />
              <Slider label="A (подача речовини A)" value={P.A} onChange={set("A")} min={0.2} max={60} log />
              <Slider label="B (подача речовини B)" value={P.B} onChange={set("B")} min={0.5} max={150} step={0.5} hint={`поріг Хопфа: B = 1 + A² = ${fmt(1 + P.A * P.A, 4)}`} />
              <div className="grid grid-cols-2 gap-3">
                <Slider label="u₁(0)" value={P.u10} onChange={set("u10")} min={0} max={200} step={0.5} />
                <Slider label="u₂(0)" value={P.u20} onChange={set("u20")} min={0} max={200} step={0.5} />
              </div>
              <Slider label="Кінець відрізка T" value={P.T} onChange={set("T")} min={1} max={300} log />
              <Slider label="Крок h (фіксовані методи)" value={h} onChange={setH} min={0.001} max={0.5} log />
              <Slider
                label="Точність rtol (адаптивні)"
                value={tol}
                onChange={setTol}
                min={1e-8}
                max={1e-2}
                log
                format={(v) => v.toExponential(0)}
                hint="atol = rtol · 10⁻²"
              />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] leading-relaxed text-white/65">
                Рівновага <Tex>{`(${fmt(A, 3)},\\ ${fmt(B / A, 3)})`}</Tex> — <b className="text-white/85">{eq.kind}</b>.
                <br />
                <Tex>{`\\lambda = ${eq.ev.map((e) => (Math.abs(e.im) > 1e-9 ? `${fmt(e.re, 4)}\\pm${fmt(Math.abs(e.im), 4)}i` : fmt(e.re, 5))).filter((v, i, a) => a.indexOf(v) === i).join(",\\ ")}`}</Tex>
                {fastReal && lamFast < 0 && (
                  <>
                    <br />
                    <Tex>{`h|\\lambda_{\\max}| = ${fmt(hEff * Math.abs(lamFast), 4)}`}</Tex> (у рівновазі)
                  </>
                )}
                {hEff > dh * 1.001 && (
                  <>
                    <br />
                    фактичний крок обмежено до h = {fmt(hEff, 3)} (≤ 40 000 кроків)
                  </>
                )}
              </div>
            </>
          }
        >
          <Grid>
            <Card>
              <Plot
                title="u₁(t) — речовина X"
                xLabel="t"
                height={260}
                yDomain={range.u1}
                series={[
                  { x: ref.t, y: r1, color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
                  ...sols.map(({ m, s, err }) => ({
                    x: s.t,
                    y: comp(s, 0),
                    color: METHODS[m].color,
                    label: METHODS[m].short,
                    width: s.failed || err > 0.2 * range.max1 ? 1 : 1.7,
                    opacity: s.failed || err > 0.2 * range.max1 ? 0.45 : 1,
                  })),
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="u₂(t) — речовина Y"
                xLabel="t"
                height={260}
                yDomain={range.u2}
                series={[
                  { x: ref.t, y: r2, color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
                  ...sols.map(({ m, s, err }) => ({
                    x: s.t,
                    y: comp(s, 1),
                    color: METHODS[m].color,
                    width: s.failed || err > 0.2 * range.max2 ? 1 : 1.7,
                    opacity: s.failed || err > 0.2 * range.max2 ? 0.45 : 1,
                  })),
                ]}
              />
            </Card>
          </Grid>
          <Card>
            <Plot
              title="Фазовий портрет (u₁, u₂): нульклини і поле напрямків"
              xLabel="u₁"
              yLabel="u₂"
              height={380}
              sorted={false}
              xDomain={range.u1}
              yDomain={range.u2}
              underlay={underlay}
              markers={[
                { x: A, y: B / A, color: eq.stable ? "#3ee6a8" : "#ff5d73", r: 6 },
                { x: dP.u10, y: dP.u20, color: "#ffffff", r: 4 },
              ]}
              series={[
                { x: r1, y: r2, color: "#ffffff", label: "еталон", width: 3, opacity: 0.55, fade: true },
                ...sols
                  .filter(({ s }) => !s.failed || s.steps > 3)
                  .map(({ m, s }) => ({ x: comp(s, 0), y: comp(s, 1), color: METHODS[m].color, label: METHODS[m].short, width: 1.4, opacity: s.failed ? 0.45 : 0.9 })),
              ]}
            />
            <Say
              simple={
                <p className="mt-2 text-[12.5px] text-white/50">
                  Кожна точка площини — «склад колби» (скільки X і скільки Y). Помаранчева штрихова — де X на мить перестає змінюватися, синя — де Y. Їхній
                  перетин — стан спокою ({eq.stable ? "зелений: колба туди приходить і завмирає" : "червоний: колба від нього тікає — і починає цокати"}). Біла
                  точка — старт.
                </p>
              }
            >
              <p className="mt-2 text-[12.5px] text-white/50">
                Помаранчева штрихова — <Tex>{"u_1' = 0"}</Tex>: <Tex>{"u_2 = ((B+1)u_1 - A)/u_1^2"}</Tex>; синя — <Tex>{"u_2' = 0"}</Tex>: <Tex>{"u_2 = B/u_1"}</Tex>.
                Перетин — рівновага ({eq.stable ? "зелена: стійка" : "червона: нестійка"}). Біла точка — старт.
              </p>
            </Say>
          </Card>
          <Grid>
            <Card>
              <Plot
                title="Примежовий шар: u₁ у лог. часі"
                xLabel="t"
                height={240}
                logX
                xDomain={[Math.max(1e-5, ref.t[1] ?? 1e-5), dP.T]}
                yDomain={range.u1}
                series={[
                  { x: ref.t.slice(1), y: r1.slice(1), color: "#ffffff", label: "еталон", width: 4, opacity: 0.3 },
                  ...sols.map(({ m, s, err }) => ({
                    x: s.t.slice(1),
                    y: comp(s, 0).slice(1),
                    color: METHODS[m].color,
                    width: 1.5,
                    opacity: s.failed || err > 0.2 * range.max1 ? 0.45 : 1,
                  })),
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="Крок адаптивних методів h(t)"
                xLabel="t"
                height={240}
                logY
                series={race.map(({ m, s }) => ({ x: s.t.slice(1), y: s.hs, color: METHODS[m].color, label: `${METHODS[m].short}: ${s.steps} кр.`, width: 1.5 }))}
              />
            </Card>
          </Grid>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, err }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? (s.failed.includes("Ньютона") ? "🌀" : "💥") : fmt(err, 3)}
                sub={s.failed ? s.failed : `max похибка · ${s.steps} кр.${s.rejected ? ` (+${s.rejected} відх.)` : ""} · ${fmtMs(s.ms)}`}
                tone={s.failed || err > 0.2 * range.max1 ? "bad" : err > 0.01 * range.max1 ? "warn" : "good"}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="коеф. жорсткості в рівновазі" value={!eq.stable ? "—" : Number.isFinite(stiffRatio) ? fmt(stiffRatio, 4) : "комплексні λ"} sub="|λ_max| / |λ_min|" tone={stiffRatio > 100 ? "warn" : "default"} />
            <Stat label="режим" value={eq.stable ? "рівновага" : "цикл"} sub={`B ${eq.stable ? "<" : ">"} 1 + A² = ${fmt(hopfB, 4)}`} tone={eq.stable ? "good" : "warn"} />
            <Stat
              label="період коливань"
              value={!eq.stable && Number.isFinite(per.period) ? fmt(per.period, 4) : "—"}
              sub={eq.stable ? (fastReal ? "сталих коливань нема" : "стійкий фокус: коливання згасають") : `лінійна теорія біля Хопфа: 2π/A = ${fmt((2 * Math.PI) / A, 3)}`}
            />
            <Stat label="DOPRI / Розенброк" value={`${dopriS.steps} / ${rosS.steps}`} sub={`кроків · у ${fmt(dopriS.steps / Math.max(1, rosS.steps), 3)} рази`} tone={dopriS.steps > 3 * rosS.steps ? "warn" : "default"} />
          </div>
          {blown.length > 0 && fastReal && (
            <Insight
              tone="bad"
              title={`${blown.map((x) => METHODS[x.m].short).join(" і ")}: вибух`}
              simple={
                <>
                  Найшвидший процес тут має характерний час ~{fmt(1 / Math.abs(lamFast), 2)} од., а метод крокує по {fmt(hEff, 3)} — у{" "}
                  {times(hEff * Math.abs(lamFast))} довше. Він «перестрибує» рівновагу, і кожен перестрибок у {times(Math.abs(1 + hEff * lamFast))} більший за
                  попередній. Щоб явний Ейлер вижив на всьому відрізку, крок має бути менший за {fmt(hEuler, 2)} — це{" "}
                  {Math.round(dP.T / hEuler).toLocaleString("uk-UA")} {plural(Math.round(dP.T / hEuler), ["крок", "кроки", "кроків"])}.{" "}
                  <Relatable kind="steps" n={dP.T / hEuler} />
                </>
              }
            >
              Найшвидше власне число в рівновазі <Tex>{`\\lambda \\approx ${fmt(lamFast, 5)}`}</Tex>, тож <Tex>{`h\\lambda \\approx ${fmt(hEff * lamFast, 4)}`}</Tex> — далеко за
              межами області стійкості (явний Ейлер: <Tex>{"[-2, 0]"}</Tex>, RK4: <Tex>{"\\approx[-2.785, 0]"}</Tex>). Похибка множиться на{" "}
              <Tex>{`|1 + h\\lambda| \\approx ${fmt(Math.abs(1 + hEff * lamFast), 4)}`}</Tex> на кожному кроці. Уздовж траєкторії ще гірше: на піку{" "}
              <Tex>{"u_1"}</Tex> якобіан має <Tex>{`\\lambda \\approx -u_1^2 \\approx ${fmt(-lamTraj.neg, 4)}`}</Tex>, тож щоб явний Ейлер пережив увесь відрізок, потрібно{" "}
              <Tex>{`h < 2/|\\lambda|_{\\max} \\approx ${fmt(hEuler, 3)}`}</Tex> (RK4: <Tex>{`h < ${fmt(2.785 / lamTraj.neg, 3)}`}</Tex>), а не{" "}
              <Tex>{`${fmt(2 / Math.abs(lamFast), 3)}`}</Tex>, як підказує сама рівновага.
            </Insight>
          )}
          {blown.length > 0 && !fastReal && (
            <Insight
              tone="bad"
              title="Явні методи вибухнули"
              simple={
                <>
                  Крок {fmt(hEff)} завеликий: на найрізкіших ділянках траєкторії система змінюється так швидко, що явному Ейлеру потрібен крок менший за{" "}
                  {fmt(hEuler, 3)}. Зменште h або візьміть неявний метод.
                </>
              }
            >
              Крок {fmt(hEff)} завеликий для найшвидших мод уздовж траєкторії: <Tex>{`\\min\\operatorname{Re}\\lambda \\approx ${fmt(-lamTraj.neg, 4)}`}</Tex>, тож явному
              Ейлеру потрібно <Tex>{`h < ${fmt(hEuler, 3)}`}</Tex> (див. панель жорсткості нижче). Зменшіть h або візьміть неявний метод.
            </Insight>
          )}
          {newtonFail.length > 0 && (
            <Insight
              tone="warn"
              title="Ньютон не знайшов yₙ₊₁"
              simpleTitle="Неявний метод не зміг зробити крок"
              simple={
                <>
                  {newtonFail.map((x) => METHODS[x.m].short).join(", ")}: на ділянці, де X лавиноподібно розмножується, система не заспокоюється, а «розганяється»
                  з темпом до ≈ {fmt(lamTraj.pos, 3)} за одиницю часу — на один крок це h·λ₊ ≈ {fmt(hEff * lamTraj.pos, 3)}, а неявний крок надійний, лише
                  коли це число помітно менше 1. Інакше рівняння для наступної точки може просто не мати розв&apos;язку поруч. Неявність рятує від згасаючих швидких процесів, але не від розгону — тут потрібен
                  змінний крок.
                </>
              }
            >
              {newtonFail.map((x) => METHODS[x.m].short).join(", ")}: на ділянці вибухового зростання <Tex>{"u_1"}</Tex> (автокаталіз{" "}
              <Tex>{"2X+Y\\to 3X"}</Tex>) якобіан має <b>додатне</b> власне число — уздовж еталонної траєкторії до{" "}
              <Tex>{`\\lambda_+ \\approx ${fmt(lamTraj.pos, 3)}`}</Tex>, тобто <Tex>{`h\\lambda_+ \\approx ${fmt(hEff * lamTraj.pos, 3)}`}</Tex>. При <Tex>{"h\\lambda_+ \\gtrsim 1"}</Tex>{" "}
              неявне рівняння кроку може взагалі не мати розв&apos;язку поблизу. Неявність рятує від жорсткості (<Tex>{"\\lambda \\ll 0"}</Tex>), але не від нестійкості
              самої задачі. Тут потрібен адаптивний крок — Розенброк його дрібнить лише на стрибку.
            </Insight>
          )}
          {flicker.length > 0 && (
            <Insight
              tone="warn"
              title="Неявний, але не L-стійкий"
              simpleTitle="Не вибухає — але й не заспокоюється"
              simple={
                <>
                  {flicker.map((x) => METHODS[x.m].short).join(" і ")} не розлітаються, проте стартовий стрибок вони не гасять, а «перекидають»: на кожному
                  кроці концентрація скаче то вгору, то вниз (u₂ навіть стає від&apos;ємною, чого в хімії не буває). Неявний Ейлер і BDF2 гасять стрибок за один
                  крок.
                </>
              }
            >
              {flicker.map((x) => METHODS[x.m].short).join(" і ")} не вибухають, проте похибка величезна: множник швидкої моди{" "}
              <Tex>{`R(h\\lambda)\\to ${flicker[0].m === "trap" ? "-1" : "-0.818"}`}</Tex>, і початковий стрибок не згасає, а «мерехтить» зі зміною знака від кроку
              до кроку. Неявний Ейлер і BDF2 (L-стійкі) гасять його миттєво.
            </Insight>
          )}
          {dopriS.steps > 3 * rosS.steps && (
            <Insight
              tone="info"
              title="DOPRI тупцює на місці"
              simple={
                <>
                  Навіть коли все вже плавно, явний DOPRI не наважується зробити великий крок: спробує — і швидкий процес розхитується, тож крок відкидається
                  ({dopriS.rejected} {plural(dopriS.rejected, ["раз", "рази", "разів"])}). Підсумок: {dopriS.steps} кроків проти {rosS.steps} у Розенброка — у{" "}
                  {times(dopriS.steps / Math.max(1, rosS.steps))} більше.
                </>
              }
            >
              Навіть коли розв&apos;язок уже гладкий, явний адаптивний DOPRI45 не може збільшити крок понад ~<Tex>{"3.3/|\\lambda_{\\max}|"}</Tex> — інакше втрачає
              стійкість, і контролер похибки відкидає крок ({dopriS.rejected} відхилень). Результат: {dopriS.steps} кроків проти {rosS.steps} у Розенброка.
            </Insight>
          )}
          {!eq.stable && (
            <Insight
              tone="good"
              title="Хімічний годинник цокає"
              simple={
                <>
                  Подача B = {fmt(B, 4)} більша за поріг 1 + A² = {fmt(hopfB, 4)}: стан спокою «відштовхує», і колба виходить на рівний ритм — розмах X ={" "}
                  {fmt(per.amp, 3)}
                  {Number.isFinite(per.period) ? `, один «тік» триває ≈ ${fmt(per.period, 4)}` : ""}. Що більше B понад поріг, то різкіші спалахи.
                </>
              }
            >
              <Tex>{`B = ${fmt(B, 4)} > 1 + A^2 = ${fmt(hopfB, 4)}`}</Tex>: рівновага нестійка, і траєкторія намотується на граничний цикл. Розміх{" "}
              <Tex>{`u_1`}</Tex>: {fmt(per.amp, 3)}
              {Number.isFinite(per.period) ? `, період ≈ ${fmt(per.period, 4)}` : ""}. Чим більше B відносно 1 + A², тим різкіші стрибки — коливання стають
              релаксаційними.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Колба, що цокає">
        <SceneBlock ref_={ref} r1={r1} r2={r2} T={dP.T} eq={[A, B / A]} max1={range.max1} max2={range.max2} logDefault={A >= 5} problem={problem} />
      </Section>

      <Section kicker="Біфуркація" title="Карта режимів: де живе годинник">
        <Grid>
          <Card>
            <Plot
              title="Площина параметрів (A, B), лог-шкали"
              xLabel="A"
              yLabel="B"
              height={320}
              logX
              logY
              xDomain={[0.1, 100]}
              yDomain={[0.1, 2e4]}
              underlay={hopfUnderlay}
              markers={[
                ...PRESETS.map((q) => ({ x: q.A, y: q.B, color: "rgba(255,255,255,0.55)", r: 4 })),
                { x: A, y: B, color: "#ffd166", r: 7 },
              ]}
              series={[{ ...parab, color: "#ffd166", label: "B = 1 + A² (Хопф)", width: 2.5 }]}
            />
          </Card>
          <Card title="Як читати карту" icon="🗺️">
            <Say
              simple={
                <>
                  <p className="text-[14px] leading-relaxed text-white/75">
                    Кожна точка карти — рецепт (скільки подавати A і B). Вище жовтої параболи <b>B = 1 + A²</b> колба цокає, нижче — завмирає. Біля самої
                    межі один «тік» триває ≈ 2π/A.
                  </p>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                    Рецепти з умови (A = 50) лежать глибоко в зоні тиші: щоб завести годинник, B довелося б підняти аж до 2501. Зате там швидкий процес
                    приблизно в A² = 2500 разів швидший за повільний — і що більше A, то гірше для явних методів.
                  </p>
                </>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Вище параболи <Tex>{"B = 1 + A^2"}</Tex> слід якобіана додатний — рівновага відштовхує, і з неї народжується граничний цикл (суперкритична
                біфуркація Хопфа). Прямо на порозі частота коливань дорівнює <Tex>{"\\sqrt{\\det J^*} = A"}</Tex>, тобто період <Tex>{"2\\pi/A"}</Tex>.
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                Пресети з умови (<Tex>{"A = 50"}</Tex>) лежать глибоко в зоні спокою: щоб запустити годинник, B треба було б підняти аж до 2501. Зате там
                величезна жорсткість: <Tex>{"\\lambda_1\\lambda_2 = A^2"}</Tex>, <Tex>{"\\lambda_1 + \\lambda_2 = B - 1 - A^2"}</Tex>, отже для <Tex>{"A^2 \\gg B"}</Tex>{" "}
                маємо <Tex>{"\\lambda_1 \\approx -A^2"}</Tex>, <Tex>{"\\lambda_2 \\approx -1"}</Tex>. Коефіцієнт жорсткості росте як <Tex>{"A^2"}</Tex>!
              </p>
            </Say>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="поточна точка" value={`(${fmt(A, 3)}, ${fmt(B, 3)})`} sub={eq.kind} tone={eq.stable ? "good" : "warn"} />
              <Stat label="до порогу Хопфа" value={fmt(hopfB - B, 4)} sub="1 + A² − B" />
            </div>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Жорсткість" title="Власні числа якобіана вздовж траєкторії" simpleTitle="Наскільки «нервова» реакція в кожен момент">
        <Card>
          <StiffnessPanel problem={problem} sol={ref} />
          <Say
            simple={
              <p className="mt-2 text-[13px] text-white/55">
                Графік показує, наскільки швидкі процеси живуть у колбі в кожен момент. Для рецептів з умови швидкий процес є завжди: на піку стрибка він
                у десятки тисяч разів швидший за одиницю часу, у спокої — у ≈2400 разів. У режимі годинника «нервові» ділянки трапляються лише на спалахах
                (зараз найшвидший темп ≈ {fmt(lamTraj.neg, 4)}).
              </p>
            }
          >
            <p className="mt-2 text-[13px] text-white/55">
              Для пресетів з умови швидка мода <Tex>{"\\approx -u_1^2"}</Tex>: від −10⁴…−3·10⁴ на піку стрибка до ≈ −2400 у рівновазі — жорсткість тут не епізодична,
              а постійна. У режимі годинника картина інша — жорсткість «вмикається» лише на окремих ділянках циклу (поточний максимум{" "}
              <Tex>{`|\\operatorname{Re}\\lambda| \\approx ${fmt(lamTraj.neg, 4)}`}</Tex>).
            </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Результати" title="Задача з умови: A = 50, h = 0.1, t ∈ [0, 10]" simpleTitle="Хто як упорався із задачею з умови">
        <Card>
          <Table
            head={["Метод", ...table.map((r) => `B = ${r.b}`)]}
            rows={[
              ...(["euler", "rk4", "ieuler", "trap", "theta", "bdf2"] as MethodId[]).map((m, j) => [
                <span key={m} style={{ color: METHODS[m].color }}>
                  {METHODS[m].name}
                </span>,
                ...table.map(({ cells }) => {
                  const { s, e } = cells[j];
                  if (s.failed) return <span className="text-[#ff5d73]">{s.failed.includes("Ньютона") ? "🌀 Ньютон" : "💥 вибух"}</span>;
                  return <span className={e > 10 ? "text-[#ff5d73]" : e > 1 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>{fmt(e, 3)}</span>;
                }),
              ]),
              ...(["dopri", "ros"] as MethodId[]).map((m, j) => [
                <span key={m} style={{ color: METHODS[m].color }}>
                  {METHODS[m].name} (rtol 10⁻⁴)
                </span>,
                ...table.map(({ ad }) => (
                  <span className="text-white/75">
                    {ad[j].steps} кр. / {ad[j].rejected} відх.
                  </span>
                )),
              ]),
            ]}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                У клітинках — найбільший промах метода (порівняно з дуже точним розрахунком). Явні методи вибухають одразу. Трапеції і θ-метод не вибухають, але
                стартовий стрибок «перекидають» туди-сюди — промахи в десятки й сотні одиниць. Неявний Ейлер і BDF2 гасять стрибок за один крок; їхній
                промах (до ~2) набирається пізніше, коли X швидко сповзає від ≈130 назад до 50 — крок 0.1 для цього грубуватий.
              </p>
            }
          >
            <p className="mt-3 text-[13px] text-white/55">
              Клітинки — максимальна (за обома компонентами) похибка відносно еталону (Розенброк, rtol = 10⁻⁸). За кілька тисячних концентрація{" "}
              <Tex>{"u_1"}</Tex> підскакує від 50 майже до <Tex>{"A + B"}</Tex> (на швидкій стадії зберігається <Tex>{"u_1 + u_2"}</Tex>), і жоден метод із кроком 0.1
              цей стрибок точно не відтворить. Трапеції та θ-метод його не гасять, тож їхня похибка — від стартового стрибка (максимум уже при{" "}
              <Tex>{"t \\le 0.6"}</Tex>). L-стійкі неявний Ейлер і BDF2 гасять стрибок за крок, а найбільшу похибку набирають пізніше — на швидкому сповзанні{" "}
              <Tex>{"u_1"}</Tex> від <Tex>{"\\approx A + B"}</Tex> до <Tex>{"A"}</Tex>: у BDF2 максимум на другому кроці, у неявного Ейлера (похибка{" "}
              <Tex>{"O(h)"}</Tex>) — біля <Tex>{"t \\approx 1"}</Tex>.
            </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Під мікроскопом" title="Один крок методу — покроково" report={false}>
        <StepDebugger
          f={F_DBG}
          y0={Y0_DBG}
          T={10}
          view={DBG_VIEW}
          h0={0.1}
          hMin={0.0002}
          hMax={0.2}
          hPresets={[0.1, 0.01, 0.0005]}
          hPresetsLabel="Кроки для порівняння"
          hint={
            <Say
              simple={
                <>
                  Колба з умови: A = 50, B = 80, крок 0.1. На старті X не згасає, а лавиноподібно розмножується (u₁ росте зі швидкістю ≈ {fmt(dbg.du1, 3)} за
                  одиницю часу), а після спалаху найшвидший процес у колбі в {fmt(-0.1 * dbg.fast.hi, 3)}–{fmt(-0.1 * dbg.fast.lo, 4)} разів коротший за крок.
                  Натисніть «⏭ Крок» з явним Ейлером — перша ж стрілка вилітає далеко за межі картинки (u₁ ≈ {fmt(dbg.euler1, 4)}), а після другого кроку
                  числа сягають ≈ {fmt(dbg.euler2, 2)}. Тепер виберіть неявного Ейлера: один крок — і точка вже майже на «доріжці» u₁·u₂ ≈ 80 (після кроку u₁·u₂ ≈{" "}
                  {fmt(dbg.ieProd, 3)}), якою далі спокійно повзе справжній розв&apos;язок. А трапеції стрибають через доріжку туди-сюди. Стартуємо рівно з
                  умови (50, 80): крок 0.1 тут такий великий, що Ньютону доводиться «підкрадатися» до відповіді поступово — це видно в рядку під графіком.
                </>
              }
            >
              Фазова площина (u₁, u₂) при A = 50, B = 80. Старт — точка з умови (50, 80): тут <Tex>{`u_1' \\approx ${fmt(dbg.du1, 3)}`}</Tex>, а обидва
              власні числа якобіана <b>додатні</b> (<Tex>{`\\lambda \\approx ${fmt(dbg.ev0[0], 5)}`}</Tex> і <Tex>{fmt(dbg.ev0[1], 3)}</Tex> — автокаталітичний
              розгін). Явний Ейлер з h = 0.1 першим же кроком закидає точку до <Tex>{`u_1 \\approx ${fmt(dbg.euler1, 4)}`}</Tex>, другим — до{" "}
              <Tex>{`|u| \\approx ${fmt(dbg.euler2, 2)}`}</Tex>. Після піку стрибка швидке власне число вздовж траєкторії — від {fmt(dbg.fast.lo, 5)} до{" "}
              {fmt(dbg.fast.hi, 4)} (<Tex>{`h\\lambda \\approx ${fmt(0.1 * dbg.fast.lo, 4)}\\ldots${fmt(0.1 * dbg.fast.hi, 3)}`}</Tex>), далеко за межами
              областей стійкості явних методів. L-стійкі неявний Ейлер і BDF2 (його перший крок — крок неявного Ейлера) за один крок падають майже на
              повільний многовид u₁u₂ ≈ B: після кроку u₁u₂ ≈ {fmt(dbg.ieProd, 3)}. Залишок швидкої моди не нульовий, бо R(hλ) = 1/(1 − hλ) → 0 лише при
              hλ → −∞, і з меншим кроком він більший. Трапеції (R(−∞) = −1) і θ-метод (θ = 0.55, R(−∞) ≈ −0.82) швидку моду не гасять, а перекидають
              через многовид: після першого кроку u₁u₂ ≈ {fmt(dbg.trapProd, 4)} і {fmt(dbg.thetaProd, 4)}, а далі точка стрибає з одного його боку на
              інший. З точки старту при h = 0.1 Ньютон із
              наближенням yₙ для неявного Ейлера, θ-методу й BDF2 не збігається, тому корінь знаходиться продовженням за параметром hb (позначка під
              графіком); трапеціям вистачає звичайного Ньютона.
            </Say>
          }
        />
      </Section>

      <Section kicker="Пісочниця" title="Долийте реактиву — і подивіться, як колба знайде свій ритм" report={false}>
        <PhasePlayground
          f={F_PG}
          init={Y0_PG}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          speed={3}
          speedRange={[0.3, 15]}
          trail={15}
          strip={[
            { comp: 0, label: "u₁ (X)", color: "#ffb347" },
            { comp: 1, label: "u₂ (Y)", color: "#7f9bff" },
          ]}
          window={30}
          kicks={[
            { label: "Долити X", emoji: "🧪", apply: (y) => [y[0] + 2, y[1]], hint: "u₁ += 2" },
            { label: "Долити Y", emoji: "💧", apply: (y) => [y[0], y[1] + 2], hint: "u₂ += 2" },
            { label: "Поставити в рівновагу", emoji: "⚖️", apply: () => [1.001, 3], hint: "u₁ = 1.001, u₂ = 3" },
          ]}
          underlay={pgUnderlay}
          hint={
            <Say
              simple={
                <>
                  Тут годинник цокає: A = 1, B = 3 (поріг 1 + A² = 2). Клацніть будь-де — траєкторія, звідки б не стартувала, намотується на одну й ту саму
                  петлю: колба сама знаходить свій ритм (один оберт ≈ 7.2 од. часу). Долийте X чи Y — петля та сама. А з червоної точки рівноваги колба
                  повільно «зісковзує» і теж виходить на петлю.
                </>
              }
            >
              Брюсселятор при A = 1, B = 3: рівновага (1, 3) — нестійкий фокус (λ = 0.5 ± 0.866i), а траєкторії з будь-якої точки притягує граничний цикл
              (u₁ ∈ [0.37, 3.75], u₂ ∈ [0.85, 4.72], період ≈ 7.16). Пунктири — нульклини u₁′ = 0 (помаранчева) та u₂′ = 0 (синя).
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="18"
          questions={[
            {
              id: "euler-h01",
              q: <>Колба з умови (A = 50, B = 80), крок h = 0.1. Що буде з явним Ейлером і RK4?</>,
              options: [
                "Нічого страшного — рівновага ж стійка",
                "Вибухнуть за 1–2 кроки",
                "Вибухнуть десь посередині, біля t ≈ 5",
                "RK4 вибухне, а Ейлер доживе до кінця",
              ],
              correct: 1,
              explain: (
                <>
                  У рівновазі hλ₁ ≈ −242, а на піку стрибка (u₁ ≈ 130) hλ ≈ −1700 — у сотні разів за межами областей стійкості ([−2, 0] і ≈[−2.785, 0]). Поріг
                  10⁶ RK4 перетинає вже на першому кроці (|u₁| ~ 10⁹¹), явний Ейлер — на другому (u₁ ≈ 2·10⁴, потім 7.5·10¹¹).
                </>
              ),
              explainSimple: (
                <>
                  Стійкість рівноваги методу не допомагає: він крокує в сотні разів довше, ніж триває швидкий процес. Перший же крок Ейлера закидає X до ≈20 000,
                  другий — до ≈10¹². RK4 «злітає» ще на першому.
                </>
              ),
              show: {
                label: "Показати A = 50, B = 80, h = 0.1",
                run: () => {
                  setP({ A: 50, B: 80, u10: 50, u20: 80, T: 10 });
                  setH(0.1);
                  setMethods((ms) => Array.from(new Set([...ms, "euler", "rk4", "ieuler"])) as MethodId[]);
                },
              },
            },
            {
              id: "trap-flicker",
              q: <>Метод трапецій A-стійкий і має 2-й порядок точності. Що він покаже на тій самій задачі (A = 50, B = 80, h = 0.1)?</>,
              options: [
                "Вибухне, як явні методи",
                "Найточніший результат серед методів з фіксованим кроком",
                "Не вибухне, але похибка понад 100, і u₂ скаче через нуль",
                "Метод Ньютона не зійдеться вже на першому кроці",
              ],
              correct: 2,
              explain: (
                <>
                  R(z) = (1 + z/2)/(1 − z/2) → −1 при z → −∞: швидка мода не гасне, а змінює знак щокроку. Перший крок дає (135.7, −9.96), другий (98.1, 20.9);
                  максимальна похибка ≈ 148 (при t = 0.4), навіть при t = 5 ще ≈ 26. Неявний Ейлер (R(−∞) = 0) — ≈ 1.4, BDF2 — ≈ 0.44.
                </>
              ),
              explainSimple: (
                <>
                  Трапеції не розлітаються, але стартовий стрибок не гасять — він перекидається то вгору, то вниз, і Y навіть стає від&apos;ємною. Промах — ≈148
                  одиниць, тоді як неявний Ейлер помиляється лише на ≈1.4.
                </>
              ),
              show: {
                label: "Показати трапеції при h = 0.1",
                run: () => {
                  setP({ A: 50, B: 80, u10: 50, u20: 80, T: 10 });
                  setH(0.1);
                  setMethods(["ieuler", "trap", "bdf2", "ros"]);
                },
              },
            },
            {
              id: "hopf-a1",
              q: <>Тепер A = 1. З якого значення подачі B колба почне блимати сама (граничний цикл)?</>,
              options: ["B > 1", "B > 2", "B > 3", "За будь-якого B — це ж хімічний годинник"],
              correct: 1,
              explain: (
                <>
                  Слід якобіана в рівновазі tr J* = B − 1 − A² змінює знак при B = 1 + A² = 2 (біфуркація Хопфа), а det J* = A² &gt; 0. Чисельно: при B = 1.9
                  коливання згасають до (1, 1.9), при B = 2.5 виходять на цикл з періодом ≈ 6.58 (біля порога він ≈ 2π/A ≈ 6.28).
                </>
              ),
              explainSimple: (
                <>
                  Поріг — B = 1 + A² = 2. Трохи нижче (B = 1.9) колба поблимає й заспокоїться, трохи вище (B = 2.5) — блиматиме вічно, один «тік» ≈ 6.6 од.
                  часу. Перевірте повзунком у сцені «Хімічний світлофор» угорі.
                </>
              ),
              show: {
                label: "Показати A = 1, B = 2.5",
                run: () => {
                  setP({ A: 1, B: 2.5, u10: 1, u20: 1, T: 50 });
                  setH(0.1);
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
            title="Явні методи з h = 0.1 — без шансів"
            simple={
              <>
                Явний метод питає «куди рухаємося зараз?» і йде туди на 0.1 — а швидкий процес у колбі завершується за тисячні частки. Він перестрибує, і
                кожен стрибок більший за попередній: Ейлер вибухає на другому кроці, RK4 — на першому. Щоб вижити, потрібен крок ~0.00012 — понад 80 000
                кроків заради кривої, що виглядає як плавна експонента. <Relatable kind="steps" n={83000} />
              </>
            }
          >
            У рівновазі <Tex>{"h\\lambda_1 \\approx -240"}</Tex>, що в сотню разів за межею стійкості, а на піку стрибка (<Tex>{"u_1 \\approx 130"}</Tex>,{" "}
            <Tex>{"\\lambda \\approx -u_1^2"}</Tex>) — аж <Tex>{"h\\lambda \\approx -1700"}</Tex>. Явний Ейлер вибухає вже на другому кроці, RK4 — на першому. Щоб вони
            вижили, потрібен крок <Tex>{"h \\lesssim 2/|\\lambda|_{\\max} \\approx 1.2\\cdot10^{-4}"}</Tex> (для B = 80) — понад 80 000 кроків на <Tex>{"[0,10]"}</Tex> для
            розв&apos;язку, що після першої тисячної виглядає як плавна експонента. Оцінка за рівноважним λ (<Tex>{"h < 8\\cdot10^{-4}"}</Tex>, 12 500 кроків) тут оманлива.
          </Insight>
          <Insight
            tone="good"
            title="L-стійкі неявні: неявний Ейлер і BDF2"
            simple={
              <>
                Неявні методи питають «куди ми прийдемо через крок?» — і тому не перестрибують. Стрибок на старті вони «проковтують» за один крок, а далі
                акуратно повзуть уздовж доріжки u₁·u₂ ≈ B до спокою. Промах — лише через грубуватий крок.
              </>
            }
          >
            Стрибок на старті гаситься за один крок, далі розв&apos;язок повзе по повільному многовиду — це синя нульклина <Tex>{"u_2' = 0"}</Tex>, тобто{" "}
            <Tex>{"u_1u_2 \\approx B"}</Tex> (швидка змінна тут <Tex>{"u_2"}</Tex>, а вздовж многовиду <Tex>{"u_1' \\approx A - u_1"}</Tex>) — з точністю порядку h.
          </Insight>
          <Insight
            tone="warn"
            title="A-стійкий ≠ корисний"
            simple={
              <>
                Трапеції і θ-метод не вибухають, але швидкий стрибок не гасять, а перекидають туди-сюди, як м&apos;ячик, що не хоче зупинятися. Звідси промахи
                від десятка до майже двох сотень одиниць. Для таких задач метод має вміти саме гасити швидкі процеси.
              </>
            }
          >
            Трапеції і θ = 0.55 стійкі, але <Tex>{"|R(-\\infty)| = 1"}</Tex> та <Tex>{"0.82"}</Tex>: швидка компонента не згасає, а перекидається зі знаком —
            похибки від десятка (θ) до сотні з гаком (трапеції) одиниць. Для жорстких задач потрібна L-стійкість.
          </Insight>
          <Insight
            tone="info"
            title="Адаптивність виграє"
            simple={
              <>
                Розенброк сам дрібнить крок лише на стрибку, а потім крокує широко — кілька сотень кроків. DOPRI теж підбирає крок, але як явний метод боїться
                розхитати швидкий процес — і робить близько десяти тисяч кроків. Коли явному методу заважає не точність, а «страх вибухнути», — це і є жорсткість.
              </>
            }
          >
            Розенброк робить кілька сотень кроків, DOPRI45 — десяток тисяч: він обмежений не точністю, а стійкістю. Це і є практичне означення жорсткої задачі.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Борис Білоусов відкрив «блимаючу» реакцію в 1951 р., але журнали відмовлялися її друкувати: мовляв, так не буває. Брюсселятор Пригожина показав,
                що буває — якщо безперервно підживлювати систему. У 1977 р. Пригожин отримав за це Нобелівську премію з хімії.
              </>
            }
          >
            Перший хімічний годинник відкрив Борис Білоусов у 1951 р., але журнали відмовлялися друкувати «неможливу» реакцію — мовляв, вона порушує другий
            закон термодинаміки. Брюсселятор Пригожина показав, що коливання можливі далеко від рівноваги, і в 1977 р. Пригожин отримав Нобелівську премію з
            хімії за теорію дисипативних структур.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function SceneBlock({
  ref_,
  r1,
  r2,
  T,
  eq,
  max1,
  max2,
  logDefault,
  problem,
}: {
  ref_: Solution;
  r1: number[];
  r2: number[];
  T: number;
  eq: [number, number];
  max1: number;
  max2: number;
  logDefault: boolean;
  problem: Problem;
}) {
  const pb = usePlayback(14);
  const [logTime, setLogTime] = useState(logDefault);
  const [lastDefault, setLastDefault] = useState(logDefault);
  if (lastDefault !== logDefault) {
    setLastDefault(logDefault);
    setLogTime(logDefault);
  }
  const t0 = Math.max(1e-5, ref_.t[1] ?? 1e-5);
  const t = logTime ? t0 * Math.pow(T / t0, pb.progress) : pb.progress * T;
  const u1 = sampleAt(ref_.t, r1, t);
  const u2 = sampleAt(ref_.t, r2, t);
  const dot1 = problem.f(t, [u1, u2])[0];
  const series = useMemo(
    () => [
      { x: ref_.t, y: r1, color: "#ffb347", label: "u₁ (X)", width: 2 },
      { x: ref_.t, y: r2, color: "#7f9bff", label: "u₂ (Y)", width: 2 },
    ],
    [ref_, r1, r2],
  );
  const series0 = useMemo(() => series.map((s) => ({ ...s, x: s.x.slice(1), y: s.y.slice(1) })), [series]);
  return (
    <Grid>
      <Card>
        <ChemClockScene t={pb.progress * 60} u1={u1} u2={u2} u1Max={max1} u2Max={max2} eq={eq} dot1={dot1} />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${fmt(t, 3)}`} />
        </div>
        <div className="mt-3">
          <Toggle label="Логарифмічний час (щоб побачити стрибок на старті)" value={logTime} onChange={setLogTime} />
        </div>
      </Card>
      <Card>
        <Plot
          title="Концентрації (еталон)"
          xLabel="t"
          height={300}
          logX={logTime}
          xDomain={logTime ? [t0, T] : undefined}
          cursorX={t}
          markers={[
            { x: t, y: u1, color: "#ffb347" },
            { x: t, y: u2, color: "#7f9bff" },
          ]}
          series={logTime ? series0 : series}
        />
        <Say
          simple={
            <p className="mt-2 text-[13px] leading-relaxed text-white/60">
              Колір розчину — скільки в колбі X і скільки Y (помаранчевий ↔ синій), кульки — молекули. Стрілка циферблата показує, куди «відхилилась» колба від
              стану спокою: у режимі годинника вона крутиться по колу, у спокійному — завмирає в центрі. Спалах — момент, коли X змінюється найшвидше.
            </p>
          }
        >
          <p className="mt-2 text-[13px] leading-relaxed text-white/60">
            Колір розчину — частка X і Y (помаранчевий ↔ синій), кульки — молекули, стрілка циферблата — кут точки <Tex>{"(u_1, u_2)"}</Tex> відносно рівноваги.
            У режимі годинника стрілка обертається, у стійкому — завмирає в центрі. Спалах колби — момент найшвидшої зміни <Tex>{"u_1"}</Tex>.
          </p>
        </Say>
      </Card>
    </Grid>
  );
}
