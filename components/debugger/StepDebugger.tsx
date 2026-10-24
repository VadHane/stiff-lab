"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Plot, { type Transform } from "@/components/plot/Plot";
import { Say, useMode } from "@/components/mode/Mode";
import { Chips, Slider } from "@/components/ui/controls";
import { fmt } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import type { Vec } from "@/lib/linalg";
import { comp, sampleAt, solve, type RHS } from "@/lib/ode";
import { traceStep, type DbgMethod, type StepTrace } from "@/lib/step-trace";

export interface DebuggerView {
  /** horizontal axis: a state component index or "t" */
  x: number | "t";
  /** vertical axis: a state component index */
  y: number;
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
}

interface Props {
  /** must be referentially stable (module constant or useMemo) — a new function resets the debugger */
  f: RHS;
  /** must be referentially stable as well */
  y0: Vec;
  t0?: number;
  T: number;
  view: DebuggerView;
  methods?: DbgMethod[];
  h0: number;
  hMin: number;
  hMax: number;
  hPresets?: number[];
  /** label of the preset chips (default: «Крок з умови») */
  hPresetsLabel?: string;
  /** short plain-language hint shown above the plot */
  hint?: ReactNode;
}

const PROBE_COLORS = ["#ffb547", "#ff7ad9", "#5cc8ff", "#3ee6a8"];
const OLD = "#ffb547";
const NEW = "#3ee6a8";

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width = 2.5, head = 9) {
  const dx = x1 - x0,
    dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 0.5) return;
  const ux = dx / len,
    uy = dy / len;
  const hd = Math.min(head, len * 0.6);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * hd * 0.6, y1 - uy * hd * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * hd - uy * hd * 0.45, y1 - uy * hd + ux * hd * 0.45);
  ctx.lineTo(x1 - ux * hd + uy * hd * 0.45, y1 - uy * hd - ux * hd * 0.45);
  ctx.closePath();
  ctx.fill();
}

const maxAbs = (v: Vec) => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

function StepDebugger({
  f,
  y0,
  t0 = 0,
  T,
  view,
  methods = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"],
  h0,
  hMin,
  hMax,
  hPresets,
  hPresetsLabel = "Крок з умови",
  hint,
}: Props) {
  const { mode } = useMode();
  const [method, setMethod] = useState<DbgMethod>(methods[0]);
  const [h, setH] = useState(h0);
  const init = useMemo(() => ({ states: [{ t: t0, y: y0 }], traces: [] as StepTrace[], fail: null as string | null }), [t0, y0]);
  const [run, setRun] = useState(init);
  const { states, traces, fail } = run;
  const [auto, setAuto] = useState(false);

  const reset = useCallback(() => {
    setRun(init);
    setAuto(false);
  }, [init]);
  useEffect(reset, [reset, method, f]);

  // reference: high-order explicit DOPRI for non-stiff problems (cheap on oscillations), Rosenbrock when DOPRI gives up (stiff)
  const ref = useMemo(() => {
    const d = solve("dopri", { f, y0, t0, T }, { rtol: 1e-9, atol: 1e-12, maxSteps: 20000 });
    return d.failed ? solve("ros", { f, y0, t0, T }, { rtol: 1e-7, atol: 1e-10, maxSteps: 60000 }) : d;
  }, [f, y0, t0, T]);
  const refAt = useCallback((t: number) => ref.y[0].map((_, i) => sampleAt(ref.t, comp(ref, i), t)), [ref]);

  const P = useCallback((t: number, y: Vec): [number, number] => (view.x === "t" ? [t, y[view.y]] : [y[view.x], y[view.y]]), [view.x, view.y]);

  const domain = useMemo(() => {
    if (view.xDomain && view.yDomain) return { x: view.xDomain, y: view.yDomain };
    let x0 = Infinity,
      x1 = -Infinity,
      yLo = Infinity,
      yHi = -Infinity;
    ref.t.forEach((t, i) => {
      const [a, b] = P(t, ref.y[i]);
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, a);
      yLo = Math.min(yLo, b);
      yHi = Math.max(yHi, b);
    });
    const px = (x1 - x0 || 1) * (view.x === "t" ? 0.02 : 0.2);
    const py = (yHi - yLo || 1) * 0.25;
    return { x: view.xDomain ?? ([x0 - px, x1 + px] as [number, number]), y: view.yDomain ?? ([yLo - py, yHi + py] as [number, number]) };
  }, [ref, P, view.xDomain, view.yDomain, view.x]);

  const cur = states[states.length - 1];
  const done = cur.t >= T - 1e-12;
  const last = traces[traces.length - 1];

  const step = useCallback(() => {
    setRun((r) => {
      const st = r.states;
      const n = st.length - 1;
      const { t, y } = st[n];
      if (r.fail || t >= T - 1e-12) return r;
      const hh = Math.min(h, T - t);
      const tr = traceStep(method, f, t, y, hh, method === "bdf2" && n > 0 ? st[n - 1].y : null);
      if (!tr.y1) return { ...r, fail: "Метод Ньютона не знайшов наступну точку — рівняння кроку не має кореня поблизу." };
      const span = Math.max(domain.y[1] - domain.y[0], view.x === "t" ? 0 : domain.x[1] - domain.x[0]);
      const blown = maxAbs(tr.y1) > 1e4 * Math.max(1, span);
      return {
        states: [...st, { t: tr.t1, y: tr.y1 }],
        traces: [...r.traces, tr],
        fail: blown ? "💥 Розв'язок вибухнув — далі рахувати немає сенсу." : null,
      };
    });
  }, [h, method, f, T, domain, view.x]);

  const back = () =>
    setRun((r) => (r.states.length <= 1 ? r : { states: r.states.slice(0, -1), traces: r.traces.slice(0, -1), fail: null }));

  useEffect(() => {
    if (!auto) return;
    if (fail || done) {
      setAuto(false);
      return;
    }
    const id = setTimeout(step, 550);
    return () => clearTimeout(id);
  }, [auto, step, states.length, fail, done]);

  // local exact solution from the start of the last step
  const localSol = useMemo(() => {
    if (!last) return null;
    let s = solve("dopri", { f, y0: last.y0, t0: last.t0, T: last.t1 }, { rtol: 1e-10, atol: 1e-12, maxSteps: 5000 });
    if (s.failed) s = solve("ros", { f, y0: last.y0, t0: last.t0, T: last.t1 }, { rtol: 1e-9, atol: 1e-12 });
    return { pts: s.t.map((t, i) => P(t, s.y[i])), end: s.y[s.y.length - 1] };
  }, [last, f, P]);
  const local = localSol?.pts ?? null;

  const errs = useMemo(() => states.map((s) => maxAbs(s.y.map((v, i) => v - refAt(s.t)[i]))), [states, refAt]);
  const localErr = last?.y1 && localSol ? maxAbs(last.y1.map((v, i) => v - localSol.end[i])) : NaN;
  const growth = errs.length >= 2 && errs[errs.length - 2] > 1e-14 ? errs[errs.length - 1] / errs[errs.length - 2] : NaN;
  const color = METHODS[method].color;

  const underlay = useCallback(
    (ctx: CanvasRenderingContext2D, tr: Transform) => {
      const toPx = (t: number, y: Vec) => {
        const [a, b] = P(t, y);
        return [tr.X(a), tr.Y(b)] as [number, number];
      };
      // direction field
      const dim = cur.y.length;
      if (view.x !== "t" || dim === 1) {
        const nx = 22,
          ny = 13;
        ctx.lineWidth = 1.2;
        for (let i = 0; i <= nx; i++)
          for (let j = 0; j <= ny; j++) {
            const a = domain.x[0] + ((i + 0.5) / (nx + 1)) * (domain.x[1] - domain.x[0]);
            const b = domain.y[0] + ((j + 0.5) / (ny + 1)) * (domain.y[1] - domain.y[0]);
            let dx: number, dy: number;
            if (view.x === "t") {
              const k = f(a, [b])[0];
              dx = tr.X(a + 1e-3) - tr.X(a);
              dy = tr.Y(b + 1e-3 * k) - tr.Y(b);
            } else {
              const y = cur.y.slice();
              y[view.x] = a;
              y[view.y] = b;
              const k = f(cur.t, y);
              const e = 1e-6 * Math.max(domain.x[1] - domain.x[0], domain.y[1] - domain.y[0]);
              dx = tr.X(a + e * k[view.x]) - tr.X(a);
              dy = tr.Y(b + e * k[view.y]) - tr.Y(b);
            }
            const L = Math.hypot(dx, dy);
            if (!(L > 0) || !Number.isFinite(L)) continue;
            const px = tr.X(a),
              py = tr.Y(b);
            const s = 7 / L;
            ctx.strokeStyle = "rgba(170,190,255,0.22)";
            ctx.beginPath();
            ctx.moveTo(px - dx * s, py - dy * s);
            ctx.lineTo(px + dx * s, py + dy * s);
            ctx.stroke();
            ctx.fillStyle = "rgba(170,190,255,0.35)";
            ctx.beginPath();
            ctx.arc(px + dx * s, py + dy * s, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
      }
      // local exact solution of the current step
      if (local) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        local.forEach(([a, b], i) => (i ? ctx.lineTo(tr.X(a), tr.Y(b)) : ctx.moveTo(tr.X(a), tr.Y(b))));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // history
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      states.forEach((s, i) => {
        const [x, y] = toPx(s.t, s.y);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      states.forEach((s, i) => {
        const [x, y] = toPx(s.t, s.y);
        ctx.fillStyle = i === states.length - 1 ? "#fff" : color;
        ctx.beginPath();
        ctx.arc(x, y, i === states.length - 1 ? 3 : 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
      // the current step, explained
      if (last && last.y1) {
        const [x0, y0p] = toPx(last.t0, last.y0);
        const [x1, y1p] = toPx(last.t1, last.y1);
        if (last.method === "euler") {
          arrow(ctx, x0, y0p, x1, y1p, color, 3.2, 12);
        } else if (last.method === "rk2" || last.method === "rk3" || last.method === "rk4") {
          last.probes.forEach((p, i) => {
            const end = toPx(last.t0 + last.h, last.y0.map((v, j) => v + last.h * p.k[j]));
            ctx.globalAlpha = 0.75;
            arrow(ctx, x0, y0p, end[0], end[1], PROBE_COLORS[i], 1.6, 7);
            ctx.globalAlpha = 1;
            const [px, py] = toPx(p.t, p.y);
            ctx.strokeStyle = PROBE_COLORS[i];
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = PROBE_COLORS[i];
            ctx.font = "12px var(--font-mono), monospace";
            ctx.fillText(p.label, px + 7, py - 7);
          });
          arrow(ctx, x0, y0p, x1, y1p, "#fff", 3.2, 12);
        } else if (last.c && last.hb !== undefined) {
          // explicit part (old slope) then implicit part (new slope)
          const tc = last.t1 - last.hb;
          const [xc, yc] = toPx(tc, last.c);
          if (Math.hypot(xc - x0, yc - y0p) > 1) arrow(ctx, x0, y0p, xc, yc, OLD, 2.6, 10);
          // Newton iterates
          const its = last.newton?.iterates ?? [];
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          its.forEach((z, i) => {
            const [x, y] = toPx(last.t1, z);
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          });
          ctx.stroke();
          ctx.setLineDash([]);
          its.slice(0, 6).forEach((z, i) => {
            const [x, y] = toPx(last.t1, z);
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.beginPath();
            ctx.arc(x, y, 2.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = "10px var(--font-mono), monospace";
            ctx.fillText(String(i), x + 4, y + 11);
          });
          arrow(ctx, xc, yc, x1, y1p, NEW, 3.2, 12);
        }
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(x1, y1p, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    },
    [P, cur, view.x, view.y, domain, f, local, states, last, color],
  );

  const refX = useMemo(() => ref.t.map((t, i) => P(t, ref.y[i])[0]), [ref, P]);
  const refY = useMemo(() => ref.t.map((t, i) => P(t, ref.y[i])[1]), [ref, P]);
  const refSeries = useMemo(() => [{ x: refX, y: refY, color: "#ffffff", width: 3, opacity: 0.18, label: "точний" }], [refX, refY]);
  const outside = (() => {
    const [a, b] = P(cur.t, cur.y);
    return a < domain.x[0] || a > domain.x[1] || b < domain.y[0] || b > domain.y[1];
  })();

  const newtonLine = last?.newton ? last.newton.residuals.map((r) => fmt(r, 2)).join(" → ") : "";
  const its = last?.newton ? last.newton.iterates.length - 1 : 0;
  const thetaPct = last?.oldWeight !== undefined ? Math.round(last.oldWeight * 100) : 0;

  const story: Record<DbgMethod, { simple: ReactNode; sci: ReactNode }> = {
    euler: {
      simple: (
        <>
          🧭 Метод подивився, куди «тягне» система в поточній точці (кольорова стрілка), і пройшов у той бік рівно h. Поки ми йшли, напрямок
          змінився, але метод про це не знає — тому він відхиляється від білої пунктирної лінії (там, куди насправді веде задача з цієї точки).
        </>
      ),
      sci: (
        <>
          y₍ₙ₊₁₎ = yₙ + h·f(tₙ, yₙ): дотична в лівому кінці кроку. Біла пунктирна — точний розв&apos;язок задачі Коші з точки (tₙ, yₙ); розрив між її кінцем і
          новою точкою — локальна похибка O(h²).
        </>
      ),
    },
    rk2: {
      simple: (
        <>
          🔎 Дві «розвідки»: метод подивився напрямок на старті (k₁), пройшов за ним лише півкроку, там подивився ще раз (k₂) — і весь крок зробив за цим
          другим, «серединним» напрямком. Тонка стрілка k₁ показує, куди завів би сам старт; біла товста — куди метод пішов насправді.
        </>
      ),
      sci: (
        <>
          y₍ₙ₊₁₎ = yₙ + h·k₂, k₂ = f(tₙ + h/2, yₙ + (h/2)k₁) — правило середньої точки (модифікований Ейлер). Локальна похибка O(h³), R(z) = 1 + z + z²/2.
        </>
      ),
    },
    rk3: {
      simple: (
        <>
          🔎 Три «розвідки»: напрямок на старті (k₁), посередині кроку (k₂) і в кінці кроку (k₃) — причому до кінця метод «дострибує» за правилом yₙ − h·k₁ +
          2h·k₂, щоб похибки взаємно скоротилися. Підсумок — зважене середнє 1 : 4 : 1 (як у формулі Сімпсона).
        </>
      ),
      sci: (
        <>
          y₍ₙ₊₁₎ = yₙ + h(k₁ + 4k₂ + k₃)/6, k₃ = f(tₙ + h, yₙ − h·k₁ + 2h·k₂) — метод Кутти 3-го порядку. Локальна похибка O(h⁴), R(z) = 1 + z + z²/2 + z³/6.
        </>
      ),
    },
    rk4: {
      simple: (
        <>
          🔎 Метод зробив чотири «розвідки»: подивився напрямок на старті (k₁), двічі посередині кроку (k₂, k₃) і в кінці (k₄). Тонкі стрілки показують,
          куди привела б кожна розвідка окремо, а біла товста — їхнє зважене середнє 1 : 2 : 2 : 1.
        </>
      ),
      sci: <>y₍ₙ₊₁₎ = yₙ + h(k₁ + 2k₂ + 2k₃ + k₄)/6; кружечки — точки, у яких обчислено kᵢ. Локальна похибка O(h⁵), але метод явний, тож область стійкості обмежена.</>,
    },
    ieuler: {
      simple: (
        <>
          🎯 Неявний метод шукає таку точку, з якої, якщо озирнутися назад по її <b>власній</b> стрілці (зелена), потрапиш точно в старт. Знайти її одразу не
          можна — тому метод Ньютона робить кілька спроб (білі цятки 0, 1, 2…), поки не влучить. Саме тому неявний метод не «перелітає» рівновагу.
        </>
      ),
      sci: (
        <>
          y₍ₙ₊₁₎ = yₙ + h·f(tₙ₊₁, yₙ₊₁): напрямок береться в <b>кінці</b> кроку. Нелінійне рівняння розв&apos;язується методом Ньютона з (I − hJ)Δz = −G(z); цятки —
          ітерації z⁽ᵏ⁾.
        </>
      ),
    },
    theta: {
      simple: (
        <>
          ⚖️ Компроміс: спершу {thetaPct} % кроку за старою стрілкою (помаранчева), решту {100 - thetaPct} % — за новою стрілкою в кінці (зелена), яку
          доводиться шукати методом Ньютона. Трохи більше ваги на «новому» робить метод стійким.
        </>
      ),
      sci: <>y₍ₙ₊₁₎ = yₙ + h(0.45·fₙ + 0.55·fₙ₊₁): помаранчева стрілка — h(1 − θ)fₙ, зелена — hθ·fₙ₊₁; θ &gt; ½ дає A-стійкість, але R(−∞) = −0.82.</>,
    },
    trap: {
      simple: <>⚖️ Порівну: половина кроку за старою стрілкою, половина — за новою (її шукає Ньютон). Дуже точно, але жорсткі «пружини» метод не гасить, а лише перевертає.</>,
      sci: <>y₍ₙ₊₁₎ = yₙ + (h/2)(fₙ + fₙ₊₁): 2-й порядок, A-стійкий, R(−∞) = −1 — швидкі моди змінюють знак на кожному кроці, але не згасають.</>,
    },
    bdf2: {
      simple: (
        <>
          📐 Метод Гіра «пам&apos;ятає» дві попередні точки: він продовжує лінію через них (помаранчева стрілка) і далі шукає точку, де нова стрілка (зелена)
          узгоджується з цим продовженням. Перший крок — як у неявного Ейлера.
        </>
      ),
      sci: <>3/2·y₍ₙ₊₁₎ − 2yₙ + ½yₙ₋₁ = h·f₍ₙ₊₁₎ ⇔ y₍ₙ₊₁₎ = (4yₙ − yₙ₋₁)/3 + (2h/3)f₍ₙ₊₁₎; помаранчева стрілка веде в (4yₙ − yₙ₋₁)/3.</>,
    },
  };

  return (
    <div className="space-y-3" data-report-skip="">
      {hint && <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-[14px] leading-relaxed text-white/75">{hint}</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Chips
            label="Метод"
            value={method}
            onChange={setMethod}
            options={methods.map((m) => ({ value: m, label: METHODS[m].short }))}
          />
          {hPresets && <Chips label={hPresetsLabel} value={hPresets.includes(h) ? h : -1} onChange={(v) => v > 0 && setH(v)} options={hPresets.map((v) => ({ value: v, label: `h = ${v}` }))} />}
          <Slider label="Крок h" value={h} onChange={setH} min={hMin} max={hMax} log />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={step}
              disabled={done || !!fail}
              className="rounded-xl bg-[var(--accent)] px-3 py-2.5 text-[14px] font-semibold text-black shadow-[0_0_20px_-6px_var(--accent)] transition-transform hover:scale-[1.02] disabled:opacity-40"
            >
              ⏭ Крок
            </button>
            <button
              onClick={() => setAuto((a) => !a)}
              disabled={done || !!fail}
              className="rounded-xl border border-white/15 px-3 py-2.5 text-[14px] text-white/85 hover:bg-white/10 disabled:opacity-40"
            >
              {auto ? "❚❚ Пауза" : "▶ Авто"}
            </button>
            <button onClick={back} disabled={states.length <= 1} className="rounded-xl border border-white/15 px-3 py-2 text-[13px] text-white/70 hover:bg-white/10 disabled:opacity-40">
              ⏪ Назад
            </button>
            <button
              onClick={() => {
                for (let i = 0; i < 10; i++) step();
              }}
              disabled={done || !!fail}
              className="rounded-xl border border-white/15 px-3 py-2 text-[13px] text-white/70 hover:bg-white/10 disabled:opacity-40"
            >
              ⏩ ×10
            </button>
            <button onClick={reset} className="rounded-xl border border-white/15 px-3 py-2 text-[13px] text-white/70 hover:bg-white/10">
              ⟲ Спочатку
            </button>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3 font-mono text-[12.5px] leading-relaxed text-white/75">
            <div>
              крок n = {states.length - 1}, t = {fmt(cur.t, 4)}
            </div>
            <div>
              {view.yLabel} = {fmt(cur.y[view.y], 5)}
            </div>
            <div>
              похибка: <span className={errs[errs.length - 1] > 1 ? "text-[#ff5d73]" : "text-white"}>{fmt(errs[errs.length - 1], 3)}</span>
            </div>
            {Number.isFinite(growth) && (
              <div>
                за крок: <span className={growth > 1.0001 ? "text-[#ff5d73]" : "text-[#3ee6a8]"}>×{fmt(growth, 3)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <Plot
            height={400}
            sorted={view.x === "t"}
            xLabel={view.xLabel}
            yLabel={view.yLabel}
            xDomain={domain.x}
            yDomain={domain.y}
            legend={false}
            underlay={underlay}
            series={refSeries}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/55">
            <span>
              <span className="text-white/40">━</span> точний розв&apos;язок
            </span>
            <span>
              <span className="text-white">┅</span> куди веде задача з поточної точки
            </span>
            <span style={{ color }}>● кроки методу</span>
            {last?.c && (
              <>
                <span style={{ color: OLD }}>➜ стара стрілка</span>
                <span style={{ color: NEW }}>➜ нова стрілка (шукаємо)</span>
              </>
            )}
            <span className="text-white/40">· · · поле напрямків</span>
          </div>
          {outside && !fail && <div className="rounded-xl border border-[#ff5d73]/40 bg-[#ff5d73]/10 px-4 py-2 text-[13px] text-white/85">💥 Точка вилетіла за межі графіка: {view.yLabel} = {fmt(cur.y[view.y], 4)}</div>}
          {fail && <div className="rounded-xl border border-[#ff5d73]/40 bg-[#ff5d73]/10 px-4 py-2 text-[13px] text-white/85">{fail}</div>}
          {done && !fail && <div className="rounded-xl border border-[#3ee6a8]/40 bg-[#3ee6a8]/10 px-4 py-2 text-[13px] text-white/85">🏁 Дійшли до кінця відрізка за {states.length - 1} кроків.</div>}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] leading-relaxed text-white/80">
            {last ? (
              <>
                <Say simple={story[last.method].simple}>{story[last.method].sci}</Say>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12px] text-white/60">
                  {Number.isFinite(localErr) && (
                    <span>
                      {mode === "simple" ? "промах цього кроку" : "локальна похибка"}: {fmt(localErr, 3)}
                    </span>
                  )}
                  {last.newton && (
                    <span title="нев'язка рівняння кроку на кожній ітерації Ньютона">
                      {mode === "simple" ? `спроб Ньютона: ${its}` : `Ньютон: |G| = ${newtonLine}`}
                      {last.newton.continuation && (mode === "simple" ? " (довелося підкрадатися поступово)" : " (після продовження за параметром hb)")}
                    </span>
                  )}
                  <span>f-обчислень за крок: {last.c ? `1 + ${its}×(1+${cur.y.length})` : last.probes.length}</span>
                </div>
              </>
            ) : (
              <span className="text-white/55">Натисніть «⏭ Крок», щоб побачити, як метод будує наступну точку.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Re-render only when the problem/view/step settings change — not on every parent re-render (hint is static text). */
export default memo(StepDebugger, (a, b) => {
  const keys = Object.keys({ ...a, ...b }).filter((k) => k !== "hint") as (keyof Props)[];
  return keys.every((k) => a[k] === b[k]);
});
