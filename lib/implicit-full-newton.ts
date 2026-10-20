// Fixed-step implicit methods with a full (damped) Newton iteration: the Jacobian is re-evaluated
// at every iterate and the predictor is y_n. Robust for strongly nonlinear stiff problems
// (e.g. the Brusselator with A = 50) where a frozen-Jacobian Newton with an explicit predictor diverges.
import { iMinus, luFactor, luSolve, type Vec } from "./linalg";
import { numJac, type Problem, type Solution } from "./ode";

export type ImplicitId = "ieuler" | "trap" | "theta" | "bdf2";

function newtonCore(p: Problem, t1: number, guess: Vec, c: Vec, hb: number, cnt: { fe: number; je: number }): Vec | null {
  let z = guess.slice();
  const G = (v: Vec) => {
    cnt.fe++;
    const fv = p.f(t1, v);
    return v.map((vi, i) => vi - c[i] - hb * fv[i]);
  };
  const n2 = (g: Vec) => g.reduce((a, v) => a + v * v, 0);
  let g = G(z);
  let gn = n2(g);
  if (!Number.isFinite(gn)) return null;
  for (let it = 0; it < 30; it++) {
    cnt.je++;
    const J = p.jac ? p.jac(t1, z) : numJac(p.f, t1, z);
    const lu = luFactor(iMinus(hb, J));
    if (lu.singular) return null;
    const dz = luSolve(lu, g);
    let lam = 1;
    let zn = z,
      gnew = g,
      gnn = Infinity,
      ok = false;
    for (let k = 0; k < 20; k++) {
      zn = z.map((v, i) => v - lam * dz[i]);
      gnew = G(zn);
      gnn = n2(gnew);
      if (Number.isFinite(gnn) && gnn <= (1 - 1e-4 * lam) * gn) {
        ok = true;
        break;
      }
      lam /= 2;
    }
    let rel = 0;
    for (let i = 0; i < z.length; i++) rel = Math.max(rel, Math.abs(dz[i]) / (1e-10 + Math.abs(z[i])));
    if (!ok) return rel < 1e-10 ? z : null;
    z = zn;
    g = gnew;
    gn = gnn;
    if (lam === 1 && rel < 1e-11) return z;
    if (gn === 0) return z;
  }
  const scale = Math.max(1, ...z.map(Math.abs));
  return Math.sqrt(gn) < 1e-9 * scale ? z : null;
}

/** Solve z = c + hb·f(t1, z): damped Newton, falling back to continuation in hb when it gets lost. */
function newton(p: Problem, t1: number, guess: Vec, c: Vec, hb: number): { z: Vec; fe: number; je: number } | null {
  const cnt = { fe: 0, je: 0 };
  const direct = newtonCore(p, t1, guess, c, hb, cnt);
  if (direct) return { z: direct, ...cnt };
  let z = c.slice();
  let s = 0,
    ds = 0.125;
  while (s < 1) {
    const s1 = Math.min(1, s + ds);
    const r = newtonCore(p, t1, z, c, hb * s1, cnt);
    if (r) {
      z = r;
      s = s1;
      ds = Math.min(0.5, ds * 2);
    } else {
      ds /= 4;
      if (ds < 1e-6) return null;
    }
  }
  return { z, ...cnt };
}

export function solveImplicit(method: ImplicitId, p: Problem, o: { h: number; theta?: number; blowup?: number }): Solution {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const t0 = p.t0 ?? 0;
  const N = Math.max(1, Math.round((p.T - t0) / o.h));
  const h = (p.T - t0) / N;
  const limit = o.blowup ?? 1e10;
  const theta = method === "trap" ? 0.5 : method === "ieuler" ? 1 : (o.theta ?? 0.55);
  const sol: Solution = { method, t: [t0], y: [p.y0.slice()], hs: [], steps: 0, rejected: 0, fevals: 0, jevals: 0, ms: 0 };
  let y = p.y0.slice();
  let yPrev: Vec | null = null;
  for (let n = 0; n < N; n++) {
    const t = t0 + n * h;
    const t1 = t0 + (n + 1) * h;
    let c: Vec, hb: number;
    if (method === "bdf2" && yPrev) {
      const yp = yPrev;
      c = y.map((v, i) => (4 / 3) * v - (1 / 3) * yp[i]);
      hb = (2 / 3) * h;
    } else if (method === "bdf2") {
      c = y;
      hb = h;
    } else {
      const fy = p.f(t, y);
      sol.fevals++;
      c = y.map((v, i) => v + h * (1 - theta) * fy[i]);
      hb = h * theta;
    }
    const r = newton(p, t1, y, c, hb);
    if (!r) {
      sol.failed = `Метод Ньютона не збігся при t ≈ ${t.toPrecision(4)}`;
      break;
    }
    sol.fevals += r.fe;
    sol.jevals += r.je;
    yPrev = y;
    y = r.z;
    sol.t.push(t1);
    sol.y.push(y);
    sol.hs.push(h);
    sol.steps++;
    if (y.some((v) => !Number.isFinite(v) || Math.abs(v) > limit)) {
      sol.failed = `Розв'язок «вибухнув» при t ≈ ${t1.toPrecision(4)}`;
      break;
    }
  }
  sol.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
  return sol;
}
