"use client";

import { useMemo } from "react";
import Plot, { type Series, type Transform } from "@/components/plot/Plot";
import { useMode } from "@/components/mode/Mode";
import {
  FAIL_LABEL,
  axisValue,
  failureSummary,
  methodCurve,
  arenaStore,
  taskStatus,
  taskVerdict,
  type CostAxis,
  type FailKind,
} from "@/lib/arena";
import { METHODS } from "@/lib/methods";
import type { MethodId } from "@/lib/ode";
import { fmt } from "@/lib/format";
import { costShort, pow10, specBadge, specShort } from "./shared";

/** верхня межа похибки на графіку: гірші точки малюються на ній */
const E_TOP = 30;

/**
 * Діаграма «похибка — вартість» для однієї задачі: по точці на кожен прогін (крок N або допуск rtol), лінія — крива
 * методу. Невдалі прогони (вибух, Ньютон, ліміт кроків) — не точки, а позначки в легенді.
 */
export default function WorkPrecisionPlot({ specId, methods, axis, eps, version }: { specId: string; methods: MethodId[]; axis: CostAxis; eps: number; version: number }) {
  const { mode } = useMode();
  const simple = mode === "simple";
  const ref = arenaStore.refs.get(specId);
  const status = taskStatus(specId, methods);
  const badge = specBadge(specId);
  // only this task's data version matters for the curves (the global version changes with every other task too)
  const sv = arenaStore.specVersions.get(specId) ?? 0;
  void version;

  const data = useMemo(() => {
    void sv;
    if (!ref || ref.failed) return null;
    const series: Series[] = [];
    const legend: { m: MethodId; points: number; fails: Partial<Record<FailKind, number>>; failTotal: number; pending: boolean }[] = [];
    for (const m of methods) {
      const c = methodCurve(specId, m);
      // points are joined in the order of the sweep (by f + n·J); on the noisy «ms» axis the line may step back a bit
      const pts = c.ok;
      const x = pts.map((r) => axisValue(r, axis));
      const y = pts.map((r) => Math.min(E_TOP, Math.max(r.error, ref.floor)));
      const color = METHODS[m].color;
      if (pts.length) {
        series.push({ x, y, color, width: 1.6, opacity: 0.85 });
        series.push({ x, y, color, dots: true, dotSize: 2.8, noRange: false });
      }
      const fs = failureSummary(c);
      legend.push({ m, points: pts.length, fails: fs.byKind, failTotal: fs.total, pending: !c.complete });
    }
    return { series, legend };
  }, [ref, specId, methods, axis, sv]);

  const verdict = useMemo(() => {
    void sv;
    return taskVerdict(specId, methods, eps, "f");
  }, [specId, methods, eps, sv]);

  const underlay = useMemo(() => {
    if (!ref || ref.failed) return undefined;
    const F = ref.floor;
    return (ctx: CanvasRenderingContext2D, tr: Transform) => {
      const { left, top, width, height } = tr;
      const yF = tr.Y(F);
      // «fog»: errors below the trust floor are not measured
      if (yF < top + height) {
        ctx.fillStyle = "rgba(160,170,210,0.10)";
        ctx.fillRect(left, Math.max(top, yF), width, top + height - Math.max(top, yF));
        ctx.strokeStyle = "rgba(200,210,255,0.35)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(left, yF);
        ctx.lineTo(left + width, yF);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(200,210,255,0.55)";
        ctx.font = "10.5px var(--font-sans), system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText("нижче — «туман»: межа довіри еталона", left + width - 4, yF + 3);
      }
      if (eps >= F) {
        const yE = tr.Y(eps);
        ctx.strokeStyle = "rgba(255,200,87,0.75)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(left, yE);
        ctx.lineTo(left + width, yE);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,200,87,0.95)";
        ctx.font = "11px var(--font-mono), ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(`ε = ${pow10(eps)}`, left + 4, yE - 2);
      }
    };
  }, [ref, eps]);

  const yDomain = useMemo<[number, number]>(() => [ref && !ref.failed ? Math.max(1e-14, Math.min(ref.floor / 5, eps / 10)) : 1e-10, E_TOP * 1.5], [ref, eps]);

  const winner = verdict.winner;
  return (
    <div className="glass min-w-0 rounded-2xl p-4" data-arena-task={specId}>
      <div className="mb-2 flex items-start gap-2">
        <span className="text-xl leading-none">{badge.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold leading-snug text-white">
            <span className="mr-1.5 font-mono text-[12px] text-[var(--accent)]">{badge.num}</span>
            {specShort(specId)}
          </div>
          {ref && !ref.failed && (
            <div className="mt-0.5 text-[11.5px] text-white/50">
              {ref.stiff ? "жорстка" : "нежорстка"}
              {ref.chaotic ? ` · хаос: порівняння на [0, ${fmt(ref.T, 3)}] з [0, ${fmt(ref.Tfull, 3)}]` : ` · [${fmt(ref.t0, 3)}, ${fmt(ref.T, 4)}]`}
              {!simple && ` · межа довіри ${fmt(ref.floor, 2)}`}
            </div>
          )}
        </div>
        <StatusPill status={status} />
      </div>
      {!ref ? (
        <div className="grid h-[250px] place-items-center rounded-xl border border-dashed border-white/10 text-[13px] text-white/40">
          {status === "pending" ? "очікує старту" : "рахуємо еталон…"}
        </div>
      ) : ref.failed ? (
        <div className="grid h-[250px] place-items-center rounded-xl border border-dashed border-[#ff5d73]/30 p-4 text-center text-[13px] text-[#ff9aa8]">{ref.failed}</div>
      ) : (
        <>
          <Plot
            series={data?.series ?? []}
            height={250}
            logX
            logY
            sorted={false}
            legend={false}
            yDomain={yDomain}
            xLabel={axis === "f" ? "вартість: f + n·J" : "час, мс"}
            yLabel="похибка E"
            underlay={underlay}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
            {data?.legend.map((l) => (
              <span key={l.m} className="flex items-center gap-1 text-white/70" title={METHODS[l.m].name}>
                <span className="inline-block h-[3px] w-3.5 rounded-full" style={{ background: METHODS[l.m].color }} />
                <span className={l.points ? "" : "text-white/40 line-through decoration-white/30"}>{METHODS[l.m].short}</span>
                {l.failTotal > 0 && (
                  <span className="text-[#ff8a9a]" title={Object.entries(l.fails).map(([k, n]) => `${FAIL_LABEL[k as FailKind]}: ${n}`).join(", ")}>
                    ✗{l.failTotal}
                    {!simple && <span className="text-white/40"> {Object.keys(l.fails).map((k) => FAIL_LABEL[k as FailKind]).join("/")}</span>}
                  </span>
                )}
                {l.pending && <span className="text-white/35">…</span>}
              </span>
            ))}
          </div>
          {verdict.ready && (
            <div className="mt-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[12.5px] text-white/75">
              {!verdict.evaluable ? (
                <>ε = {pow10(eps)} нижча за межу довіри еталона — тут не оцінюється.</>
              ) : winner ? (
                <>
                  🏆 при ε = {pow10(eps)}: <b style={{ color: METHODS[winner].color }}>{METHODS[winner].short}</b> —{" "}
                  {verdict.reach[winner]!.upper ? "≤ " : ""}
                  {costShort(verdict.best!)} {simple ? "обчислень" : "f + n·J"}
                  {(() => {
                    const second = methods.filter((m) => m !== winner && verdict.ratio[m] !== undefined).sort((a, b) => verdict.ratio[a]! - verdict.ratio[b]!)[0];
                    return second ? <span className="text-white/50"> · далі {METHODS[second].short} (×{verdict.ratio[second]!.toFixed(1)})</span> : null;
                  })()}
                </>
              ) : (
                <>Ніхто не досяг ε = {pow10(eps)} у межах бюджету кроків.</>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: "pending" | "partial" | "done" }) {
  const map = {
    pending: { t: "очікує", c: "border-white/10 text-white/40" },
    partial: { t: "частково", c: "border-[var(--accent)]/40 text-[var(--accent)]" },
    done: { t: "готово", c: "border-[#3ee6a8]/40 text-[#3ee6a8]" },
  }[status];
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${map.c}`}>{map.t}</span>;
}

