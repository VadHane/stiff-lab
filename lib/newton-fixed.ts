import { iMinus, luFactor, luSolve, type Vec } from "./linalg";
import type { MethodId, Problem, Solution } from "./ode";

/**
 * Fixed-step implicit methods (θ-family and BDF2) with a FULL Newton iteration:
 * the Jacobian is re-evaluated on every iteration and the initial guess is y_n.
 * Needed for strongly nonlinear problems where a frozen-Jacobian Newton from an explicit predictor diverges.
 * Formulas are identical to `solve()` in ./ode.ts (θ-step: z = y + h(1−θ)f(t,y) + hθ f(t+h,z);
 * BDF2: z = 4/3 y_n − 1/3 y_{n−1} + 2/3 h f(t+h,z); first BDF2 step = backward Euler).
 * If Newton still fails (e.g. at a fold of a slow manifold) the step is rescued by splitting it into
 * halves of the same θ-method (BDF2 falls back to backward Euler for that one step). Every such
 * failed Newton solve — including the BDF2→BE fallback — is counted in `rejected`; the output grid
 * (t_n = t_0 + n h) is never changed, so `steps` always equals N.
 */
export function solveFullNewton(method: MethodId, p: Problem, h0: number, blowup = 1e8): Solution {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const t0 = p.t0 ?? 0;
  const N = Math.max(1, Math.round((p.T - t0) / h0));
  const h = (p.T - t0) / N;
  const theta = method === "trap" ? 0.5 : method === "ieuler" ? 1 : 0.55;
  const sol: Solution = { method, t: [t0], y: [p.y0.slice()], hs: [], steps: 0, rejected: 0, fevals: 0, jevals: 0, ms: 0 };
  const jac = p.jac!;
  let y = p.y0.slice();
  let yPrev: Vec | null = null;
  let t = t0;
  const resid = (t1: number, z: Vec, c: Vec, hb: number) => {
    const fz = p.f(t1, z);
    sol.fevals++;
    return z.map((zi, i) => zi - c[i] - hb * fz[i]);
  };
  const plain = (t1: number, guess: Vec, c: Vec, hb: number): Vec | null => {
    const z = guess.slice();
    for (let it = 0; it < 50; it++) {
      const G = resid(t1, z, c, hb);
      const J = jac(t1, z);
      sol.jevals++;
      const lu = luFactor(iMinus(hb, J));
      if (lu.singular) return null;
      const dz = luSolve(lu, G);
      let step = 0;
      for (let i = 0; i < z.length; i++) {
        z[i] -= dz[i];
        step = Math.max(step, Math.abs(dz[i]) / (1 + Math.abs(z[i])));
      }
      if (!Number.isFinite(step)) return null;
      if (step < 1e-11) return z;
    }
    return null;
  };
  const damped = (t1: number, guess: Vec, c: Vec, hb: number): Vec | null => {
    let z = guess.slice();
    let G = resid(t1, z, c, hb);
    let r = Math.hypot(...G);
    for (let it = 0; it < 100; it++) {
      const J = jac(t1, z);
      sol.jevals++;
      const lu = luFactor(iMinus(hb, J));
      if (lu.singular) return null;
      const dz = luSolve(lu, G);
      let lam = 1;
      let zn = z,
        Gn = G,
        rn = Infinity;
      for (let k = 0; k < 20; k++) {
        zn = z.map((zi, i) => zi - lam * dz[i]);
        Gn = resid(t1, zn, c, hb);
        rn = Math.hypot(...Gn);
        if (Number.isFinite(rn) && rn < (1 - 1e-4 * lam) * r) break;
        lam /= 2;
      }
      if (!Number.isFinite(rn) || rn >= r) return null;
      const step = dz.reduce((m, d, i) => Math.max(m, Math.abs(lam * d) / (1 + Math.abs(zn[i]))), 0);
      z = zn;
      G = Gn;
      r = rn;
      if (lam === 1 && step < 1e-11) return z;
    }
    return null;
  };
  const newton = (t1: number, guess: Vec, c: Vec, hb: number): Vec | null => plain(t1, guess, c, hb) ?? damped(t1, guess, c, hb);
  const oneStep = (tt: number, yy: Vec, hh: number, th: number): Vec | null => {
    const fy = p.f(tt, yy);
    sol.fevals++;
    const c = yy.map((v, i) => v + hh * (1 - th) * fy[i]);
    return newton(tt + hh, yy, c, hh * th);
  };
  const rescue = (tt: number, yy: Vec, hh: number, th: number, depth: number): Vec | null => {
    const direct = oneStep(tt, yy, hh, th);
    if (direct || depth >= 14) return direct;
    sol.rejected++;
    const mid = rescue(tt, yy, hh / 2, th, depth + 1);
    return mid ? rescue(tt + hh / 2, mid, hh / 2, th, depth + 1) : null;
  };
  for (let n = 0; n < N; n++) {
    const t1 = t0 + (n + 1) * h;
    let yn: Vec | null;
    if (method === "bdf2" && yPrev) {
      const yp = yPrev;
      const c = y.map((v, i) => (4 / 3) * v - (1 / 3) * yp[i]);
      yn = newton(t1, y, c, (2 / 3) * h);
      if (!yn) {
        // BDF2 Newton failed: this one step is taken by (possibly split) backward Euler. Count it.
        sol.rejected++;
        yn = rescue(t, y, h, 1, 0);
      }
    } else {
      const th = method === "bdf2" ? 1 : theta;
      yn = rescue(t, y, h, th, 0);
    }
    if (!yn) {
      sol.failed = `Ньютон не збігся при t ≈ ${t.toPrecision(4)}`;
      break;
    }
    yPrev = y;
    y = yn;
    t = t1;
    sol.t.push(t);
    sol.y.push(y);
    sol.hs.push(h);
    sol.steps++;
    if (y.some((v) => !Number.isFinite(v) || Math.abs(v) > blowup)) {
      sol.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
      break;
    }
  }
  sol.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
  return sol;
}
