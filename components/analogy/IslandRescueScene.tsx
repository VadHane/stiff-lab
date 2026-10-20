"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import { Chips, Slider } from "@/components/ui/controls";
import { fmt, sup } from "@/lib/format";
import { sampleAt, solve, type Solution } from "@/lib/ode";

const EPS = 0.01;
const T = 500;
const LN10 = Math.LN10;
// eco-genetic model in log-variables (w, z, θ) = (ln u, ln v, θ): positivity for free, no stiffness from the factor u
const f = (_t: number, [w, z, th]: number[]) => {
  const u = Math.exp(w),
    v = Math.exp(z);
  return [1 - 0.5 * u - (2 * v) / (7 * th * th), 2 * th - 3.5 * th * th * u - 0.5 * v, EPS * (2 - 7 * th * u)];
};
const jac = (_t: number, [w, z, th]: number[]) => {
  const u = Math.exp(w),
    v = Math.exp(z);
  return [
    [-0.5 * u, (-2 * v) / (7 * th * th), (4 * v) / (7 * th * th * th)],
    [-3.5 * th * th * u, -0.5 * v, 2 - 7 * th * u],
    [-7 * EPS * th * u, 0, -7 * EPS * u],
  ];
};
const OPTS = { rtol: 1e-6, atol: 1e-8, maxSteps: 100000 };
type Kind = "rabbits" | "foxes" | "none";

function revival(t: number[], lnU: number[]) {
  let low = false;
  for (let k = 0; k < t.length; k++) {
    if (!low && lnU[k] < Math.log(1e-3)) low = true;
    if (low && lnU[k] > 0) return t[k];
  }
  return NaN;
}
const lg = (a: number[]) => a.map((v) => Math.max(v / LN10, -1000));
const badge = (l: number) => (l < Math.log(1e-3) ? `10${sup(String(Math.round(l / LN10)))}` : fmt(Math.exp(l), 3));

/** «What if we intervene?» — the whole solution is recomputed from the intervention moment. */
export default function IslandRescueScene() {
  const base = useMemo(() => solve("ros", { f, jac, y0: [Math.log(2), Math.log(10), 0.1], T }, OPTS), []);
  const [kind, setKind] = useState<Kind>("rabbits");
  const [tk, setTk] = useState(10);
  const dtk = useDeferredValue(tk);

  const path = useMemo(() => {
    const cut = (s: Solution, upTo: number) => {
      const k = s.t.findIndex((t) => t > upTo);
      return k < 0 ? s.t.length : k;
    };
    if (kind === "none") return { t: base.t, y: base.y };
    const y = [0, 1, 2].map((i) => sampleAt(base.t, base.y.map((v) => v[i]), dtk));
    const y1 = kind === "rabbits" ? [Math.log(Math.exp(y[0]) + 0.05), y[1], y[2]] : [y[0], Math.log(Math.exp(y[1]) + 5), y[2]];
    const s = solve("ros", { f, jac, y0: y1, t0: dtk, T }, OPTS);
    const k = cut(base, dtk);
    return { t: [...base.t.slice(0, k), ...s.t], y: [...base.y.slice(0, k), ...s.y] };
  }, [base, kind, dtk]);

  const view = useMemo(() => {
    const bu = base.y.map((v) => v[0]),
      bv = base.y.map((v) => v[1]);
    const pu = path.y.map((v) => v[0]),
      pv = path.y.map((v) => v[1]);
    let minAfter = Infinity;
    path.t.forEach((t, k) => t >= dtk && pu[k] < minAfter && (minAfter = pu[k]));
    return {
      series: [
        { x: base.t, y: lg(bu), color: "#ffffff", width: 1.2, dash: [5, 4], opacity: 0.45, label: "без втручання" },
        { x: base.t, y: lg(bv), color: "#ffffff", width: 1.2, dash: [2, 4], opacity: 0.35 },
        { x: path.t, y: lg(pu), color: "#7cf29c", width: 2.2, label: "🐇 lg u" },
        { x: path.t, y: lg(pv), color: "#ff9f5a", width: 2.2, label: "🦊 lg v" },
      ],
      revBase: revival(base.t, bu),
      revNew: revival(path.t, pu),
      minBase: Math.min(...bu),
      minAfter,
      end: path.y[path.y.length - 1],
    };
  }, [base, path, dtk]);

  const marks = useMemo(() => (kind !== "none" ? [{ x: dtk, y: 0, color: "#ffd84d", r: 5 }] : []), [kind, dtk]);

  return (
    <div className="space-y-3">
      <Chips
        value={kind}
        onChange={setKind}
        options={[
          { value: "rabbits", label: "🐇 Завезти кроликів (u += 0.05)" },
          { value: "foxes", label: "🦊 Завезти лисиць (v += 5)" },
          { value: "none", label: "нічого не робити" },
        ]}
      />
      {kind !== "none" && <Slider label="Коли втрутитися: t" value={tk} onChange={setTk} min={1} max={490} step={1} />}
      <Plot
        height={210}
        xLabel="t"
        yLabel="lg"
        yDomain={[-100, 3]}
        series={view.series}
        markers={marks}
      />
      <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
        <div className="rounded-xl bg-white/[0.04] p-2">
          <div className="text-white/45">🐇 відродження</div>
          <div className="font-mono text-white">
            {Number.isFinite(view.revNew) ? `t ≈ ${fmt(view.revNew, 3)}` : "—"}
            <span className="text-white/40"> / {fmt(view.revBase, 3)}</span>
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-2">
          <div className="text-white/45">🐇 мінімум після t = {kind === "none" ? 0 : fmt(dtk, 3)}</div>
          <div className="font-mono text-white">{badge(kind === "none" ? view.minBase : view.minAfter)}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-2">
          <div className="text-white/45">наприкінці 🐇 / 🦊</div>
          <div className="font-mono text-white">
            {badge(view.end[0])} / {badge(view.end[1])}
          </div>
        </div>
      </div>
      <div className="text-[12px] leading-snug text-white/50">
        Кожна зміна — повний перерахунок від моменту втручання (Розенброк у змінних ln u, ln v, θ). Графік обрізано на 10⁻¹⁰⁰. Спробуйте завезти кроликів при t =
        10 (хижаки ще «злі», θ &lt; 8/7) і при t = 100 (θ уже &gt; 8/7) — або лисиць при t = 400, коли острів належить кроликам.
      </div>
    </div>
  );
}
