// One step of a method, with every intermediate quantity recorded — for the step-by-step debugger.
import { iMinus, luFactor, luSolve, type Vec } from "./linalg";
import { numJac, type RHS } from "./ode";

export type DbgMethod = "euler" | "rk4" | "ieuler" | "theta" | "trap" | "bdf2";

export interface Probe {
  t: number;
  y: Vec;
  k: Vec;
  label: string;
}

export interface StepTrace {
  method: DbgMethod;
  t0: number;
  y0: Vec;
  h: number;
  t1: number;
  y1: Vec | null;
  /** slope evaluations the method used */
  probes: Probe[];
  /** implicit methods: y1 = c + hb·f(t1, y1) */
  c?: Vec;
  hb?: number;
  /** continuation = Newton from y_n failed and the root was reached by gradually increasing the implicit weight */
  newton?: { iterates: Vec[]; residuals: number[]; converged: boolean; continuation?: boolean };
  /** f(t1, y1) for implicit methods */
  fEnd?: Vec;
  /** weight of the old slope (θ-family: 1 − θ) */
  oldWeight?: number;
}

const axpy = (a: number, x: Vec, y: Vec) => y.map((v, i) => v + a * x[i]);

function newtonTrace(f: RHS, t1: number, guess: Vec, c: Vec, hb: number) {
  // same criterion as lib/ode.ts (scale 1 + |c|, at least one Newton step)
  let lastScale: Vec = c.map(() => 1);
  const resid = (z: Vec) => {
    const fz = f(t1, z);
    lastScale = c.map((v) => 1 + Math.abs(v));
    return z.map((zi, i) => zi - c[i] - hb * fz[i]);
  };
  const norm = (G: Vec) => G.reduce((m, g, i) => Math.max(m, Math.abs(g) / lastScale[i]), 0);
  let z = guess.slice();
  let G = resid(z);
  let r = norm(G);
  const iterates = [z.slice()];
  const residuals = [r];
  for (let it = 0; it < 25 && (it === 0 || r > 1e-12); it++) {
    const J = numJac(f, t1, z);
    const lu = luFactor(iMinus(hb, J));
    if (lu.singular) break;
    const dz = luSolve(lu, G);
    let lam = 1;
    let zn = z,
      Gn = G,
      rn = Infinity;
    for (let k = 0; k < 14; k++) {
      zn = z.map((v, i) => v - lam * dz[i]);
      Gn = resid(zn);
      rn = norm(Gn);
      if (Number.isFinite(rn) && rn < r) break;
      lam /= 2;
    }
    if (!(rn < r)) break;
    z = zn;
    G = Gn;
    r = rn;
    iterates.push(z.slice());
    residuals.push(r);
  }
  return { z, iterates, residuals, converged: r < 1e-9 };
}

/** Perform one step of `method` from (t, y) and record how it was built. */
export function traceStep(method: DbgMethod, f: RHS, t: number, y: Vec, h: number, yPrev?: Vec | null, theta = 0.55): StepTrace {
  const base = { method, t0: t, y0: y, h, t1: t + h };
  if (method === "euler") {
    const k1 = f(t, y);
    return { ...base, y1: axpy(h, k1, y), probes: [{ t, y, k: k1, label: "k₁ = f(tₙ, yₙ)" }] };
  }
  if (method === "rk4") {
    const k1 = f(t, y);
    const y2 = axpy(h / 2, k1, y);
    const k2 = f(t + h / 2, y2);
    const y3 = axpy(h / 2, k2, y);
    const k3 = f(t + h / 2, y3);
    const y4 = axpy(h, k3, y);
    const k4 = f(t + h, y4);
    const y1 = y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    return {
      ...base,
      y1,
      probes: [
        { t, y, k: k1, label: "k₁" },
        { t: t + h / 2, y: y2, k: k2, label: "k₂" },
        { t: t + h / 2, y: y3, k: k3, label: "k₃" },
        { t: t + h, y: y4, k: k4, label: "k₄" },
      ],
    };
  }
  // implicit: y1 = c + hb·f(t1, y1)
  let c: Vec, hb: number, oldWeight: number;
  const f0 = f(t, y);
  const probes: Probe[] = [{ t, y, k: f0, label: "fₙ" }];
  if (method === "bdf2" && yPrev) {
    c = y.map((v, i) => (4 / 3) * v - (1 / 3) * yPrev[i]);
    hb = (2 / 3) * h;
    oldWeight = 0;
  } else {
    const th = method === "ieuler" || method === "bdf2" ? 1 : method === "trap" ? 0.5 : theta;
    c = axpy(h * (1 - th), f0, y);
    hb = h * th;
    oldWeight = 1 - th;
  }
  let nt = newtonTrace(f, t + h, y, c, hb);
  let continuation = false;
  if (!nt.converged) {
    // homotopy in the implicit weight: start from the explicit part (exact root for hb = 0) and increase hb gradually
    let z = c.slice();
    let sNow = 0,
      ds = 0.25;
    for (let guard = 0; guard < 60 && sNow < 1; guard++) {
      const sn = Math.min(1, sNow + ds);
      const tr = newtonTrace(f, t + h, z, c, hb * sn);
      if (tr.converged) {
        z = tr.z;
        sNow = sn;
        ds = Math.min(2 * ds, 1 - sNow || 1);
        if (sNow >= 1) nt = tr;
      } else if ((ds /= 2) < 1e-4) break;
    }
    continuation = nt.converged;
  }
  const y1 = nt.converged ? nt.z : null;
  const fEnd = y1 ? f(t + h, y1) : undefined;
  if (y1 && fEnd) probes.push({ t: t + h, y: y1, k: fEnd, label: "fₙ₊₁" });
  return { ...base, y1, probes, c, hb, newton: { iterates: nt.iterates, residuals: nt.residuals, converged: nt.converged, continuation }, fEnd, oldWeight };
}
