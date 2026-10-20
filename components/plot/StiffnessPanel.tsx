"use client";

import { useMemo } from "react";
import Plot from "./Plot";
import { stiffnessAt, type Problem, type Solution } from "@/lib/ode";
import { fmt } from "@/lib/format";
import { Stat } from "@/components/ui/blocks";

/** Eigenvalues of the Jacobian along a trajectory: how stiff is the problem and when. */
export default function StiffnessPanel({ problem, sol, samples = 160, logT = false }: { problem: Problem; sol: Solution; samples?: number; logT?: boolean }) {
  const data = useMemo(() => {
    const t: number[] = [];
    const fast: number[] = [];
    const slow: number[] = [];
    const ratio: number[] = [];
    const n = sol.t.length;
    for (let k = 0; k < samples; k++) {
      let i = Math.floor((k / (samples - 1)) * (n - 1));
      if (logT) {
        // log-spaced sampling in time
        const t0 = Math.max(sol.t[1] ?? 1e-6, 1e-8),
          t1 = sol.t[n - 1];
        const tt = t0 * Math.pow(t1 / t0, k / (samples - 1));
        let lo = 0,
          hi = n - 1;
        while (hi - lo > 1) {
          const m = (lo + hi) >> 1;
          if (sol.t[m] <= tt) lo = m;
          else hi = m;
        }
        i = lo;
      }
      const s = stiffnessAt(problem, sol.t[i], sol.y[i]);
      // drop (numerically) zero eigenvalues: conservation laws give exact zeros that come out as ~1e-10 noise
      const all = s.ev.map((e) => Math.abs(e.re));
      const top = Math.max(...all);
      const mags = all.filter((v) => v > 1e-300 && v > 1e-11 * top);
      if (!mags.length) continue;
      t.push(Math.max(sol.t[i], 1e-12));
      fast.push(Math.max(...mags));
      slow.push(Math.min(...mags));
      ratio.push(Math.max(...mags) / Math.min(...mags));
    }
    return { t, fast, slow, ratio };
  }, [problem, sol, samples, logT]);
  const maxFast = Math.max(...data.fast);
  const maxRatio = Math.max(...data.ratio.filter(Number.isFinite));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="max |Re λ|" value={fmt(maxFast, 3)} sub="найшвидша мода" />
        <Stat label="коеф. жорсткості" value={fmt(maxRatio, 3)} sub="max|Re λ| / min|Re λ|" tone={maxRatio > 100 ? "warn" : "default"} />
        <Stat label="h для явн. Ейлера" value={`< ${fmt(2 / maxFast, 3)}`} sub="2 / max|Re λ| (для дійсних λ)" />
      </div>
      <Plot
        height={220}
        logY
        logX={logT}
        xLabel="t"
        yLabel="|Re λ|"
        series={[
          { x: data.t, y: data.fast, color: "#ff5d73", label: "швидка мода" },
          { x: data.t, y: data.slow, color: "#5cc8ff", label: "повільна мода" },
        ]}
      />
    </div>
  );
}
