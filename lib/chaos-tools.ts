export type Field = (t: number, y: number[]) => number[];

export function rk4Run(f: Field, y0: number[], t0: number, h: number, steps: number, every = 1, onStep?: (t: number, y: number[]) => void) {
  const n = y0.length;
  let y = y0.slice();
  let t = t0;
  const ts: number[] = [t];
  const ys: number[][] = [y.slice()];
  const tmp = new Array(n);
  for (let s = 1; s <= steps; s++) {
    const k1 = f(t, y);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k1[i];
    const k2 = f(t + h / 2, tmp);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + (h / 2) * k2[i];
    const k3 = f(t + h / 2, tmp);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
    const k4 = f(t + h, tmp);
    const yn = new Array(n);
    for (let i = 0; i < n; i++) yn[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    y = yn;
    t = t0 + s * h;
    onStep?.(t, y);
    if (s % every === 0) {
      ts.push(t);
      ys.push(y);
    }
    if (!Number.isFinite(y[0]) || Math.abs(y[0]) > 1e12) break;
  }
  return { t: ts, y: ys };
}

/**
 * Largest Lyapunov exponent (Benettin): `fv` is the system extended by its variational equation
 * (state of length 2n: [y, δy]). Renormalises δy every `renorm` steps, skips `skip` time units.
 */
export function lyapunov(fv: Field, y0: number[], n: number, h: number, T: number, skip: number, renorm = 50) {
  let s = [...y0, ...new Array(n).fill(0)];
  s[n] = 1;
  const steps = Math.round(T / h);
  let sum = 0;
  let tAcc = 0;
  const trace: { t: number; L: number }[] = [];
  let k = 0;
  let t = 0;
  const m = 2 * n;
  const tmp = new Array(m);
  while (k < steps) {
    const chunk = Math.min(renorm, steps - k);
    for (let j = 0; j < chunk; j++) {
      const k1 = fv(t, s);
      for (let i = 0; i < m; i++) tmp[i] = s[i] + (h / 2) * k1[i];
      const k2 = fv(t + h / 2, tmp);
      for (let i = 0; i < m; i++) tmp[i] = s[i] + (h / 2) * k2[i];
      const k3 = fv(t + h / 2, tmp);
      for (let i = 0; i < m; i++) tmp[i] = s[i] + h * k3[i];
      const k4 = fv(t + h, tmp);
      const sn = new Array(m);
      for (let i = 0; i < m; i++) sn[i] = s[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      s = sn;
      t += h;
    }
    k += chunk;
    let nr = 0;
    for (let i = n; i < m; i++) nr += s[i] * s[i];
    nr = Math.sqrt(nr);
    if (!Number.isFinite(nr) || nr === 0) break;
    for (let i = n; i < m; i++) s[i] /= nr;
    if (t > skip) {
      sum += Math.log(nr);
      tAcc += chunk * h;
      trace.push({ t, L: sum / tAcc });
    }
  }
  return { L: tAcc > 0 ? sum / tAcc : NaN, trace };
}

/** Indices of strict local maxima of a sampled series. */
export function localMaxima(ys: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < ys.length - 1; i++) if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1]) out.push(i);
  return out;
}

/** Parabolic refinement of a local maximum value. */
export function refineMax(ys: number[], i: number): number {
  const a = ys[i - 1],
    b = ys[i],
    c = ys[i + 1];
  const den = a - 2 * b + c;
  if (den === 0) return b;
  const d = (0.5 * (a - c)) / den;
  return b - 0.25 * (a - c) * d;
}

/** Count clusters of values (period detection). Returns Infinity-like large number for chaos. */
export function countDistinct(vals: number[], tol: number): number {
  const uniq: number[] = [];
  for (const v of vals) if (!uniq.some((u) => Math.abs(u - v) < tol)) uniq.push(v);
  return uniq.length;
}

export function countDistinct2(pts: [number, number][], tol: number): number {
  const uniq: [number, number][] = [];
  for (const p of pts) if (!uniq.some((u) => Math.hypot(u[0] - p[0], u[1] - p[1]) < tol)) uniq.push(p);
  return uniq.length;
}
