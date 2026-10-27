"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Say } from "@/components/mode/Mode";
import Plot, { type Series } from "@/components/plot/Plot";
import { Card, Grid, Insight, Stat } from "@/components/ui/blocks";
import { Chips } from "@/components/ui/controls";
import { Tex } from "@/components/ui/Tex";
import { CONVERGENCE_PROBLEMS, convergenceRun, observedOrder, type Tableau } from "@/lib/butcher";
import { fmt } from "@/lib/format";
import type { Analysis } from "./Passport";
import { orderLabel } from "./Passport";
import { BUILDER_ACCENT } from "./theme";

const NS = [5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560];

export default function ConvergencePanel({ tab, a, name }: { tab: Tableau; a: Analysis; name: string }) {
  const [pid, setPid] = useState(CONVERGENCE_PROBLEMS[0].id);
  const cp = CONVERGENCE_PROBLEMS.find((p) => p.id === pid) ?? CONVERGENCE_PROBLEMS[0];
  const dTab = useDeferredValue(tab);
  const dCp = useDeferredValue(cp);
  const res = useMemo(() => {
    const t0 = performance.now();
    const pts = convergenceRun(dTab, dCp, NS);
    return { pts, obs: observedOrder(pts), ms: performance.now() - t0 };
  }, [dTab, dCp]);
  const { pts, obs } = res;
  const p = a.order.p;
  const q = a.order.q;
  const pShow = a.order.atLeast ? 5 : p;
  const valid = pts.filter((x) => Number.isFinite(x.err) && x.err > 0);

  // reference slope lines anchored at the most accurate point above the round-off floor
  const lastUsed = obs.used[obs.used.length - 1];
  const anchor = lastUsed !== undefined ? pts[lastUsed] : valid[valid.length - 1];
  const hs = [pts[0].h, pts[pts.length - 1].h];
  const line = (k: number) => (anchor ? hs.map((h) => anchor.err * Math.pow(h / anchor.h, k)) : []);
  const series: Series[] = [
    { x: valid.map((x) => x.h), y: valid.map((x) => x.err), color: BUILDER_ACCENT, label: name, width: 2 },
    { x: valid.map((x) => x.h), y: valid.map((x) => x.err), color: BUILDER_ACCENT, dots: true, dotSize: 3.5 },
  ];
  if (anchor && pShow > 0) series.push({ x: hs, y: line(pShow), color: "#ffffff", label: `нахил p = ${orderLabel(a.order)}`, width: 1.2, dash: [6, 5], opacity: 0.7, noRange: true });
  if (anchor && cp.id === "pr" && q !== pShow && q > 0) series.push({ x: hs, y: line(q), color: "#ffb547", label: `нахил q = ${q}`, width: 1.2, dash: [3, 4], opacity: 0.8, noRange: true });

  const slope = obs.slope;
  const agrees = slope !== null && (a.order.atLeast ? slope >= 4.6 : Math.abs(slope - p) < 0.35);
  const higher = slope !== null && !a.order.atLeast && slope > p + 0.35;
  const lower = slope !== null && slope < pShow - 0.35;
  const allFailed = valid.length === 0;

  return (
    <div className="space-y-4">
      <Chips value={pid} onChange={setPid} options={CONVERGENCE_PROBLEMS.map((c) => ({ value: c.id, label: c.name }))} />
      <Grid>
        <Card>
          <Tex block>{cp.tex}</Tex>
          <p className="mt-1 text-[12.5px] text-white/55">{cp.note}</p>
          <Plot
            title="Похибка в кінці відрізка від кроку h (лог-лог)"
            xLabel="h"
            yLabel="|y_N − y(T)|"
            logX
            logY
            sorted={false}
            series={series}
            height={300}
          />
        </Card>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Порядок з паспорта" value={orderLabel(a.order)} sub={`стадійний q = ${q}`} />
            <Stat
              label="Спостережений нахил"
              value={slope === null ? "—" : fmt(slope, 3)}
              sub={`медіана локальних нахилів, похибки 10⁻¹³…10⁻² (${Math.max(0, obs.used.length - 1)} пар)`}
              tone={slope === null ? "default" : agrees ? "good" : "warn"}
            />
          </div>
          {allFailed ? (
            <Insight tone="bad" title="Жодного успішного прогону">
              На цій задачі метод вибухає або Ньютон не збігається за всіх кроків від h = {fmt(pts[0].h, 3)} до {fmt(pts[pts.length - 1].h, 3)} — типово для явного методу на
              жорсткій задачі.
            </Insight>
          ) : slope === null ? (
            <Insight tone="note" title="Замало точок для нахилу">
              Потрібні щонайменше дві сусідні точки з похибкою між 10⁻¹³ і 10⁻². Можливо, метод надто точний (похибка вже на рівні округлень) або надто грубий.
            </Insight>
          ) : agrees ? (
            <Insight tone="good" title="Збіжність підтверджує паспорт" simple={
                <>
                  Зменшили крок удвічі — похибка впала приблизно в 2<sup>{fmt(slope, 2)}</sup> ≈ {fmt(Math.pow(2, slope), 3)} разів. Саме так і має бути для порядку{" "}
                  {orderLabel(a.order)}.
                </>
              }>
              Нахил {fmt(slope, 3)} ≈ p = {orderLabel(a.order)}: похибка <Tex>{`\\sim C h^{${fmt(slope, 3)}}`}</Tex>, тобто подвоєння N зменшує її в ≈ {fmt(Math.pow(2, slope), 3)} разів.
            </Insight>
          ) : higher ? (
            <Insight tone="info" title={`Нахил ${fmt(slope, 3)} вищий за p = ${p}`}>
              {cp.id === "linear"
                ? "Лінійна задача «бачить» лише частину умов порядку (R(z) і квадратурні умови), тож метод тут може сходитися швидше, ніж на нелінійних задачах. Перевірте на нелінійній."
                : "На цій задачі головний член похибки випадково малий (або порядок вищий для цього класу задач). Подивіться локальні нахили при найменших h і спробуйте іншу задачу."}
            </Insight>
          ) : lower ? (
            <Insight tone="warn" title={`Нахил ${fmt(slope, 3)} нижчий за p = ${orderLabel(a.order)}`}>
              {cp.id === "pr"
                ? `Зниження порядку на жорсткій задачі: при h|λ| ≫ 1 похибка стадій (стадійний порядок q = ${q}) визначає збіжність — нахил ≈ q або q + 1, а не p. Порядок p повертається лише при h|λ| ≲ 1.`
                : "Можливо, крок ще не в асимптотичній зоні або похибка впирається в округлення. Подивіться локальні нахили між сусідніми точками."}
            </Insight>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-white/[0.04] text-white/55">
                <tr>
                  <th className="px-3 py-1.5 font-medium">N</th>
                  <th className="px-3 py-1.5 font-medium">h</th>
                  <th className="px-3 py-1.5 font-medium">похибка</th>
                  <th className="px-3 py-1.5 font-medium">нахил</th>
                  <th className="px-3 py-1.5 font-medium">f</th>
                </tr>
              </thead>
              <tbody>
                {pts.map((x, i) => {
                  const loc = obs.local[i - 1];
                  return (
                    <tr key={x.N} className={`border-t border-white/[0.06] ${obs.used.includes(i) ? "" : "text-white/45"}`}>
                      <td className="px-3 py-1 font-mono">{x.N}</td>
                      <td className="px-3 py-1 font-mono">{fmt(x.h, 3)}</td>
                      <td className="px-3 py-1 font-mono">{Number.isFinite(x.err) ? fmt(x.err, 3) : x.failed?.includes("Ньютон") ? "✖ Ньютон" : "💥"}</td>
                      <td className="px-3 py-1 font-mono">{i > 0 && loc !== null && loc !== undefined ? fmt(loc, 3) : ""}</td>
                      <td className="px-3 py-1 font-mono text-white/55">{x.fevals}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Say
            simple={<p className="text-[12px] text-white/45">Сірі рядки не враховано в нахилі: там похибка або ще завелика, або вже на рівні похибок округлення (10⁻¹³ і менше).</p>}
          >
            <p className="text-[12px] text-white/45">
              Нахил між сусідніми точками: <Tex>{"\\log(e_{k}/e_{k+1})/\\log(h_k/h_{k+1})"}</Tex>; спостережений порядок — медіана нахилів пар, обидві похибки яких у зоні 10⁻¹³…10⁻² (сірі рядки — поза нею). Розрахунок — {fmt(res.ms, 3)} мс.
            </p>
          </Say>
        </div>
      </Grid>
    </div>
  );
}
