import { iMinus, luFactor, luSolve, type Mat, type Vec } from "./linalg";
import { numJac, type Problem } from "./ode";

export interface ThetaAttempt {
  t: number;
  h: number;
  /** scaled error estimate ‖err‖/tol (≤ 1 ⇒ accepted) */
  ratio: number;
  accepted: boolean;
  /** step factor chosen by the controller */
  fac: number;
}

export interface ThetaTrace {
  t: number[];
  y: Vec[];
  hs: number[];
  attempts: ThetaAttempt[];
  steps: number;
  rejected: number;
  fevals: number;
  jevals: number;
  newton: number;
  failed?: string;
  ms: number;
}

export interface ThetaTraceOptions {
  theta?: number;
  rtol?: number;
  atol?: number;
  maxSteps?: number;
  hInit?: number;
  /** abort when any |y_i| exceeds this value */
  blowup?: number;
  /** abort when the number of f-evaluations exceeds this value (keeps the UI responsive) */
  maxFevals?: number;
}

/**
 * Adaptive θ-method y_n = y_{n-1} + h(θ f_n + (1−θ) f_{n−1}) with step-doubling (Richardson) error control.
 * Same algorithm as `solve("thetaA")` in ode.ts (same damped Newton, same error estimate and step formula),
 * but every attempt (accepted or rejected) is recorded.
 */
export function thetaTrace(p: Problem, o: ThetaTraceOptions = {}): ThetaTrace {
  const start = performance.now();
  const theta = o.theta ?? 0.55;
  const rtol = o.rtol ?? 1e-3;
  const atol = o.atol ?? 1e-6;
  const maxSteps = o.maxSteps ?? 100000;
  const limit = o.blowup ?? 1e10;
  const maxFevals = o.maxFevals ?? Infinity;
  // order of the method: 2 for θ = 1/2, 1 otherwise
  const q = Math.abs(theta - 0.5) < 1e-12 ? 2 : 1;
  const out: ThetaTrace = { t: [p.t0 ?? 0], y: [p.y0.slice()], hs: [], attempts: [], steps: 0, rejected: 0, fevals: 0, jevals: 0, newton: 0, ms: 0 };
  const f = (t: number, y: Vec) => {
    out.fevals++;
    return p.f(t, y);
  };
  const J = (t: number, y: Vec, fy: Vec): Mat => {
    out.jevals++;
    if (p.jac) return p.jac(t, y);
    out.fevals += y.length;
    return numJac(p.f, t, y, fy);
  };
  /** Damped full Newton for G(z) = z − c − hb·f(t1, z) = 0 (identical to newtonImplicit in ode.ts). */
  const newton = (t1: number, guess: Vec, c: Vec, hb: number, J0: Mat): Vec | null => {
    // mirrors newtonImplicit in lib/ode.ts: residual relative to the size of each equation's terms
    const resid = (z: Vec, fz: Vec) => z.map((zi, i) => zi - c[i] - hb * fz[i]);
    // scale 1 + |c_i|: relative for large components, absolute (1e-12) for small ones — robust when f_i is
    // computed with cancellation; tiny components are still updated because a Newton step is always taken.
    const scaleOf = (_z: Vec, _fz: Vec) => c.map((v) => 1 + Math.abs(v));
    const rnormS = (G: Vec, sc: Vec) => G.reduce((m, g, i) => Math.max(m, Math.abs(g) / sc[i]), 0);
    let z = guess.slice();
    let fz = f(t1, z);
    let G = resid(z, fz);
    let scale = scaleOf(z, fz);
    // relative size of the last Newton increment per component: tiny components must converge relatively too
    let relStep = Infinity;
    let r = rnormS(G, scale);
    let Jm = J0;
    let first = J0;
    for (let it = 0; it < 80; it++) {
      // always take at least one Newton step from the guess: otherwise tiny components would never be updated
      if (it > 0 && r < 1e-12 && relStep < 1e-10) return z;
      out.newton++;
      const lu = luFactor(iMinus(hb, Jm));
      if (lu.singular) return null;
      const dz = luSolve(lu, G);
      let lam = 1;
      let zn: Vec = z,
        fn: Vec = fz,
        rn = Infinity,
        scn = scale;
      let decreased = false;
      for (let k = 0; k < 16; k++) {
        zn = z.map((zi, i) => zi - lam * dz[i]);
        fn = f(t1, zn);
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
        if (Jm === first && it === 0) {
          Jm = J(t1, z, fz);
          first = Jm;
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
      Jm = J(t1, z, fz);
    }
    return r < 1e-8 ? z : null;
  };
  const step = (t0: number, y0: Vec, f0: Vec, Jm: Mat, hh: number) => {
    const c = y0.map((v, i) => v + hh * (1 - theta) * f0[i]);
    return newton(t0 + hh, y0, c, hh * theta, Jm);
  };

  let t = p.t0 ?? 0;
  let y = p.y0.slice();
  let h: number;
  if (o.hInit) h = o.hInit;
  else {
    const f0 = p.f(t, y);
    let d0 = 0,
      d1 = 0;
    for (let i = 0; i < y.length; i++) {
      const sc = atol + rtol * Math.abs(y[i]);
      d0 = Math.max(d0, Math.abs(y[i]) / sc);
      d1 = Math.max(d1, Math.abs(f0[i]) / sc);
    }
    h = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : (0.01 * d0) / d1;
    h = Math.max(Math.min(h, (p.T - t) / 10), 1e-12);
  }

  while (t < p.T && out.steps + out.rejected < maxSteps) {
    if (out.fevals > maxFevals) {
      out.failed = `Вичерпано ліміт обчислень f (${maxFevals}) при t ≈ ${t.toPrecision(4)}`;
      break;
    }
    h = Math.min(h, p.T - t);
    const f0 = f(t, y);
    const Jm = J(t, y, f0);
    const big = step(t, y, f0, Jm, h);
    const half = step(t, y, f0, Jm, h / 2);
    const two = half ? step(t + h / 2, half, f(t + h / 2, half), Jm, h / 2) : null;
    if (!big || !two) {
      out.rejected++;
      out.attempts.push({ t, h, ratio: Infinity, accepted: false, fac: 0.25 });
      h *= 0.25;
    } else {
      let en = 0;
      for (let i = 0; i < y.length; i++) {
        const e = (two[i] - big[i]) / (Math.pow(2, q) - 1);
        const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(two[i]));
        en = Math.max(en, Math.abs(e) / sc);
      }
      const fac = en === 0 ? 4 : Math.min(4, Math.max(0.2, 0.9 * Math.pow(en, -1 / (q + 1))));
      const ok = en <= 1;
      out.attempts.push({ t, h, ratio: en, accepted: ok, fac });
      if (ok) {
        t += h;
        y = two;
        out.t.push(t);
        out.y.push(y);
        out.hs.push(h);
        out.steps++;
        if (y.some((v) => !Number.isFinite(v) || Math.abs(v) > limit)) {
          out.failed = `Розв'язок «вибухнув» при t ≈ ${t.toPrecision(4)}`;
          break;
        }
      } else out.rejected++;
      h *= fac;
    }
    if (t < p.T && h < 1e-14 * Math.max(1, Math.abs(t))) {
      out.failed = `Крок став надто малим при t ≈ ${t.toPrecision(4)}`;
      break;
    }
  }
  if (t < p.T && !out.failed) out.failed = `Вичерпано ліміт кроків (${maxSteps}) при t ≈ ${t.toPrecision(4)}`;
  out.ms = performance.now() - start;
  return out;
}
