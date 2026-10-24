"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import Plot3D from "@/components/plot/Plot3D";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import MalkusWheelScene from "@/components/analogy/MalkusWheelScene";
import StepDebugger, { type DebuggerView } from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import QuizBlock from "@/components/quiz/Quiz";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider, Toggle } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import Relatable from "@/components/ui/Relatable";
import { Tex } from "@/components/ui/Tex";
import { lyapunov } from "@/lib/chaos-tools";
import { fmt, fmtMs } from "@/lib/format";
import { eigenvalues, type Complex } from "@/lib/linalg";
import { METHODS } from "@/lib/methods";
import { comp, denseOutput, indexAt, isAdaptive, solve, stiffnessAt, type MethodId, type Problem, type Solution } from "@/lib/ode";
import { plural } from "@/lib/relatable";

// ---------------------------------------------------------------------------------------------------------------------
// constants of the assignment
// ---------------------------------------------------------------------------------------------------------------------
const Y0_TASK: [number, number, number] = [3.051522, 1.582542, 15.62388];
const Y0_ALT: [number, number, number] = [0, 1, 0];
const R_PRESETS = [0.5, 1.5, 15.5, 24.5, 28.5, 105];
const ALL: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "dopri", "ros"];
/** reference: DOPRI with a tolerance close to machine precision (verified against RK4 with h = 2·10⁻⁴ on the page itself) */
const REF_TOL = 1e-13;
/** reference value from the literature (Sparrow 1982; Viswanath 2004): λ₁ ≈ 0.9056 for σ = 10, b = 8/3, r = 28 */
const LIT_L1 = 0.9056;
const CONV_H = [0.02, 0.01, 0.005, 0.0025];

// step-by-step debugger: the system of the assignment with r = 28.5, projection x–z (stable module constants)
const DBG_F = (_t: number, y: number[]) => [10 * (y[1] - y[0]), 28.5 * y[0] - y[1] - y[0] * y[2], y[0] * y[1] - (8 / 3) * y[2]];
const DBG_Y0 = [...Y0_TASK];
const DBG_VIEW: DebuggerView = { x: 0, y: 2, xLabel: "x", yLabel: "z", xDomain: [-22, 22], yDomain: [0, 50] };

// ---------------------------------------------------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------------------------------------------------
const lorenzF = (s: number, b: number, r: number) => (_t: number, y: number[]) => [s * (y[1] - y[0]), r * y[0] - y[1] - y[0] * y[2], y[0] * y[1] - b * y[2]];
const lorenzJ = (s: number, b: number, r: number) => (_t: number, y: number[]) => [
  [-s, s, 0],
  [r - y[2], -1, -y[0]],
  [y[1], y[0], -b],
];
/** system + variational equation (for the Benettin estimate of λ₁) */
const lorenzV = (s: number, b: number, r: number) => (_t: number, v: number[]) => {
  const [x, y, z, dx, dy, dz] = v;
  return [s * (y - x), r * x - y - x * z, x * y - b * z, s * (dy - dx), (r - z) * dx - dy - x * dz, y * dx + x * dy - b * dz];
};
/** the system exactly as printed in the handout: x′ = σ(x − y), y′ = r·x·y − x·z, z′ = −b·z + x·y */
const literalF = (s: number, b: number, r: number) => (_t: number, y: number[]) => [s * (y[0] - y[1]), r * y[0] * y[1] - y[0] * y[2], -b * y[2] + y[0] * y[1]];
const literalJ = (s: number, b: number, r: number) => (_t: number, y: number[]) => [
  [s, -s, 0],
  [r * y[1] - y[2], r * y[0], -y[0]],
  [y[1], y[0], -b],
];

const dist3 = (a: ArrayLike<number>, c: ArrayLike<number>) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
const last = (s: Solution) => s.y[s.y.length - 1];
const cx = (e: Complex) => (Math.abs(e.im) < 1e-9 ? fmt(e.re, 4) : `${fmt(e.re, 3)} ± ${fmt(Math.abs(e.im), 4)}i`);

interface FixedPoints {
  evO: Complex[];
  /** analytic eigenvalues at O: (−(σ+1) ± √((σ+1)² + 4σ(r−1)))/2 and −b */
  anO: [number, number, number];
  rH: number;
  c: number;
  C: [number, number, number] | null;
  evC: Complex[];
  stableC: boolean;
  /** real / imaginary part of the complex pair at C± */
  alpha: number;
  omega: number;
}

function fixedPoints(s: number, b: number, r: number): FixedPoints {
  const evO = eigenvalues(lorenzJ(s, b, r)(0, [0, 0, 0]));
  const disc = Math.sqrt((s + 1) * (s + 1) + 4 * s * (r - 1));
  const anO: [number, number, number] = [(-(s + 1) + disc) / 2, (-(s + 1) - disc) / 2, -b];
  const rH = s > b + 1 ? (s * (s + b + 3)) / (s - b - 1) : Infinity;
  if (r <= 1) return { evO, anO, rH, c: 0, C: null, evC: [], stableC: false, alpha: NaN, omega: NaN };
  const c = Math.sqrt(b * (r - 1));
  const evC = eigenvalues(lorenzJ(s, b, r)(0, [c, c, r - 1]));
  const pair = evC.find((e) => Math.abs(e.im) > 1e-9);
  const alpha = pair ? pair.re : Math.max(...evC.map((e) => e.re));
  const omega = pair ? Math.abs(pair.im) : 0;
  return { evO, anO, rH, c, C: [c, c, r - 1], evC, stableC: evC.every((e) => e.re < 0), alpha, omega };
}

/** number of sign changes of x = passages between the two «wings» (on [0, T] when T is given) */
function switchesOf(s: Solution, T = Infinity): number {
  let n = 0;
  for (let k = 1; k < s.y.length && s.t[k] <= T; k++) if (s.y[k][0] * s.y[k - 1][0] < 0) n++;
  return n;
}

/** last time the trajectory was farther than `radius` from the target set (O or the nearest of C±) */
function settleTime(s: Solution, fp: FixedPoints, radius: number): number {
  const d = (y: number[]) => (fp.C ? Math.min(dist3(y, fp.C), dist3(y, [-fp.C[0], -fp.C[1], fp.C[2]])) : Math.hypot(y[0], y[1], y[2]));
  for (let k = s.y.length - 1; k >= 0; k--) if (d(s.y[k]) > radius) return s.t[k];
  return 0;
}

/** first time the solution is farther than `lim` from the reference */
function horizonOf(s: Solution, R: (t: number) => number[], lim = 1): number {
  const stride = Math.max(1, Math.floor(s.t.length / 6000));
  for (let k = 0; k < s.t.length; k += stride) if (dist3(s.y[k], R(s.t[k])) > lim) return s.t[k];
  return NaN;
}

/** Allocation-free RK4 for the Lorenz system: successive maxima of z after a transient, lobe switches, end state. */
function lorenzScan(s: number, b: number, r: number, y0: ArrayLike<number>, h: number, tTrans: number, tKeep: number) {
  let x = y0[0],
    y = y0[1],
    z = y0[2];
  const zMax: number[] = [];
  const N = Math.round((tTrans + tKeep) / h);
  const nT = Math.round(tTrans / h);
  let zp = z,
    zpp = z,
    sw = 0;
  for (let k = 0; k < N; k++) {
    const k1x = s * (y - x),
      k1y = r * x - y - x * z,
      k1z = x * y - b * z;
    let X = x + 0.5 * h * k1x,
      Y = y + 0.5 * h * k1y,
      Z = z + 0.5 * h * k1z;
    const k2x = s * (Y - X),
      k2y = r * X - Y - X * Z,
      k2z = X * Y - b * Z;
    X = x + 0.5 * h * k2x;
    Y = y + 0.5 * h * k2y;
    Z = z + 0.5 * h * k2z;
    const k3x = s * (Y - X),
      k3y = r * X - Y - X * Z,
      k3z = X * Y - b * Z;
    X = x + h * k3x;
    Y = y + h * k3y;
    Z = z + h * k3z;
    const k4x = s * (Y - X),
      k4y = r * X - Y - X * Z,
      k4z = X * Y - b * Z;
    zpp = zp;
    zp = z;
    const xn = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    if (xn * x < 0 && k > nT) sw++;
    x = xn;
    y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    z += (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
    if (!Number.isFinite(x) || Math.abs(x) > 1e6) break;
    if (k > nT && zp > zpp && zp >= z) {
      const den = zpp - 2 * zp + z;
      zMax.push(den ? zp - (0.125 * (zpp - z) * (zpp - z)) / den : zp);
    }
  }
  return { zMax, end: [x, y, z], sw };
}

function distinctCount(vals: number[], tol: number): number {
  const u: number[] = [];
  for (const v of vals) {
    if (!u.some((q) => Math.abs(q - v) < tol)) u.push(v);
    if (u.length > 40) return Infinity;
  }
  return u.length;
}

/** bifurcation diagram of z-maxima over r ∈ [r0, r1]: continuation in r, time budget */
function bifScan(s: number, b: number, r0: number, r1: number, n: number, h: number, tTrans: number, tKeep: number, y0: ArrayLike<number>, budgetMs: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  let seed: ArrayLike<number> = y0;
  const t0 = performance.now();
  for (let k = 0; k <= n; k++) {
    const r = r0 + ((r1 - r0) * k) / n;
    const sc = lorenzScan(s, b, r, seed, h, k === 0 ? tTrans * 2 : tTrans, tKeep);
    seed = sc.end.every(Number.isFinite) && Math.abs(sc.end[0]) < 1e3 ? sc.end : y0;
    for (const v of sc.zMax) {
      xs.push(r);
      ys.push(v);
    }
    if (performance.now() - t0 > budgetMs) break;
  }
  return { xs, ys, rMax: xs.length ? xs[xs.length - 1] : r0 };
}

type RegimeKind = "O" | "C" | "transient" | "coexist" | "periodic" | "chaos";

interface RegimeInfo {
  kind: RegimeKind;
  label: string;
  /** time after which the trajectory stays within the radius of its destination (O: 0.01, C±: 0.5) */
  tSettle: number;
  sw: number;
  toPlus: boolean;
  nDistinct: number;
}

/** `T` — horizon used for the settle test; `Tsw` — horizon on which the lobe switches are counted (default T) */
function classifyRegime(fp: FixedPoints, sol: Solution, T: number, nDistinct: number, nMax: number, L: number, Tsw = T): RegimeInfo {
  const sw = switchesOf(sol, Tsw);
  const end = last(sol);
  const toPlus = end[0] > 0;
  if (!fp.C) return { kind: "O", label: "усе згасає в O", tSettle: settleTime(sol, fp, 0.01), sw, toPlus, nDistinct };
  if (fp.stableC) {
    const tS = settleTime(sol, fp, 0.5);
    if (tS < T - 0.5) return { kind: sw > 2 ? "transient" : "C", label: sw > 2 ? `перехідний хаос → C${toPlus ? "+" : "−"}` : `збіжність до C${toPlus ? "+" : "−"}`, tSettle: tS, sw, toPlus, nDistinct };
    return { kind: "coexist", label: "дивний атрактор поруч зі стійкими C±", tSettle: NaN, sw, toPlus, nDistinct };
  }
  if (Number.isFinite(nDistinct) && nDistinct <= 32 && nMax >= 3 * nDistinct && L < 0.05)
    return { kind: "periodic", label: nDistinct === 1 ? "цикл (період-1)" : `періодичне вікно (період-${nDistinct})`, tSettle: NaN, sw, toPlus, nDistinct };
  return { kind: "chaos", label: "хаос", tSettle: NaN, sw, toPlus, nDistinct };
}

// ---------------------------------------------------------------------------------------------------------------------
export default function TLorenz() {
  const [r, setR] = useState(28.5);
  const [sig, setSig] = useState(10);
  const [b, setB] = useState(8 / 3);
  const [T, setT] = useState(25);
  const [h, setH] = useState(0.01);
  const [rtol, setRtol] = useState(1e-6);
  const [delta, setDelta] = useState(1e-6);
  const [start, setStart] = useState(0);
  const [methods, setMethods] = useState<MethodId[]>(["rk2", "rk3", "rk4", "dopri"]);
  const [showTwin, setShowTwin] = useState(true);
  const [literal, setLiteral] = useState(false);
  const [Tconv, setTconv] = useState(0.5);

  const dr = useDeferredValue(r);
  const dSig = useDeferredValue(sig);
  const dB = useDeferredValue(b);
  const dT = useDeferredValue(T);
  const dH = useDeferredValue(h);
  const dRtol = useDeferredValue(rtol);
  const dDelta = useDeferredValue(delta);
  const dLiteral = useDeferredValue(literal);
  const dTconv = useDeferredValue(Tconv);

  const y0 = useMemo<number[]>(() => (start === 0 ? [...Y0_TASK] : [...Y0_ALT]), [start]);

  const problem: Problem = useMemo(() => ({ f: lorenzF(dSig, dB, dr), jac: lorenzJ(dSig, dB, dr), y0: [...y0], T: dT }), [dSig, dB, dr, y0, dT]);
  const fp = useMemo(() => fixedPoints(dSig, dB, dr), [dSig, dB, dr]);

  // ---- methods of the lab
  const sols = useMemo(
    () =>
      (methods.length ? methods : (["rk4"] as MethodId[])).map((m) => ({
        m,
        s: isAdaptive(m) ? solve(m, problem, { rtol: dRtol, atol: dRtol * 1e-3, maxSteps: 400000 }) : solve(m, problem, { h: dH, blowup: 1e6 }),
      })),
    [methods, problem, dH, dRtol],
  );
  const main = sols[0].s;

  // ---- reference and its twin (δ in x(0)); Ts covers the butterfly section even for small δ
  const Ts = Math.max(dT, 40);
  const ref = useMemo(() => solve("dopri", { ...problem, T: Ts }, { rtol: REF_TOL, atol: 1e-15, maxSteps: 1500000 }), [problem, Ts]);
  const refDense = useMemo(() => denseOutput(ref, problem.f), [ref, problem]);
  const twin = useMemo(
    () => solve("dopri", { ...problem, T: Ts, y0: [y0[0] + dDelta, y0[1], y0[2]] }, { rtol: REF_TOL, atol: 1e-15, maxSteps: 1500000 }),
    [problem, Ts, y0, dDelta],
  );
  /** an independent second reference (RK4, h = 2·10⁻⁴) tells until when the DOPRI reference can be trusted */
  const refCheck = useMemo(() => {
    const s = solve("rk4", problem, { h: 2e-4 });
    let t3 = NaN,
      t2 = NaN,
      t1 = NaN;
    for (let k = 0; k < s.t.length; k += 5) {
      const d = dist3(s.y[k], refDense(s.t[k]));
      if (Number.isNaN(t3) && d > 1e-3) t3 = s.t[k];
      if (Number.isNaN(t2) && d > 1e-2) t2 = s.t[k];
      if (d > 1) {
        t1 = s.t[k];
        break;
      }
    }
    return { t3, t2, t1 };
  }, [problem, refDense]);

  // ---- λ₁ (Benettin) for the current parameters and for the book value r = 28
  const lyap = useMemo(() => lyapunov(lorenzV(dSig, dB, dr), [...y0], 3, dr > 50 ? 0.005 : 0.01, 800, 100, 50), [dSig, dB, dr, y0]);
  const L = lyap.L;
  const bookL = useMemo(() => lyapunov(lorenzV(10, 8 / 3, 28), [...Y0_TASK], 3, 0.01, 1000, 100, 50).L, []);

  // ---- Lorenz map (successive z-maxima) and regime of the current r
  const scan = useMemo(() => lorenzScan(dSig, dB, dr, y0, dr > 50 ? 0.004 : 0.01, 30, 150), [dSig, dB, dr, y0]);
  const nDistinct = useMemo(() => distinctCount(scan.zMax, 0.05), [scan]);
  // settle test on the longer internal horizon Ts (more conservative), switches counted on the user's [0, T]
  const regime = useMemo(() => classifyRegime(fp, ref, Ts, nDistinct, scan.zMax.length, L, dT), [fp, ref, Ts, nDistinct, scan, L, dT]);
  const chaos = regime.kind === "chaos" || regime.kind === "coexist";

  // ---- butterfly: distance between the reference and the twin
  const bfly = useMemo(() => {
    const W = denseOutput(twin, problem.f);
    const gap = (tt: number) => dist3(refDense(tt), W(tt));
    const t: number[] = [];
    const d: number[] = [];
    const n = 900;
    for (let k = 0; k <= n; k++) {
      const tt = (Ts * k) / n;
      t.push(tt);
      d.push(Math.max(1e-16, gap(tt)));
    }
    let tHit = NaN;
    for (let k = 1; k < ref.t.length; k++) {
      if (dist3(ref.y[k], W(ref.t[k])) > 1) {
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
    // least-squares slope of ln‖Δ‖ on [0.5, tHit − 2] — the «measured» λ₁
    const tEnd = Number.isFinite(tHit) ? tHit - 2 : Ts;
    const xs: number[] = [],
      ys: number[] = [];
    for (let k = 0; k < ref.t.length; k += 5) {
      const tt = ref.t[k];
      if (tt < 0.5 || tt > tEnd) continue;
      xs.push(tt);
      ys.push(Math.log(dist3(ref.y[k], W(tt))));
    }
    let slope = NaN;
    if (xs.length > 5) {
      const mx = xs.reduce((a, v) => a + v, 0) / xs.length,
        my = ys.reduce((a, v) => a + v, 0) / ys.length;
      slope = xs.reduce((a, v, i) => a + (v - mx) * (ys[i] - my), 0) / xs.reduce((a, v) => a + (v - mx) ** 2, 0);
    }
    return { t, d, tHit, slope };
  }, [twin, ref, refDense, problem, Ts]);

  // ---- per-method statistics: forecast horizon and error at t = 1
  const methodStats = useMemo(
    () =>
      sols.map(({ m, s }) => {
        const s1 = isAdaptive(m)
          ? solve(m, { ...problem, T: 1 }, { rtol: dRtol, atol: dRtol * 1e-3, maxSteps: 400000 })
          : solve(m, { ...problem, T: 1 }, { h: dH, blowup: 1e6 });
        return { m, tH: s.failed ? NaN : horizonOf(s, refDense), e1: s1.failed ? NaN : dist3(last(s1), refDense(1)) };
      }),
    [sols, problem, refDense, dH, dRtol],
  );

  // ---- the six values of r from the assignment (σ, b, y0 as in the lab)
  const regimes = useMemo(
    () =>
      R_PRESETS.map((rr) => {
        const fpR = fixedPoints(dSig, dB, rr);
        const s = solve("dopri", { f: lorenzF(dSig, dB, rr), jac: lorenzJ(dSig, dB, rr), y0: [...y0], T: 25 }, { rtol: 1e-10, atol: 1e-12, maxSteps: 400000 });
        const sc = lorenzScan(dSig, dB, rr, y0, rr > 50 ? 0.004 : 0.01, 30, 100);
        const nd = distinctCount(sc.zMax, 0.05);
        const Lr = lyapunov(lorenzV(dSig, dB, rr), [...y0], 3, rr > 50 ? 0.005 : 0.01, 400, 50, 50).L;
        return { r: rr, fp: fpR, info: classifyRegime(fpR, s, 25, nd, sc.zMax.length, Lr), L: Lr, end: last(s) };
      }),
    [dSig, dB, y0],
  );

  // ---- convergence orders of RK2/RK3/RK4 on [0, Tconv]
  const conv = useMemo(() => {
    const P: Problem = { f: problem.f, jac: problem.jac, y0: [...y0], T: dTconv };
    const refC = solve("dopri", P, { rtol: REF_TOL, atol: 1e-15, maxSteps: 400000 });
    const yR = last(refC);
    const cross = dist3(last(solve("rk4", P, { h: 1e-4 })), yR);
    const rows = (["euler", "rk2", "rk3", "rk4"] as MethodId[]).map((m) => {
      const errs = CONV_H.map((hh) => {
        const s = solve(m, P, { h: hh, blowup: 1e12 });
        return { h: hh, e: s.failed ? NaN : dist3(last(s), yR), fe: s.fevals };
      });
      const orders = errs.slice(1).map((e, i) => Math.log2(errs[i].e / e.e));
      return { m, errs, orders, meanOrder: orders.reduce((a, v) => a + v, 0) / orders.length };
    });
    const curves = (["rk2", "rk3", "rk4"] as MethodId[]).map((m) => {
      const pts: { fe: number; e: number; h: number }[] = [];
      for (let n = 25; n <= 6400; n = Math.round(n * Math.SQRT2)) {
        const s = solve(m, P, { h: dTconv / n, blowup: 1e12 });
        const e = s.failed ? NaN : dist3(last(s), yR);
        if (Number.isFinite(e) && e > 1e-13) pts.push({ fe: s.fevals, e, h: dTconv / n });
      }
      const need = (tol: number) => pts.find((p) => p.e <= tol);
      return { m, pts, need4: need(1e-4), need6: need(1e-6) };
    });
    return { rows, curves, cross, refSteps: refC.steps };
  }, [problem.f, problem.jac, y0, dTconv]);

  // ---- stiffness along the trajectory: the same 160 samples of `main` as StiffnessPanel, plus the median of the ratio
  const stiff = useMemo(() => {
    const ratios: number[] = [];
    let maxFast = 0;
    const n = main.t.length;
    for (let k = 0; k < 160; k++) {
      const i = Math.floor((k / 159) * (n - 1));
      const st = stiffnessAt(problem, main.t[i], main.y[i]);
      const all = st.ev.map((e) => Math.abs(e.re));
      const top = Math.max(...all);
      const mags = all.filter((v) => v > 1e-300 && v > 1e-11 * top);
      if (!mags.length) continue;
      maxFast = Math.max(maxFast, top);
      ratios.push(top / Math.min(...mags));
    }
    ratios.sort((p, q) => p - q);
    return { maxFast, median: ratios[ratios.length >> 1] ?? NaN, max: ratios[ratios.length - 1] ?? NaN };
  }, [main, problem]);

  // ---- implicit Euler vs RK4 at the same step (why implicit methods are a bad idea here)
  const ieCmp = useMemo(() => {
    const ie = solve("ieuler", problem, { h: dH, blowup: 1e6 });
    const rk = solve("rk4", problem, { h: dH, blowup: 1e6 });
    const dC = (y: number[]) => (fp.C ? Math.min(dist3(y, fp.C), dist3(y, [-fp.C[0], -fp.C[1], fp.C[2]])) : NaN);
    const hStar = fp.alpha > 0 ? (2 * fp.alpha) / (fp.alpha * fp.alpha + fp.omega * fp.omega) : NaN;
    const Rie = 1 / Math.hypot(1 - dH * fp.alpha, dH * fp.omega);
    const Rex = Math.exp(dH * fp.alpha);
    return { ie, rk, swIe: switchesOf(ie), swRk: switchesOf(rk), swRef: switchesOf(ref, dT), dIe: dC(last(ie)), tHie: horizonOf(ie, refDense), tHrk: horizonOf(rk, refDense), hStar, Rie, Rex };
  }, [problem, dH, dT, fp, ref, refDense]);

  // ---- the «literal» system from the handout (computed only when switched on)
  const lit = useMemo(() => {
    if (!dLiteral) return null;
    const TL = Math.min(dT, 25);
    const P: Problem = { f: literalF(dSig, dB, dr), jac: literalJ(dSig, dB, dr), y0: [...y0], T: TL };
    const s = solve("ros", P, { rtol: 1e-6, atol: 1e-9, maxSteps: 400000, blowup: 1e300 });
    const rk = solve("rk4", { f: P.f, y0: [...y0], T: TL }, { h: dH, blowup: 1e300 });
    const rk2 = solve("rk2", { f: P.f, y0: [...y0], T: TL }, { h: dH, blowup: 1e300 });
    let tSign = NaN,
      yMax = -Infinity,
      tYmax = 0;
    for (let k = 1; k < s.t.length; k++) {
      if (Number.isNaN(tSign) && s.y[k][0] * s.y[k - 1][0] < 0) tSign = s.t[k];
      if (s.y[k][1] > yMax) {
        yMax = s.y[k][1];
        tYmax = s.t[k];
      }
    }
    const at = (tt: number) => s.y[indexAt(s.t, tt)];
    const tA = Math.min(2, TL / 2),
      tB = s.t[s.t.length - 1];
    const slope = Math.log(Math.abs(at(tB)[0]) / Math.abs(at(tA)[0])) / (tB - tA);
    const lg = (v: number) => Math.max(1e-12, Math.abs(v));
    return {
      s,
      rk,
      rk2,
      tSign,
      yMax,
      tYmax,
      slope,
      xEnd: at(tB)[0],
      tEnd: tB,
      log10x: Math.log10(Math.abs(at(tB)[0])),
      yEnd: at(tB)[1],
      zEnd: at(tB)[2],
      series: [
        { x: s.t, y: s.y.map((v) => lg(v[0])), color: "#f0abfc", label: "|x|", width: 1.6 },
        { x: s.t, y: s.y.map((v) => lg(v[1])), color: "#5cc8ff", label: "|y|", width: 1.2 },
        { x: s.t, y: s.y.map((v) => lg(v[2])), color: "#ff7ad9", label: "|z|", width: 1.2 },
      ],
      jacYY: dr * at(Math.min(1, tB))[0],
    };
  }, [dLiteral, dSig, dB, dr, dT, y0, dH]);

  // ---- bifurcation diagrams (depend on σ, b only)
  const bif1 = useMemo(() => bifScan(dSig, dB, 0, 60, 240, 0.01, 40, 40, y0, 1500), [dSig, dB, y0]);
  const bif2 = useMemo(() => bifScan(dSig, dB, 95, 110, 200, 0.005, 60, 40, y0, 1500), [dSig, dB, y0]);

  // ---- facts for the quiz: parameters of the assignment, independent of the sliders
  const facts = useMemo(() => {
    const P: Problem = { f: lorenzF(10, 8 / 3, 28.5), jac: lorenzJ(10, 8 / 3, 28.5), y0: [...Y0_TASK], T: 25 };
    const R0 = solve("dopri", P, { rtol: REF_TOL, atol: 1e-15, maxSteps: 1500000 });
    const R = denseOutput(R0, P.f);
    const run = (m: MethodId, o: { h?: number; rtol?: number; atol?: number }) => {
      const s = solve(m, P, { ...o, blowup: 1e6, maxSteps: 400000 });
      const s1 = solve(m, { ...P, T: 1 }, { ...o, blowup: 1e6, maxSteps: 400000 });
      return { tH: horizonOf(s, R), fe: s.fevals, je: s.jevals, sw: switchesOf(s), end: last(s), e1: dist3(last(s1), R(1)) };
    };
    const fp28 = fixedPoints(10, 8 / 3, 28.5);
    const C = fp28.C!;
    const dC = (y: number[]) => Math.min(dist3(y, C), dist3(y, [-C[0], -C[1], C[2]]));
    const rk4 = run("rk4", { h: 0.01 }),
      rk2 = run("rk2", { h: 0.01 }),
      ie = run("ieuler", { h: 0.01 }),
      trap = run("trap", { h: 0.01 });
    const litS = solve("ros", { f: literalF(10, 8 / 3, 28.5), jac: literalJ(10, 8 / 3, 28.5), y0: [...Y0_TASK], T: 10 }, { rtol: 1e-6, atol: 1e-9, maxSteps: 400000, blowup: 1e300 });
    const litRk = solve("rk4", { f: literalF(10, 8 / 3, 28.5), y0: [...Y0_TASK], T: 10 }, { h: 0.01, blowup: 1e300 });
    const lAt = (tt: number) => litS.y[indexAt(litS.t, tt)];
    const litSlope = Math.log(Math.abs(lAt(10)[0]) / Math.abs(lAt(2)[0])) / 8;
    const fp05 = fixedPoints(10, 8 / 3, 0.5);
    const s05 = solve("dopri", { f: lorenzF(10, 8 / 3, 0.5), y0: [...Y0_TASK], T: 25 }, { rtol: 1e-10, atol: 1e-12 });
    return {
      swRef: switchesOf(R0),
      rk4,
      rk2,
      ie: { ...ie, dC: dC(ie.end) },
      trap,
      hStar: (2 * fp28.alpha) / (fp28.alpha ** 2 + fp28.omega ** 2),
      Rie: 1 / Math.hypot(1 - 0.01 * fp28.alpha, 0.01 * fp28.omega),
      fp28,
      fp245: fixedPoints(10, 8 / 3, 24.5),
      fp05,
      tO05: settleTime(s05, fp05, 0.01),
      litSlope,
      litLog10x10: Math.log10(Math.abs(lAt(10)[0])),
      litRkFail: litRk.failed ? litRk.t[litRk.t.length - 1] : NaN,
      litYmax: Math.max(...litS.y.map((v) => v[1])),
    };
  }, []);

  // ---- derived display values
  const horizonEst = L > 0.01 ? Math.log(1 / dDelta) / L : Infinity;
  const doubling = Number.isFinite(bfly.slope) && bfly.slope > 0 ? Math.LN2 / bfly.slope : NaN;
  const dopriSol = sols.find(({ m }) => m === "dopri")?.s;
  const rPresetIdx = R_PRESETS.indexOf(r);
  const rk4Row = conv.rows.find((q) => q.m === "rk4")!;
  const rk2Row = conv.rows.find((q) => q.m === "rk2")!;
  const rk3Row = conv.rows.find((q) => q.m === "rk3")!;
  const eulRow = conv.rows.find((q) => q.m === "euler")!;
  const cRk2 = conv.curves[0],
    cRk3 = conv.curves[1],
    cRk4 = conv.curves[2];
  const accH = fp.omega > 0 ? (2 * Math.PI) / fp.omega / 20 : NaN;
  const stabH = 2.785 / stiff.maxFast;

  const regimeText = (() => {
    const sgn = regime.toPlus ? "+" : "−";
    switch (regime.kind) {
      case "O":
        return {
          tone: "good" as const,
          title: "r < 1: єдина рівновага O, і вона стійка",
          simpleTitle: "Тонкий струмінь: колесо зупиняється",
          sci: (
            <>
              Усі три власні числа якобіана в O від&apos;ємні: {fp.anO.map((v) => fmt(v, 4)).join(", ")}. Траєкторія з точки умови входить у кулю радіуса 0.01 навколо
              O при t ≈ {fmt(regime.tSettle, 3)} і більше її не покидає; найповільніша мода згасає як e<sup>{fmt(fp.anO[0], 3)}t</sup>. Жоден метод тут не має
              проблем — похибки не підсилюються (λ₁ = {fmt(L, 3)} &lt; 0).
            </>
          ),
          simple: (
            <>
              Води замало: ковшики протікають швидше, ніж наповнюються, і колесо стає. У моделі всі три змінні згасають до нуля — вже при t ≈{" "}
              {fmt(regime.tSettle, 3)} від них лишається менше сотої. Похибки тут теж згасають, тож усі методи малюють те саме.
            </>
          ),
        };
      case "C":
        return {
          tone: "good" as const,
          title: `1 < r < r_H: збіжність до C${sgn}`,
          simpleTitle: "Колесо розкручується в один бік",
          sci: (
            <>
              O стала сідлом (власне число {fmt(fp.anO[0], 3)} &gt; 0), а дві нові рівноваги C± = (±{fmt(fp.c, 4)}, ±{fmt(fp.c, 4)}, {fmt(dr - 1, 4)}) стійкі: власні
              числа {fp.evC.map(cx).join("; ")}. Траєкторія з цієї точки робить {regime.sw} {plural(regime.sw, ["перехід", "переходи", "переходів"])} між
              «крилами» і з t ≈ {fmt(regime.tSettle, 3)} лишається в кулі радіуса 0.5 навколо C{sgn}; спіраль згасає як e<sup>{fmt(fp.alpha, 3)}t</sup> з
              періодом {fmt((2 * Math.PI) / fp.omega, 3)}. λ₁ = {fmt(L, 3)} &lt; 0.
            </>
          ),
          simple: (
            <>
              Води вистачає, щоб колесо розкрутилось, і воно крутиться рівномірно в один бік — у моделі це рівновага C{sgn}. Траєкторія «сідає» на неї
              при t ≈ {fmt(regime.tSettle, 3)} (після {regime.sw} {plural(regime.sw, ["зміни", "зміни", "змін"])} напрямку). Похибки згасають разом із коливаннями.
            </>
          ),
        };
      case "transient":
        return {
          tone: "warn" as const,
          title: `Перехідний хаос, потім C${sgn}`,
          simpleTitle: "Довго метається, потім заспокоюється",
          sci: (
            <>
              C± стійкі ({fp.evC.map(cx).join("; ")}), але поруч із ними в фазовому просторі вже живе хаотична множина (вона з&apos;являється при r ≈ 13.93 —
              довідкове значення, гомоклінічний вибух). Траєкторія {regime.sw} {plural(regime.sw, ["раз", "рази", "разів"])} перестрибує між крилами і лише при t ≈{" "}
              {fmt(regime.tSettle, 3)} остаточно осідає на C{sgn}. Куди саме — залежить від найменших похибок, тож різні методи можуть осісти на різних крилах.
            </>
          ),
          simple: (
            <>
              Колесо довго смикається туди-сюди ({regime.sw} {plural(regime.sw, ["реверс", "реверси", "реверсів"])}), але зрештою вибирає напрямок і крутиться
              рівномірно — з t ≈ {fmt(regime.tSettle, 3)}. Який саме напрямок — вирішує випадок, тобто крихітні похибки.
            </>
          ),
        };
      case "coexist":
        return {
          tone: "warn" as const,
          title: "Співіснування: стійкі C± і дивний атрактор",
          simpleTitle: "Два сценарії одночасно",
          sci: (
            <>
              C± ще стійкі (Re λ = {fmt(fp.alpha, 4)} &lt; 0, до Хопфа при r_H = {fmt(fp.rH, 4)} лишилось {fmt(fp.rH - dr, 3)}), але з r ≈ 24.06 (довідкове значення для
              σ = 10, b = 8/3) поруч існує притягальний дивний атрактор. Точка умови належить його басейну: за {fmt(dT, 3)} одиниць часу траєкторія зробила {regime.sw}{" "}
              {plural(regime.sw, ["перехід", "переходи", "переходів"])} між крилами й до t = {fmt(Ts, 3)} так і не наблизилась до C± (λ₁ = {fmt(L, 3)} &gt; 0). Старт
              поруч із C± натомість згас би.
            </>
          ),
          simple: (
            <>
              Рівномірне обертання тут можливе — але тільки якщо колесо вже майже так крутиться. З точки умови воно натомість потрапляє в хаотичний
              режим і за {fmt(dT, 3)} одиниць часу змінило напрямок {regime.sw} {plural(regime.sw, ["раз", "рази", "разів"])}. Два сценарії співіснують, і
              перемагає той, до чиєї «зони тяжіння» ближчий старт.
            </>
          ),
        };
      case "periodic":
        return {
          tone: "info" as const,
          title: `r > r_H, але режим періодичний: ${regime.label}`,
          simpleTitle: "Вікно порядку серед хаосу",
          sci: (
            <>
              C± нестійкі (Re λ = {fmt(fp.alpha, 4)} &gt; 0), проте послідовні максимуми z набувають лише {regime.nDistinct}{" "}
              {plural(regime.nDistinct, ["значення", "значення", "значень"])} — траєкторія лягла на замкнений цикл (λ₁ = {fmt(L, 3)} ≈ 0). Такі «вікна»
              є в хаосі Лоренца, наприклад при r ∈ (99.5, 100.8).
            </>
          ),
          simple: (
            <>
              Хоч рівномірне обертання і нестійке, колесо знайшло складний, але повторюваний танець: висоти «викидів» z повторюються з періодом{" "}
              {regime.nDistinct}. Поруч (трохи інше r) — знову хаос.
            </>
          ),
        };
      default:
        return {
          tone: "bad" as const,
          title: "r > r_H: класичний хаос Лоренца",
          simpleTitle: "Сильний потік: колесо непередбачуване",
          sci: (
            <>
              Після біфуркації Хопфа при r_H = {fmt(fp.rH, 4)} рівноваги C± нестійкі (Re λ = {fmt(fp.alpha, 4)} &gt; 0, спіраль розкручується з періодом{" "}
              {fmt((2 * Math.PI) / fp.omega, 3)}), і траєкторія вічно перестрибує між крилами: {regime.sw} {plural(regime.sw, ["перехід", "переходи", "переходів"])}{" "}
              за {fmt(dT, 3)} одиниць часу, {Number.isFinite(regime.nDistinct) ? regime.nDistinct : "понад 40"} різних максимумів z, λ₁ = {fmt(L, 3)} &gt; 0.
            </>
          ),
          simple: (
            <>
              Води так багато, що ковшики, які піднімаються, не встигають спорожніти, перехиляють колесо назад — і так без кінця: {regime.sw}{" "}
              {plural(regime.sw, ["реверс", "реверси", "реверсів"])} за {fmt(dT, 3)} одиниць часу, жоден не схожий на попередній. Крихітні похибки тут
              подвоюються кожні {fmt(Math.LN2 / Math.max(L, 1e-6), 3)} одиниць часу.
            </>
          ),
        };
    }
  })();

  return (
    <>
      <AnalogyCard
        emoji="🎡"
        title="Водяне колесо, яке не знає, куди крутитиметься"
        story={
          <>
            Уявіть колесо з ковшиками, у кожному з яких дірка; зверху з крана ллється вода. <b>Тонкий струмінь</b> — ковшики протікають швидше, ніж
            наповнюються, колесо стоїть. <b>Середній</b> — верхні ковшики важчають, колесо розкручується і крутиться рівномірно. <b>Сильний</b> — ковшики,
            що піднімаються з того боку, не встигають спорожніти, переважують, колесо гальмує й рушає назад — і так без кінця, щоразу інакше. Це колесо
            Малкуса, і його рівняння — <b>буквально</b> система Лоренца.
          </>
        }
        mapping={[
          ["напір води з крана", <>параметр r (у Лоренца — підігрів знизу)</>],
          ["швидкість обертання колеса", <>змінна x</>],
          ["перекіс води «ліво–право» і «верх–низ»", <>змінні y та r − z</>],
          ["дірки в ковшиках і тертя осі", <>доданки −y, −bz, −σx (дисипація)</>],
          ["колесо стоїть / крутиться рівно / реверсує", <>O стійка (r &lt; 1) / C± стійкі / дивний атрактор</>],
          ["«через скільки секунд реверс?» — невідомо", <>λ₁ ≈ {fmt(bookL, 2)}: похибка росте як e<sup>λ₁t</sup></>],
        ]}
      >
        <MalkusWheelScene />
      </AnalogyCard>

      {/* ============================================================ постановка */}
      <Section kicker="Постановка" title="Модель Лоренца: три рівняння й одна помилка в методичці" simpleTitle="Що написано в методичці — і що мали на увазі">
        <Grid>
          <Card title="Система з методички (дослівно)" icon="📜">
            <Tex block>{String.raw`\begin{cases} x' = \sigma\,(x - y),\\ y' = r\,x\,y - x\,z,\\ z' = -b\,z + x\,y, \end{cases}\qquad t\in[0,25],`}</Tex>
            <Tex block>{String.raw`(x,y,z)(0) = (3.051522,\ 1.582542,\ 15.62388),\quad \sigma = 10,\ b = \tfrac{8}{3},\quad r \in \{0.5,\,1.5,\,15.5,\,24.5,\,28.5,\,105\}.`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                  Завдання просить «застосувати один із числових методів» і побудувати розв&apos;язок на відрізку від 0 до 25 для шести значень r. Але якщо
                  інтегрувати саме те, що надруковано, — нічого схожого на знаменитого «метелика» не вийде (перемикач нижче показує, що саме вийде).
                </p>
              }
            >
              <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                Формули в документі набрано в MathType; у першому рівнянні надруковано <Tex>{"\\sigma(x-y)"}</Tex> замість <Tex>{"\\sigma(y-x)"}</Tex>, а в
                другому — <Tex>{"r\\,x\\,y"}</Tex> замість <Tex>{"r\\,x - y"}</Tex>. Обидві «описки» перетворюють дисипативну систему на систему з
                експоненційним розгоном (див. перемикач «як надруковано»).
              </p>
            </Say>
          </Card>
          <Card title="Класична система Лоренца (з нею працює сторінка)" icon="🦋">
            <Tex block>{String.raw`\begin{cases} \dot x = \sigma\,(y - x),\\ \dot y = r\,x - y - x\,z,\\ \dot z = x\,y - b\,z. \end{cases}`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                  Едвард Лоренц (1963) вивів ці рівняння як грубу модель конвекції в шарі повітря, що підігрівається знизу: x — швидкість обертання
                  валка повітря, y і z — перекіс температури по горизонталі й вертикалі, r — сила підігріву. Та сама математика описує й водяне колесо
                  зверху.
                </p>
              }
            >
              <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                Лоренц (1963) отримав її трьохмодовим відсіканням рівнянь Релея–Бенара: <Tex>{"x"}</Tex> — інтенсивність конвекції, <Tex>{"y"}</Tex> —
                різниця температур між висхідним і низхідним потоками, <Tex>{"z"}</Tex> — відхилення вертикального профілю температури від лінійного;{" "}
                <Tex>{"\\sigma"}</Tex> — число Прандтля, <Tex>{"r"}</Tex> — нормоване число Релея, <Tex>{"b"}</Tex> — геометрія комірки. Дивергенція поля{" "}
                <Tex>{"-(\\sigma+1+b)"}</Tex> = {fmt(-(dSig + 1 + dB), 4)} &lt; 0: об&apos;єми стискаються, тому атрактор має нульовий об&apos;єм.
              </p>
            </Say>
            <div className="mt-3">
              <Insight tone="note" title="Неточності умови" simpleTitle="Що не так в умові">
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    <b>Знак у першому рівнянні:</b> надруковано <Tex>{"\\sigma(x-y)"}</Tex>; у Лоренца <Tex>{"\\sigma(y-x)"}</Tex>. З плюсом при x рівновага O
                    стає сідлом із власним числом +σ = {fmt(dSig, 3)} за будь-якого r.
                  </li>
                  <li>
                    <b>Друге рівняння:</b> «rxy − xz» — очевидно втрачене «−» і зайве y: має бути <Tex>{"r\\,x - y - x\\,z"}</Tex>. Член <Tex>{"-y"}</Tex> — це
                    дисипація; без нього система не має обмеженого атрактора.
                  </li>
                  <li>
                    <b>«Один із числових методів»</b> не названо. Ми порівнюємо RK2, RK3, RK4 (сталий крок) і DOPRI45 (адаптивний) і обґрунтовуємо вибір у висновках;
                    критерій — похибка на короткому відрізку й горизонт прогнозу.
                  </li>
                  <li>
                    <b>Початкова точка</b> (3.051522, 1.582542, 15.62388) лежить на атракторі для r ≈ 28 (так її й підібрали), тож для r = 28.5 перехідного
                    процесу майже немає; для інших r вона «чужа» — це видно в таблиці режимів.
                  </li>
                  <li>
                    <b>Відрізок [0, 25]</b> для хаотичних r — це приблизно {fmt(25 * bookL, 2)} ляпуновських часів: будь-який метод з похибкою 10⁻¹⁰ на
                    старті до t = 25 втрачає траєкторію повністю. Тобто «розв&apos;язок» у сенсі точкової траєкторії на всьому відрізку не існує — існує
                    статистика (форма атрактора).
                  </li>
                </ul>
              </Insight>
            </div>
          </Card>
        </Grid>

        <div className="mt-4">
          <Card title="А що, як інтегрувати саме те, що надруковано?" icon="🧯" right={<Toggle label="як надруковано" value={literal} onChange={setLiteral} />}>
            {!lit && (
              <Say
                simple={
                  <p className="text-[14px] text-white/65">
                    Увімкніть перемикач — сторінка проінтегрує «буквальну» систему для поточного r жорстким методом Розенброка (бо явні методи на ній
                    одразу переповнюються) і покаже, що відбувається.
                  </p>
                }
              >
                <p className="text-[14px] text-white/65">
                  Увімкніть перемикач: «буквальну» систему для поточного r = {fmt(dr, 4)} буде проінтегровано методом Розенброка 2(3) (rtol 10⁻⁶), а
                  поруч — RK4 і RK2 з кроком h = {fmt(dH, 3)}, як це зробив би студент.
                </p>
              </Say>
            )}
            {lit && (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Stat label="Що робить x" value={`|x| ~ e^{${fmt(lit.slope, 3)}·t}`} sub={`нахил ln|x| на [${fmt(Math.min(2, lit.tEnd / 2), 2)}, ${fmt(lit.tEnd, 3)}]; σ = ${fmt(dSig, 3)}`} tone="bad" />
                  <Stat label={`x(${fmt(lit.tEnd, 3)})`} value={`${lit.xEnd < 0 ? "−" : ""}10^${fmt(lit.log10x, 4)}`} sub={`x змінює знак при t ≈ ${fmt(lit.tSign, 3)}; max y = ${fmt(lit.yMax, 4)}`} tone="bad" />
                  <Stat label="y, z наприкінці" value={`${Math.abs(lit.yEnd) < 1e-200 ? "0" : fmt(lit.yEnd, 2)}, ${Math.abs(lit.zEnd) < 1e-200 ? "0" : fmt(lit.zEnd, 2)}`} sub="обидві прямують до 0 (нижче 10⁻³⁰⁰ — машинний нуль)" />
                  <Stat
                    label={`RK4 / RK2, h = ${fmt(dH, 3)}`}
                    value={lit.rk.failed ? `NaN при t ≈ ${fmt(lit.rk.t[lit.rk.t.length - 1], 3)}` : "дорахував"}
                    sub={lit.rk2.failed ? `RK2: ${lit.rk2.failed.includes("вибух") ? "переповнення" : "збій"} при t ≈ ${fmt(lit.rk2.t[lit.rk2.t.length - 1], 3)}` : "RK2 дорахував"}
                    tone="bad"
                  />
                </div>
                <div className="mt-3">
                  <Plot title="«Буквальна» система: |x|, |y|, |z| (лог. шкала, Розенброк)" height={240} xLabel="t" logY series={lit.series} />
                </div>
                <div className="mt-3">
                  <Insight
                    tone="bad"
                    title="Не метелик, а ракета: експоненційний розгін і жахлива жорсткість"
                    simpleTitle="Не метелик, а ракета"
                    simple={
                      <>
                        Із надрукованими знаками модель не «втомлюється»: x спершу за мить ({fmt(lit.tSign, 2)} од. часу) змінює знак, а далі зростає за модулем
                        удвічі кожні {fmt(Math.LN2 / lit.slope, 3)} одиниці часу — до t = {fmt(lit.tEnd, 3)} це число з {Math.round(lit.log10x)} знаками. Перемінні y
                        та z тим часом падають у нуль. Звичайний RK4 з кроком {fmt(dH, 3)} видає NaN уже при t ≈ {fmt(lit.rk.t[lit.rk.t.length - 1], 3)}. Жодного з шести
                        режимів за r тут не існує — усі шість виглядають однаково.
                      </>
                    }
                  >
                    У O буквальна система має власні числа {fmt(dSig, 3)}, 0 і {fmt(-dB, 4)}: це сідло з розгоном e<sup>σt</sup> незалежно від r. Чисельно: x
                    змінює знак при t ≈ {fmt(lit.tSign, 3)}, після чого <Tex>{"\\ln|x|"}</Tex> зростає лінійно з нахилом {fmt(lit.slope, 4)} ≈ σ (кожні{" "}
                    {fmt(Math.LN2 / lit.slope, 3)} од. часу — подвоєння), а y, z → 0 (вони зануляються в подвійній точності вже біля t ≈ 2). Скінченного часу
                    вибуху немає — це чиста експонента, |x({fmt(lit.tEnd, 3)})| = 10<sup>{fmt(lit.log10x, 4)}</sup>. Але задача стає надзвичайно{" "}
                    <b>жорсткою</b>: ∂ẏ/∂y = r·x ≈ {fmt(lit.jacYY, 3)} уже при t = 1 і далі росте як x, тому явні методи (RK4 з h = {fmt(dH, 3)} — NaN при t ≈{" "}
                    {fmt(lit.rk.t[lit.rk.t.length - 1], 3)}) миттєво втрачають стійкість, а DOPRI «дріботить» мільйонами кроків. Єдина нерухома точка з x ≠ 0 —{" "}
                    <Tex>{"(rb,\\ rb,\\ r^2 b)"}</Tex> = ({fmt(dr * dB, 4)}, {fmt(dr * dB, 4)}, {fmt(dr * dr * dB, 4)}) — теж нестійка. Шість значень r дають
                    шість майже однакових графіків: усе цікаве в моделі Лоренца живе саме в знаках, які загубила методичка.
                  </Insight>
                </div>
              </>
            )}
          </Card>
        </div>
      </Section>

      {/* ============================================================ лабораторія */}
      <Section kicker="Лабораторія" title="Крутіть r — від спокою до хаосу" simpleTitle="Крутіть кран — від спокою до хаосу">
        <Lab
          controls={
            <>
              <Chips
                label="r з умови"
                value={rPresetIdx >= 0 ? r : -1}
                onChange={(v) => v >= 0 && setR(v)}
                options={R_PRESETS.map((v) => ({ value: v, label: String(v).replace(".", ",") }))}
              />
              <Slider label="r" value={r} onChange={setR} min={0} max={120} step={0.1} />
              <Slider label="σ" value={sig} onChange={setSig} min={1} max={20} step={0.1} />
              <Slider label="b" value={b} onChange={setB} min={0.5} max={5} step={0.01} />
              <Chips
                label="Старт"
                value={start}
                onChange={setStart}
                options={[
                  { value: 0, label: "(3.05, 1.58, 15.62) — умова" },
                  { value: 1, label: "(0, 1, 0)" },
                ]}
              />
              <Slider label="Кінець відрізка T" value={T} onChange={setT} min={5} max={50} step={1} hint="в умові T = 25" />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Slider label="Крок h (методи зі сталим кроком)" value={h} onChange={setH} min={0.002} max={0.05} log />
              <Slider label="rtol (DOPRI45, Розенброк)" value={rtol} onChange={setRtol} min={1e-9} max={1e-3} log format={(v) => fmt(v, 2)} hint="atol = rtol/1000" />
              <Slider label="Збурення x(0) += δ" value={delta} onChange={setDelta} min={1e-12} max={1e-2} log format={(v) => fmt(v, 2)} />
              <Toggle label="Показати «двійника» в 3D" value={showTwin} onChange={setShowTwin} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                Режим: <b className="text-white">{regime.label}</b>, <Tex>{`\\lambda_1 \\approx ${fmt(L, 3)}`}</Tex>
              </div>
            </>
          }
        >
          <Playground sols={sols} twin={showTwin ? twin : null} T={dT} fp={fp} />

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label="Режим"
              value={regime.kind === "chaos" ? "хаос" : regime.kind === "O" ? "спокій" : regime.kind === "C" ? `C${regime.toPlus ? "+" : "−"}` : regime.kind === "periodic" ? `P-${regime.nDistinct}` : regime.kind === "coexist" ? "атрактор" : "транзієнт"}
              sub={regime.kind === "chaos" ? `C± нестійкі; ${regime.sw} ${plural(regime.sw, ["перехід", "переходи", "переходів"])} на [0, ${fmt(dT, 3)}]` : regime.label}
              tone={chaos ? "bad" : regime.kind === "periodic" ? "warn" : "good"}
            />
            <Stat label="Показник Ляпунова λ₁" value={fmt(L, 3)} sub={L > 0.01 ? `Бенеттін, 800 од. часу; подвоєння кожні ${fmt(Math.LN2 / L, 3)}` : "≤ 0: сусідні траєкторії не розбігаються"} tone={L > 0.01 ? "warn" : "good"} />
            <Stat label="Горизонт ln(1/δ)/λ₁" value={Number.isFinite(horizonEst) ? `t ≈ ${fmt(horizonEst, 3)}` : "∞"} sub={`оцінка для δ = ${fmt(dDelta, 2)}`} />
            <Stat label="Двійник відійшов на 1" value={Number.isFinite(bfly.tHit) ? `t ≈ ${fmt(bfly.tHit, 3)}` : "ніколи"} sub="виміряно за двома еталонами DOPRI 10⁻¹³" tone={Number.isFinite(bfly.tHit) ? "warn" : "good"} />
          </div>

          <Card title="Методи на цьому відрізку" icon="🧮">
            <Table
              head={["Метод", "Кроки", "f-обчислень", "Час", "Похибка при t = 1", "Горизонт ‖Δ‖ > 1"]}
              rows={sols.map(({ m, s }, k) => [
                <span key="m" style={{ color: METHODS[m].color }}>
                  {METHODS[m].short}
                  {isAdaptive(m) ? "" : ` (h = ${fmt(dH, 3)})`}
                </span>,
                s.failed ? <span key="f" className="text-[#ff5d73]">💥 {s.failed}</span> : `${s.steps}${s.rejected ? ` (+${s.rejected} відх.)` : ""}`,
                `${s.fevals}${s.jevals ? ` + ${s.jevals} J` : ""}`,
                fmtMs(s.ms),
                Number.isFinite(methodStats[k].e1) ? fmt(methodStats[k].e1, 3) : "—",
                s.failed ? "—" : Number.isFinite(methodStats[k].tH) ? `t ≈ ${fmt(methodStats[k].tH, 3)}` : `> ${fmt(dT, 3)}`,
              ])}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] text-white/55">
                  «Похибка при t = 1» — наскільки метод відхилився від дуже точного розрахунку (DOPRI з допуском 10⁻¹³) ще до того, як хаос усе розмазав.
                  «Горизонт» — момент, після якого метод малює вже зовсім іншу траєкторію (відстань більша за 1). У хаотичному режимі він настає для будь-якого
                  методу — питання лише коли.
                </p>
              }
            >
              <p className="mt-2 text-[13px] text-white/55">
                Еталон — DOPRI45 з rtol = 10⁻¹³, atol = 10⁻¹⁵ ({ref.steps} кроків на [0, {fmt(Ts, 3)}]). Його власна надійність перевірена незалежним RK4 з h = 2·10⁻⁴: два
                еталони розходяться на 10⁻³ при t ≈ {Number.isFinite(refCheck.t3) ? fmt(refCheck.t3, 3) : `> ${fmt(dT, 3)}`}, на 10⁻² при t ≈{" "}
                {Number.isFinite(refCheck.t2) ? fmt(refCheck.t2, 3) : `> ${fmt(dT, 3)}`}, на 1 — {Number.isFinite(refCheck.t1) ? `при t ≈ ${fmt(refCheck.t1, 3)}` : `ніде на [0, ${fmt(dT, 3)}]`}
                . Тому горизонти за критерієм ‖Δ‖ &gt; 1 надійні, а похибки при t = 1 — точні до ~10⁻¹¹.
              </p>
            </Say>
          </Card>

          <Insight tone={regimeText.tone} title={regimeText.title} simpleTitle={regimeText.simpleTitle} simple={regimeText.simple}>
            {regimeText.sci}
          </Insight>

          {chaos && (
            <Insight
              tone="warn"
              title="Хаос: будь-який метод має термін придатності"
              simple={
                <>
                  Похибка тут <b>множиться</b>: кожні {fmt(Math.LN2 / L, 3)} од. часу — удвічі. За весь відрізок T = {fmt(dT, 3)} це{" "}
                  <Relatable kind="growth" n={Math.exp(L * dT)} />. Тому RK2, RK3, RK4 і DOPRI на [0, 25] неминуче розійдуться — і жоден не бреше. Довіряти
                  можна формі метелика, а не точній позиції в момент t.
                </>
              }
            >
              λ₁ ≈ {fmt(L, 3)}: за T = {fmt(dT, 3)} збурення зростає в e<sup>λ₁T</sup> ≈ {fmt(Math.exp(L * dT), 2)} разів. Похибка RK4 з h = {fmt(dH, 3)} при t = 1
              дорівнює {Number.isFinite(methodStats.find((q) => q.m === "rk4")?.e1 ?? NaN) ? fmt(methodStats.find((q) => q.m === "rk4")!.e1, 2) : "—"}, тож
              до рівня 1 вона дійде приблизно за ln(1/ε)/λ₁ ≈{" "}
              {Number.isFinite(methodStats.find((q) => q.m === "rk4")?.e1 ?? NaN) ? fmt(1 + Math.log(1 / methodStats.find((q) => q.m === "rk4")!.e1) / L, 3) : "—"} — порівняйте з
              виміряним горизонтом у таблиці. Коректне завдання для хаотичного r — не «траєкторія на [0, 25]», а інваріанти: форма атрактора, мапа
              максимумів, λ₁.
            </Insight>
          )}
          {sols.some(({ m, s }) => m === "rk4" && s.failed) && (
            <Insight tone="bad" title="RK4 вибухнув" simple={<>Крок h = {fmt(dH, 3)} завеликий: найшвидша мода має |Re λ| до {fmt(stiff.maxFast, 3)}, а RK4 стійкий лише при h|λ| ≲ 2.8. Зменшіть крок.</>}>
              Найшвидше власне число якобіана вздовж траєкторії сягає |Re λ| ≈ {fmt(stiff.maxFast, 3)}; при h = {fmt(dH, 3)} маємо h|λ| ≈ {fmt(dH * stiff.maxFast, 2)} &gt; 2.785 —
              за межею області стійкості RK4 на дійсній осі.
            </Insight>
          )}
          {sols.some(({ m }) => m === "euler") && !sols.find(({ m }) => m === "euler")!.s.failed && (
            <Insight
              tone="warn"
              title="Явний Ейлер: не вибухає, але бреше"
              simple={<>Ейлер із кроком {fmt(dH, 3)} лишається в межах атрактора, але його похибка при t = 1 ({fmt(methodStats.find((q) => q.m === "euler")?.e1 ?? NaN, 2)}) уже порівнянна з розміром метелика — він малює «якусь» хаотичну траєкторію, а не ту, що треба.</>}
            >
              При h = {fmt(dH, 3)} явний Ейлер стійкий (h·max|Re λ| ≈ {fmt(dH * stiff.maxFast, 2)} &lt; 2), але глобальна похибка першого порядку на такій
              «швидкій» системі (|f| ~ 10²) вже при t = 1 дорівнює {fmt(methodStats.find((q) => q.m === "euler")?.e1 ?? NaN, 2)}; горизонт —{" "}
              {Number.isFinite(methodStats.find((q) => q.m === "euler")?.tH ?? NaN) ? `t ≈ ${fmt(methodStats.find((q) => q.m === "euler")!.tH, 3)}` : "—"}. Для нього потрібен h ≲ 10⁻⁴.
            </Insight>
          )}
        </Lab>
      </Section>

      {/* ============================================================ режими за r */}
      <Section kicker="Результати" title="Шість значень r з умови: що саме ми бачимо" simpleTitle="Шість положень крана">
        <Grid>
          <Card title="Нерухомі точки та їхня стійкість" icon="📐">
            <Tex block>{String.raw`O=(0,0,0):\quad \lambda_{1,2} = \frac{-(\sigma+1)\pm\sqrt{(\sigma+1)^2+4\sigma(r-1)}}{2},\quad \lambda_3=-b;`}</Tex>
            <Tex block>{String.raw`C_\pm=\bigl(\pm\sqrt{b(r-1)},\ \pm\sqrt{b(r-1)},\ r-1\bigr),\quad r>1;\qquad r_H=\frac{\sigma(\sigma+b+3)}{\sigma-b-1}.`}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                  У системі є три «точки спокою»: O (колесо стоїть) і дві C± (рівномірне обертання вправо/вліво). O стійка лише при r &lt; 1; C± існують при r &gt; 1 і
                  стійкі до r_H = {fmt(fp.rH, 4)} (для σ = {fmt(dSig, 3)}, b = {fmt(dB, 4)}). Після r_H стійких точок спокою немає взагалі — звідси хаос.
                </p>
              }
            >
              <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                Для поточних σ = {fmt(dSig, 3)}, b = {fmt(dB, 4)}: <Tex>{`r_H = ${fmt(fp.rH, 5)}`}</Tex>
                {dSig === 10 && Math.abs(dB - 8 / 3) < 1e-9 ? <> (= 470/19 ≈ 24.7368)</> : null}. При r = 1 — вилкова біфуркація (O → сідло, народжуються C±), при r_H —
                субкритична біфуркація Хопфа: C± втрачають стійкість, і поруч уже немає стійкого циклу, тож траєкторії змушені блукати. Поточне r = {fmt(dr, 4)}:
                власні числа в O — {fp.evO.map(cx).join("; ")}
                {fp.C ? <>; у C± — {fp.evC.map(cx).join("; ")} ({fp.stableC ? "стійкий фокус" : "нестійкий фокус (сідло-фокус)"})</> : null}.
              </p>
            </Say>
          </Card>
          <Card title="Траєкторія з точки умови на [0, 25]" icon="🧭">
            <Table
              head={["r", "Стійкість", "Із точки умови", "λ₁"]}
              rows={regimes.map((q) => [
                <button key="r" onClick={() => setR(q.r)} className={`underline-offset-2 hover:underline ${q.r === dr ? "text-white" : "text-[var(--accent)]"}`}>
                  {String(q.r).replace(".", ",")}
                </button>,
                <span key="s" className="font-sans text-white/75">
                  {!q.fp.C ? "O стійка" : q.fp.stableC ? `C± стійкі (Re λ = ${fmt(q.fp.alpha, 3)})` : `C± нестійкі (Re λ = ${fmt(q.fp.alpha, 3)})`}
                </span>,
                <span key="t" className={`font-sans ${q.info.kind === "chaos" || q.info.kind === "coexist" ? "text-[#ff8597]" : q.info.kind === "periodic" ? "text-[#ffb547]" : "text-[#3ee6a8]"}`}>
                  {q.info.kind === "O"
                    ? `згасає; |y| < 0.01 з t ≈ ${fmt(q.info.tSettle, 3)}`
                    : q.info.kind === "C" || q.info.kind === "transient"
                      ? `${q.info.sw} ${plural(q.info.sw, ["перехід", "переходи", "переходів"])}, на C${q.info.toPlus ? "+" : "−"} з t ≈ ${fmt(q.info.tSettle, 3)}`
                      : q.info.kind === "coexist"
                        ? `${q.info.sw} переходів, на C± не сіла`
                        : q.info.kind === "periodic"
                          ? `${q.info.sw} переходів, цикл P-${q.info.nDistinct}`
                          : `${q.info.sw} переходів, ${Number.isFinite(q.info.nDistinct) ? q.info.nDistinct : ">40"} різних max z`}
                </span>,
                <span key="l" className={q.L > 0.01 ? "text-[#ff8597]" : "text-white/80"}>
                  {fmt(q.L, 3)}
                </span>,
              ])}
            />
            <Say
              simple={
                <p className="mt-3 text-[13px] text-white/55">
                  «Переходи» — скільки разів x змінив знак (колесо змінило напрямок) до t = 25. Натисніть на r, щоб завантажити його в лабораторію. λ₁ &gt; 0 — хаос:
                  похибки ростуть; λ₁ &lt; 0 — усе заспокоюється.
                </p>
              }
            >
              <p className="mt-3 text-[13px] text-white/55">
                Еталон DOPRI (rtol 10⁻¹⁰) на [0, 25] із σ = {fmt(dSig, 3)}, b = {fmt(dB, 4)}, старт {start === 0 ? "(3.05, 1.58, 15.62)" : "(0, 1, 0)"}; «сіла на C±» =
                відстань &lt; 0.5 і далі не зростає; λ₁ — Бенеттін на 400 од. часу. Для 24.5 траєкторія з точки умови належить басейну дивного атрактора,
                хоча C± ще стійкі (в окремому розрахунку поза сторінкою, до t = 300, — жодного наближення до C±). Для 105: λ₁ ≈ {fmt(regimes[5].L, 2)} і{" "}
                {Number.isFinite(regimes[5].info.nDistinct) ? regimes[5].info.nDistinct : "> 40"} різних максимумів z — це хаос, а не періодичне вікно
                (найближчі вікна — r ≈ 99.5–100.8, де максимуми z повторюються з періодом 3).
              </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      {/* ============================================================ ефект метелика */}
      <Section kicker="Чутливість" title="Ефект метелика: дві траєкторії на відстані δ" simpleTitle="Ефект метелика: майже однаковий старт">
        <Grid>
          <Card>
            <Plot
              title="x(t): оригінал і двійник"
              height={260}
              xLabel="t"
              xDomain={[0, Math.min(Ts, Math.max(dT, Number.isFinite(bfly.tHit) ? bfly.tHit + 5 : dT))]}
              series={[
                { x: ref.t, y: comp(ref, 0), color: "#f0abfc", label: `x(0) = ${fmt(y0[0], 4)}`, width: 1.5 },
                { x: twin.t, y: comp(twin, 0), color: "#ffe66d", label: `x(0) + ${fmt(dDelta, 2)}`, width: 1.2, opacity: 0.85 },
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
                { x: bfly.t, y: bfly.d, color: "#ff7ad9", label: "‖Δ(t)‖", width: 1.5 },
                ...(L > 0.01
                  ? [
                      {
                        x: bfly.t,
                        y: bfly.t.map((t) => dDelta * Math.exp(L * t)),
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
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Нахил ln‖Δ‖ (МНК)" value={Number.isFinite(bfly.slope) ? fmt(bfly.slope, 3) : "—"} sub={`пряма на [0.5, ${Number.isFinite(bfly.tHit) ? fmt(bfly.tHit - 2, 3) : fmt(Ts, 3)}]; Бенеттін дає ${fmt(L, 3)}`} tone={bfly.slope > 0.01 ? "warn" : "good"} />
          <Stat label="Час подвоєння похибки" value={Number.isFinite(doubling) ? fmt(doubling, 3) : "∞"} sub="ln 2 / нахил" />
          <Stat label="Прогноз марний із" value={Number.isFinite(bfly.tHit) ? `t ≈ ${fmt(bfly.tHit, 3)}` : "ніколи"} sub={`δ = ${fmt(dDelta, 2)}, поріг ‖Δ‖ = 1`} tone={Number.isFinite(bfly.tHit) ? "bad" : "good"} />
          <Stat label="Довідково: λ₁ при r = 28" value={fmt(bookL, 3)} sub={`наш Бенеттін; література ≈ ${LIT_L1}`} />
        </div>
        <div className="mt-4">
          <Insight
            tone="info"
            title="Що означає δ = 10⁻⁶ у побутових термінах"
            simpleTitle="Скільки коштує точніший старт"
            simple={
              <>
                Різниця на старті в одну мільйонну — це як виміряти температуру повітря з точністю до мільйонної частки градуса. І все одно через{" "}
                {Number.isFinite(bfly.tHit) ? fmt(bfly.tHit, 3) : "—"} одиниць часу (≈ {Number.isFinite(bfly.tHit) && doubling > 0 ? Math.round(bfly.tHit / doubling) : "—"} подвоєнь)
                прогноз нічого не вартий. Щоб відсунути цей момент удвічі, точність треба підвищити не вдвічі, а в <Relatable kind="growth" n={Math.exp(L * (Number.isFinite(bfly.tHit) ? bfly.tHit : 0))} />
                — бо кожні {fmt(doubling, 2)} од. часу похибка подвоюється.
              </>
            }
          >
            На лог-шкалі експонента — пряма: нахил МНК {fmt(bfly.slope, 3)} практично збігається з λ₁ Бенеттіна ({fmt(L, 3)}; різниця — бо локальна швидкість
            розбігання коливається вздовж атрактора). Горизонт ln(1/δ)/λ₁ ≈ {fmt(horizonEst, 3)} проти виміряного {Number.isFinite(bfly.tHit) ? fmt(bfly.tHit, 3) : "—"}:
            оцінка систематично завищена, бо ‖Δ‖ насичується на розмірі атрактора (~30–40) і росте нерівномірно. Залежність від δ лише логарифмічна:
            зменшення δ у 10⁶ разів купує ln(10⁶)/λ₁ ≈ {fmt(Math.log(1e6) / Math.max(L, 1e-6), 3)} од. часу. Показник Ляпунова рахуємо методом Бенеттіна: лінеаризовану
            систему <Tex>{"\\dot{\\boldsymbol\\xi} = J(t)\\,\\boldsymbol\\xi"}</Tex> інтегруємо разом з основною (RK4, h = {dr > 50 ? "0.005" : "0.01"}), перенормовуючи ξ
            кожні 50 кроків, 800 од. часу після відкидання перших 100.
          </Insight>
        </div>
      </Section>

      {/* ============================================================ порядок збіжності */}
      <Section kicker="Методи" title="RK2, RK3, RK4: порядок збіжності й ціна точності" simpleTitle="Три методи Рунге–Кутти: хто дешевше дає точність">
        <div className="mb-3">
          <Chips label="Відрізок для вимірювання похибки [0, T]" value={Tconv} onChange={setTconv} options={[0.5, 1, 2].map((v) => ({ value: v, label: `T = ${v}` }))} />
        </div>
        <Grid>
          <Card title={`Похибка в точці t = ${Tconv} проти еталона`} icon="📏">
            <Table
              head={["h", "Ейлер", "RK2", "RK3", "RK4"]}
              rows={CONV_H.map((hh, i) => [
                fmt(hh, 4),
                ...[eulRow, rk2Row, rk3Row, rk4Row].map((row, j) => (
                  <span key={j}>
                    {fmt(row.errs[i].e, 3)}
                    {i > 0 && <span className="ml-1 text-[11px] text-white/45">(p ≈ {fmt(row.orders[i - 1], 2)})</span>}
                  </span>
                )),
              ])}
            />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="RK2: середній порядок" value={fmt(rk2Row.meanOrder, 3)} sub="теорія: 2" tone={Math.abs(rk2Row.meanOrder - 2) < 0.3 ? "good" : "warn"} />
              <Stat label="RK3" value={fmt(rk3Row.meanOrder, 3)} sub="теорія: 3" tone={Math.abs(rk3Row.meanOrder - 3) < 0.3 ? "good" : "warn"} />
              <Stat label="RK4" value={fmt(rk4Row.meanOrder, 3)} sub="теорія: 4" tone={Math.abs(rk4Row.meanOrder - 4) < 0.3 ? "good" : "warn"} />
            </div>
            <Say
              simple={
                <p className="mt-3 text-[13px] text-white/55">
                  У дужках — у скільки «двійок» впала похибка, коли крок зменшили вдвічі: p ≈ 2 означає «у 4 рази», p ≈ 3 — «у 8», p ≈ 4 — «у 16». Ейлер при таких
                  кроках ще навіть не почав збігатися. Еталон — RK4 із кроком 10⁻⁴ і DOPRI з допуском 10⁻¹³, які між собою збігаються до {fmt(conv.cross, 2)}.
                </p>
              }
            >
              <p className="mt-3 text-[13px] text-white/55">
                Спостережений порядок p = log₂(e(h)/e(h/2)); еталон — DOPRI45 з rtol 10⁻¹³ ({conv.refSteps} кроків), незалежна перевірка RK4 з h = 10⁻⁴ відрізняється від
                нього на {fmt(conv.cross, 2)}. Похибка — евклідова норма при t = {Tconv}. Ейлер при h ≥ 0.0025 ще поза асимптотичним режимом (h·‖J‖ ~ 0.05–0.4, а
                похибка — порядку розміру атрактора). {Tconv === 1 ? <>При T = 1 порядки RK2 і RK4 виглядають завищеними (≈ 2.5–2.8 і ≈ 4.8): у цей момент головний член похибки <Tex>{"C_p h^p"}</Tex> майже обнуляється і домінує наступний, <Tex>{"C_{p+1} h^{p+1}"}</Tex>; при T = 0.5 або при менших h порядки повертаються до 2 і 4 — перемкніть чипс.</> : null}
              </p>
            </Say>
          </Card>
          <Card title="Похибка — вартість (f-обчислення), лог–лог" icon="💸">
            <Plot
              height={300}
              logX
              logY
              xLabel="f-обчислень"
              yLabel={`похибка при t = ${Tconv}`}
              sorted={false}
              series={[
                ...conv.curves.map((c) => ({ x: c.pts.map((p) => p.fe), y: c.pts.map((p) => p.e), color: METHODS[c.m].color, label: METHODS[c.m].short, width: 1.6 })),
                ...conv.curves.map((c) => ({ x: c.pts.map((p) => p.fe), y: c.pts.map((p) => p.e), color: METHODS[c.m].color, dots: true, dotSize: 2.5 })),
                { x: [40, 40000], y: [1e-4, 1e-4], color: "#ffffff", width: 1, dash: [4, 4], opacity: 0.35, noRange: true, label: "10⁻⁴" },
                { x: [40, 40000], y: [1e-6, 1e-6], color: "#ffffff", width: 1, dash: [2, 5], opacity: 0.35, noRange: true, label: "10⁻⁶" },
              ]}
            />
            <div className="mt-3 grid grid-cols-3 gap-2">
              {conv.curves.map((c) => (
                <Stat
                  key={c.m}
                  label={`${METHODS[c.m].short}: ціна 10⁻⁴ / 10⁻⁶`}
                  value={`${c.need4 ? c.need4.fe : "—"} / ${c.need6 ? c.need6.fe : "—"}`}
                  sub={`f-обчислень${c.need4 ? `; h ≈ ${fmt(c.need4.h, 2)}` : ""}${c.need6 ? ` / ${fmt(c.need6.h, 2)}` : ""}`}
                />
              ))}
            </div>
            <Say
              simple={
                <p className="mt-3 text-[13px] text-white/55">
                  Головне питання не «який метод точніший при однаковому кроці», а «скільки обчислень правої частини коштує задана точність». Щоб отримати похибку
                  10⁻⁴ при t = {Tconv}, RK2 потребує {cRk2.need4 ? cRk2.need4.fe : "понад 40 000"} обчислень, RK3 — {cRk3.need4 ? cRk3.need4.fe : "—"}, RK4 — лише{" "}
                  {cRk4.need4 ? cRk4.need4.fe : "—"}. Чим вища точність потрібна, тим більшим є виграш високого порядку.
                </p>
              }
            >
              <p className="mt-3 text-[13px] text-white/55">
                На лог–лог графіку нахил кривої = −p: RK4 падає удвічі крутіше за RK2. Для похибки 10⁻⁴ при t = {Tconv}: RK2 — {cRk2.need4 ? `${cRk2.need4.fe} f (h ≈ ${fmt(cRk2.need4.h, 2)})` : "не досягає в межах 40 000 f"}, RK3 —{" "}
                {cRk3.need4 ? `${cRk3.need4.fe} f` : "—"}, RK4 — {cRk4.need4 ? `${cRk4.need4.fe} f` : "—"}; для 10⁻⁶: RK2 — {cRk2.need6 ? `${cRk2.need6.fe} f` : "поза графіком"}, RK3 — {cRk3.need6 ? `${cRk3.need6.fe} f` : "—"}, RK4 —{" "}
                {cRk4.need6 ? `${cRk4.need6.fe} f` : "—"}. Виграш RK4 над RK2 росте як (1/ε)<sup>1/2 − 1/4</sup>: чотири стадії замість двох окуповуються вже при ε ≲ 10⁻².
              </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      {/* ============================================================ жорсткість */}
      <Section kicker="Жорсткість" title="Де тут жорсткість? Ніде — і це важливо" simpleTitle="Чи потрібні тут «важкі» неявні методи?">
        <Grid>
          <Card title="Власні числа вздовж траєкторії" icon="🔬">
            <StiffnessPanel problem={problem} sol={main} />
            <Say
              simple={
                <p className="mt-3 text-[13px] text-white/55">
                  Панель вище показує «найшвидший» і «найповільніший» темпи в кожній точці траєкторії. Максимум їх відношення ({fmt(stiff.max, 3)}) виглядає страшно, але
                  це обман: найповільніший темп тут не «повільне згасання», а обертання навколо C± — його дійсна частина просто проходить через нуль. Типове
                  (медіанне) відношення — лише {fmt(stiff.median, 3)}.
                </p>
              }
            >
              <p className="mt-3 text-[13px] text-white/55">
                Якобіан <Tex>{String.raw`J=\begin{pmatrix}-\sigma&\sigma&0\\ r-z&-1&-x\\ y&x&-b\end{pmatrix}`}</Tex>, слід <Tex>{"-(\\sigma+1+b)"}</Tex> сталий. Максимум
                відношення max|Re λ|/min|Re λ| ({fmt(stiff.max, 3)}) досягається там, де Re комплексної пари проходить через 0 — це не жорсткість, а обертання; медіана
                відношення вздовж траєкторії {fmt(stiff.median, 3)}, max|Re λ| = {fmt(stiff.maxFast, 3)}.
              </p>
            </Say>
          </Card>
          <Card title="Стійкість проти точності: хто обмежує крок" icon="⚖️">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Межа стійкості RK4" value={`h < ${fmt(stabH, 3)}`} sub={`2.785 / max|Re λ| = 2.785 / ${fmt(stiff.maxFast, 3)}`} />
              <Stat label="Вимога точності" value={Number.isFinite(accH) ? `h ≲ ${fmt(accH, 3)}` : "—"} sub={fp.omega > 0 ? `≈ 20 кроків на оберт спіралі (T = ${fmt((2 * Math.PI) / fp.omega, 3)})` : "C± не існують"} />
              <Stat label={`Неявний Ейлер, h = ${fmt(dH, 3)}`} value={`${ieCmp.ie.fevals} f + ${ieCmp.ie.jevals} J`} sub={`RK4 з тим самим h: ${ieCmp.rk.fevals} f · ${fmtMs(ieCmp.rk.ms)} проти ${fmtMs(ieCmp.ie.ms)}`} tone="warn" />
              <Stat
                label="Куди веде неявний Ейлер"
                value={fp.C ? (ieCmp.swIe === 0 && ieCmp.dIe < 1 ? `у C${last(ieCmp.ie)[0] > 0 ? "+" : "−"}` : `${ieCmp.swIe} переходів`) : `${ieCmp.swIe} переходів`}
                sub={fp.C ? `|y(T) − C±| = ${fmt(ieCmp.dIe, 2)}; еталон: ${ieCmp.swRef} переходів, RK4: ${ieCmp.swRk}` : `еталон: ${ieCmp.swRef}`}
                tone={fp.C && !fp.stableC && ieCmp.swIe === 0 ? "bad" : "default"}
              />
            </div>
            <div className="mt-3">
              <Insight
                tone={fp.C && !fp.stableC && Number.isFinite(ieCmp.hStar) && dH > ieCmp.hStar ? "bad" : "info"}
                title="Неявні методи тут не рятують, а шкодять"
                simpleTitle="Чому неявний метод тут — погана ідея"
                simple={
                  <>
                    Жорсткість — це коли метод змушений дріботіти заради стійкості, хоч розв&apos;язок гладкий. Тут навпаки: заради точності треба h ≲ {fmt(accH, 2)}, а
                    стійкість дозволяє аж до {fmt(stabH, 2)}. Неявний Ейлер із тим самим кроком коштує в {fmt((ieCmp.ie.fevals + 3 * ieCmp.ie.jevals) / Math.max(1, ieCmp.rk.fevals), 2)}{" "}
                    рази дорожче (разом з якобіанами) і до того ж «заспокоює» колесо: він додає штучне тертя, і{" "}
                    {fp.C && !fp.stableC && ieCmp.swIe === 0 ? <>з h = {fmt(dH, 3)} траєкторія без жодного реверсу осідає на C± — хаос зник, бо метод його «пригладив»</> : <>з більшим h траєкторія осяде на C±, хоч насправді вони нестійкі</>}.
                  </>
                }
              >
                Задача жорстка, коли область стійкості обмежує крок сильніше, ніж точність. Тут межа стійкості RK4 h &lt; {fmt(stabH, 3)}, а точність вимагає{" "}
                h ≲ {fmt(accH, 3)} — отже, <b>не жорстка</b>. Неявний Ейлер з h = {fmt(dH, 3)} витрачає {ieCmp.ie.fevals} обчислень f і {ieCmp.ie.jevals} якобіанів (кожен —
                ще ~3 f) проти {ieCmp.rk.fevals} f у RK4, тобто в ~{fmt((ieCmp.ie.fevals + 3 * ieCmp.ie.jevals) / Math.max(1, ieCmp.rk.fevals), 2)} рази дорожче, а горизонт — {Number.isFinite(ieCmp.tHie) ? `t ≈ ${fmt(ieCmp.tHie, 3)}` : "—"} проти{" "}
                {Number.isFinite(ieCmp.tHrk) ? `t ≈ ${fmt(ieCmp.tHrk, 3)}` : "—"}. Гірше: його функція стійкості R(z) = 1/(1 − z) при z = hλ, λ = {fmt(fp.alpha, 4)} ± {fmt(fp.omega, 4)}i дає |R| ={" "}
                {fmt(ieCmp.Rie, 5)} проти точного |e<sup>hλ</sup>| = {fmt(ieCmp.Rex, 5)}
                {fp.C && !fp.stableC ? (
                  <>
                    : для h &gt; 2α/(α² + ω²) = {fmt(ieCmp.hStar, 4)} нестійкий фокус C± стає <b>чисельно стійким</b>. З h = {fmt(dH, 3)} неявний Ейлер зробив{" "}
                    {ieCmp.swIe} {plural(ieCmp.swIe, ["перехід", "переходи", "переходів"])} (еталон — {ieCmp.swRef}) і {ieCmp.dIe < 1 ? `осів на C± на відстані ${fmt(ieCmp.dIe, 2)}` : `закінчив на відстані ${fmt(ieCmp.dIe, 3)} від C±`} — хаос
                    «зник» через штучну дисипацію методу. Трапеції (|R| = 1 на уявній осі) такого не роблять, але й вони дорожчі за RK4 без жодного виграшу.
                  </>
                ) : (
                  <>. Неявність нічого не дає, бо немає швидких мод, які треба гасити.</>
                )}
              </Insight>
            </div>
          </Card>
        </Grid>
      </Section>

      {/* ============================================================ структура хаосу */}
      <Section kicker="Структура хаосу" title="Мапа Лоренца і дерево біфуркацій" simpleTitle="Порядок усередині хаосу">
        <Grid cols={3}>
          <Card>
            <Plot
              title={`Мапа Лоренца: zₙ₊₁(zₙ), r = ${fmt(dr, 4)}`}
              height={280}
              xLabel="zₙ"
              yLabel="zₙ₊₁"
              sorted={false}
              series={[
                { x: [Math.min(...scan.zMax, 0), Math.max(...scan.zMax, 1)], y: [Math.min(...scan.zMax, 0), Math.max(...scan.zMax, 1)], color: "#ffffff", width: 1, dash: [4, 4], opacity: 0.35, noRange: true },
                { x: scan.zMax.slice(0, -1), y: scan.zMax.slice(1), color: "#ff7ad9", dots: true, dotSize: 2.2, label: `${Math.max(0, scan.zMax.length - 1)} пар` },
              ]}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] text-white/55">
                  Висота кожного «гребеня» z проти висоти наступного. Якщо точки лягають на тонку лінію-«намет» — наступний гребінь однозначно визначається
                  попереднім (хаос детермінований!), а крутий нахил намету (&gt; 1) — і є причина, чому похибки ростуть. Цикл дає кілька окремих точок.
                </p>
              }
            >
              <p className="mt-2 text-[13px] text-white/55">
                Трюк Лоренца 1963 року: послідовні максимуми z лягають на одногорбу криву («намет») із |нахилом| &gt; 1 всюди — одновимірне відображення, що
                розтягує, звідси λ₁ &gt; 0. {Number.isFinite(nDistinct) ? `${nDistinct} різних значень` : "> 40 різних значень"} серед {scan.zMax.length} максимумів
                (RK4, h = {dr > 50 ? "0.004" : "0.01"}, після перехідних 30 од. часу).
              </p>
            </Say>
          </Card>
          <Card>
            <Plot
              title="Біфуркаційна діаграма: максимуми z при r ∈ [0, 60]"
              height={280}
              xLabel="r"
              yLabel="max z"
              cursorX={dr}
              sorted={false}
              series={[{ x: bif1.xs, y: bif1.ys, color: "#f0abfc", dots: true, dotSize: 0.8, opacity: 0.75 }]}
              underlay={(ctx, tr) => {
                if (!Number.isFinite(fp.rH)) return;
                ctx.setLineDash([6, 4]);
                ctx.strokeStyle = "rgba(255,181,71,0.6)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(tr.X(fp.rH), tr.top);
                ctx.lineTo(tr.X(fp.rH), tr.top + tr.height);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "rgba(255,181,71,0.8)";
                ctx.font = "11px sans-serif";
                ctx.fillText(`r_H = ${fmt(fp.rH, 4)}`, tr.X(fp.rH) + 4, tr.top + 12);
              }}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] text-white/55">
                  Для кожного r — усі «гребені» z після заспокоєння. До r ≈ 1 нічого немає (усе згасає), далі одна точка (рівномірне обертання, z = r − 1), а після
                  помаранчевої риски r_H — суцільна хмара хаосу. Пунктир — поточне r.
                </p>
              }
            >
              <p className="mt-2 text-[13px] text-white/55">
                Продовження за r (стартуємо з кінця попереднього прогону, RK4 h = 0.01, 40 од. перехідних + 40 од. запису). Для 1 &lt; r &lt; r_H після перехідного процесу
                максимумів немає або вони вироджені (спіраль у C± має z → r − 1); хаотична смуга починається біля r_H = {fmt(fp.rH, 3)} (з гістерезисом від ≈ 24.06).
              </p>
            </Say>
          </Card>
          <Card>
            <Plot
              title="Збільшення: r ∈ [95, 110] (де 105)"
              height={280}
              xLabel="r"
              yLabel="max z"
              cursorX={dr >= 95 && dr <= 110 ? dr : undefined}
              sorted={false}
              series={[{ x: bif2.xs, y: bif2.ys, color: "#ffe66d", dots: true, dotSize: 0.8, opacity: 0.75 }]}
              underlay={(ctx, tr) => {
                ctx.fillStyle = "rgba(62,230,168,0.10)";
                ctx.fillRect(tr.X(99.524), tr.top, tr.X(100.795) - tr.X(99.524), tr.height);
                ctx.fillStyle = "rgba(62,230,168,0.8)";
                ctx.font = "11px sans-serif";
                ctx.fillText("вікно P-3", tr.X(99.6), tr.top + 12);
                ctx.strokeStyle = "rgba(240,171,252,0.7)";
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(tr.X(105), tr.top);
                ctx.lineTo(tr.X(105), tr.top + tr.height);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "rgba(240,171,252,0.9)";
                ctx.fillText("r = 105", tr.X(105) + 4, tr.top + tr.height - 6);
              }}
            />
            <Say
              simple={
                <p className="mt-2 text-[13px] text-white/55">
                  Поруч із 105 є «вікно порядку» (зелене, r ≈ 99.5–100.8), де гребені z повторюються по три. Саме 105 — поза вікном: хмара точок, тобто хаос, причому
                  «швидший», ніж при 28.5 (похибки подвоюються кожні {fmt(Math.LN2 / Math.max(regimes[5].L, 1e-6), 2)} од. часу замість {fmt(Math.LN2 / Math.max(regimes[4].L, 1e-6), 2)}).
                </p>
              }
            >
              <p className="mt-2 text-[13px] text-white/55">
                RK4 h = 0.005 (при r ~ 100 період спіралі навколо C± лише {fmt((2 * Math.PI) / regimes[5].fp.omega, 3)}), 60 + 40 од. часу. Зелена смуга — періодичне вікно
                99.524 &lt; r &lt; 100.795 (довідкові межі за Спарроу, 1982; симетрична орбіта, максимуми z повторюються з періодом 3 — на діаграмі це три гілки); при r = 105 —{" "}
                {Number.isFinite(regimes[5].info.nDistinct) ? regimes[5].info.nDistinct : "> 40"} різних максимумів, λ₁ ≈ {fmt(regimes[5].L, 3)}: розвинений хаос.
              </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      {/* ============================================================ дебагер */}
      <Section kicker="Під мікроскопом" title="Один крок методу — покроково (r = 28.5, площина x–z)" report={false}>
        <StepDebugger
          f={DBG_F}
          y0={DBG_Y0}
          T={3}
          view={DBG_VIEW}
          methods={["euler", "rk2", "rk3", "rk4", "ieuler", "trap", "bdf2"]}
          h0={0.02}
          hMin={0.002}
          hMax={0.1}
          hPresets={[0.01, 0.02, 0.05]}
          hPresetsLabel="Кроки"
          hint={
            <Say
              simple={
                <>
                  Вид збоку на метелика (x — вліво-вправо, z — висота). Сіра смуга — точний шлях на перші 3 одиниці часу. Дивіться на стрілки-«розвідки»: у RK2 їх
                  дві, у RK3 три, у RK4 чотири — і саме тому RK4 так точно лягає на поворотах, де траєкторія різко загинається (біля верхівки петлі). Явний
                  Ейлер з h = 0.05 починає «зрізати» повороти вже з перших кроків і вилітає з петлі; неявний Ейлер, навпаки, затягує спіраль усередину —
                  це те саме штучне тертя, що «гасить» хаос.
                </>
              }
            >
              Проєкція x–z, h = 0.02 ≈ {Math.round((2 * Math.PI) / facts.fp28.omega / 0.02)} кроків на оберт спіралі (T ≈ {fmt((2 * Math.PI) / facts.fp28.omega, 3)}). Порівняйте положення проб
              k₁…k₄ на крутому повороті біля z ≈ 40: середня точка (RK2) бере один нахил посередині, Кутта (RK3) — ще й у кінці з екстраполяцією 2k₂ − k₁, RK4 — два
              серединних. Для неявних методів видно 2–3 ітерації Ньютона на крок: тут вони збігаються миттєво (система не жорстка), але кожна коштує якобіан + LU. При
              h = 0.05 явний Ейлер систематично виходить назовні спіралі (|R(hλ)| &gt; 1 для hλ ≈ {fmt(0.05 * facts.fp28.alpha, 2)} ± {fmt(0.05 * facts.fp28.omega, 2)}i), неявний —
              усередину.
            </Say>
          }
        />
      </Section>

      {/* ============================================================ квіз */}
      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="lorenz"
          questions={[
            {
              id: "r05",
              q: <>r = 0.5 (σ = 10, b = 8/3), старт із точки умови (3.05, 1.58, 15.62). Що станеться на [0, 25]?</>,
              options: ["Усе згасне до нуля за кілька одиниць часу", "Траєкторія вийде на рівномірне обертання C±", "Буде хаос, але слабший, ніж при 28.5", "Розв'язок вибухне"],
              correct: 0,
              explain: (
                <>
                  При r &lt; 1 єдина рівновага — O, і всі власні числа якобіана в ній від&apos;ємні: {facts.fp05.anO.map((v) => fmt(v, 4)).join(", ")}. Розрахунок дає: |y(t)| &lt; 0.01 для
                  всіх t &gt; {fmt(facts.tO05, 3)}; найповільніше згасає мода e<sup>{fmt(facts.fp05.anO[0], 3)}t</sup>. Хаос неможливий: λ₁ = {fmt(regimes[0].L, 3)} &lt; 0.
                </>
              ),
              explainSimple: <>Тонкий струмінь: ковшики протікають швидше, ніж наповнюються, і колесо стає. Уже при t ≈ {fmt(facts.tO05, 2)} від усіх трьох змінних лишається менше сотої.</>,
              show: { label: "Показати r = 0.5", run: () => setR(0.5) },
            },
            {
              id: "hopf",
              q: <>Рівноваги C± («рівномірне обертання») існують при r &gt; 1. При якому r вони втрачають стійкість (σ = 10, b = 8/3)?</>,
              options: ["Одразу при r = 1", "r ≈ 13.9", "r ≈ 24.7", "r = 28 — тому Лоренц і взяв 28"],
              correct: 2,
              explain: (
                <>
                  Біфуркація Хопфа при r_H = σ(σ + b + 3)/(σ − b − 1) = 470/19 ≈ {fmt(facts.fp28.rH, 5)}. Перевірка власними числами: при r = 24.5 комплексна пара в C± має
                  Re λ = {fmt(facts.fp245.alpha, 4)} &lt; 0 (ще стійкі), при 28.5 — {fmt(facts.fp28.alpha, 4)} &gt; 0. r ≈ 13.93 — це інша подія (гомоклінічний вибух: з&apos;являється
                  хаотична множина, ще не притягальна), а Лоренц узяв 28 просто як «трохи більше за r_H».
                </>
              ),
              explainSimple: (
                <>
                  До r ≈ {fmt(facts.fp28.rH, 4)} рівномірне обертання ще стійке (при 24.5 — ледь-ледь: згасання {fmt(facts.fp245.alpha, 4)} за одиницю часу), а далі воно розкручується — і
                  колесу нема де заспокоїтись.
                </>
              ),
              show: { label: "Показати r = 24.5", run: () => setR(24.5) },
            },
            {
              id: "horizon",
              q: <>RK4 із кроком h = 0.01 при r = 28.5. Коли його траєкторія вперше відійде від еталона на відстань 1?</>,
              options: ["Майже одразу, t ≈ 1", "t ≈ 10", "Лише після t = 25", "Ніколи — RK4 четвертого порядку, похибка ~10⁻⁸"],
              correct: 1,
              explain: (
                <>
                  Виміряно на сторінці: горизонт RK4 (h = 0.01) — t ≈ {fmt(facts.rk4.tH, 3)}; для RK2 з тим самим кроком — t ≈ {fmt(facts.rk2.tH, 3)}. Локальна точність
                  RK4 справді висока, але похибка множиться на e<sup>λ₁t</sup>: від ~10⁻⁴ при t = 1 до 1 — приблизно за ln(10⁴)/0.91 ≈ {fmt(Math.log(1e4) / 0.91, 2)} одиниць.
                  Десятикратне зменшення h додає лише ~ln(10⁴)/λ₁ ≈ 10 одиниць горизонту.
                </>
              ),
              explainSimple: <>Приблизно на десятій одиниці часу (виміряно: t ≈ {fmt(facts.rk4.tH, 2)}). Похибка подвоюється кожні ~0.7, тож навіть дуже маленька стартова похибка доростає до розміру метелика за ~10–15 одиниць.</>,
              show: {
                label: "Показати RK4 і RK2 з h = 0.01",
                run: () => {
                  setR(28.5);
                  setH(0.01);
                  setT(25);
                  setMethods(["rk2", "rk4", "dopri"]);
                },
              },
            },
            {
              id: "order",
              q: <>Крок RK4 зменшили вдвічі (0.01 → 0.005) на короткому відрізку, де хаос ще не встиг усе розмазати. У скільки разів упаде похибка?</>,
              options: ["≈ 2 рази", "≈ 4 рази", "≈ 16 разів", "≈ 100 разів"],
              correct: 2,
              explain: (
                <>
                  Порядок 4 означає e ∝ h⁴, тобто 2⁴ = 16. У таблиці вище (T = {Tconv}): {fmt(rk4Row.errs[1].e, 2)} → {fmt(rk4Row.errs[2].e, 2)}, у{" "}
                  {fmt(rk4Row.errs[1].e / rk4Row.errs[2].e, 3)} разів (p ≈ {fmt(rk4Row.orders[1], 2)}); для RK2 — у {fmt(rk2Row.errs[1].e / rk2Row.errs[2].e, 3)} (p ≈ {fmt(rk2Row.orders[1], 2)}), для RK3 — у{" "}
                  {fmt(rk3Row.errs[1].e / rk3Row.errs[2].e, 3)}. Саме тому для рівної точності 10⁻⁶ RK4 потребує {cRk4.need6 ? cRk4.need6.fe : "—"} обчислень f, а RK3 — {cRk3.need6 ? cRk3.need6.fe : "—"}.
                </>
              ),
              explainSimple: <>У шістнадцять: кожне «вдвічі менший крок» для RK4 — це «у 16 разів точніше», для RK3 — у 8, для RK2 — лише у 4. Тому RK4 і є робочим конем, попри чотири обчислення за крок.</>,
            },
            {
              id: "literal",
              q: <>Якщо проінтегрувати систему так, як вона надрукована (x′ = σ(x − y), y′ = rxy − xz), стартуючи з точки умови при r = 28.5, то…</>,
              options: ["Вийде той самий метелик, лише дзеркальний", "Усе згасне до нуля", "x зростатиме експоненційно як e^{σt}, а y, z → 0", "Розв'язок вибухне за скінченний час t ≈ 0.3"],
              correct: 2,
              explain: (
                <>
                  У O буквальна система має власне число +σ = 10: це сідло з розгоном. Чисельно (Розенброк, бо явні методи переповнюються): нахил ln|x| на [2, 10] дорівнює{" "}
                  {fmt(facts.litSlope, 4)} ≈ σ, |x(10)| = 10<sup>{fmt(facts.litLog10x10, 3)}</sup>, y і z зануляються. Це не скінченний час вибуху — чиста експонента; але RK4 з h = 0.01
                  видає NaN при t ≈ {fmt(facts.litRkFail, 3)}, бо ∂ẏ/∂y = r·x робить задачу надзвичайно жорсткою.
                </>
              ),
              explainSimple: <>Без дисипативних знаків модель не «втомлюється»: x подвоюється кожні 0.07 од. часу і до t = 10 стає числом із {Math.round(facts.litLog10x10)} знаками, а y і z зникають. Звичайний RK4 ламається вже при t ≈ {fmt(facts.litRkFail, 2)}.</>,
              show: { label: "Увімкнути «як надруковано»", run: () => setLiteral(true) },
            },
            {
              id: "implicit",
              q: <>Неявний Ейлер з h = 0.01 при r = 28.5 на [0, 25]. Що він покаже порівняно з RK4 з тим самим кроком?</>,
              options: ["Те саме, але швидше — він же стійкий при будь-якому h", "Хаос зникне: траєкторія осяде на C±, а коштуватиме це дорожче", "Він вибухне, бо задача хаотична", "Точніший метелик, бо неявні методи завжди точніші"],
              correct: 1,
              explain: (
                <>
                  Виміряно: неявний Ейлер зробив {facts.ie.sw} переходів між крилами (еталон — {facts.swRef}, RK4 — {facts.rk4.sw}) і закінчив на відстані {fmt(facts.ie.dC, 2)} від C±, витративши{" "}
                  {facts.ie.fe} f + {facts.ie.je} якобіанів проти {facts.rk4.fe} f у RK4. Причина: |R(hλ)| = 1/|1 − hλ| = {fmt(facts.Rie, 5)} &lt; 1 при λ = {fmt(facts.fp28.alpha, 3)} ± {fmt(facts.fp28.omega, 3)}i — для h &gt;{" "}
                  {fmt(facts.hStar, 4)} метод робить нестійкий фокус чисельно стійким. Задача не жорстка (медіана відношення власних чисел ~{fmt(stiff.median, 2)}), тож неявність лише дорожча й
                  спотворює динаміку.
                </>
              ),
              explainSimple: <>Неявний Ейлер додає штучне тертя: колесо, яке мало б реверсувати ({facts.swRef} разів), у нього жодного разу не змінило напрямок і спокійно закрутилось в один бік. І коштувало це у {fmt((facts.ie.fe + 3 * facts.ie.je) / facts.rk4.fe, 2)} рази дорожче.</>,
              show: {
                label: "Показати неявний Ейлер проти RK4",
                run: () => {
                  setR(28.5);
                  setH(0.01);
                  setT(25);
                  setMethods(["rk4", "ieuler"]);
                },
              },
            },
          ]}
        />
      </Section>

      {/* ============================================================ висновки */}
      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="info"
            title="Який метод і крок обрати для [0, 25]"
            simpleTitle="Що брати для цієї лаби"
            simple={
              <>
                RK4 з кроком h = 0.01 (2500 кроків, {facts.rk4.fe} обчислень правої частини — <Relatable kind="steps" n={facts.rk4.fe} />). Він дає похибку {fmt(facts.rk4.e1, 2)} при t = 1,
                правильну форму метелика і правильну статистику. RK2 з тим самим кроком у {fmt(facts.rk4.tH / facts.rk2.tH, 2)} рази гірший за горизонтом (t ≈ {fmt(facts.rk2.tH, 2)} проти{" "}
                {fmt(facts.rk4.tH, 2)}), а щоб зрівнятися з RK4 за точністю, йому треба в {cRk2.need4 && cRk4.need4 ? `~${fmt(cRk2.need4.fe / cRk4.need4.fe, 2)}` : "багато"} разів більше обчислень. Для
                нехаотичних r (0.5, 1.5, 15.5) підійде будь-який із RK2/RK3/RK4.
              </>
            }
          >
            Рекомендація: <b>RK4, h = 0.01</b> ({facts.rk4.fe} f на [0, 25]; горизонт t ≈ {fmt(facts.rk4.tH, 3)} при r = 28.5) або DOPRI45 з rtol 10⁻⁶–10⁻⁸ (
            {dopriSol ? `${dopriSol.steps} кроків, ${dopriSol.fevals} f при rtol ${fmt(dRtol, 1)}` : "адаптивний крок"}). Критерій — не «розв&apos;язок на [0, 25]» (для хаотичних r
            він не визначений поточково), а похибка до першого ляпуновського часу та інваріанти атрактора. RK2 вимагає h ≈ {cRk2.need4 ? fmt(cRk2.need4.h, 2) : "3·10⁻⁴"} для тієї ж
            точності 10⁻⁴, що RK4 дає при h ≈ {cRk4.need4 ? fmt(cRk4.need4.h, 2) : "7·10⁻³"}: за рівної точності RK4 у {cRk2.need4 && cRk4.need4 ? fmt(cRk2.need4.fe / cRk4.need4.fe, 2) : "~10"} разів дешевший. Стійкість не обмежує: межа RK4
            h &lt; {fmt(stabH, 3)}, а точність уже вимагає h ≲ {fmt(accH, 3)}.
          </Insight>
          <Insight
            tone="warn"
            title="Хаос переписує поняття «похибка»"
            simple={
              <>
                При r = 28.5 похибка подвоюється кожні ~{fmt(Math.LN2 / bookL, 2)} од. часу. Відрізок [0, 25] — це {Math.round(25 / (Math.LN2 / bookL))} подвоєнь, тобто{" "}
                <Relatable kind="growth" n={Math.exp(bookL * 25)} />. Жоден метод і жодна точність не дають «ту саму» траєкторію на всьому відрізку — порівнюють форму
                атрактора, мапу максимумів і λ₁.
              </>
            }
          >
            λ₁ ≈ {fmt(bookL, 3)} (r = 28; література {LIT_L1}) → на [0, 25] підсилення e<sup>25λ₁</sup> ≈ {fmt(Math.exp(bookL * 25), 2)}. Навіть два еталони з точністю ~10⁻¹³
            розходяться на 10⁻² біля t ≈ 22. Коректні об&apos;єкти порівняння — інваріанти: форма атрактора, мапа zₙ₊₁(zₙ), λ₁, частота переходів між крилами.
            Горизонт прогнозу залежить від точності лише логарифмічно: у 10⁶ разів точніше — лише на ~{fmt(Math.log(1e6) / bookL, 2)} од. часу довше.
          </Insight>
          <Insight
            tone="good"
            title="Система не жорстка — неявні методи зайві"
            simple={
              <>
                Найшвидший процес тут лише в ~{fmt(stiff.median, 2)} разів швидший за типовий (медіана), а не в тисячі, як у хімії. Неявний Ейлер коштує в{" "}
                {fmt((facts.ie.fe + 3 * facts.ie.je) / facts.rk4.fe, 2)} рази дорожче і до того ж «заспокоює» хаос штучним тертям. Трапеції й BDF2 чесніші, але теж дорожчі без жодної користі.
              </>
            }
          >
            Коефіцієнт жорсткості (медіана) ≈ {fmt(stiff.median, 2)}, max|Re λ| ≈ {fmt(stiff.maxFast, 3)}; обмеження точності жорсткіше за обмеження стійкості. Неявний Ейлер з
            h &gt; {fmt(facts.hStar, 4)} стабілізує нестійкий фокус C± (|R| = {fmt(facts.Rie, 4)} &lt; 1) і при h = 0.01 знищує хаос ({facts.ie.sw} переходів замість {facts.swRef}), коштуючи при цьому{" "}
            {facts.ie.fe} f + {facts.ie.je} J проти {facts.rk4.fe} f. A-стійкість потрібна там, де є швидкі згасаючі моди, яких тут немає.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Назва «ефект метелика» з&apos;явилась із доповіді Лоренца 1972 року «Чи може помах крила метелика в Бразилії викликати торнадо в Техасі?». А сам хаос він
                відкрив випадково в 1961-му: перезапустив розрахунок із роздруківки, де числа були округлені до трьох знаків — і погода «пішла інакше».
              </>
            }
          >
            Лоренц відкрив чутливість до початкових умов у 1961 році на комп&apos;ютері Royal McBee LGP-30, коли повторний запуск із роздрукованих до 3 знаків значень
            (похибка ~10⁻⁴ — як у нашого RK4 при t = 1) за кілька «місяців» модельної погоди розійшовся з оригіналом. Водяне колесо Малкуса (1972) показало, що
            рівняння з конвекції — не абстракція: їх можна зібрати з відра й ковшиків. А буквальна система з методички дає чудову ілюстрацію того, як два
            загублені знаки перетворюють дисипативний хаос на експоненційний розгін.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
function Playground({ sols, twin, T, fp }: { sols: { m: MethodId; s: Solution }[]; twin: Solution | null; T: number; fp: FixedPoints }) {
  const pb = usePlayback(20);
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

  const k = indexAt(main.t, time);
  const cur = main.y[k];
  const series = useMemo(() => {
    const ts = [
      { x: main.t, y: comp(main, 0), color: "#f0abfc", label: "x", width: 1.4 },
      { x: main.t, y: comp(main, 1), color: "#5cc8ff", label: "y", width: 1.2, opacity: 0.8 },
      { x: main.t, y: comp(main, 2), color: "#ff7ad9", label: "z", width: 1.4 },
    ];
    const proj = (a: number, j: number) =>
      sols.map(({ m, s }, i) => ({ x: comp(s, a), y: comp(s, j), color: METHODS[m].color, label: METHODS[m].short, width: i ? 0.8 : 1.1, opacity: i ? 0.5 : 1, fade: i === 0 }));
    return { ts, xz: proj(0, 2), xy: proj(0, 1) };
  }, [main, sols]);

  const fpMarkers = fp.C
    ? [
        { x: fp.C[0], y: fp.C[2], color: fp.stableC ? "#3ee6a8" : "#ff5d73", r: 4 },
        { x: -fp.C[0], y: fp.C[2], color: fp.stableC ? "#3ee6a8" : "#ff5d73", r: 4 },
      ]
    : [];

  return (
    <>
      <Card title="Метелик у 3D (тягніть мишею)" icon="🦋" right={<span className="text-[12px] text-white/50">{METHODS[sols[0].m].name}</span>}>
        <Plot3D
          curves={[{ pts, colors: ["#5b21b6", "#f0abfc"] }, ...(twinPts ? [{ pts: twinPts, colors: ["#6b5a00", "#ffe66d"] as [string, string], width: 1 }] : [])]}
          progress={Math.max(0.002, pb.progress)}
          height={400}
        />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${time.toFixed(1)}`} />
        </div>
        {twinPts && (
          <Say simple={<p className="mt-2 text-[12px] text-white/45">Жовта — «двійник», що стартував на δ інакше. Спершу вони нерозрізненні, потім (у хаотичному режимі) розлітаються на різні крила.</p>}>
            <p className="mt-2 text-[12px] text-white/45">Жовта — «двійник» зі збуреним x(0). У хаотичному режимі через ln(1/δ)/λ₁ одиниць часу вони опиняються на різних крилах.</p>
          </Say>
        )}
      </Card>
      <Card>
        <Plot title="Часові ряди x(t), y(t), z(t)" height={240} xLabel="t" cursorX={time} xDomain={[0, T]} series={series.ts} />
      </Card>
      <Grid>
        <Card>
          <Plot
            title="Проєкція x–z (крила метелика)"
            height={280}
            xLabel="x"
            yLabel="z"
            sorted={false}
            markers={[...fpMarkers, ...(cur ? [{ x: cur[0], y: cur[2], color: "#ffffff" }] : [])]}
            series={series.xz}
          />
        </Card>
        <Card>
          <Plot
            title="Проєкція x–y"
            height={280}
            xLabel="x"
            yLabel="y"
            sorted={false}
            equalAspect
            markers={[...(fp.C ? [{ x: fp.C[0], y: fp.C[1], color: fp.stableC ? "#3ee6a8" : "#ff5d73", r: 4 }, { x: -fp.C[0], y: -fp.C[1], color: fp.stableC ? "#3ee6a8" : "#ff5d73", r: 4 }] : []), ...(cur ? [{ x: cur[0], y: cur[1], color: "#ffffff" }] : [])]}
            series={series.xy}
          />
        </Card>
      </Grid>
    </>
  );
}
