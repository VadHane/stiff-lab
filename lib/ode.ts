// Numerical integrators for (possibly stiff) ODE systems y' = f(t, y).
import { axpy, eigenvalues, iMinus, luFactor, luSolve, type Mat, type Vec } from "./linalg";

export type RHS = (t: number, y: Vec) => Vec;
export type Jac = (t: number, y: Vec) => Mat;

export interface Problem {
  f: RHS;
  y0: Vec;
  t0?: number;
  T: number;
  /** Optional analytic Jacobian; finite differences are used otherwise. */
  jac?: Jac;
}

export type MethodId =
  | "euler" // explicit Euler
  | "rk4" // classical Runge–Kutta 4
  | "ieuler" // implicit (backward) Euler
  | "theta" // linear one-step θ-method, θ = 0.55 by default
  | "trap" // trapezoidal rule (θ = 0.5)
  | "bdf2" // Gear / BDF of order 2
  | "dopri" // adaptive Dormand–Prince 5(4)
  | "ros" // adaptive Rosenbrock 2(3) (MATLAB ode23s)
  | "thetaA"; // adaptive θ-method with step doubling

export interface SolveOptions {
  h?: number;
  theta?: number;
  rtol?: number;
  atol?: number;
  hInit?: number;
  hMax?: number;
  maxSteps?: number;
  /** Abort when any |y_i| exceeds this value (blow-up detector). */
  blowup?: number;
}

export interface Solution {
  method: MethodId;
  t: number[];
  y: Vec[];
  /** step sizes actually used (for adaptive methods) */
  hs: number[];
  steps: number;
  rejected: number;
  fevals: number;
  jevals: number;
  failed?: string;
  ms: number;
}

const EPS = 2.220446049250313e-16;

export function numJac(f: RHS, t: number, y: Vec, fy?: Vec): Mat {
  const n = y.length;
  const f0 = fy ?? f(t, y);
  const J: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const d = Math.sqrt(EPS) * Math.max(Math.abs(y[j]), 1e-6);
    const yp = y.slice();
    yp[j] += d;
    const f1 = f(t, yp);
    for (let i = 0; i < n; i++) J[i][j] = (f1[i] - f0[i]) / d;
  }
  return J;
}

function bad(y: Vec, limit: number): boolean {
  for (const v of y) if (!Number.isFinite(v) || Math.abs(v) > limit) return true;
  return false;
}

class Counter {
  fe = 0;
  je = 0;
  private p: Problem;
  constructor(p: Problem) {
    this.p = p;
  }
  f = (t: number, y: Vec) => {
    this.fe++;
    return this.p.f(t, y);
  };
  J = (t: number, y: Vec, fy?: Vec): Mat => {
    this.je++;
    if (this.p.jac) return this.p.jac(t, y);
    this.fe += y.length;
    return numJac(this.p.f, t, y, fy);
  };
}

/**
 * Solve the implicit equation z = c + h·β·f(t1, z) by Newton's method.
 * Returns null when Newton fails to converge.
 */
function newtonImplicit(
  C: Counter,
  t1: number,
  guess: Vec,
  c: Vec,
  hb: number,
  J0in: Mat,
): Vec | null {
  let J0 = J0in;
  // Damped full Newton for G(z) = z − c − hb·f(t1, z) = 0.
  // At least one Newton step is always taken, and convergence also requires a RELATIVE increment < 1e-10 per component
  // (floor 1e-200, below which doubles lose precision): otherwise tiny but meaningful components — decaying modes,
  // populations ~1e-80 — would be "frozen" at their old values by the absolute residual test.
  const resid = (z: Vec, fz: Vec) => z.map((zi, i) => zi - c[i] - hb * fz[i]);
  // scale 1 + |c_i|: relative for large components, absolute (1e-12) for small ones — robust when f_i is
  // computed with cancellation; tiny components are still updated because a Newton step is always taken.
  const scaleOf = (_z: Vec, _fz: Vec) => c.map((v) => 1 + Math.abs(v));
  const rnormS = (G: Vec, sc: Vec) => G.reduce((m, g, i) => Math.max(m, Math.abs(g) / sc[i]), 0);
  let z = guess.slice();
  let fz = C.f(t1, z);
  let G = resid(z, fz);
  let scale = scaleOf(z, fz);
  // relative size of the last Newton increment per component: tiny components must converge relatively too
  let relStep = Infinity;
  let r = rnormS(G, scale);
  let J = J0;
  for (let it = 0; it < 80; it++) {
    // always take at least one Newton step from the guess: otherwise tiny components would never be updated
    if (it > 0 && r < 1e-12 && relStep < 1e-10) return z;
    const lu = luFactor(iMinus(hb, J));
    if (lu.singular) return null;
    const dz = luSolve(lu, G);
    let lam = 1;
    let zn: Vec = z,
      fn: Vec = fz,
      rn = Infinity;
    let decreased = false;
    let scn = scale;
    for (let k = 0; k < 16; k++) {
      zn = z.map((zi, i) => zi - lam * dz[i]);
      fn = C.f(t1, zn);
      scn = scaleOf(zn, fn);
      rn = rnormS(resid(zn, fn), scn);
      // once the residual is at round-off level it can no longer measure progress: take the full step and let the
        // relative-increment test decide convergence
        if (Number.isFinite(rn) && (rn < r || (lam === 1 && r < 1e-12))) {
        decreased = true;
        break;
      }
      lam /= 2;
    }
    if (!decreased) {
      // stuck in a local minimum of the residual (or stale Jacobian): refresh J once, otherwise give up
      if (J === J0 && it === 0) {
        J = C.J(t1, z, fz);
        J0 = J;
        continue;
      }
      return r < 1e-8 ? z : null;
    }
    let step = 0;
    relStep = 0;
    for (let i = 0; i < z.length; i++) {
      step = Math.max(step, (lam * Math.abs(dz[i])) / scn[i]);
      relStep = Math.max(relStep, (lam * Math.abs(dz[i])) / (Math.abs(zn[i]) + 1e-200));
    }
    z = zn;
    fz = fn;
    G = resid(z, fz);
    scale = scn;
    r = rn;
    if (lam === 1 && step < 1e-11 && relStep < 1e-10) return z;
    J = C.J(t1, z, fz);
  }
  return r < 1e-8 ? z : null;
}

function emptySol(method: MethodId, p: Problem): Solution {
  return {
    method,
    t: [p.t0 ?? 0],
    y: [p.y0.slice()],
    hs: [],
    steps: 0,
    rejected: 0,
    fevals: 0,
    jevals: 0,
    ms: 0,
  };
}

// ----------------------------------------------------------------------------
// Fixed-step methods
// ----------------------------------------------------------------------------

/**
 * Starting guess for a hard implicit step: march t → t+h with backward-Euler sub-steps
 * (halving recursively). Only used to seed Newton; the step itself keeps its own formula.
 */
function substepGuess(C: Counter, t: number, y: Vec, h: number, depth = 0): Vec | null {
  const J = C.J(t, y);
  const z = newtonImplicit(C, t + h, y, y, h, J);
  if (z) return z;
  if (depth >= 10) return null;
  const mid = substepGuess(C, t, y, h / 2, depth + 1);
  return mid ? substepGuess(C, t + h / 2, mid, h / 2, depth + 1) : null;
}

/**
 * Last-resort solver for z = c + hb·f(t1, z): homotopy in the implicit weight.
 * Starts from the explicit part z = c (the exact root for hb = 0) and increases hb gradually.
 */
function continuationSolve(C: Counter, t1: number, c: Vec, hb: number): Vec | null {
  let z = c.slice();
  let s = 0;
  let ds = 0.25;
  let guard = 0;
  while (s < 1 && guard++ < 60) {
    const sn = Math.min(1, s + ds);
    const zn = newtonImplicit(C, t1, z, c, hb * sn, C.J(t1, z));
    if (zn) {
      z = zn;
      s = sn;
      ds = Math.min(ds * 2, 1 - s || 1);
    } else {
      ds /= 2;
      if (ds < 1e-4) return null;
    }
  }
  return s >= 1 ? z : null;
}

/**
 * Multi-start fallback: when the implicit root lies on another branch of a slow manifold
 * (fold of a relaxation oscillation), Newton from nearby guesses gets stuck in a local minimum
 * of the residual. Try progressively "farther" starting points along the vector field.
 */
function multiStartSolve(C: Counter, t1: number, c: Vec, hb: number): Vec | null {
  const fc = C.f(t1, c);
  for (const k of [1, 2, 4, 8, 16, 32, 64]) {
    const z0 = c.map((v, i) => v + k * hb * fc[i]);
    if (z0.some((v) => !Number.isFinite(v))) break;
    const z = newtonImplicit(C, t1, z0, c, hb, C.J(t1, z0));
    if (z) return z;
  }
  return null;
}

function fixedStep(method: MethodId, p: Problem, o: SolveOptions): Solution {
  const sol = emptySol(method, p);
  const C = new Counter(p);
  const t0 = p.t0 ?? 0;
  const h0 = o.h ?? 0.01;
  const N = Math.max(1, Math.round((p.T - t0) / h0));
  const h = (p.T - t0) / N;
  const limit = o.blowup ?? 1e10;
  const theta = method === "trap" ? 0.5 : method === "ieuler" ? 1 : (o.theta ?? 0.55);
  let y = p.y0.slice();
  let yPrev: Vec | null = null;
  let t = t0;
  // the rescue strategies below are expensive; a solution that needs them on many steps is hopeless — give up early
  const MAX_RESCUES = 25;
  let rescues = 0;
  for (let n = 0; n < N; n++) {
    let yn: Vec | null;
    const t1 = t0 + (n + 1) * h;
    switch (method) {
      case "euler": {
        yn = axpy(h, C.f(t, y), y);
        break;
      }
      case "rk4": {
        const k1 = C.f(t, y);
        const k2 = C.f(t + h / 2, axpy(h / 2, k1, y));
        const k3 = C.f(t + h / 2, axpy(h / 2, k2, y));
        const k4 = C.f(t + h, axpy(h, k3, y));
        yn = y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
        break;
      }
      case "ieuler":
      case "trap":
      case "theta": {
        const fy = C.f(t, y);
        const J = C.J(t, y, fy);
        const c = y.map((v, i) => v + h * (1 - theta) * fy[i]);
        yn = newtonImplicit(C, t1, y, c, h * theta, J);
        break;
      }
      case "bdf2": {
        const fy = C.f(t, y);
        const J = C.J(t, y, fy);
        if (!yPrev) {
          // start-up step: backward Euler
          yn = newtonImplicit(C, t1, y, y, h, J);
        } else {
          const yp = yPrev;
          const c = y.map((v, i) => (4 / 3) * v - (1 / 3) * yp[i]);
          yn = newtonImplicit(C, t1, y, c, (2 / 3) * h, J);
        }
        break;
      }
      default:
        throw new Error("not a fixed-step method: " + method);
    }
    if (!yn && method !== "euler" && method !== "rk4" && rescues++ >= MAX_RESCUES) {
      sol.failed = `Метод Ньютона не збігся (рівняння кроку не розв'язується вже ${MAX_RESCUES} разів) при t ≈ ${t.toPrecision(4)}`;
      break;
    }
    if (!yn && method !== "euler" && method !== "rk4") {
      const g = substepGuess(C, t, y, h);
      if (g) {
        const fy = C.f(t, y);
        const J = C.J(t1, g);
        if (method === "bdf2" && yPrev) {
          const yp = yPrev;
          yn = newtonImplicit(C, t1, g, y.map((v, i) => (4 / 3) * v - (1 / 3) * yp[i]), (2 / 3) * h, J);
        } else if (method === "bdf2") {
          yn = newtonImplicit(C, t1, g, y, h, J);
        } else {
          yn = newtonImplicit(C, t1, g, y.map((v, i) => v + h * (1 - theta) * fy[i]), h * theta, J);
        }
      }
    }
    if (!yn && method !== "euler" && method !== "rk4") {
      const fy = C.f(t, y);
      let c: Vec, hb: number;
      if (method === "bdf2" && yPrev) {
        const yp = yPrev;
        c = y.map((v, i) => (4 / 3) * v - (1 / 3) * yp[i]);
        hb = (2 / 3) * h;
      } else if (method === "bdf2") {
        c = y;
        hb = h;
      } else {
        c = y.map((v, i) => v + h * (1 - theta) * fy[i]);
        hb = h * theta;
      }
      yn = continuationSolve(C, t1, c, hb) ?? multiStartSolve(C, t1, c, hb);
    }
    if (!yn) {
      sol.failed = `Метод Ньютона не збігся при t ≈ ${t.toPrecision(4)}`;
      break;
    }
    yPrev = y;
    y = yn;
    t = t1;
    sol.t.push(t);
    sol.y.push(y);
    sol.hs.push(h);
    sol.steps++;
    if (bad(y, limit)) {
      sol.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
      break;
    }
  }
  sol.fevals = C.fe;
  sol.jevals = C.je;
  return sol;
}

// ----------------------------------------------------------------------------
// Adaptive methods
// ----------------------------------------------------------------------------

function errNorm(err: Vec, y0: Vec, y1: Vec, rtol: number, atol: number): number {
  let s = 0;
  for (let i = 0; i < err.length; i++) {
    const sc = atol + rtol * Math.max(Math.abs(y0[i]), Math.abs(y1[i]));
    s = Math.max(s, Math.abs(err[i]) / sc);
  }
  return s;
}

function initialStep(p: Problem, o: SolveOptions, order: number): number {
  if (o.hInit) return o.hInit;
  const t0 = p.t0 ?? 0;
  const f0 = p.f(t0, p.y0);
  const rtol = o.rtol ?? 1e-3,
    atol = o.atol ?? 1e-6;
  let d0 = 0,
    d1 = 0;
  for (let i = 0; i < p.y0.length; i++) {
    const sc = atol + rtol * Math.abs(p.y0[i]);
    d0 = Math.max(d0, Math.abs(p.y0[i]) / sc);
    d1 = Math.max(d1, Math.abs(f0[i]) / sc);
  }
  let h = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : (0.01 * d0) / d1;
  h = Math.min(h, (p.T - t0) / 10);
  return Math.max(h * Math.pow(0.5, order - 1), 1e-12);
}

// Dormand–Prince 5(4) tableau
const DP = {
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ],
  b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  e: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40],
};

function dopri(p: Problem, o: SolveOptions): Solution {
  const sol = emptySol("dopri", p);
  const C = new Counter(p);
  const rtol = o.rtol ?? 1e-3,
    atol = o.atol ?? 1e-6;
  const maxSteps = o.maxSteps ?? 200000;
  const hMax = o.hMax ?? Infinity;
  const limit = o.blowup ?? 1e10;
  let t = p.t0 ?? 0;
  let y = p.y0.slice();
  let h = initialStep(p, o, 5);
  let k1 = C.f(t, y);
  while (t < p.T && sol.steps + sol.rejected < maxSteps) {
    h = Math.min(h, p.T - t, hMax);
    const k: Vec[] = [k1];
    for (let s = 1; s < 7; s++) {
      const ys = y.slice();
      for (let j = 0; j < s; j++) {
        const a = DP.a[s][j];
        if (a) for (let i = 0; i < ys.length; i++) ys[i] += h * a * k[j][i];
      }
      k.push(C.f(t + DP.c[s] * h, ys));
    }
    const yn = y.map((v, i) => v + h * DP.b.reduce((acc, b, s) => acc + b * k[s][i], 0));
    const err = y.map((_, i) => h * DP.e.reduce((acc, e, s) => acc + e * k[s][i], 0));
    const en = errNorm(err, y, yn, rtol, atol);
    if (en <= 1 && Number.isFinite(en)) {
      t += h;
      y = yn;
      k1 = k[6];
      sol.t.push(t);
      sol.y.push(y);
      sol.hs.push(h);
      sol.steps++;
      if (bad(y, limit)) {
        sol.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
        break;
      }
    } else sol.rejected++;
    const fac = !Number.isFinite(en) ? 0.1 : en === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(en, -0.2)));
    h *= fac;
    if (t < p.T && h < 1e-14 * Math.max(1, Math.abs(t))) {
      sol.failed = `Крок став надто малим при t ≈ ${t.toPrecision(4)}`;
      break;
    }
  }
  if (t < p.T && !sol.failed) sol.failed = `Вичерпано ліміт кроків (${maxSteps}) при t ≈ ${t.toPrecision(4)}`;
  sol.fevals = C.fe;
  sol.jevals = C.je;
  return sol;
}

/** Rosenbrock 2(3) method of Shampine & Reichelt (ode23s). L-stable, good for stiff problems. */
function rosenbrock(p: Problem, o: SolveOptions): Solution {
  const sol = emptySol("ros", p);
  const C = new Counter(p);
  const rtol = o.rtol ?? 1e-3,
    atol = o.atol ?? 1e-6;
  const maxSteps = o.maxSteps ?? 200000;
  const hMax = o.hMax ?? Infinity;
  const limit = o.blowup ?? 1e10;
  const d = 1 / (2 + Math.SQRT2);
  const e32 = 6 + Math.SQRT2;
  let t = p.t0 ?? 0;
  let y = p.y0.slice();
  let h = initialStep(p, o, 2);
  let F0 = C.f(t, y);
  while (t < p.T && sol.steps + sol.rejected < maxSteps) {
    h = Math.min(h, p.T - t, hMax);
    const J = C.J(t, y, F0);
    // ∂f/∂t by finite differences
    const dtt = Math.sqrt(EPS) * Math.max(Math.abs(t), 1e-3);
    const Ft = C.f(t + dtt, y);
    const T = Ft.map((v, i) => (v - F0[i]) / dtt);
    const lu = luFactor(iMinus(h * d, J));
    let accepted = false;
    if (!lu.singular) {
      const k1 = luSolve(lu, F0.map((v, i) => v + h * d * T[i]));
      const F1 = C.f(t + 0.5 * h, axpy(0.5 * h, k1, y));
      const k2 = luSolve(lu, F1.map((v, i) => v - k1[i])).map((v, i) => v + k1[i]);
      const yn = axpy(h, k2, y);
      const F2 = C.f(t + h, yn);
      const k3 = luSolve(
        lu,
        F2.map((v, i) => v - e32 * (k2[i] - F1[i]) - 2 * (k1[i] - F0[i]) + h * d * T[i]),
      );
      const err = k1.map((v, i) => (h / 6) * (v - 2 * k2[i] + k3[i]));
      const en = errNorm(err, y, yn, rtol, atol);
      if (en <= 1 && Number.isFinite(en)) {
        accepted = true;
        t += h;
        y = yn;
        F0 = F2;
        sol.t.push(t);
        sol.y.push(y);
        sol.hs.push(h);
        sol.steps++;
        if (bad(y, limit)) {
          sol.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
          break;
        }
      }
      const fac = !Number.isFinite(en) ? 0.1 : en === 0 ? 5 : Math.min(5, Math.max(0.2, 0.8 * Math.pow(en, -1 / 3)));
      h *= accepted ? fac : Math.min(fac, 0.5);
    } else h *= 0.25;
    if (!accepted) sol.rejected++;
    if (t < p.T && h < 1e-14 * Math.max(1, Math.abs(t))) {
      sol.failed = `Крок став надто малим при t ≈ ${t.toPrecision(4)}`;
      break;
    }
  }
  if (t < p.T && !sol.failed) sol.failed = `Вичерпано ліміт кроків (${maxSteps}) при t ≈ ${t.toPrecision(4)}`;
  sol.fevals = C.fe;
  sol.jevals = C.je;
  return sol;
}

/**
 * Adaptive θ-method y_{n} = y_{n-1} + h(θ f_n + (1-θ) f_{n-1}) with step-doubling error control.
 */
function thetaAdaptive(p: Problem, o: SolveOptions): Solution {
  const sol = emptySol("thetaA", p);
  const C = new Counter(p);
  const theta = o.theta ?? 0.55;
  const rtol = o.rtol ?? 1e-3,
    atol = o.atol ?? 1e-6;
  const maxSteps = o.maxSteps ?? 200000;
  const hMax = o.hMax ?? Infinity;
  const limit = o.blowup ?? 1e10;
  // order of the method: 2 for θ = 1/2, 1 otherwise
  const q = Math.abs(theta - 0.5) < 1e-12 ? 2 : 1;
  let t = p.t0 ?? 0;
  let y = p.y0.slice();
  let h = initialStep(p, o, 1);
  const step = (t0: number, y0: Vec, f0: Vec, J: Mat, hh: number) => {
    const c = y0.map((v, i) => v + hh * (1 - theta) * f0[i]);
    return newtonImplicit(C, t0 + hh, y0, c, hh * theta, J);
  };
  while (t < p.T && sol.steps + sol.rejected < maxSteps) {
    h = Math.min(h, p.T - t, hMax);
    const f0 = C.f(t, y);
    const J = C.J(t, y, f0);
    const big = step(t, y, f0, J, h);
    const half = step(t, y, f0, J, h / 2);
    const two = half ? step(t + h / 2, half, C.f(t + h / 2, half), J, h / 2) : null;
    if (!big || !two) {
      sol.rejected++;
      h *= 0.25;
    } else {
      const err = two.map((v, i) => (v - big[i]) / (Math.pow(2, q) - 1));
      const en = errNorm(err, y, two, rtol, atol);
      if (en <= 1) {
        t += h;
        // local extrapolation is not used to keep the method "pure"
        y = two;
        sol.t.push(t);
        sol.y.push(y);
        sol.hs.push(h);
        sol.steps++;
        if (bad(y, limit)) {
          sol.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
          break;
        }
      } else sol.rejected++;
      const fac = en === 0 ? 4 : Math.min(4, Math.max(0.2, 0.9 * Math.pow(en, -1 / (q + 1))));
      h *= fac;
    }
    if (t < p.T && h < 1e-14 * Math.max(1, Math.abs(t))) {
      sol.failed = `Крок став надто малим при t ≈ ${t.toPrecision(4)}`;
      break;
    }
  }
  if (t < p.T && !sol.failed) sol.failed = `Вичерпано ліміт кроків (${maxSteps}) при t ≈ ${t.toPrecision(4)}`;
  sol.fevals = C.fe;
  sol.jevals = C.je;
  return sol;
}

export function solve(method: MethodId, p: Problem, o: SolveOptions = {}): Solution {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  let sol: Solution;
  switch (method) {
    case "dopri":
      sol = dopri(p, o);
      break;
    case "ros":
      sol = rosenbrock(p, o);
      break;
    case "thetaA":
      sol = thetaAdaptive(p, o);
      break;
    default:
      sol = fixedStep(method, p, o);
  }
  sol.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
  return sol;
}

export const isAdaptive = (m: MethodId) => m === "dopri" || m === "ros" || m === "thetaA";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Component i of a solution as a plain array. */
export function comp(sol: Solution, i: number): number[] {
  return sol.y.map((v) => v[i]);
}

/** Linear interpolation of solution component at time t (t sorted ascending). */
export function sampleAt(ts: number[], ys: number[], t: number): number {
  if (ts.length === 0) return NaN;
  if (t <= ts[0]) return ys[0];
  if (t >= ts[ts.length - 1]) return ys[ys.length - 1];
  let lo = 0,
    hi = ts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= t) lo = m;
    else hi = m;
  }
  const w = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return ys[lo] + w * (ys[hi] - ys[lo]);
}

/**
 * Dense output of a numerical solution by piecewise cubic Hermite interpolation (values + f at the nodes).
 * Error O(h⁴) instead of O(h²) for linear interpolation — needed when a reference solution is compared
 * with an accurate method at points that are not reference nodes.
 */
export function denseOutput(sol: Solution, f: RHS): (t: number) => Vec {
  const ts = sol.t,
    ys = sol.y;
  const fs: (Vec | undefined)[] = new Array(ts.length);
  const fAt = (i: number) => (fs[i] ??= f(ts[i], ys[i]));
  return (t: number) => {
    const n = ts.length;
    if (n === 1 || t <= ts[0]) return ys[0].slice();
    if (t >= ts[n - 1]) return ys[n - 1].slice();
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m;
      else hi = m;
    }
    const h = ts[hi] - ts[lo];
    if (!(h > 0)) return ys[lo].slice();
    const s = (t - ts[lo]) / h;
    const s2 = s * s,
      s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1,
      h10 = s3 - 2 * s2 + s,
      h01 = -2 * s3 + 3 * s2,
      h11 = s3 - s2;
    const f0 = fAt(lo),
      f1 = fAt(hi),
      y0 = ys[lo],
      y1 = ys[hi];
    return y0.map((v, i) => h00 * v + h10 * h * f0[i] + h01 * y1[i] + h11 * h * f1[i]);
  };
}

export function indexAt(ts: number[], t: number): number {
  let lo = 0,
    hi = ts.length - 1;
  if (t <= ts[0]) return 0;
  if (t >= ts[hi]) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= t) lo = m;
    else hi = m;
  }
  return lo;
}

/** Max abs error of a numerical solution vs an exact solution. */
export function maxError(sol: Solution, exact: (t: number) => Vec): { max: number; perComp: number[]; err: number[][] } {
  const n = sol.y[0].length;
  const perComp = new Array(n).fill(0);
  const err: number[][] = Array.from({ length: n }, () => []);
  sol.t.forEach((t, k) => {
    const e = exact(t);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(sol.y[k][i] - e[i]);
      err[i].push(d);
      if (!(d <= perComp[i])) perComp[i] = d; // NaN-safe
    }
  });
  return { max: Math.max(...perComp), perComp, err };
}

/** Stiffness info of the Jacobian at a point. */
export function stiffnessAt(p: Problem, t: number, y: Vec) {
  const J = p.jac ? p.jac(t, y) : numJac(p.f, t, y);
  const ev = eigenvalues(J);
  const all = ev.map((e) => Math.abs(e.re));
  const top = all.length ? Math.max(...all) : 0;
  // ignore numerically-zero eigenvalues (conservation laws) when measuring stiffness;
  // QR eigenvalues are accurate to ~ε·‖J‖, so anything below 1e-11·max is round-off
  const re = all.filter((v) => v > 1e-300 && v > 1e-11 * top);
  const neg = ev.filter((e) => e.re < 0 && -e.re > 1e-11 * top).map((e) => -e.re);
  const ratio = neg.length >= 2 ? Math.max(...neg) / Math.max(Math.min(...neg), 1e-300) : NaN;
  return { J, ev, ratio, maxRe: re.length ? Math.max(...re) : 0 };
}

/** Exact solution of a constant 2×2 linear system y' = A y + b via eigen-decomposition (real distinct eigenvalues). */
export function linear2Exact(A: Mat, b: Vec, y0: Vec): { lambda: [number, number]; at: (t: number) => Vec } {
  const [[a, bb], [c, d]] = A;
  const tr = a + d,
    det = a * d - bb * c;
  const disc = Math.sqrt(tr * tr - 4 * det);
  const l1 = (tr + disc) / 2,
    l2 = (tr - disc) / 2;
  // equilibrium y* : A y* = -b
  const ys = [(-b[0] * d + bb * b[1]) / det, (-a * b[1] + c * b[0]) / det];
  // eigenvectors
  const v = (l: number): Vec => (Math.abs(bb) > 1e-14 ? [bb, l - a] : [l - d, c]);
  const v1 = v(l1),
    v2 = v(l2);
  const r = [y0[0] - ys[0], y0[1] - ys[1]];
  // solve [v1 v2] [c1 c2]^T = r
  const D = v1[0] * v2[1] - v2[0] * v1[1];
  const c1 = (r[0] * v2[1] - v2[0] * r[1]) / D;
  const c2 = (v1[0] * r[1] - r[0] * v1[1]) / D;
  return {
    lambda: [l1, l2],
    at: (t: number) => {
      const e1 = c1 * Math.exp(l1 * t),
        e2 = c2 * Math.exp(l2 * t);
      return [ys[0] + e1 * v1[0] + e2 * v2[0], ys[1] + e1 * v1[1] + e2 * v2[1]];
    },
  };
}
