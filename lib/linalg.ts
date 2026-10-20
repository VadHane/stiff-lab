// Tiny dense linear algebra for small systems (n ≤ ~6).

export type Vec = number[];
export type Mat = number[][];

export function zeros(n: number): Vec {
  return new Array(n).fill(0);
}

export function identity(n: number): Mat {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

export interface LU {
  lu: Mat;
  piv: number[];
  singular: boolean;
}

/** LU decomposition with partial pivoting. */
/**
 * LU decomposition with SCALED partial pivoting: the pivot maximises |a_ik| / s_i, where s_i is the largest
 * magnitude in the original row i. This keeps rows of very different scale (e.g. a population ~1e-80 next to
 * O(1) variables) from being mixed by elimination, so tiny solution components stay relatively accurate.
 */
export function luFactor(A: Mat): LU {
  const n = A.length;
  const lu = A.map((r) => r.slice());
  const piv = Array.from({ length: n }, (_, i) => i);
  const rowScale = A.map((r) => r.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1);
  let singular = false;
  for (let k = 0; k < n; k++) {
    let p = k;
    let max = Math.abs(lu[k][k]) / rowScale[piv[k]];
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i][k]) / rowScale[piv[i]];
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (max === 0 || !Number.isFinite(max)) {
      singular = true;
      continue;
    }
    if (p !== k) {
      [lu[p], lu[k]] = [lu[k], lu[p]];
      [piv[p], piv[k]] = [piv[k], piv[p]];
    }
    for (let i = k + 1; i < n; i++) {
      const f = (lu[i][k] /= lu[k][k]);
      for (let j = k + 1; j < n; j++) lu[i][j] -= f * lu[k][j];
    }
  }
  return { lu, piv, singular };
}

export function luSolve({ lu, piv }: LU, b: Vec): Vec {
  const n = lu.length;
  const x = piv.map((p) => b[p]);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= lu[i][j] * x[j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= lu[i][j] * x[j];
    x[i] /= lu[i][i];
  }
  return x;
}

/** I - c·J */
export function iMinus(c: number, J: Mat): Mat {
  return J.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - c * v));
}

export function axpy(a: number, x: Vec, y: Vec): Vec {
  return y.map((v, i) => v + a * x[i]);
}

export function normInf(v: Vec): number {
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  return m;
}

// ---------- eigenvalues of small real matrices (2×2, 3×3) ----------

export interface Complex {
  re: number;
  im: number;
}

function quadRoots(b: number, c: number): Complex[] {
  // x² + b x + c = 0
  const d = b * b - 4 * c;
  if (d >= 0) {
    const s = Math.sqrt(d);
    // numerically stable
    const q = -0.5 * (b + Math.sign(b || 1) * s);
    const r1 = q;
    const r2 = q !== 0 ? c / q : -b - q;
    return [
      { re: r1, im: 0 },
      { re: r2, im: 0 },
    ];
  }
  const s = Math.sqrt(-d);
  return [
    { re: -b / 2, im: s / 2 },
    { re: -b / 2, im: -s / 2 },
  ];
}

/**
 * Eigenvalues of a general real n×n matrix: reduction to upper Hessenberg form by elimination
 * (elmhes) followed by the shifted QR algorithm (hqr), after Numerical Recipes §11.5–11.6.
 * Backward stable: absolute error ~ ε·‖J‖, so tiny eigenvalues next to huge ones (stiff chemistry)
 * are resolved far better than via the characteristic polynomial.
 */
function hqrEigen(J: Mat): Complex[] {
  const n = J.length;
  // 1-based working copy
  const a: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i && j ? J[i - 1][j - 1] : 0)));
  // --- elmhes
  for (let m = 2; m < n; m++) {
    let x = 0;
    let i = m;
    for (let j = m; j <= n; j++) {
      if (Math.abs(a[j][m - 1]) > Math.abs(x)) {
        x = a[j][m - 1];
        i = j;
      }
    }
    if (i !== m) {
      for (let j = m - 1; j <= n; j++) [a[i][j], a[m][j]] = [a[m][j], a[i][j]];
      for (let j = 1; j <= n; j++) [a[j][i], a[j][m]] = [a[j][m], a[j][i]];
    }
    if (x) {
      for (i = m + 1; i <= n; i++) {
        let y = a[i][m - 1];
        if (y !== 0) {
          y /= x;
          a[i][m - 1] = y;
          for (let j = m; j <= n; j++) a[i][j] -= y * a[m][j];
          for (let j = 1; j <= n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
  for (let i = 1; i <= n; i++) for (let j = 1; j < i - 1; j++) a[i][j] = 0;
  // --- hqr
  const wr = new Array(n + 1).fill(0),
    wi = new Array(n + 1).fill(0);
  let anorm = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
  let nn = n;
  let t = 0;
  const sign = (a1: number, b1: number) => (b1 >= 0 ? Math.abs(a1) : -Math.abs(a1));
  while (nn >= 1) {
    let its = 0;
    let l: number;
    do {
      for (l = nn; l >= 2; l--) {
        let s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) {
          a[l][l - 1] = 0;
          break;
        }
      }
      let x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn--] = 0;
      } else {
        let y = a[nn - 1][nn - 1];
        let w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          const p = 0.5 * (y - x);
          const q = p * p + w;
          let z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + sign(z, p);
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) throw new Error("hqr: too many iterations");
          if (its === 10 || its === 20) {
            t += x;
            for (let i = 1; i <= nn; i++) a[i][i] -= x;
            const s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          let m: number;
          let p = 0,
            q = 0,
            r = 0,
            z: number;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            const s0 = y - z;
            p = (r * s0 - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s0;
            r = a[m + 2][m + 1];
            const s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s;
            q /= s;
            r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) {
                p /= x;
                q /= x;
                r /= x;
              }
            }
            const s = sign(Math.sqrt(p * p + q * q + r * r), p);
            if (s !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else a[k][k - 1] = -s * x;
              p += s;
              x = p / s;
              y = q / s;
              z = r / s;
              q /= p;
              r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) {
                  p += r * a[k + 2][j];
                  a[k + 2][j] -= p * z;
                }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) {
                  p += z * a[i][k + 2];
                  a[i][k + 2] -= p * r;
                }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  const out: Complex[] = [];
  for (let i = 1; i <= n; i++) out.push({ re: wr[i], im: wi[i] });
  return out;
}

export function eigenvalues(J: Mat): Complex[] {
  const n = J.length;
  if (n === 1) return [{ re: J[0][0], im: 0 }];
  if (n === 2) {
    const tr = J[0][0] + J[1][1];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    return quadRoots(-tr, det);
  }
  if (J.some((row) => row.some((v) => !Number.isFinite(v)))) return J.map(() => ({ re: NaN, im: 0 }));
  return hqrEigen(J);
}
