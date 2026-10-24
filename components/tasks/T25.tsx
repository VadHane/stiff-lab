"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import Plot3D from "@/components/plot/Plot3D";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import IslandScene from "@/components/scenes/IslandScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs, sup } from "@/lib/format";
import { eigenvalues } from "@/lib/linalg";
import { METHODS } from "@/lib/methods";
import { cached } from "@/lib/stiffc-cache";
import { isAdaptive, isExplicit, sampleAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import IslandRescueScene from "@/components/analogy/IslandRescueScene";
import { Say } from "@/components/mode/Mode";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

type Form = "orig" | "log";
const ALL: MethodId[] = ["bdf2", "ieuler", "trap", "theta", "euler", "rk2", "rk3", "rk4", "ros", "dopri"];
const LN10 = Math.LN10;
const STIFF_SAMPLES = 200;
const PRESETS = [
  { id: "task", label: "Умова: (2, 10, 0.1), ε = 0.01", y0: [2, 10, 0.1], eps: 0.01 },
  { id: "eps05", label: "Те саме, ε = 0.05", y0: [2, 10, 0.1], eps: 0.05 },
  { id: "eq", label: "Стійка рівновага, ε = 0.1", y0: [1, 1, 0.5], eps: 0.1 },
  { id: "near", label: "Біля рівноваги, ε = 0.01", y0: [0.5, 1.5, 0.7], eps: 0.01 },
];

function makeProblem(form: Form, eps: number, y0: number[], T: number): Problem {
  if (form === "orig")
    return {
      f: (_t, [u, v, th]) => [u * (1 - 0.5 * u - (2 * v) / (7 * th * th)), v * (2 * th - 3.5 * th * th * u - 0.5 * v), eps * (2 - 7 * th * u)],
      jac: (_t, [u, v, th]) => {
        const g = 1 - 0.5 * u - (2 * v) / (7 * th * th),
          k = 2 * th - 3.5 * th * th * u - 0.5 * v;
        return [
          [g - 0.5 * u, (-2 * u) / (7 * th * th), (4 * u * v) / (7 * th * th * th)],
          [-3.5 * th * th * v, k - 0.5 * v, v * (2 - 7 * th * u)],
          [-7 * eps * th, 0, -7 * eps * u],
        ];
      },
      y0,
      T,
    };
  return {
    f: (_t, [w, z, th]) => {
      const u = Math.exp(w),
        v = Math.exp(z);
      return [1 - 0.5 * u - (2 * v) / (7 * th * th), 2 * th - 3.5 * th * th * u - 0.5 * v, eps * (2 - 7 * th * u)];
    },
    jac: (_t, [w, z, th]) => {
      const u = Math.exp(w),
        v = Math.exp(z);
      return [
        [-0.5 * u, (-2 * v) / (7 * th * th), (4 * v) / (7 * th * th * th)],
        [-3.5 * th * th * u, -0.5 * v, 2 - 7 * th * u],
        [-7 * eps * th * u, 0, -7 * eps * u],
      ];
    },
    y0: [Math.log(y0[0]), Math.log(y0[1]), y0[2]],
    T,
  };
}

/** Eigenvalues of the Jacobian at the start, sorted by Re (in (ln u, ln v, θ) the Jacobian is taken at (ln u₀, ln v₀, θ₀)). */
function startEig(form: Form, eps: number, y0: number[]) {
  const p = makeProblem(form, eps, y0, 1);
  return eigenvalues(p.jac!(0, p.y0)).sort((a, b) => a.re - b.re);
}
/** "−6.05, −0.0427 ± 8.08i": eigenvalues with conjugate pairs merged (TeX or plain text). */
const evList = (ev: { re: number; im: number }[], tex = false) =>
  ev
    .map((e) => `${fmt(e.re, 3)}${e.im ? `${tex ? " \\pm " : " ± "}${fmt(Math.abs(e.im), 3)}i` : ""}`)
    .filter((s, i, a) => a.indexOf(s) === i)
    .join(tex ? ",\\ " : ", ");
/** The task's start (2, 10, 0.1), ε = 0.01: eigenvalues in (u, v, θ) (≈ −287, −9.8, −0.421) and in (ln u, ln v, θ) (≈ −6.05, −0.0427 ± 8.08i). */
const EV0 = startEig("orig", 0.01, [2, 10, 0.1]);
const EV0_LOG = startEig("log", 0.01, [2, 10, 0.1]);
const LAM0 = Math.abs(EV0[0].re);
const STIFF0 = LAM0 / Math.abs(EV0[EV0.length - 1].re);
/** |1 + hλ| of explicit Euler with the task's h = 0.2 for the complex pair in (ln u, ln v, θ) at the start. */
const EULER_PAIR0 = Math.hypot(1 + 0.2 * EV0_LOG[1].re, 0.2 * EV0_LOG[1].im);

interface View {
  t: number[];
  lnU: number[];
  lnV: number[];
  th: number[];
  /** points with u < 0 or v < 0 (only possible in (u, v, θ)), and separately with u < 0 and with v < 0 */
  neg: number;
  negU: number;
  negV: number;
}
function view(form: Form, s: Solution): View {
  let neg = 0,
    negU = 0,
    negV = 0;
  const lnU: number[] = [],
    lnV: number[] = [];
  for (const y of s.y) {
    if (form === "log") {
      lnU.push(y[0]);
      lnV.push(y[1]);
    } else {
      if (y[0] < 0) negU++;
      if (y[1] < 0) negV++;
      if (y[0] < 0 || y[1] < 0) neg++;
      lnU.push(y[0] > 0 ? Math.log(y[0]) : NaN);
      lnV.push(y[1] > 0 ? Math.log(y[1]) : NaN);
    }
  }
  return { t: s.t, lnU, lnV, th: s.y.map((y) => y[2]), neg, negU, negV };
}
/** "u, v < 0" / "u < 0" / "v < 0" — which populations went negative. */
const negLabel = (v: View) => (v.negU > 0 && v.negV > 0 ? "u, v < 0" : v.negU > 0 ? "u < 0" : "v < 0");
/** Lowest positive u of a run, in decades (NaN when u is never positive). */
function minLgPos(v: View): number {
  let m = Infinity;
  for (const x of v.lnU) if (Number.isFinite(x) && x < m) m = x;
  return Number.isFinite(m) ? m / LN10 : NaN;
}
const FIXED_IMPLICIT: MethodId[] = ["bdf2", "ieuler", "trap", "theta"];

/** First time u recovers above 1 after having dropped below 1e-3. */
function revival(v: View): number {
  let low = false;
  for (let k = 0; k < v.t.length; k++) {
    if (!low && v.lnU[k] < Math.log(1e-3)) low = true;
    if (low && v.lnU[k] > 0) return v.t[k];
  }
  return NaN;
}

/** Ukrainian plural form: 1 точка, 2 точки, 5 точок. */
function plural(n: number, one: string, few: string, many: string) {
  const a = n % 100,
    b = n % 10;
  return b === 1 && a !== 11 ? one : b >= 2 && b <= 4 && (a < 12 || a > 14) ? few : many;
}
const nPts = (n: number) => `${n.toLocaleString("uk-UA")} ${plural(n, "точка", "точки", "точок")}`;
/** "у 59 точках", "у 21 точці" */
const nPtsLoc = (n: number) => `${n.toLocaleString("uk-UA")} ${plural(n, "точці", "точках", "точках")}`;
const nTimes = (n: number) => `${n} ${plural(n, "раз", "рази", "разів")}`;
/** "0.4…7" (or a single time) */
const span = (a: number, b: number) => (a === b ? fmt(a, 4) : `${fmt(a, 4)}…${fmt(b, 4)}`);
const names = (rs: { m: MethodId }[]) => rs.map(({ m }) => METHODS[m].short).join(", ");

/**
 * Sign history of a run in (u, v, θ). On a steep decay (h|g| large, g = 1 − u/2 − 2v/(7θ²)) the trapezoid and θ = 0.55 flip the sign of
 * u every step (uₙ₊₁/uₙ = (1 + (1−θ)h gₙ)/(1 − θh gₙ₊₁) < 0 for h|gₙ| > 2 and > 2.22), and BDF2 jumps through zero whenever |u| drops more
 * than fourfold in a step (c = (4uₙ − uₙ₋₁)/3 < 0). Once the decay slows down the sign freezes, and its value when θ first exceeds 8/7
 * (the bottom of the dip) decides the run: u > 0 — an early revival, u < 0 — growth along the non-physical branch. Which one depends on
 * how many flips there were, i.e. on h (task: BDF2 with h = 0.2 and 0.19 ends positive, with 0.15, 0.12, 0.1 negative). Implicit Euler
 * never flips: uₙ₊₁ = uₙ/(1 − h gₙ₊₁) with g < 1.
 */
interface Signs {
  /** number of sign changes of u before θ first exceeds 8/7 (the whole run if it never does) and the time of the last one */
  flips: number;
  tLast: number;
  /** sign of u when θ first exceeds 8/7 on this run (0 if it never does) */
  bottom: number;
  /** first and last time with u < 0 and with v < 0 (NaN if none) */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}
function signs(s: Solution): Signs {
  let flips = 0,
    tLast = NaN,
    u0 = NaN,
    u1 = NaN,
    v0 = NaN,
    v1 = NaN,
    bottom = 0,
    crossed = false;
  for (let k = 0; k < s.y.length; k++) {
    const [u, v, th] = s.y[k];
    if (u < 0) {
      if (Number.isNaN(u0)) u0 = s.t[k];
      u1 = s.t[k];
    }
    if (v < 0) {
      if (Number.isNaN(v0)) v0 = s.t[k];
      v1 = s.t[k];
    }
    // sign changes on the way down only (up to the bottom of the dip)
    if (!crossed && k > 0 && (u < 0) !== (s.y[k - 1][0] < 0)) {
      flips++;
      tLast = s.t[k];
    }
    if (!crossed && th > 8 / 7) {
      crossed = true;
      bottom = Math.sign(u);
    }
  }
  return { flips, tLast, bottom, u0, u1, v0, v1 };
}

function errors(v: View, ref: View) {
  let du = 0,
      dth = 0;
  const eU: number[] = [],
    eTh: number[] = [];
  for (let k = 0; k < v.t.length; k++) {
    const a = Math.abs(v.lnU[k] - sampleAt(ref.t, ref.lnU, v.t[k])) / LN10;
    const b = Math.abs(v.th[k] - sampleAt(ref.t, ref.th, v.t[k]));
    const aa = Number.isFinite(a) ? a : Infinity;
    eU.push(Number.isFinite(a) ? Math.max(a, 1e-14) : NaN);
    eTh.push(Math.max(b, 1e-14));
    if (!(aa <= du)) du = aa;
    if (!(b <= dth)) dth = b;
  }
  return { du, dth, eU, eTh };
}

/** BDF2 local-error estimate: C₃ = −2/9, LTE ≈ (2/9)|Δ³y|. */
function bdf2Lte(s: Solution) {
  const t: number[] = [],
    e: number[] = [];
  for (let n = 3; n < s.y.length; n++) {
    let m = 0;
    for (let i = 0; i < 3; i++) m = Math.max(m, Math.abs(s.y[n][i] - 3 * s.y[n - 1][i] + 3 * s.y[n - 2][i] - s.y[n - 3][i]));
    t.push(s.t[n]);
    e.push(Math.max((2 / 9) * m, 1e-16));
  }
  return { t, e };
}

function run(m: MethodId, form: Form, eps: number, y0: number[], T: number, h: number, tol: number): Solution {
  const key = `T25|${m}|${form}|${eps}|${y0.join(",")}|${T}|${isAdaptive(m) ? tol : h}`;
  return cached(key, () => {
    const p = makeProblem(form, eps, y0, T);
    if (isAdaptive(m)) return solve(m, p, { rtol: tol, atol: tol * 1e-3, maxSteps: 100000, blowup: 1e6 });
    return solve(m, p, { h, blowup: 1e6 });
  });
}
function reference(eps: number, y0: number[], T: number): View {
  return cached(`T25|ref|${eps}|${y0.join(",")}|${T}`, () => view("log", solve("ros", makeProblem("log", eps, y0, T), { rtol: 1e-9, atol: 1e-10, maxSteps: 400000 })));
}

const lg = (a: number[]) => a.map((v) => v / LN10);
/** 10 to an integer power with a superscript exponent, e.g. 10⁻⁸² */
const p10 = (lgv: number) => `10${sup(String(Math.round(lgv)))}`;
/** "10⁻³³" or "10⁻³³…10⁻³⁶" for a list of depths in decades */
const p10Range = (d: number[]) => (Math.max(...d) - Math.min(...d) >= 1 ? `${p10(Math.max(...d))}…${p10(Math.min(...d))}` : p10(Math.min(...d)));
const tex10Range = (d: number[]) =>
  Math.max(...d) - Math.min(...d) >= 1 ? `10^{${Math.round(Math.max(...d))}}\\ldots10^{${Math.round(Math.min(...d))}}` : `10^{${Math.round(Math.min(...d))}}`;
/** "201" or "197.4…209.8" for a list of revival times */
const tRange = (r: number[]) => (Math.max(...r) - Math.min(...r) < 0.05 ? fmt(Math.min(...r), 4) : `${fmt(Math.min(...r), 4)}…${fmt(Math.max(...r), 4)}`);
/** Runs in (u, v, θ) that crossed zero and then left along the non-physical branch (u → −2/3, v, θ → ∞) until a Newton failure or a blow-up. */
const ranOff = (s: Solution) =>
  !!s.failed && (s.failed.includes("Ньютона") || s.failed.includes("вибухнув")) && s.y[s.y.length - 1][0] < 0 && s.y[s.y.length - 1][1] > 1e3;
/** how such a run ended */
const offHow = (s: Solution) => (s.failed?.includes("Ньютона") ? "відмова Ньютона" : "вибух");
/** g = 1 − u/2 − 2v/(7θ²): the per-capita growth rate of the prey (u′ = u·g) */
const gRate = (u: number, v: number, th: number) => 1 - 0.5 * u - (2 * v) / (7 * th * th);
/** The task's setup with the step from the problem statement. */
const TASK = { eps: 0.01, y0: [2, 10, 0.1], T: 500, h: 0.2 };

/** One fixed-step run in (u, v, θ) with what the texts need (the solve itself is cached). */
function origRun(m: MethodId, eps: number, y0: number[], T: number, h: number) {
  const s = run(m, "orig", eps, y0, T, h, 1e-4);
  const v = view("orig", s);
  return { m, s, v, rev: revival(v), sg: signs(s), depth: minLgPos(v) };
}
/**
 * The task in (u, v, θ) for the quiz «bdf2orig»: BDF2 with h = 0.2 (the results table solves the same, so it is cached) and with h = 0.1,
 * implicit Euler with h = 0.2. Called only when the quiz explanation is shown (≈ 30 ms for BDF2 with h = 0.1).
 */
function taskOrigFacts() {
  const { eps, y0, T, h } = TASK;
  const ref = reference(eps, y0, T);
  return {
    refRev: revival(ref),
    minLgU: Math.min(...ref.lnU) / LN10,
    bdf: origRun("bdf2", eps, y0, T, h),
    bdfHalf: origRun("bdf2", eps, y0, T, h / 2),
    ie: origRun("ieuler", eps, y0, T, h),
  };
}

/** Quiz «bdf2orig» explanation (both modes), with the numbers computed for the task's setup. */
function Bdf2OrigWhy({ simple = false }: { simple?: boolean }) {
  const F = useMemo(taskOrigFacts, []);
  const { bdf, bdfHalf, ie, refRev, minLgU } = F;
  const { y0, h } = TASK;
  /** h|g| at the start (≈ 57.1): exact factor e^{−h|g|}, implicit Euler 1/(1 + h|g|), BDF2 |ζ| = (3 + 2h|g|)^{−1/2} */
  const hg0 = h * Math.abs(gRate(y0[0], y0[1], y0[2]));
  const earlyPct = Math.round((1 - bdf.rev / refRev) * 100);
  const u1 = bdf.s.y[1][0],
    u2 = bdf.s.y[2][0];
  const plus = bdf.sg.bottom > 0;
  const halfOff = ranOff(bdfHalf.s) && bdfHalf.sg.bottom < 0;
  const halfEnd = bdfHalf.s.t[bdfHalf.s.t.length - 1];
  if (simple)
    return (
      <>
        Метод не бачить провалу на {Math.round(-minLgU)} {plural(Math.round(-minLgU), "порядок", "порядки", "порядків")}: поки кролики вимирають стрімко, за крок він зменшує їх лише в десятки разів, а не в{" "}
        {p10(hg0 / LN10)} разів, як насправді, — і в нього їх лишається ~{p10(bdf.depth)}. Тож кролики «відроджуються» на {earlyPct} % раніше — при t ≈{" "}
        {fmt(bdf.rev, 3)} замість {fmt(refRev, 3)}. До того ж BDF2 не стежить за знаком: на крутому спаді кроликів кілька разів стає «мінус» (а наприкінці —
        лисиць). Тут кролики на дні провалу опинилися «{plus ? "в плюсі" : "в мінусі"}»
        {halfOff ? (
          <>
            , а з кроком {fmt(h / 2, 2)} — «в мінусі»: тоді «від&apos;ємні кролики» розмножуються, і розрахунок ламається при t ≈ {fmt(halfEnd, 4)}. Менший крок
            тут не рятує
          </>
        ) : null}
        . Неявний Ейлер знака не губить, але й у нього кролики «прокидаються» зарано — при t ≈ {fmt(ie.rev, 3)}.
      </>
    );
  return (
    <>
      BDF2 доходить до кінця, але у {nPtsLoc(bdf.v.neg)} u чи v від&apos;ємні (u — на старті, t ≈ {span(bdf.sg.u0, bdf.sg.u1)}; v — при t ≈ {span(bdf.sg.v0, bdf.sg.v1)},
      коли вимирають уже лисиці), а «відродження» настає при t ≈ {fmt(bdf.rev, 4)} — на {earlyPct} % раніше за еталон. Причина перша — мілкий провал. На
      старті h|g| ≈ {fmt(hg0, 3)}: точний розв&apos;язок за крок множить u на e<sup>−h|g|</sup> ≈ {p10(-hg0 / LN10)}, а неявні схеми гасять швидкий розпад лише
      алгебраїчно — неявний Ейлер ділить u на 1 + h|g| ≈ {fmt(1 + hg0, 3)}, BDF2 (|ζ| = (3 + 2h|g|)<sup>−1/2</sup>) — лише на ~{fmt(Math.sqrt(3 + 2 * hg0), 2)}. Тож u
      падає тільки до ~{p10(bdf.depth)} замість {p10(minLgU)}, і затримку втрати стійкості метод «відробляє» значно швидше. Причина друга — BDF2 не зберігає
      додатність: після першого кроку u ≈ {fmt(u1, 3)}, а другий дає u ≈ {fmt(u2, 3)}, бо (4·{fmt(u1, 3)} − {fmt(y0[0], 3)})/3 &lt; 0. Поки спад крутий, знак u
      змінюється {nTimes(bdf.sg.flips)} (до t ≈ {fmt(bdf.sg.tLast, 3)}), а далі застигає — тут на дні провалу u {plus ? ">" : "<"} 0.
      {halfOff && (
        <>
          {" "}
          З h = {fmt(h / 2, 2)} знак застигає «в мінусі»: після θ &gt; 8/7 «від&apos;ємні кролики» розмножуються, розв&apos;язок тікає на нефізичну гілку (u → −2/3, v
          → ∞), і при t ≈ {fmt(halfEnd, 4)} — {offHow(bdfHalf.s)}: менший крок тут не рятує.
        </>
      )}{" "}
      Неявний Ейлер знак береже і з h = {fmt(h, 2)} дає t* ≈ {fmt(ie.rev, 4)} — теж зарано, зате без жодного «мінуса».
    </>
  );
}

export default function T25() {
  const [form, setForm] = useState<Form>("log");
  const [eps, setEps] = useState(0.01);
  const [y0, setY0] = useState<number[]>([2, 10, 0.1]);
  const [T, setT] = useState(500);
  const [h, setH] = useState(0.2);
  const [tol, setTol] = useState(1e-4);
  const [methods, setMethods] = useState<MethodId[]>(["bdf2", "rk4", "ros"]);
  const de = useDeferredValue(eps);
  const dy0 = useDeferredValue(y0);
  const dT = useDeferredValue(T);
  const dh = useDeferredValue(h);
  const dtol = useDeferredValue(tol);
  const ensureMethods = (...ms: MethodId[]) => setMethods((cur) => [...cur, ...ms.filter((m) => !cur.includes(m))]);
  const taskSetup = () => {
    setY0([2, 10, 0.1]);
    setEps(0.01);
    setT(500);
    setH(0.2);
  };

  const ref = useMemo(() => reference(de, dy0, dT), [de, dy0, dT]);
  const refRev = useMemo(() => revival(ref), [ref]);

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s = run(m, form, de, dy0, dT, dh, dtol);
        const v = view(form, s);
        return { m, s, v, err: errors(v, ref), rev: revival(v), sg: form === "orig" ? signs(s) : null, depth: minLgPos(v) };
      }),
    [methods, form, de, dy0, dT, dh, dtol, ref],
  );

  const bdf = sols.find((r) => r.m === "bdf2");
  const lte = useMemo(() => (bdf && bdf.s.steps > 3 ? bdf2Lte(bdf.s) : null), [bdf]);

  const marks = useMemo(() => {
    const out: { at: number; label: string }[] = [];
    let uLow = false,
      vLow = false,
      thCross = false;
    for (let k = 0; k < ref.t.length; k++) {
      const t = ref.t[k];
      if (!uLow && ref.lnU[k] < Math.log(1e-3)) {
        uLow = true;
        out.push({ at: t, label: "🐇 майже вимерли" });
      } else if (uLow && ref.lnU[k] > 0) {
        uLow = false;
        out.push({ at: t, label: "🐇 відродження!" });
      }
      if (!vLow && ref.lnV[k] < Math.log(1e-3)) {
        vLow = true;
        out.push({ at: t, label: "🦊 майже вимерли" });
      } else if (vLow && ref.lnV[k] > 0) {
        vLow = false;
        out.push({ at: t, label: "🦊 повернулися" });
      }
      if (!thCross && ref.th[k] > 8 / 7) {
        thCross = true;
        out.push({ at: t, label: "θ > 8/7: u = 0 нестійке" });
      }
    }
    return out;
  }, [ref]);
  const tLoss = marks.find((m) => m.label.startsWith("θ > 8/7"))?.at;
  const minLgU = Math.min(...ref.lnU) / LN10;
  const minLgV = Math.min(...ref.lnV.filter(Number.isFinite)) / LN10;
  const tMinU = ref.t[ref.lnU.indexOf(Math.min(...ref.lnU))];
  /** Eigenvalues of the interior equilibrium (0.4, 10/7, 5/7) for the current ε (Hopf at ε* ≈ 0.081). */
  const eqEig = useMemo(() => eigenvalues(makeProblem("orig", de, [1, 1, 1], 1).jac!(0, [0.4, 10 / 7, 5 / 7])), [de]);
  const eqStable = eqEig.every((e) => e.re < 0);
  /** Eigenvalues at the current start (u₀, v₀, θ₀) and ε: in (u, v, θ) and in (ln u, ln v, θ). */
  const ev0 = useMemo(() => ({ orig: startEig("orig", de, dy0), log: startEig("log", de, dy0) }), [de, dy0]);
  const evFast0 = ev0.orig.reduce((a, b) => (Math.abs(b.re) > Math.abs(a.re) ? b : a));
  const lam0 = Math.abs(evFast0.re);
  const logMod0 = ev0.log.map((e) => Math.hypot(e.re, e.im));
  /** The log substitution removes the fast decay only when the start is stiff in (u, v, θ) (true for the task: 287 vs ~8). */
  const logTamed = lam0 > 2 * Math.max(...logMod0);
  /** Explicit Euler steps on [0, T] under the start bound h < 2/|λ| (in (u, v, θ) the fast eigenvalue is real). */
  const eulerSteps0 = Math.ceil((dT * lam0) / 2);
  /** Quality of a run: error of the revival time when the reference has one, otherwise max|Δθ|. */
  const quality = (err: { dth: number }, rev: number, rr = refRev): "good" | "warn" | "bad" => {
    if (Number.isFinite(rr)) {
      if (!Number.isFinite(rev)) return "bad";
      const rel = Math.abs(rev - rr) / rr;
      return rel < 0.01 ? "good" : rel < 0.05 ? "warn" : "bad";
    }
    return err.dth > 0.5 ? "bad" : err.dth > 0.05 ? "warn" : "good";
  };
  const QCOL = { good: "text-[#3ee6a8]", warn: "text-[#ffb547]", bad: "text-[#ff5d73]" };
  /** Lower bounds (in decades) of lg u / lg v over the reference and all non-failed runs — nothing gets clipped. */
  const floors = useMemo(() => {
    let u = minLgU,
      v = minLgV;
    for (const { s, v: vw } of sols) {
      if (s.failed) continue;
      for (const x of vw.lnU) if (Number.isFinite(x) && x / LN10 < u) u = x / LN10;
      for (const x of vw.lnV) if (Number.isFinite(x) && x / LN10 < v) v = x / LN10;
    }
    return { u: Math.min(u, -1) - 5, v: Math.min(v, -1) - 5 };
  }, [sols, minLgU, minLgV]);

  const uSeries = useMemo(
    () => [
      { x: ref.t, y: lg(ref.lnU), color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      ...sols.map(({ m, s, v }) => ({ x: v.t, y: lg(v.lnU), color: METHODS[m].color, label: METHODS[m].short, width: s.failed ? 1 : 1.6, opacity: s.failed ? 0.5 : 1 })),
    ],
    [ref, sols],
  );
  const vSeries = useMemo(
    () => [
      { x: ref.t, y: lg(ref.lnV), color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      ...sols.map(({ m, s, v }) => ({ x: v.t, y: lg(v.lnV), color: METHODS[m].color, label: METHODS[m].short, width: s.failed ? 1 : 1.6, opacity: s.failed ? 0.5 : 1 })),
    ],
    [ref, sols],
  );
  const thSeries = useMemo(
    () => [
      { x: [0, dT], y: [8 / 7, 8 / 7], color: "#ffb547", width: 1, dash: [5, 4], label: "θ = 8/7", noRange: true },
      { x: [0, dT], y: [1 / 7, 1 / 7], color: "#5cc8ff", width: 1, dash: [5, 4], label: "θ = 1/7", noRange: true },
      { x: ref.t, y: ref.th, color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      ...sols.map(({ m, s, v }) => ({ x: v.t, y: v.th, color: METHODS[m].color, width: s.failed ? 1 : 1.6, opacity: s.failed ? 0.5 : 1 })),
    ],
    [ref, sols, dT],
  );
  const phase = useMemo(
    () => [
      { x: lg(ref.lnU), y: lg(ref.lnV), color: "#7cf29c", width: 2.4, fade: true, label: "еталон" },
      ...sols.map(({ m, v }) => ({ x: lg(v.lnU), y: lg(v.lnV), color: METHODS[m].color, width: 1, opacity: 0.6 })),
    ],
    [ref, sols],
  );
  const curves3d = useMemo(() => {
    const step = Math.max(1, Math.floor(ref.t.length / 3000));
    const pts: [number, number, number][] = [];
    for (let i = 0; i < ref.t.length; i += step) pts.push([Math.max(ref.lnU[i] / LN10, -120), Math.max(Number.isFinite(ref.lnV[i]) ? ref.lnV[i] / LN10 : -120, -120), ref.th[i]]);
    return [{ pts, colors: ["#7cf29c", "#ff7ad9"] as [string, string], width: 2 }];
  }, [ref]);

  /**
   * The results table solves all 8 methods in both forms (16 runs, ≈ 0.1 s for the task in node) plus implicit Euler and BDF2 in
   * (u, v, θ) with half the step (`half`, ≈ 50 ms). It follows ε, y₀ and T only after they have settled for 250 ms, so dragging a slider
   * stays responsive.
   */
  const [tabArgs, setTabArgs] = useState({ eps: de, y0: dy0, T: dT });
  const tabStale = tabArgs.eps !== de || tabArgs.y0 !== dy0 || tabArgs.T !== dT;
  useEffect(() => {
    if (!tabStale) return;
    const id = setTimeout(() => setTabArgs({ eps: de, y0: dy0, T: dT }), 250);
    return () => clearTimeout(id);
  }, [tabStale, de, dy0, dT]);
  /** the table's own reference (the same cached solve as `ref` once the table has caught up) */
  const tabRef = useMemo(() => reference(tabArgs.eps, tabArgs.y0, tabArgs.T), [tabArgs]);
  const tabRefRev = useMemo(() => revival(tabRef), [tabRef]);
  const tabMinLgU = useMemo(() => Math.min(...tabRef.lnU) / LN10, [tabRef]);
  const tabLoss = useMemo(() => {
    const k = tabRef.th.findIndex((th) => th > 8 / 7);
    return k >= 0 ? tabRef.t[k] : undefined;
  }, [tabRef]);
  const table = useMemo(
    () =>
      (["orig", "log"] as Form[]).map((fm) =>
        ALL.map((m) => {
          const s = run(m, fm, tabArgs.eps, tabArgs.y0, tabArgs.T, 0.2, 1e-4);
          const v = view(fm, s);
          return { s, v, err: errors(v, tabRef), rev: revival(v) };
        }),
      ),
    [tabArgs, tabRef],
  );
  /**
   * The table's setting with half its step (h = 0.1) in (u, v, θ): implicit Euler's revival moves towards the reference (first order),
   * while BDF2's sign of u at the bottom of the dip may come out the other way (task: negative — the non-physical branch and a blow-up).
   */
  const half = useMemo(
    () => ({ ie: origRun("ieuler", tabArgs.eps, tabArgs.y0, tabArgs.T, 0.1), bdf: origRun("bdf2", tabArgs.eps, tabArgs.y0, tabArgs.T, 0.1) }),
    [tabArgs],
  );

  const refStiff = useMemo(() => {
    const s: Solution = {
      method: "ros",
      t: ref.t,
      y: ref.t.map((_, k) => [Math.exp(ref.lnU[k]), Math.exp(ref.lnV[k]), ref.th[k]]),
      hs: [],
      steps: ref.t.length - 1,
      rejected: 0,
      fevals: 0,
      jevals: 0,
      ms: 0,
    };
    return { s, p: makeProblem("orig", de, dy0, dT) };
  }, [ref, de, dy0, dT]);

  const presetId = PRESETS.find((p) => p.eps === eps && p.y0.every((v, i) => v === y0[i]))?.id ?? "";
  const explBlow = sols.filter(({ m, s }) => isExplicit(m) && s.failed);
  /** Runs in (u, v, θ) that went below zero (explicit blow-ups are covered by their own insight). */
  const origNeg = form === "orig" ? sols.filter(({ m, s, v }) => v.neg > 0 && !(isExplicit(m) && s.failed)) : [];
  const uFin = Math.exp(ref.lnU[ref.lnU.length - 1]);
  /** In (u, v, θ): is the start alone outside the explicit Euler bound h|λ| < 2? (False e.g. for the "near equilibrium" preset with h = 0.2.) */
  const startStiff = dh * lam0 > 2;
  const explFailT = explBlow.length ? Math.min(...explBlow.map(({ s }) => s.t[s.t.length - 1])) : NaN;
  /** Fixed-step implicit / adaptive runs among origNeg. */
  const implNeg = origNeg.filter(({ m }) => FIXED_IMPLICIT.includes(m));
  const adaptNeg = origNeg.filter(({ m }) => isAdaptive(m));
  /**
   * The prey's own rate at the start, g₀ = 1 − u₀/2 − 2v₀/(7θ₀²) (task: −285.7, i.e. h|g₀| ≈ 57.1 for h = 0.2), and the per-step factors
   * for it, z = h·g₀: exact e^z, implicit Euler 1/(1 − z), trapezoid and θ = 0.55. uSteep — the prey's start is steep enough for the
   * trapezoid to flip the sign of u (h|g₀| > 2); for e.g. θ₀ = 2 the fast start belongs to the predators, not the prey.
   */
  const zStart = dh * gRate(dy0[0], dy0[1], dy0[2]);
  const uSteep = zStart < -2;
  const rTrap0 = (1 + zStart / 2) / (1 - zStart / 2);
  const rTheta0 = (1 + 0.45 * zStart) / (1 - 0.55 * zStart);
  /** selected trapezoid / θ-method runs that went negative while their factor for the start's fast decay is negative (sign flips every step) */
  const flipMs = [...(rTrap0 < 0 ? ["trap" as MethodId] : []), ...(rTheta0 < 0 ? ["theta" as MethodId] : [])].filter((m) => implNeg.some((r) => r.m === m));
  /** what makes the selected implicit methods cross zero on the start's steep decay (plain words) */
  const crossWhy = [
    flipMs.length
      ? `${flipMs.map((m) => (m === "trap" ? "трапеції" : "θ-метод")).join(" і ")} ${flipMs.length > 1 || flipMs[0] === "trap" ? "перекидають" : "перекидає"} знак кроликів щокроку`
      : "",
    implNeg.some(({ m }) => m === "bdf2") ? "BDF2 «перестрибує» через нуль щоразу, коли кроликів чи лисиць (без зміни знака) за крок стає менше більш ніж учетверо" : "",
  ]
    .filter(Boolean)
    .join(", а ");
  /** implicit runs whose u changed sign and had frozen on one side by the time θ exceeded 8/7 */
  const frozen = implNeg.filter(({ sg }) => !!sg && sg.flips > 0 && sg.bottom !== 0);
  const frozenPlus = frozen.filter(({ sg }) => sg!.bottom > 0);
  const frozenMinus = frozen.filter(({ sg }) => sg!.bottom < 0);
  const frozenLast = frozen.length ? Math.max(...frozen.map(({ sg }) => sg!.tLast)) : NaN;
  /** implicit runs that went negative yet revived (too early: the dip is shallow) and their depths in decades */
  const implEarly = implNeg.filter(({ s, rev }) => !s.failed && Number.isFinite(rev) && Number.isFinite(refRev) && rev < 0.95 * refRev);
  const earlyDepths = implEarly.map(({ depth }) => depth).filter((d) => d < -3);
  const offBranch = origNeg.filter(({ s }) => ranOff(s));
  /** implicit runs that went negative and stopped for another reason (e.g. a Newton failure while u > 0) */
  const implStop = implNeg.filter(({ s }) => !!s.failed && !ranOff(s));
  const offEnd = offBranch.length ? offBranch[0].s.y[offBranch[0].s.y.length - 1] : null;
  /**
   * u → −2/3 on the non-physical branch: with u < 0 the trait θ grows, v ≈ 4θ + 14θ²/3, and u′ ∝ u(1 − u/2 − 2v/(7θ²)) settles where the
   * bracket vanishes.
   */
  const nearTwoThirds = !!offEnd && Math.abs(offEnd[0] + 2 / 3) < 0.05;
  /** BDF2 in (u, v, θ): the first negative u or v and the BDF2 right-hand part c = (4yₙ − yₙ₋₁)/3 of that step. */
  const bdfNeg = useMemo(() => {
    if (form !== "orig" || !bdf) return null;
    const y = bdf.s.y;
    for (let k = 1; k < y.length; k++) {
      const i = y[k][0] < 0 ? 0 : y[k][1] < 0 ? 1 : -1;
      if (i < 0) continue;
      return {
        i,
        /** for u: with v ≥ 0 at the new point the u-equation u(1 − ⅔h·g) = c_u has no positive root when c_u < 0 (g < 1, h < 1.5) */
        vPos: y[k][1] >= 0,
        t: bdf.s.t[k],
        val: y[k][i],
        t0: k >= 2 ? bdf.s.t[k - 2] : NaN,
        t1: bdf.s.t[k - 1],
        a: k >= 2 ? y[k - 2][i] : NaN,
        b: y[k - 1][i],
        c: k >= 2 ? (4 * y[k - 1][i] - y[k - 2][i]) / 3 : NaN,
      };
    }
    return null;
  }, [form, bdf]);
  const bdfEndU = bdf ? bdf.s.y[bdf.s.y.length - 1][0] : NaN;
  const bdfDepth = bdf ? bdf.depth : NaN;
  /** BDF2's sign history of u, told only when its first negative value was u (then the later flips continue that story) */
  const bdfSg = bdf?.sg && bdfNeg?.i === 0 && bdf.sg.flips > 1 ? bdf.sg : null;
  /**
   * Implicit Euler in (u, v, θ): its step uₙ₊₁ = uₙ/(1 − h gₙ₊₁) keeps u > 0, but on the steep part of the decay (h|g| > 1 along the
   * reference, task with h = 0.2: up to t ≈ 4.9) it loses most of the dip — the reference drops 62 decades there, implicit Euler 17.
   * With half the step it gets closer to the reference (first order; that extra solve is skipped when it would take over 12 500 steps).
   */
  const ieR = form === "orig" ? sols.find(({ m }) => m === "ieuler") : undefined;
  const ieInfo = useMemo(() => {
    if (!ieR || ieR.s.failed) return null;
    const kMin = ref.lnU.indexOf(Math.min(...ref.lnU));
    let k1 = -1;
    for (let k = 0; k <= kMin; k++) if (-dh * gRate(Math.exp(ref.lnU[k]), Math.exp(ref.lnV[k]), ref.th[k]) > 1) k1 = k;
    const tSteep = k1 > 0 ? ref.t[k1] : NaN;
    const lgU0 = Math.log10(dy0[0]);
    const halfH = dh / 2;
    return {
      tSteep,
      refDrop: k1 > 0 ? lgU0 - ref.lnU[k1] / LN10 : NaN,
      ieDrop: k1 > 0 ? lgU0 - sampleAt(ieR.v.t, ieR.v.lnU, tSteep) / LN10 : NaN,
      halfH,
      /** at most 12 500 steps (≈ 40 ms): with h = 0.2 on [0, 500] that is h/2 = 0.1; skipped for small h or long T */
      half: halfH >= 0.02 && dT / halfH <= 12500 ? origRun("ieuler", de, dy0, dT, halfH) : null,
    };
  }, [ieR, ref, dh, de, dy0, dT]);
  const ieHalfCloser =
    !!ieR &&
    !!ieInfo?.half &&
    Number.isFinite(ieInfo.half.rev) &&
    Number.isFinite(ieR.rev) &&
    Number.isFinite(refRev) &&
    Math.abs(ieInfo.half.rev - refRev) < Math.abs(ieR.rev - refRev);
  /** Results table, (u, v, θ), fixed-step implicit methods (h = 0.2): early revivals vs runs that went negative and ended with a Newton failure or a blow-up. */
  const tabOrig = useMemo(() => FIXED_IMPLICIT.map((m) => ({ m, ...table[0][ALL.indexOf(m)], sg: signs(table[0][ALL.indexOf(m)].s) })), [table]);
  const tabEarly = tabOrig.filter(({ s, rev }) => !s.failed && Number.isFinite(rev) && Number.isFinite(tabRefRev) && rev < 0.95 * tabRefRev);
  const tabOff = tabOrig.filter(({ s }) => ranOff(s));
  /** how deep the early revivals got (decades) */
  const tabDepths = tabEarly.map(({ v }) => minLgPos(v)).filter((d) => d < -3);
  /** implicit methods of the table that kept the sign (implicit Euler) / that produced negative u or v */
  const tabKeep = tabOrig.filter(({ s, v }) => !s.failed && v.neg === 0);
  const tabLose = tabOrig.filter(({ v }) => v.neg > 0);
  /** …and among the latter, whether u itself crossed zero on the way down and reached the bottom of the dip (θ = 8/7) with some sign */
  const tabSignStory = tabLose.some(({ sg }) => sg.flips > 0 && sg.bottom !== 0);
  const tabIe = tabOrig[FIXED_IMPLICIT.indexOf("ieuler")];
  const tabBdf = tabOrig[FIXED_IMPLICIT.indexOf("bdf2")];
  /** half the table's step: does implicit Euler get closer to the reference, does BDF2 leave the physical branch? */
  const halfIeCloser =
    Number.isFinite(half.ie.rev) && Number.isFinite(tabIe.rev) && Number.isFinite(tabRefRev) && Math.abs(half.ie.rev - tabRefRev) < Math.abs(tabIe.rev - tabRefRev);
  const halfBdfOff = ranOff(half.bdf.s);
  const fateOf = (r: { s: Solution; v: View; rev: number }) =>
    ranOff(r.s)
      ? `іде через «мінус» на нефізичну гілку й ламається при t ≈ ${fmt(r.s.t[r.s.t.length - 1], 4)} (${offHow(r.s)})`
      : r.s.failed
        ? `зупиняється при t ≈ ${fmt(r.s.t[r.s.t.length - 1], 4)}`
        : Number.isFinite(r.rev) && Number.isFinite(tabRefRev)
          ? `${minLgPos(r.v) > tabMinLgU + 1 ? `опускає кроликів лише до ${p10(minLgPos(r.v))} і ` : ""}«відроджує» їх при t ≈ ${fmt(r.rev, 4)} замість ${fmt(tabRefRev, 4)}${r.v.neg > 0 ? ` (у ${nPtsLoc(r.v.neg)} популяції від'ємні)` : " (без жодного «мінуса»)"}`
          : r.v.neg > 0
            ? `дає від'ємні популяції у ${nPtsLoc(r.v.neg)}`
            : "справляється";
  /** When an explicit run in (u, v, θ) fails although the start is within the bound: max|Re λ| along the reference up to the failure. */
  const lamToFail = useMemo(() => {
    if (form !== "orig" || startStiff || !Number.isFinite(explFailT)) return null;
    const { s, p } = refStiff;
    let mx = 0,
      tAt = 0;
    for (let i = 0; i < s.t.length && s.t[i] <= explFailT; i++) {
      const v = Math.max(...eigenvalues(p.jac!(s.t[i], s.y[i])).map((e) => Math.abs(e.re)));
      if (v > mx) {
        mx = v;
        tAt = s.t[i];
      }
    }
    return { mx, tAt };
  }, [form, startStiff, explFailT, refStiff]);
  /**
   * What the stiffness panel shows (same samples, same cut of |Re λ| ≤ 10⁻¹¹·max as zero): the fastest mode, the panel's max ratio with
   * the prey density there, and the stretch where a mode is cut (u so small that the θ-mode −7εu falls below the cut).
   */
  const panelInfo = useMemo(() => {
    const { s, p } = refStiff;
    const n = s.t.length;
    let fast = 0,
      tFast = 0,
      r = 0,
      tR = 0,
      uR = NaN,
      cut0 = NaN,
      cut1 = NaN;
    for (let k = 0; k < STIFF_SAMPLES; k++) {
      const i = Math.floor((k / (STIFF_SAMPLES - 1)) * (n - 1));
      const a = eigenvalues(p.jac!(s.t[i], s.y[i])).map((e) => Math.abs(e.re));
      const top = Math.max(...a);
      const m = a.filter((v) => v > 1e-300 && v > 1e-11 * top);
      if (!m.length) continue;
      if (m.length < a.length) {
        if (Number.isNaN(cut0)) cut0 = s.t[i];
        cut1 = s.t[i];
      }
      if (top > fast) {
        fast = top;
        tFast = s.t[i];
      }
      const q = Math.max(...m) / Math.min(...m);
      if (q > r) {
        r = q;
        tR = s.t[i];
        uR = s.y[i][0];
      }
    }
    return { fast, tFast, r, tR, uR, cut0, cut1, prey: uR > 0 && uR < 1e-3 };
  }, [refStiff]);

  const analogy = useMemo(
    () => (
      <>
        <AnalogyCard
          emoji="🏝️"
          title="Кролики, лисиці та повільна еволюція «хижості»"
          story={
            <>
              На острові живуть кролики й лисиці. Спершу лисиці — вправні мисливці, і за лічені одиниці часу кроликів стає в десятки порядків менше: до 10⁻⁸²,
              менше за «один атом кролика на весь Всесвіт». Але лисиці повільно еволюціонують: їхня ознака θ росте, і тиск на кроликів слабшає. Уже при t ≈ 52
              острів для кроликів безпечний — а відроджуються вони лише при t ≈ 345: стільки часу треба, щоб «вибратися з ями» глибиною 82 порядки. Швидка
              екологія плюс повільна еволюція — і задача стає жорсткою.
            </>
          }
          mapping={[
            ["кролики (жертви)", <>u</>],
            ["лисиці (хижаки)", <>v</>],
            ["«мисливський талант» лисиць, що змінюється поколіннями", <>ознака θ: тиск на кроликів ∝ 1/θ²</>],
            ["екологія — швидко, еволюція — повільно", <>ε = 0.01: θ змінюється в ~100 разів повільніше</>],
            ["«майже нуль» кроликів, але не нуль", <>u до 10⁻⁸² — тому рахуємо в ln u</>],
          ]}
        >
          <IslandRescueScene />
        </AnalogyCard>
      </>
    ),
    // static block (only stable setters inside): keep it out of slider-driven re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const extras = useMemo(() => {
    /**
     * Quiz «bdf2orig», the right option: BDF2 with h = 0.2 in (u, v, θ) for the task's setup — the same cached solve as the results table
     * (computed just above for the default setting on the first render), so it costs nothing extra.
     */
    const bdf2OrigOption = (() => {
      const { eps, y0, T, h } = TASK;
      const r = origRun("bdf2", eps, y0, T, h);
      const rr = revival(reference(eps, y0, T));
      return `Від'ємні популяції, а відродження — на ${Math.round((1 - r.rev / rr) * 100)} % раніше (t ≈ ${fmt(r.rev, 3)})`;
    })();
    return (
      <>
        <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
          <QuizBlock
            taskId="25"
            questions={[
              {
                id: "bdf2orig",
                q: <>Метод Гіра (BDF2) з h = 0.2 у змінних з методички (u, v, θ) — рівно як вимагає завдання. Що побачимо, якщо в еталоні кролики відроджуються при t* ≈ 345?</>,
                options: ["Майже еталон: відродження при t ≈ 345", "💥 Вибух на першому ж кроці", bdf2OrigOption, "Кролики не відродяться зовсім"],
                correct: 2,
                explain: <Bdf2OrigWhy />,
                explainSimple: <Bdf2OrigWhy simple />,
                show: {
                  label: "Показати BDF2 у (u, v, θ)",
                  run: () => {
                    taskSetup();
                    setForm("orig");
                    ensureMethods("bdf2");
                  },
                },
              },
              {
                id: "eulerlog",
                q: <>А тепер явний Ейлер з тим самим кроком h = 0.2, але в змінних (ln u, ln v, θ). Що буде?</>,
                options: ["💥 Вибухне, як у змінних (u, v, θ)", "Виживе: відродження при t ≈ 364 замість 345", "Ідеальний збіг з еталоном", "Дасть від'ємних кроликів"],
                correct: 1,
                explain: (
                  <>
                    У лог-змінних немає «вимирального» темпу −{fmt(LAM0, 3)}: на старті власні числа ≈ {evList(EV0_LOG)} (для пари |1 + hλ| ≈{" "}
                    {fmt(EULER_PAIR0, 2)} — нестійко, але лише на першому кроці), а вже при t ≈ 0.2 найбільше |λ| ≈ 2.6 (два інші ≈ 0), тобто h|λ| ≈ 0.5. Межу h|λ| = 2
                    еталон перетинає лише при θ &gt; 5 (t ≳ 245): лисиць там v ≈ 4θ, і крок Ейлера для ln v множить відхилення на 1 − 2hθ, |1 − 2hθ| &gt; 1 (максимум h|λ|
                    ≈ 2.7 при t ≈ 335). Тож lg v тремтить з періодом 2 (≈ 0.90 ↔ 1.61 навколо lg 4θ ≈ 1.39 при t ≈ 300), але не тікає: для великих v крок сам
                    тягне ln v униз. Ейлер не вибухає й проходить [0, 500] за 2 500 кроків. Точність, однак, 1-го порядку: мінімум lg u ≈ −89 замість −82, і
                    відродження запізнюється на 5.6 % (t* ≈ 364). Від&apos;ємних кроликів у лог-змінних не буває: u = eʷ &gt; 0.
                  </>
                ),
                explainSimple: (
                  <>
                    У логарифмах немає «вимирального» темпу {fmt(LAM0, 3)} — на старті найшвидший процес лише ~{fmt(Math.hypot(EV0_LOG[1].re, EV0_LOG[1].im), 1)}, і
                    крок 0.2 для нього майже весь час прийнятний: крок × темп менше 2 аж до t ≈ 245. Лише потім, коли лисиць стає багато, розрахунок лисиць
                    «тремтить» (крок × темп до ≈ 2.7), але не вибухає. Ейлер живе, але неточний: кролики відроджуються при t ≈ 364 замість 345. А від&apos;ємних кроликів у логарифмах не буває взагалі.
                  </>
                ),
                show: {
                  label: "Показати Ейлера в лог-змінних",
                  run: () => {
                    taskSetup();
                    setForm("log");
                    ensureMethods("euler");
                  },
                },
              },
              {
                id: "delay",
                q: (
                  <>
                    Уже при t ≈ 52 ознака θ перевищує 8/7 — острів для кроликів «безпечний»: кожен кролик мав би розмножуватися. Коли кролики справді відродяться (u &gt;
                    1)?
                  </>
                ),
                options: ["Майже одразу, при t ≈ 55", "≈ 100 — через кілька десятків одиниць", "≈ 345 — майже через 300 одиниць", "Ніколи: їх стало менше за один атом"],
                correct: 2,
                explain: (
                  <>
                    Еталон: θ &gt; 8/7 при t ≈ 52.2, відродження — при t* ≈ 345.2. Це затримка втрати стійкості: ln u має «відробити» накопичений мінус
                    ∫(1 − 0.5u − 2v/(7θ²))ds, а він сягає −82·ln 10 ≈ −189. Модель неперервна, тож 10⁻⁸² — не нуль і теж росте експоненційно. Завезіть кроликів у сцені
                    «Що це в житті?» при t = 10 — провал буде лише ~10⁻¹⁵, і відродження настане вже при t ≈ 138.
                  </>
                ),
                explainSimple: <>Острів безпечний уже з t ≈ 52, але кролики впали аж до 10⁻⁸², і щоб вибратися з такої ями, треба майже 300 одиниць часу: відродження при t ≈ 345. Що глибша яма, то довше. Перевірте в сцені вгорі: завезіть кроликів при t = 10 — і вони відродяться вже при t ≈ 138.</>,
                show: {
                  label: "Показати еталон",
                  run: () => {
                    taskSetup();
                    setForm("log");
                    ensureMethods("ros");
                  },
                },
              },
            ]}
          />
        </Section>
      </>
    );
    // static block (only stable setters inside): keep it out of slider-driven re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {analogy}

      <Section kicker="Постановка" title="Хижак, жертва і еволюція ознаки" simpleTitle="Лисиці, кролики і повільна еволюція">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`\begin{aligned} \frac{du}{dt} &= u\Bigl(1 - 0.5\,u - \frac{2}{7\theta^2}\,v\Bigr),\\ \frac{dv}{dt} &= v\bigl(2\theta - 3.5\,\theta^2 u - 0.5\,v\bigr),\\ \frac{d\theta}{dt} &= \varepsilon\,(2 - 7\,\theta\, u),\end{aligned}`}</Tex>
            <Say
              simple={
                <p className="mt-1 text-[14px] leading-relaxed text-white/75">
                  u — скільки кроликів, v — скільки лисиць, θ — ознака лисиць, що повільно змінюється з поколіннями (у множнику ε = 0.01). Що менше θ, то
                  небезпечніші лисиці: їхній «тиск» на кроликів 2v/(7θ²). Старт: 2 кролики, 10 лисиць, θ = 0.1 (тобто лисиці дуже небезпечні); рахуємо до t = 500
                  методом Гіра (BDF2) з кроком 0.2.
                </p>
              }
            >
            <p className="mt-1 text-[14px] leading-relaxed text-white/75">
              <Tex>{"\\varepsilon = 0.01"}</Tex>, <Tex>{"u(0)=2,\\ v(0)=10,\\ \\theta(0)=0.1"}</Tex>, <Tex>{"0 \\le t \\le 500"}</Tex>; метод Гіра 2-го порядку (BDF2) з кроком{" "}
              <Tex>{"h = 0.2"}</Tex>. <Tex>{"u"}</Tex> — чисельність жертв, <Tex>{"v"}</Tex> — хижаків, <Tex>{"\\theta"}</Tex> — генетична ознака хижака, що еволюціонує
              повільно (<Tex>{"\\varepsilon \\ll 1"}</Tex>).
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="Як ми прочитали умову"
                simple={
                  <>
                    У методичці формули зіпсовані при наборі (зайві символи u₁, u₂, u₃ без сенсу). Ми читаємо їх як класичну екогенетичну модель вище. Вона має
                    «красиву» точку співіснування: u = 0.4, v = 10/7, θ = 5/7 — ознака, що прочитання правильне. При поточному ε = {fmt(de, 3)} ця точка{" "}
                    {eqStable ? "стійка" : "нестійка"}; стійкою вона стає лише при ε ≳ 0.081, тож за умовою (ε = 0.01) острів ніколи в ній не заспокоюється.
                  </>
                }
              >
                У методичці формули зіпсовані при наборі: <Tex>{String.raw`u(u_2 + u_1(1 - 0.5u - \tfrac{2}{7\theta^2}v))`}</Tex> і <Tex>{String.raw`v(2\theta u_3 - \dots)`}</Tex> —
                символи <Tex>{"u_1, u_2, u_3"}</Tex> тут не мають сенсу (це артефакти). Трактуємо систему як класичну екогенетичну модель, записану вище. Перевірка
                адекватності: вона має внутрішню рівновагу з «красивими» числами <Tex>{"u^*=0.4,\\ v^*=10/7,\\ \\theta^*=5/7"}</Tex> (з <Tex>{"\\theta'=0"}</Tex>:{" "}
                <Tex>{"\\theta u = 2/7"}</Tex>; з <Tex>{"v'=0"}</Tex>: <Tex>{"v = 2\\theta"}</Tex>; тоді <Tex>{"u'=0 \\Rightarrow 1 - 5/(7\\theta) = 0"}</Tex>). Ця рівновага{" "}
                {eqStable ? "стійка" : "нестійка"} при поточному <Tex>{`\\varepsilon = ${fmt(de, 3)}`}</Tex>:{" "}
                <Tex>{`\\lambda = ${eqEig.map((e) => `${fmt(e.re, 3)}${e.im ? ` \\pm ${fmt(Math.abs(e.im), 3)}i` : ""}`).filter((s, i, a) => a.indexOf(s) === i).join(",\\ ")}`}</Tex>; стійкою вона
                стає лише при <Tex>{"\\varepsilon \\gtrsim 0.081"}</Tex> (біфуркація Хопфа), тож за умовою задачі (<Tex>{"\\varepsilon = 0.01"}</Tex>) система ніколи не заспокоюється
                в ній.
              </Insight>
            </div>
          </Card>
          <Card title="Повільно-швидка структура" icon="🐢🐇">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Чисельності змінюються за ~1 одиницю часу, ознака — за ~100. Але найшвидше на старті вимирають кролики: при θ = 0.1 тиск лисиць ≈ 286, і кролики
                  тануть як e⁻²⁸⁶ᵗ. Тож найшвидший процес (темп ≈ {fmt(LAM0, 3)}) у ~{fmt(STIFF0, 3)} разів швидший за найповільніший (≈{" "}
                  {fmt(Math.abs(EV0[EV0.length - 1].re), 2)}). <Relatable kind="ratio" n={STIFF0} /> Формула нижче — «бухгалтерія» логарифма кроликів:
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Популяції змінюються за час <Tex>{"\\sim 1"}</Tex>, ознака — за <Tex>{"\\sim 1/\\varepsilon = 100"}</Tex>. Але справжня жорсткість інша: при{" "}
              <Tex>{"\\theta(0)=0.1"}</Tex> тиск хижака на жертву <Tex>{"2v/(7\\theta^2) \\approx 286"}</Tex> — і жертви вимирають зі швидкістю <Tex>{"e^{-286 t}"}</Tex>.
              Власні числа на старті: <Tex>{`\\approx ${evList(EV0, true)}`}</Tex>, коефіцієнт жорсткості ≈ {fmt(STIFF0, 3)}.
            </p>
            </Say>
            <Tex block>{String.raw`\ln u(t) = \ln u(t_0) + \int_{t_0}^{t}\Bigl(1 - 0.5u - \frac{2v}{7\theta^2}\Bigr)ds`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Поки кроликів майже немає, лисиць ≈ 4θ, а ознака росте: θ′ ≈ 2ε. Коли θ перевищить 8/7, острів для кроликів уже безпечний — кожен кролик мав
                  би розмножуватися. Але відроджуються вони значно пізніше: спершу треба «відробити» весь накопичений мінус у логарифмі (формула вище). Це
                  <b> затримка втрати стійкості</b>: що глибше впали, то довше вибиратися.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Поки <Tex>{"u \\approx 0"}</Tex>, хижак живе на <Tex>{"v \\approx 4\\theta"}</Tex>, а ознака росте: <Tex>{"\\theta' \\approx 2\\varepsilon"}</Tex>. Стан «без жертв»
              стає нестійким при <Tex>{"1 - 8/(7\\theta) > 0 \\Leftrightarrow \\theta > 8/7"}</Tex>, але <Tex>{"u"}</Tex> відроджується значно пізніше — коли інтеграл вище
              «відробить» накопичений мінус. Це <b>затримка втрати стійкості</b> (правило рівних площ Нейштадта).
            </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Метод Гіра на острові" simpleTitle="Рахуємо острів різними методами">
        <Lab
          controls={
            <>
              <Chips
                label="Сценарій"
                value={presetId}
                onChange={(id) => {
                  const p = PRESETS.find((x) => x.id === id);
                  if (p) {
                    setY0(p.y0);
                    setEps(p.eps);
                  }
                }}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
              <Chips
                label="Змінні, в яких інтегруємо"
                value={form}
                onChange={setForm}
                options={[
                  { value: "orig", label: "(u, v, θ) — як у методичці" },
                  { value: "log", label: "(ln u, ln v, θ)" },
                ]}
              />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              {/* min 0.02: a fixed-step implicit solve in (u, v, θ) with h = 0.02 (25 000 steps) costs ≈ 85 ms in node, with h = 0.01 ≈ 170 ms — four of them would take ≈ 0.7 s */}
              <Slider label="Крок h (фіксовані методи)" value={h} onChange={setH} min={0.02} max={1} log format={(v) => fmt(v, 3)} />
              <Slider label="ε — темп еволюції" value={eps} onChange={setEps} min={0.001} max={0.3} log format={(v) => fmt(v, 3)} />
              <Slider label="u(0)" value={y0[0]} onChange={(v) => setY0([v, y0[1], y0[2]])} min={0.05} max={4} step={0.05} />
              <Slider label="v(0)" value={y0[1]} onChange={(v) => setY0([y0[0], v, y0[2]])} min={0.1} max={20} step={0.1} />
              <Slider label="θ(0)" value={y0[2]} onChange={(v) => setY0([y0[0], y0[1], v])} min={0.05} max={2} step={0.01} />
              <Slider label="Кінець T" value={T} onChange={setT} min={50} max={1000} step={10} />
              <Slider label="rtol (адаптивні)" value={tol} onChange={setTol} min={1e-7} max={1e-2} log format={(v) => fmt(v, 2)} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Say
                  simple={
                    <>
                      Еталон — дуже точний розв&apos;язок у логарифмах. Найменше кроликів: <span className="font-mono text-white">{p10(minLgU)}</span>
                      {Number.isFinite(refRev) && <>, відродження при t ≈ {fmt(refRev, 4)}</>}.
                    </>
                  }
                >
                  Еталон: Розенброк у змінних (ln u, ln v, θ), rtol = 10⁻⁹. Мінімум жертв <span className="font-mono text-white">10^{minLgU.toFixed(0)}</span>
                  {Number.isFinite(refRev) && <>, відродження при t ≈ {fmt(refRev, 4)}</>}.
                </Say>
              </div>
            </>
          }
        >
          <Grid>
            <Card>
              <Plot title="lg u — жертви (у порядках!)" height={260} xLabel="t" yLabel="lg u" yDomain={[floors.u, 2]} series={uSeries} />
            </Card>
            <Card>
              <Plot title="lg v — хижаки" height={260} xLabel="t" yLabel="lg v" yDomain={[floors.v, 3]} series={vSeries} />
            </Card>
          </Grid>
          <Card>
            <Plot title="θ(t) — ознака хижака" height={240} xLabel="t" series={thSeries} />
          </Card>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {sols.map(({ m, s, v, err, rev }) => (
              <Stat
                key={m}
                label={`${METHODS[m].short}${isAdaptive(m) ? "" : ` h=${fmt(dh, 2)}`}`}
                value={s.failed ? (s.failed.includes("Ньютона") ? "✗ Ньютон" : "💥") : v.neg > 0 ? `${negLabel(v)} !` : `${fmt(err.du, 2)} пор.`}
                sub={
                  s.failed
                    ? `${s.failed}`
                    : `${s.steps} кр.${isAdaptive(m) ? ` (+${s.rejected})` : ""} · ${fmtMs(s.ms)} · max|Δθ| ${fmt(err.dth, 2)} · відродж. ${Number.isFinite(rev) ? fmt(rev, 4) : "—"}`
                }
                tone={s.failed || v.neg > 0 ? "bad" : quality(err, rev)}
              />
            ))}
          </div>
          <p className="text-[12px] text-white/45">
            <Say
              simple={
                <>
                  У картці — промах у «порядках» кількості кроликів і промах в ознаці θ. Промах в θ великий навіть у хороших методів: θ обвалюється з ≈ 7 до 1/7 за
                  кілька одиниць часу, і запізнення на мить дає велику різницю.{" "}
                  {Number.isFinite(refRev)
                    ? "Тому колір картки визначаємо за тим, наскільки точно метод вгадав момент відродження кроликів (<1 % — зелений, <5 % — жовтий)."
                    : "Тут відродження немає, тож колір визначає промах в θ (<0.05 / <0.5)."}
                </>
              }
            >
            max|Δθ| — поточкова похибка; вона велика навіть у хороших методів, бо θ обвалюється з ≈ 7 до 1/7 за кілька одиниць часу, і зсув моменту відродження на 1 % дає похибку
            O(1). Тому колір картки{Number.isFinite(refRev) ? " визначає відносна похибка моменту відродження t* (<1 % / <5 %)." : " визначає max|Δθ| (<0.05 / <0.5)."}
            </Say>
          </p>
          <Grid>
            <Card>
              <Plot
                title="Глобальна похибка |Δ lg u| (порядки) — лог. шкала"
                height={230}
                logY
                xLabel="t"
                yDomain={[1e-10, 1e3]}
                series={sols.map(({ m, err, v }) => ({ x: v.t, y: err.eU, color: METHODS[m].color, label: METHODS[m].short, width: 1.3 }))}
              />
            </Card>
            <Card>
              {lte ? (
                <Plot
                  title="BDF2: оцінка локальної похибки (2/9)|Δ³y|"
                  height={230}
                  logY
                  xLabel="t"
                  yDomain={[1e-14, 1e2]}
                  series={[{ x: lte.t, y: lte.e, color: METHODS.bdf2.color, label: `BDF2, h = ${fmt(dh, 2)}`, width: 1.3 }]}
                />
              ) : (
                <div className="grid h-[230px] place-items-center text-center text-[13px] text-white/45">Увімкніть BDF2, щоб побачити оцінку локальної похибки.</div>
              )}
            </Card>
          </Grid>

          {origNeg.length > 0 && (
            <Insight
              tone="bad"
              title="Від'ємні популяції"
              simple={
                <>
                  {origNeg.map(({ m, v }) => `${METHODS[m].short} (${negLabel(v)})`).join(", ")}: у звичайних змінних розв&apos;язок проскочив через нуль — кроликів чи
                  лисиць стало «мінус». Насправді популяції додатні, хоч і падають на десятки порядків (кролики — до {p10(minLgU)}, лисиці — до {p10(minLgV)}), а ці
                  методи знак не бережуть
                  {implNeg.length > 0 &&
                    (uSteep && crossWhy ? (
                      <>
                        : на крутому спаді, де кроликів за крок мало б стати в {-zStart / LN10 >= 3 ? p10(-zStart / LN10) : fmt(Math.exp(-zStart), 2)} разів менше,{" "}
                        {crossWhy}
                      </>
                    ) : (
                      <>: неявні методи з фіксованим кроком на швидкому спаді «перестрибують» через нуль</>
                    ))}
                  {adaptNeg.length > 0 && (
                    <>
                      {implNeg.length > 0 ? "; " : ": "}
                      адаптивним методам числа, менші за допуск {fmt(dtol * 1e-3, 1)}, — те саме, що нуль
                    </>
                  )}
                  .
                  {frozen.length > 0 && (
                    <>
                      {" "}
                      Коли спад сповільнюється, знак кроликів «застигає»: на дні провалу він
                      {frozenPlus.length > 0 && (
                        <>
                          {" "}
                          «плюс» у {frozenPlus.length > 1 ? "розрахунках" : "розрахунку"} {names(frozenPlus)}
                        </>
                      )}
                      {frozenPlus.length > 0 && frozenMinus.length > 0 && ", але"}
                      {frozenMinus.length > 0 && (
                        <>
                          {" "}
                          «мінус» у {frozenMinus.length > 1 ? "розрахунках" : "розрахунку"} {names(frozenMinus)}
                        </>
                      )}
                      . Куди застигне знак, вирішує кількість перекидань, тобто крок: змініть h на кілька відсотків — і результат може стати іншим.
                    </>
                  )}
                  {implEarly.length > 0 && (
                    <>
                      {" "}
                      {names(implEarly)} {implEarly.length > 1 ? "«відроджують»" : "«відроджує»"} кроликів зарано: провал мілкий
                      {earlyDepths.length > 0 && (
                        <>
                          {" "}
                          (~{p10Range(earlyDepths)} замість {p10(minLgU)})
                        </>
                      )}
                      , і t* ≈ {tRange(implEarly.map(({ rev }) => rev))} замість {fmt(refRev, 4)}.
                    </>
                  )}
                  {implStop.length > 0 && (
                    <>
                      {" "}
                      {names(implStop)} {implStop.length > 1 ? "не дорахували" : "не дорахував"} до кінця: розрахунок зупинився при t ≈{" "}
                      {implStop.map(({ s }) => fmt(s.t[s.t.length - 1], 4)).join(" і ")}.
                    </>
                  )}
                  {offBranch.length > 0 && offEnd && (
                    <>
                      {" "}
                      А коли острів стає безпечним, «від&apos;ємні кролики» розмножуються: розрахунок іде в нісенітницю (кроликів ≈ {fmt(offEnd[0], 2)}, лисиць ≈{" "}
                      {fmt(offEnd[1], 2)}), і {offBranch.map(({ m, s }) => `${METHODS[m].short} (t ≈ ${fmt(s.t[s.t.length - 1], 4)})`).join(", ")}{" "}
                      {offBranch.length > 1 ? "ламаються" : "ламається"}.
                    </>
                  )}
                </>
              }
            >
              {origNeg.map(({ m, v }) => `${METHODS[m].short} (${negLabel(v)}: ${nPts(v.neg)})`).join(", ")}: у змінних (u, v, θ) чисельний розв&apos;язок проскакує через
              нуль. Справжні <Tex>{"u"}</Tex> і <Tex>{"v"}</Tex> додатні, хоч і падають на десятки порядків (до <Tex>{`10^{${minLgU.toFixed(0)}}`}</Tex> і{" "}
              <Tex>{`10^{${minLgV.toFixed(0)}}`}</Tex>), а ці методи додатності не гарантують
              {implNeg.length > 0 &&
                (uSteep && crossWhy ? (
                  <>
                    : на старті для жертв <Tex>{`h|g| \\approx ${fmt(-zStart, 3)}`}</Tex>, <Tex>{String.raw`g = 1 - \tfrac u2 - \tfrac{2v}{7\theta^2}`}</Tex> (точний множник
                    за крок <Tex>{`e^{-h|g|} \\approx ${-zStart / LN10 >= 3 ? `10^{${Math.round(zStart / LN10)}}` : fmt(Math.exp(zStart), 2)}`}</Tex>)
                    {flipMs.length > 0 && (
                      <>
                        , а множник{" "}
                        {flipMs.includes("trap") && (
                          <>
                            трапецій <Tex>{String.raw`R(z) = \frac{1 + z/2}{1 - z/2} \approx ${fmt(rTrap0, 2)}`}</Tex>
                          </>
                        )}
                        {flipMs.length > 1 && " і "}
                        {flipMs.includes("theta") && (
                          <>
                            θ-методу <Tex>{`R \\approx ${fmt(rTheta0, 2)}`}</Tex>
                          </>
                        )}{" "}
                        від&apos;ємний — знак <Tex>{"u"}</Tex> перекидається щокроку, поки <Tex>{"h|g| > 2"}</Tex>
                        {flipMs.includes("theta") && (
                          <>
                            {" "}
                            (для θ = 0.55 — <Tex>{"h|g| > 2.22"}</Tex>)
                          </>
                        )}
                      </>
                    )}
                    {implNeg.some(({ m }) => m === "bdf2") && (
                      <>
                        ; у BDF2 права частина <Tex>{String.raw`c = (4y_n - y_{n-1})/3`}</Tex> має протилежний знак щоразу, коли компонента без зміни знака за крок спадає більш ніж учетверо (<Tex>{String.raw`0 < y_n/y_{n-1} < 1/4`}</Tex>)
                      </>
                    )}
                  </>
                ) : (
                  <>
                    : неявні схеми з фіксованим кроком на швидкому спаді «перестрибують» через нуль (у трапецій і θ-методу множник <Tex>{"R(h\\lambda)"}</Tex> від&apos;ємний
                    при <Tex>{"h|\\lambda| > 2"}</Tex> і <Tex>{"> 2.22"}</Tex>, у BDF2 — щойно компонента без зміни знака за крок спадає більш ніж учетверо, <Tex>{String.raw`0 < y_n/y_{n-1} < 1/4`}</Tex>)
                  </>
                ))}
              {adaptNeg.length > 0 && (
                <>
                  {implNeg.length > 0 ? "; " : ": "}
                  {adaptNeg.length > 1 ? "адаптивні" : "адаптивний"} {adaptNeg.map(({ m }) => METHODS[m].short).join(", ")}{" "}
                  {adaptNeg.length > 1 ? "контролюють" : "контролює"} абсолютну похибку atol = {fmt(dtol * 1e-3, 2)}, і{" "}
                  <Tex>{"|u|,\\ |v| \\ll \\text{atol}"}</Tex> для {adaptNeg.length > 1 ? "них" : "нього"} — те саме, що нуль
                </>
              )}
              .
              {frozen.length > 0 && (
                <>
                  {" "}
                  До t ≈ {fmt(frozenLast, 3)} <Tex>{"u"}</Tex> змінює знак ({frozen.map(({ m, sg }) => `${METHODS[m].short} — ${nTimes(sg!.flips)}`).join(", ")}), а
                  коли спад сповільнюється, знак застигає: при <Tex>{"\\theta = 8/7"}</Tex>
                  {frozenPlus.length > 0 && (
                    <>
                      {" "}
                      <Tex>{"u > 0"}</Tex> для {names(frozenPlus)}
                    </>
                  )}
                  {frozenPlus.length > 0 && frozenMinus.length > 0 && ","}
                  {frozenMinus.length > 0 && (
                    <>
                      {" "}
                      <Tex>{"u < 0"}</Tex> для {names(frozenMinus)}
                    </>
                  )}
                  . Кількість перекидань, а з нею й знак на дні провалу, залежить від кроку <Tex>{"h"}</Tex>.
                </>
              )}
              {implEarly.length > 0 && (
                <>
                  {" "}
                  {names(implEarly)}: провал мілкий
                  {earlyDepths.length > 0 && (
                    <>
                      {" "}
                      (~<Tex>{tex10Range(earlyDepths)}</Tex> замість <Tex>{`10^{${minLgU.toFixed(0)}}`}</Tex>: швидкий розпад неявні схеми гасять лише алгебраїчно)
                    </>
                  )}
                  , тож затримка втрати стійкості коротша: t* ≈ {tRange(implEarly.map(({ rev }) => rev))} проти {fmt(refRev, 4)}.
                </>
              )}
              {implStop.length > 0 && (
                <>
                  {" "}
                  {implStop.map(({ m, s }) => `${METHODS[m].short}: ${s.failed}`).join("; ")}.
                </>
              )}
              {offBranch.length > 0 && offEnd && (
                <>
                  {" "}
                  Коли ж <Tex>{"\\theta > 8/7"}</Tex> при <Tex>{"u < 0"}</Tex>, «від&apos;ємна популяція» росте експоненційно: розв&apos;язок іде на нефізичну гілку (
                  {nearTwoThirds ? <><Tex>{"u \\to -2/3"}</Tex>, <Tex>{"v,\\ \\theta \\to \\infty"}</Tex>; </> : null}наприкінці u ≈ {fmt(offEnd[0], 3)}, v ≈{" "}
                  {fmt(offEnd[1], 2)}), і розрахунок зупиняється:{" "}
                  {offBranch.map(({ m, s }) => `${METHODS[m].short} — ${offHow(s)} при t ≈ ${fmt(s.t[s.t.length - 1], 4)}`).join(", ")}.
                </>
              )}
            </Insight>
          )}
          {form === "orig" && bdf && (bdf.s.failed || bdf.v.neg > 0) && (
            <Insight
              tone="warn"
              title={bdfNeg ? `Звідки у BDF2 від'ємні ${bdfNeg.i === 0 ? "u" : "v"}` : "BDF2 у змінних (u, v, θ)"}
              simple={
                <>
                  {bdfNeg && bdfNeg.c < 0 ? (
                    <>
                      За крок t ≈ {fmt(bdfNeg.t0, 4)} → {fmt(bdfNeg.t1, 4)} {bdfNeg.i === 0 ? "кроликів" : "лисиць"} поменшало більш ніж учетверо ({fmt(bdfNeg.a, 3)} →{" "}
                      {fmt(bdfNeg.b, 3)}). BDF2 будує наступний крок від двох попередніх точок, і його «опорна» частина (4·{fmt(bdfNeg.b, 3)} − {fmt(bdfNeg.a, 3)})/3 ≈{" "}
                      {fmt(bdfNeg.c, 2)} уже від&apos;ємна{bdfNeg.i === 0 && bdfNeg.vPos ? " — додатної відповіді в рівнянні кроку просто немає" : ""}: при t ≈{" "}
                      {fmt(bdfNeg.t, 4)} {bdfNeg.i === 0 ? "кроликів" : "лисиць"} ≈ {fmt(bdfNeg.val, 2)}. Метод стійкий, але знак не береже.
                    </>
                  ) : bdfNeg ? (
                    <>
                      BDF2 не береже знак: уперше {bdfNeg.i === 0 ? "кроликів" : "лисиць"} стає «мінус» ({fmt(bdfNeg.val, 2)}) при t ≈ {fmt(bdfNeg.t, 4)}.
                    </>
                  ) : null}
                  {bdfSg && (
                    <>
                      {" "}
                      Поки спад крутий, кроликів ще {nTimes(bdfSg.flips - 1)} перекидає через нуль (востаннє — при t ≈ {fmt(bdfSg.tLast, 3)}), а далі знак застигає
                      {bdfSg.bottom > 0 ? " — тут у плюсі." : bdfSg.bottom < 0 ? " — тут у мінусі." : "."} Яким він застигне, залежить від кроку.
                    </>
                  )}{" "}
                  {ranOff(bdf.s) ? (
                    <>
                      Далі, коли острів стає безпечним, «від&apos;ємні кролики» розмножуються, розрахунок тікає в нісенітницю (кроликів ≈ {fmt(bdfEndU, 2)}), і при t ≈{" "}
                      {fmt(bdf.s.t[bdf.s.t.length - 1], 4)} {bdf.s.failed?.includes("Ньютона") ? "Ньютон здається" : "розв'язок «вибухає»"}.
                    </>
                  ) : bdf.s.failed ? (
                    <>Розрахунок зупинився: {bdf.s.failed}.</>
                  ) : Number.isFinite(bdf.rev) && Number.isFinite(refRev) ? (
                    bdfDepth > minLgU + 1 ? (
                      <>
                        Провал кроликів у BDF2 мілкий — лише до {p10(bdfDepth)} (насправді {p10(minLgU)}), тож вони «відроджуються» при t ≈ {fmt(bdf.rev, 4)} замість{" "}
                        {fmt(refRev, 4)}.
                      </>
                    ) : (
                      <>
                        Кролики відроджуються при t ≈ {fmt(bdf.rev, 4)} (в еталоні {fmt(refRev, 4)}).
                      </>
                    )
                  ) : null}{" "}
                  Рятують змінні (ln u, ln v, θ).
                </>
              }
            >
              {bdfNeg && bdfNeg.c < 0 ? (
                <>
                  Крок BDF2 — рівняння <Tex>{String.raw`y_{n+1} - \tfrac23 h f(y_{n+1}) = c,\ c = \tfrac{4y_n - y_{n-1}}{3}`}</Tex>. При t ≈ {fmt(bdfNeg.t0, 4)} → {fmt(bdfNeg.t1, 4)}{" "}
                  <Tex>{bdfNeg.i === 0 ? "u" : "v"}</Tex> спадає з {fmt(bdfNeg.a, 3)} до {fmt(bdfNeg.b, 3)} — більш ніж учетверо, тож{" "}
                  <Tex>{`c_${bdfNeg.i === 0 ? "u" : "v"} \\approx ${fmt(bdfNeg.c, 3)} < 0`}</Tex>
                  {bdfNeg.i === 0 && bdfNeg.vPos && (
                    <>
                      . Для <Tex>{"u"}</Tex> рівняння має вигляд <Tex>{String.raw`u\,(1 - \tfrac23 h g) = c_u`}</Tex>, де <Tex>{String.raw`g = 1 - \tfrac u2 - \tfrac{2v}{7\theta^2} < 1`}</Tex>{" "}
                      при <Tex>{"u > 0,\\ v \\ge 0"}</Tex>; при <Tex>{"h < 1.5"}</Tex> множник додатний, і додатного кореня немає
                    </>
                  )}
                  : Ньютон знаходить <Tex>{`${bdfNeg.i === 0 ? "u" : "v"} \\approx ${fmt(bdfNeg.val, 3)}`}</Tex> (t ≈ {fmt(bdfNeg.t, 4)}). Метод A-стійкий, але не зберігає
                  додатність.
                </>
              ) : bdfNeg ? (
                <>
                  BDF2 не зберігає додатність: перше від&apos;ємне <Tex>{`${bdfNeg.i === 0 ? "u" : "v"} \\approx ${fmt(bdfNeg.val, 3)}`}</Tex> — при t ≈ {fmt(bdfNeg.t, 4)}.
                </>
              ) : null}
              {bdfSg && (
                <>
                  {" "}
                  Далі знак <Tex>{"u"}</Tex> змінюється ще {nTimes(bdfSg.flips - 1)} — щоразу, коли два сусідні значення мають однаковий знак, а <Tex>{"|u|"}</Tex> за крок спадає більш ніж учетверо (<Tex>{String.raw`0 < u_n/u_{n-1} < 1/4`}</Tex>; востаннє при t ≈{" "}
                  {fmt(bdfSg.tLast, 3)}); коли спад сповільнюється, знак застигає
                  {bdfSg.bottom !== 0 ? (
                    <>
                      : при <Tex>{"\\theta = 8/7"}</Tex> <Tex>{bdfSg.bottom > 0 ? "u > 0" : "u < 0"}</Tex>
                    </>
                  ) : null}
                  . Кількість перекидань, а отже й знак на дні провалу, залежить від <Tex>{"h"}</Tex>.
                </>
              )}{" "}
              {ranOff(bdf.s) ? (
                <>
                  Далі при <Tex>{"\\theta > 8/7"}</Tex> від&apos;ємне <Tex>{"u"}</Tex> росте, розв&apos;язок іде на нефізичну гілку (наприкінці <Tex>{`u \\approx ${fmt(bdfEndU, 3)}`}</Tex>), і
                  при t ≈ {fmt(bdf.s.t[bdf.s.t.length - 1], 4)} {bdf.s.failed?.includes("Ньютона") ? "рівняння кроку перестає розв'язуватися" : "розв'язок «вибухає»"}.
                </>
              ) : bdf.s.failed ? (
                <>{bdf.s.failed}.</>
              ) : Number.isFinite(bdf.rev) && Number.isFinite(refRev) ? (
                bdfDepth > minLgU + 1 ? (
                  <>
                    Провал <Tex>{"u"}</Tex> у BDF2 сягає лише <Tex>{`10^{${Math.round(bdfDepth)}}`}</Tex> замість <Tex>{`10^{${minLgU.toFixed(0)}}`}</Tex>, тож затримка втрати стійкості
                    коротша: t* ≈ {fmt(bdf.rev, 4)} проти {fmt(refRev, 4)}.
                  </>
                ) : (
                  <>
                    t* ≈ {fmt(bdf.rev, 4)} проти {fmt(refRev, 4)} в еталоні.
                  </>
                )
              ) : null}{" "}
              <b>Перейдіть до змінних (ln u, ln v, θ)</b>.
            </Insight>
          )}
          {ieR && ieInfo && ieR.v.neg === 0 && minLgU < -3 && ieR.depth > minLgU + 1 && (
            <Insight
              tone="warn"
              title="Неявний Ейлер: знак береже, глибину — ні"
              simple={
                <>
                  Неявний Ейлер знак береже: на спаді за крок кроликів у нього стає менше в 1 + h|g| разів (g — темп, з яким кролики вимирають чи розмножуються), і
                  число лишається додатним — від&apos;ємних популяцій немає.
                  {ieR.depth > minLgU + 1 && (
                    <>
                      {" "}
                      Але на крутому спаді цього замало
                      {uSteep && (
                        <>
                          : на старті кроликів за крок мало б стати менше в {-zStart / LN10 >= 3 ? p10(-zStart / LN10) : fmt(Math.exp(-zStart), 2)} разів, а в нього — лише в{" "}
                          {fmt(1 - zStart, 3)}
                        </>
                      )}
                      .
                      {Number.isFinite(ieInfo.tSteep) && (
                        <>
                          {" "}
                          До t ≈ {fmt(ieInfo.tSteep, 2)} справжніх кроликів стає менше на {Math.round(ieInfo.refDrop)}{" "}
                          {plural(Math.round(ieInfo.refDrop), "порядок", "порядки", "порядків")}, а в неявного Ейлера — лише на {Math.round(ieInfo.ieDrop)}.
                        </>
                      )}{" "}
                      Провал виходить мілкий ({p10(ieR.depth)} замість {p10(minLgU)}), тож кролики «прокидаються» зарано
                      {Number.isFinite(ieR.rev) && Number.isFinite(refRev) ? `: t ≈ ${fmt(ieR.rev, 4)} замість ${fmt(refRev, 4)}.` : "."}
                    </>
                  )}
                  {ieHalfCloser && ieInfo.half && (
                    <>
                      {" "}
                      Що менший крок, то ближче до правди: з кроком {fmt(ieInfo.halfH, 3)} — t ≈ {fmt(ieInfo.half.rev, 4)}.
                    </>
                  )}
                </>
              }
            >
              Крок неявного Ейлера для жертв: <Tex>{String.raw`u_{n+1} = u_n/(1 - h\,g_{n+1})`}</Tex>, де{" "}
              <Tex>{String.raw`g = 1 - \tfrac u2 - \tfrac{2v}{7\theta^2} < 1`}</Tex> при <Tex>{"u > 0,\\ v \\ge 0"}</Tex>, тож при <Tex>{"h \\le 1"}</Tex> знак{" "}
              <Tex>{"u"}</Tex> зберігається: від&apos;ємних точок немає.
              {ieR.depth > minLgU + 1 && (
                <>
                  {" "}
                  Проте швидкий спад він гасить алгебраїчно: множник за крок <Tex>{"1/(1 + h|g|)"}</Tex> замість <Tex>{"e^{-h|g|}"}</Tex>
                  {uSteep && (
                    <>
                      {" "}
                      (на старті <Tex>{`h|g| \\approx ${fmt(-zStart, 3)}`}</Tex>: <Tex>{`1/${fmt(1 - zStart, 3)}`}</Tex> замість{" "}
                      <Tex>{-zStart / LN10 >= 3 ? `10^{${Math.round(zStart / LN10)}}` : fmt(Math.exp(zStart), 2)}</Tex>)
                    </>
                  )}
                  .
                  {Number.isFinite(ieInfo.tSteep) && (
                    <>
                      {" "}
                      Поки <Tex>{"h|g| > 1"}</Tex> (на еталоні — до t ≈ {fmt(ieInfo.tSteep, 3)}), <Tex>{"\\lg u"}</Tex> еталона спадає на {fmt(ieInfo.refDrop, 3)}, а неявного
                      Ейлера — лише на {fmt(ieInfo.ieDrop, 3)}.
                    </>
                  )}{" "}
                  Провал <Tex>{"u"}</Tex> — лише <Tex>{`10^{${Math.round(ieR.depth)}}`}</Tex> замість <Tex>{`10^{${minLgU.toFixed(0)}}`}</Tex>
                  {Number.isFinite(ieR.rev) && Number.isFinite(refRev) ? `, тож затримка втрати стійкості коротша: t* ≈ ${fmt(ieR.rev, 4)} проти ${fmt(refRev, 4)}.` : "."}
                </>
              )}
              {ieHalfCloser && ieInfo.half && (
                <>
                  {" "}
                  Метод першого порядку: з <Tex>{`h = ${fmt(ieInfo.halfH, 3)}`}</Tex> t* ≈ {fmt(ieInfo.half.rev, 4)} — зі зменшенням кроку відродження наближається до еталона.
                </>
              )}
            </Insight>
          )}
          {form === "log" && bdf && !bdf.s.failed && (
            <Insight
              tone="good"
              title="Логарифмічна заміна рятує"
              simple={
                <>
                  Рахуючи не u, а ln u, ми не можемо отримати від&apos;ємних кроликів
                  {logTamed && (
                    <>
                      , а найшвидший процес зникає (замість темпу {fmt(lam0, 3)} на старті — лише ~{fmt(Math.min(...logMod0), 1)}–{fmt(Math.max(...logMod0), 1)})
                    </>
                  )}
                  . BDF2 з кроком {fmt(dh, 2)} відтворює і глибину провалу, і момент відродження
                  {Number.isFinite(bdf.rev) && Number.isFinite(refRev) ? `: t* ≈ ${fmt(bdf.rev, 4)} проти ${fmt(refRev, 4)} в еталоні.` : "."}
                </>
              }
            >
              У змінних <Tex>{"w=\\ln u,\\ z=\\ln v"}</Tex> додатність автоматична
              {logTamed && (
                <>
                  , а система перестає бути жорсткою (на старті <Tex>{`\\lambda \\approx ${evList(ev0.log, true)}`}</Tex> замість <Tex>{fmt(evFast0.re, 3)}</Tex>)
                </>
              )}
              . BDF2 з <Tex>{`h=${fmt(dh, 2)}`}</Tex> відтворює і глибину вимирання, і момент відродження:{" "}
              {Number.isFinite(bdf.rev) && Number.isFinite(refRev) ? `t* ≈ ${fmt(bdf.rev, 4)} проти ${fmt(refRev, 4)} в еталоні.` : "див. графіки."}
            </Insight>
          )}
          {explBlow.length > 0 && (
            <Insight
              tone="bad"
              title={`Явні методи з h = ${fmt(dh, 2)}`}
              simple={
                form === "orig" ? (
                  startStiff ? (
                    <>
                      {explBlow.map(({ m }) => METHODS[m].short).join(", ")} вибухнули: на старті найшвидший процес має темп ≈ {fmt(lam0, 3)}, а крок × темп ≈{" "}
                      {fmt(dh * lam0, 3)} — більше за дозволені ~2. Явному Ейлеру тут знадобився б крок, менший за {fmt(2 / lam0, 2)}, — це ~
                      {eulerSteps0.toLocaleString("uk-UA")} кроків на [0, {fmt(dT, 4)}]. <Relatable kind="steps" n={eulerSteps0} />
                    </>
                  ) : (
                    <>
                      {explBlow.map(({ m }) => METHODS[m].short).join(", ")} вибухнули, хоча на старті крок × темп лише ≈ {fmt(dh * lam0, 3)} (темп ≈ {fmt(lam0, 3)}) —
                      менше за 2. Зрив стався пізніше, при t ≈ {fmt(explFailT, 4)}
                      {lamToFail &&
                        (dh * lamToFail.mx > 2 ? (
                          <>
                            : до цього моменту найшвидший процес пришвидшився до ≈ {fmt(lamToFail.mx, 3)} (t ≈ {fmt(lamToFail.tAt, 4)}), і крок × темп сягнув ≈{" "}
                            {fmt(dh * lamToFail.mx, 3)} (межі: Ейлер і RK2 — 2, RK3 — 2.513, RK4 — 2.785).
                          </>
                        ) : (
                          <>
                            , хоча й на точному розв&apos;язку крок × темп до того не перевищує ≈ {fmt(dh * lamToFail.mx, 3)}: зірвався сам наближений розв&apos;язок — у
                            звичайних змінних він може проскочити через нуль і піти в нісенітницю.
                          </>
                        ))}
                      {!lamToFail && "."}
                    </>
                  )
                ) : (
                  <>
                    {explBlow.map(({ m }) => METHODS[m].short).join(", ")} вибухнули навіть у лог-змінних: на старті найшвидший процес має темп ≈{" "}
                    {fmt(Math.max(...logMod0), 3)}, і крок {fmt(dh, 2)} для нього завеликий.
                  </>
                )
              }
            >
              {explBlow.map(({ m, s }) => `${METHODS[m].short}: ${s.failed}`).join("; ")}.{" "}
              {form === "orig" ? (
                startStiff ? (
                  <>
                    На старті <Tex>{`\\lambda \\approx ${evList(ev0.orig, true)}`}</Tex>, і <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(dh * lam0, 3)}`}</Tex> — за межами
                    областей стійкості (2 для Ейлера і RK2, 2.513 для RK3, 2.785 для RK4): явному Ейлеру потрібен <Tex>{`h < 2/|\\lambda| \\approx ${fmt(2 / lam0, 3)}`}</Tex>, тобто ~
                    {eulerSteps0.toLocaleString("uk-UA")} кроків на <Tex>{`[0, ${fmt(dT, 4)}]`}</Tex>.
                  </>
                ) : (
                  <>
                    На старті <Tex>{`\\lambda \\approx ${evList(ev0.orig, true)}`}</Tex>, <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(dh * lam0, 3)} < 2`}</Tex> — старт у межах
                    стійкості; зрив — при <Tex>{`t \\approx ${fmt(explFailT, 4)}`}</Tex>.
                    {lamToFail && (
                      <>
                        {" "}
                        Уздовж еталона до цього моменту <Tex>{`\\max|\\operatorname{Re}\\lambda| \\approx ${fmt(lamToFail.mx, 3)}`}</Tex> (при{" "}
                        <Tex>{`t \\approx ${fmt(lamToFail.tAt, 4)}`}</Tex>), тобто <Tex>{`h|\\lambda| \\approx ${fmt(dh * lamToFail.mx, 3)}`}</Tex> (межі: 2 для Ейлера і RK2, 2.513 для RK3,
                        2.785 для RK4)
                        {dh * lamToFail.mx > 2
                          ? "."
                          : ": лінійна стійкість на еталоні не порушена, тож причина — сам чисельний розв'язок, що відійшов від еталона (у змінних (u, v, θ) він може проскочити через нуль)."}
                      </>
                    )}
                  </>
                )
              ) : (
                <>
                  На старті в змінних (ln u, ln v, θ) <Tex>{`\\lambda \\approx ${evList(ev0.log, true)}`}</Tex>, і <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(dh * Math.max(...logMod0), 3)}`}</Tex>.
                </>
              )}
            </Insight>
          )}
          {form === "log" && sols.some(({ m, s }) => isExplicit(m) && !s.failed) && (
            <Insight
              tone="info"
              title="Сюрприз: у лог-змінних навіть явні методи живуть"
              simple={
                <>
                  Заміна змінних прибрала головне джерело жорсткості — множник u перед дужкою. Тож навіть явні методи з кроком {fmt(dh, 2)} тепер не вибухають. Часто правильна
                  постановка задачі важливіша за вибір методу.
                </>
              }
            >
              Заміна змінних прибрала головне джерело жорсткості — множник <Tex>{"u"}</Tex> перед дужкою. Часто правильна постановка задачі важливіша за вибір методу.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Острів: кролики, лисиці та еволюція">
        <Card>
          <IslandScene t={ref.t} lnU={ref.lnU} lnV={ref.lnV} theta={ref.th} marks={marks} />
          <p className="mt-3 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Кількість іконок — скільки кроликів і лисиць; коли їх «майже нуль», картка показує порядок ({p10(minLgU)} — менше за один атом кролика на
                  весь Всесвіт). Шкала внизу — ознака θ: 1/7 (рівновага без лисиць), 5/7 (співіснування) і 8/7 (поріг, після якого кролики мали б відроджуватися).
                </>
              }
            >
            Кількість іконок пропорційна <Tex>{"u"}</Tex> та <Tex>{"v"}</Tex>; коли популяція «майже нуль», картка показує її порядок (<Tex>{`10^{${minLgU.toFixed(0)}}`}</Tex> — це
            менше, ніж один атом кролика на весь Всесвіт). Шкала внизу — ознака <Tex>{"\\theta"}</Tex> з позначками 1/7 (рівновага без хижаків), 5/7 (спільна рівновага) і 8/7 (поріг
            відродження жертв).
            </Say>
          </p>
        </Card>
      </Section>

      <Section kicker="Фазовий простір" title="Траєкторія в координатах (lg u, lg v, θ)" simpleTitle="Траєкторія в «порядках» чисельності">
        <Grid>
          <Card>
            <Plot title="Фазовий портрет (lg u, lg v)" height={320} sorted={false} xLabel="lg u" yLabel="lg v" series={phase} />
          </Card>
          <Card>
            <Plot3D curves={curves3d} labels={["lg u", "lg v", "θ"]} height={320} />
            <p className="mt-2 text-[12.5px] text-white/50">
              <Say
                simple={
                  <>
                    У 3D осі обрізано знизу на 10⁻¹²⁰ для наочності (лисиці після відродження кроликів падають аж до {p10(minLgV)}); на плоских графіках видно
                    все.
                  </>
                }
              >
              У 3D осі lg u і lg v обрізано знизу на −120 для наочності (хижаки після відродження жертв падають аж до <Tex>{`10^{${minLgV.toFixed(0)}}`}</Tex>); на плоских
              графіках показано повний діапазон.
              </Say>
            </p>
          </Card>
        </Grid>
      </Section>

      <Section
        kicker="Результати"
        title={`Усі методи з h = 0.2 (адаптивні — rtol = 10⁻⁴) у двох формулюваннях`}
        simpleTitle="Хто впорався з кроком 0.2 — у звичайних і в лог-змінних"
      >
        <Card>
          <div className={tabStale ? "opacity-50 transition-opacity" : "transition-opacity"} aria-busy={tabStale}>
          <Table
            head={["Метод", "(u,v,θ): статус", "max|Δθ|", "відродження t*", "(ln u, ln v, θ): статус", "max|Δθ|", "відродження t*", "кроки"]}
            rows={ALL.map((m, j) => {
              const cell = (fi: number) => {
                const { s, v, err, rev } = table[fi][j];
                const st = s.failed ? (
                  <span className="text-[#ff5d73]">{s.failed.includes("Ньютона") ? `✗ Ньютон, t≈${fmt(s.t[s.t.length - 1], 3)}` : `💥 t≈${fmt(s.t[s.t.length - 1], 3)}`}</span>
                ) : v.neg > 0 ? (
                  <span className="text-[#ff5d73]">{negLabel(v)} ({v.neg})</span>
                ) : (
                  <span className="text-[#3ee6a8]">✓</span>
                );
                return [
                  st,
                  s.failed ? "—" : <span className="text-white/70">{fmt(err.dth, 2)}</span>,
                  s.failed ? "—" : <span className={QCOL[quality(err, rev, tabRefRev)]}>{Number.isFinite(rev) ? fmt(rev, 4) : Number.isFinite(tabRefRev) ? "немає" : "—"}</span>,
                ];
              };
              return [
                <span key={m} style={{ color: METHODS[m].color }}>
                  {METHODS[m].name}
                </span>,
                ...cell(0),
                ...cell(1),
                `${table[0][j].s.steps} / ${table[1][j].s.steps}`,
              ];
            })}
          />
          </div>
          <p className="mt-3 text-[13px] text-white/55">
            <Say
              simple={
                <>
                  Еталонне відродження кроликів: {Number.isFinite(tabRefRev) ? `t* ≈ ${fmt(tabRefRev, 4)}` : "на цьому відрізку його немає"}
                  {tabLoss !== undefined && <> (хоча острів став безпечним уже при t ≈ {fmt(tabLoss, 3)})</>}. Колір t* — наскільки метод промахнувся з моментом
                  відродження (&lt;1 %, &lt;5 %, більше); «u, v &lt; 0 (n)» — у n точках кроликів чи лисиць «мінус»; «✗ Ньютон» — метод не зміг розв&apos;язати рівняння
                  свого кроку.
                  {tabEarly.length > 0 && (
                    <>
                      {" "}
                      У звичайних змінних {names(tabEarly)} {tabEarly.length > 1 ? "«відроджують»" : "«відроджує»"} кроликів зарано (t* ≈{" "}
                      {tRange(tabEarly.map(({ rev }) => rev))})
                      {tabDepths.length > 0 ? `: провал у ${tabEarly.length > 1 ? "них" : "нього"} лише ~${p10Range(tabDepths)}.` : "."}
                    </>
                  )}
                  {tabOff.length > 0 && (
                    <>
                      {" "}
                      {names(tabOff)} через «мінус» {tabOff.length > 1 ? "ідуть у нісенітницю й ламаються" : "іде в нісенітницю й ламається"}.
                    </>
                  )}
                  {tabKeep.some(({ m }) => m === "ieuler") && tabSignStory && (
                    <>
                      {" "}
                      Неявний Ейлер знак береже, а {names(tabLose)} — ні: у них кролики на дні провалу можуть опинитися «в мінусі», і тоді розрахунок ламається; чи так
                      станеться, залежить від кроку
                      {halfBdfOff && half.bdf.sg.bottom < 0 && tabLose.some(({ m }) => m === "bdf2")
                        ? ` (з кроком 0.1 BDF2 саме так ламається при t ≈ ${fmt(half.bdf.s.t[half.bdf.s.t.length - 1], 4)})`
                        : ""}
                      .
                    </>
                  )}
                  {halfIeCloser && (
                    <>
                      {" "}
                      Неявний Ейлер із кроком 0.1 «відроджує» кроликів при t ≈ {fmt(half.ie.rev, 4)} — ближче до правди.
                    </>
                  )}
                </>
              }
            >
            Еталонне відродження жертв: {Number.isFinite(tabRefRev) ? `t* ≈ ${fmt(tabRefRev, 4)}` : "не відбувається на цьому відрізку"}
            {tabLoss !== undefined && <> (хоча стан без жертв став нестійким уже при t ≈ {fmt(tabLoss, 3)})</>}. Колір t* — відносна похибка моменту відродження (&lt;1 %, &lt;5 %,
            більше); max|Δθ| наведено довідково, бо це поточкова похибка, яку визначає той самий зсув t*. «u, v &lt; 0 (n)» — кількість точок з від&apos;ємними u чи v.
            Неявні методи розв&apos;язуються повним методом Ньютона; «✗ Ньютон» — рівняння кроку не розв&apos;язалося навіть резервними способами (підкроки, продовження за
            параметром, мультистарт) або їх знадобилося понад 25 разів.
            {tabEarly.length > 0 && (
              <>
                {" "}
                У змінних (u, v, θ) {names(tabEarly)} {tabEarly.length > 1 ? "дають" : "дає"} зарано t* ({tRange(tabEarly.map(({ rev }) => rev))})
                {tabDepths.length > 0
                  ? `: провал u лише ~${p10Range(tabDepths)}, бо швидкий спад неявні схеми з фіксованим кроком гасять алгебраїчно, а не експоненційно.`
                  : "."}
              </>
            )}
            {tabOff.length > 0 && (
              <>
                {" "}
                {names(tabOff)} після переходу через нуль {tabOff.length > 1 ? "ідуть" : "іде"} на нефізичну гілку (
                {tabOff.map(({ m, s }) => `${METHODS[m].short} — ${offHow(s)} при t ≈ ${fmt(s.t[s.t.length - 1], 4)}`).join(", ")}).
              </>
            )}
            {tabKeep.some(({ m }) => m === "ieuler") && tabSignStory && (
              <>
                {" "}
                Неявний Ейлер зберігає додатність; {names(tabLose)} — ні, і їхню долю визначає знак u на дні провалу, тобто кількість перекидань знака на крутому
                спаді, — а вона залежить від кроку
                {halfBdfOff && half.bdf.sg.bottom < 0 && tabLose.some(({ m }) => m === "bdf2")
                  ? ` (з h = 0.1 у BDF2 u < 0 при θ = 8/7, і розв'язок іде на нефізичну гілку: ${offHow(half.bdf.s)} при t ≈ ${fmt(half.bdf.s.t[half.bdf.s.t.length - 1], 4)})`
                  : ""}
                .
              </>
            )}
            {halfIeCloser && (
              <>
                {" "}
                Неявний Ейлер з h = 0.1 дає t* ≈ {fmt(half.ie.rev, 4)} — ближче до еталона (метод першого порядку).
              </>
            )}
            </Say>
          </p>
        </Card>
      </Section>

      <Section kicker="Жорсткість" title="Власні числа в оригінальних змінних (u, v, θ)" simpleTitle="Наскільки швидкі процеси в кожен момент">
        <Card>
          <StiffnessPanel problem={refStiff.p} sol={refStiff.s} samples={STIFF_SAMPLES} />
          <p className="mt-2 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Темпи найшвидшого й найповільнішого процесів у звичайних змінних. Найшвидший — до ≈ {fmt(panelInfo.fast, 3)} (t ≈ {fmt(panelInfo.tFast, 3)}
                  {logTamed && panelInfo.tFast < 1 ? ", масове вимирання на старті" : ""}).{" "}
                  {panelInfo.prey ? (
                    <>
                      Коли кроликів мало, найповільніший процес — зміна ознаки θ з темпом ≈ 7εu: він майже завмирає, і відношення формально величезне — картка «коеф.
                      жорсткості» показує {fmt(panelInfo.r, 2)} (t ≈ {fmt(panelInfo.tR, 4)}, кроликів ≈ {p10(Math.log10(panelInfo.uR))}).
                    </>
                  ) : (
                    <>
                      Найбільше відношення — {fmt(panelInfo.r, 2)} (t ≈ {fmt(panelInfo.tR, 4)}): там темп одного з процесів проходить поблизу нуля.
                    </>
                  )}
                  {Number.isFinite(panelInfo.cut0) && (
                    <>
                      {" "}
                      Коли ж кроликів зовсім мало (t ≈ {fmt(panelInfo.cut0, 3)}…{fmt(panelInfo.cut1, 4)}), темп 7εu менший за 10⁻¹¹ від найшвидшого: панель вважає його
                      нулем, як нуль закону збереження, і на цій «тихій» ділянці показує лише два інші процеси.
                    </>
                  )}
                </>
              }
            >
            Дійсні частини власних чисел у змінних (u, v, θ). Найшвидше: <Tex>{`\\max|\\operatorname{Re}\\lambda| \\approx ${fmt(panelInfo.fast, 3)}`}</Tex> при t ≈{" "}
            {fmt(panelInfo.tFast, 3)}
            {logTamed && panelInfo.tFast < 1 ? " (масове вимирання на старті)" : ""}.{" "}
            {panelInfo.prey ? (
              <>
                Коли жертв мало, одне власне число <Tex>{"\\approx -7\\varepsilon u"}</Tex> (ознака θ майже не рухається) крихітне, і коефіцієнт жорсткості формально
                величезний: максимум картки — {fmt(panelInfo.r, 2)} при t ≈ {fmt(panelInfo.tR, 4)} (<Tex>{`u \\approx 10^{${Math.round(Math.log10(panelInfo.uR))}}`}</Tex>).
              </>
            ) : (
              <>
                Максимум «коеф. жорсткості» картки — {fmt(panelInfo.r, 2)} при t ≈ {fmt(panelInfo.tR, 4)}: там дійсна частина одного з власних чисел проходить поблизу
                нуля.
              </>
            )}
            {Number.isFinite(panelInfo.cut0) &&
              ` На «тихій» ділянці t ≈ ${fmt(panelInfo.cut0, 3)}…${fmt(panelInfo.cut1, 4)} жертв майже немає, і 7εu < 10⁻¹¹·max|Re λ|: панель відкидає це власне число як нульове (тим самим фільтром, що й нулі законів збереження), тож там показано два інші, а «коеф. жорсткості» — лише їхнє відношення.`}
            </Say>
          </p>
        </Card>
      </Section>

      {extras}

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="info"
            title="Що відбувається на острові"
            simple={
              <>
                Лисиці з θ = {fmt(dy0[2], 3)} за одиницю часу збивають кроликів на десятки порядків — аж до {p10(minLgU)}. Еволюція повільно робить лисиць менш
                небезпечними, і кролики відроджуються — але із запізненням на сотні одиниць часу
                {Number.isFinite(refRev) && tLoss !== undefined ? ` (t* ≈ ${fmt(refRev, 4)} проти порогу ${fmt(tLoss, 3)})` : ""}. Потім ознака повертається до 1/7, і
                вже лисиці вимирають — до {p10(minLgV)}.{uFin > 1 ? " Наприкінці острів належить кроликам." : ""}
              </>
            }
          >
            Хижаки з ознакою <Tex>{`\\theta(0) = ${fmt(dy0[2], 3)}`}</Tex> за <Tex>{"t \\lesssim 1"}</Tex> збивають жертв на десятки порядків, а до <Tex>{`t \\approx ${fmt(tMinU, 3)}`}</Tex>{" "}
            {tLoss !== undefined ? "(поки θ не перетне 8/7) " : ""}тиснуть їх до <Tex>{`10^{${minLgU.toFixed(0)}}`}</Tex>. Повільно еволюціонуючи (<Tex>{"\\theta \\uparrow"}</Tex>), хижаки
            стають менш небезпечними, і жертви відроджуються — але із запізненням на сотні одиниць часу
            {Number.isFinite(refRev) && tLoss !== undefined ? ` (t* ≈ ${fmt(refRev, 4)} проти порогу ${fmt(tLoss, 3)})` : ""}. Потім ознака повертається до <Tex>{"1/7"}</Tex>, а
            вимирають уже хижаки — до <Tex>{`10^{${minLgV.toFixed(0)}}`}</Tex>; формально вони відновлюються зі швидкістю <Tex>{"e^{t/7}"}</Tex>, але з такої глибини на це пішли б
            тисячі одиниць часу.{uFin > 1 ? " На кінці відрізка острів належить кроликам." : ""}
          </Insight>
          <Insight
            tone="warn"
            title="Мораль для методів"
            simple={
              <>
                BDF2 добрий для жорстких задач, але не стежить за знаком і не відтворює провалів на десятки порядків.
                {tabMinLgU < -20 && ` Тут, у звичайних змінних з кроком 0.2, BDF2 ${fateOf(tabBdf)}, а неявний Ейлер ${fateOf(tabIe)}.`} Неявний Ейлер знак береже,
                але глибину провалу теж недооцінює: на спаді за крок кроликів у нього стає менше в 1 + h|g| разів, а не в e<sup>h|g|</sup>, — тож вони «прокидаються»
                зарано; що менший крок, то ближче до правди{halfIeCloser ? ` (з кроком 0.1 — t ≈ ${fmt(half.ie.rev, 4)})` : ""}. А в методів, що знак не бережуть (BDF2,
                трапеції, θ-метод), кролики на дні провалу можуть опинитися «в мінусі» — і тоді розрахунок ламається; чи так станеться, залежить від кроку
                {halfBdfOff && half.bdf.sg.bottom < 0 ? ` (BDF2 з кроком 0.1 ламається при t ≈ ${fmt(half.bdf.s.t[half.bdf.s.t.length - 1], 4)})` : ""}.
              </>
            }
          >
            BDF2 — класичний метод для жорстких систем, але він не гарантує додатності розв&apos;язку, а швидкі моди гасить лише алгебраїчно (
            <Tex>{"|\\zeta| \\approx (2h|\\lambda|)^{-1/2}"}</Tex> за крок замість <Tex>{"e^{-h|\\lambda|}"}</Tex>). Тож провалу на десятки порядків він не відтворює — а саме
            глибина провалу{minLgU < -3 ? <> (тут <Tex>{`10^{${minLgU.toFixed(0)}}`}</Tex>)</> : null} задає затримку втрати стійкості.
            {tabMinLgU < -20 && ` У вихідних змінних з h = 0.2 BDF2 ${fateOf(tabBdf)}; неявний Ейлер ${fateOf(tabIe)}.`} Неявний Ейлер зберігає додатність (
            <Tex>{String.raw`u_{n+1} = u_n/(1 - h\,g_{n+1}),\ g < 1`}</Tex>), але глибину провалу так само недооцінює (множник <Tex>{"1/(1 + h|g|)"}</Tex> замість{" "}
            <Tex>{"e^{-h|g|}"}</Tex>); це метод першого порядку, і зі зменшенням <Tex>{"h"}</Tex> момент відродження наближається до еталона
            {halfIeCloser ? ` (h = 0.1: t* ≈ ${fmt(half.ie.rev, 4)})` : ""}. Для BDF2, трапецій і θ-методу доля розрахунку залежить від знака <Tex>{"u"}</Tex> на дні провалу, а
            отже від <Tex>{"h"}</Tex>: якщо <Tex>{"u < 0"}</Tex>, то після <Tex>{"\\theta > 8/7"}</Tex> воно росте й веде на нефізичну гілку (
            <Tex>{"u \\to -2/3,\\ v,\\ \\theta \\to \\infty"}</Tex>)
            {halfBdfOff && half.bdf.sg.bottom < 0 ? ` — так BDF2 з h = 0.1 завершується при t ≈ ${fmt(half.bdf.s.t[half.bdf.s.t.length - 1], 4)} (${offHow(half.bdf.s)})` : ""}.
          </Insight>
          <Insight
            tone="good"
            title="Ліки — логарифмічні змінні"
            simple={
              <>
                Рахуємо не кількість, а її логарифм — множення стає додаванням: від&apos;ємних кроликів не буває, жорсткість зникає, і BDF2 з кроком 0.2 дає майже
                еталон. Так роблять і в хімії, і в епідеміології.
              </>
            }
          >
            Заміна <Tex>{"u = e^w"}</Tex> перетворює мультиплікативну динаміку на адитивну: додатність гарантована, жорсткість зникає, і BDF2 з <Tex>{"h = 0.2"}</Tex> дає майже еталонну
            картину. Те саме роблять у хімічній кінетиці та епідеміології.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Довго вважали, що еволюція — справа тисячоліть. Але в дослідах з коловертками й водоростями (Nature, 2003) вона змінювала цикли «хижак–жертва» просто
                на очах. А затримку втрати стійкості першим строго описав А. Нейштадт (1987) — і її досі важко відтворити чисельно.
              </>
            }
          >
            Ідея, що еволюція може йти з екологічною швидкістю, довго здавалася екзотикою. Але в експериментах із коловертками й водоростями (Йошида та ін., Nature, 2003)
            еволюція жертви змінювала навіть форму циклів «хижак–жертва». Затримку ж втрати стійкості вперше строго описав А. Нейштадт (1987) — і саме її так важко відтворити
            чисельно.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
