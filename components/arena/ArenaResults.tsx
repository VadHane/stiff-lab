"use client";

import { useMemo, type ReactNode } from "react";
import { useMode } from "@/components/mode/Mode";
import { arenaStore, taskVerdict, type CostAxis, type TaskVerdict } from "@/lib/arena";
import { METHODS } from "@/lib/methods";
import type { MethodId } from "@/lib/ode";
import { costShort, msShort, pow10, specBadge, specShort } from "./shared";

/** Колір клітинки теплової карти за відношенням «вартість / вартість переможця» (лог-шкала 1 … 1000). */
export function ratioColor(r: number): string {
  const t = Math.min(1, Math.max(0, Math.log10(r) / 3));
  // green → yellow → orange → red
  const stops = [
    [62, 230, 168],
    [255, 216, 77],
    [255, 138, 61],
    [255, 93, 115],
  ];
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + f * (stops[i + 1][k] - v)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function useVerdicts(specIds: string[], methods: MethodId[], eps: number, axis: CostAxis, version: number): TaskVerdict[] {
  return useMemo(() => {
    void version;
    return specIds.map((id) => taskVerdict(id, methods, eps, axis));
  }, [specIds, methods, eps, axis, version]);
}

/** Теплова карта «задачі × методи»: колір — у скільки разів дорожче за переможця (за f + n·J). */
export function Heatmap({ specIds, methods, eps, version }: { specIds: string[]; methods: MethodId[]; eps: number; version: number }) {
  const { mode } = useMode();
  const verdicts = useVerdicts(specIds, methods, eps, "f", version);
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-white/8" data-arena-heatmap="">
        <table className="w-full border-separate border-spacing-[3px] text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#0b0d1f] px-2 py-1.5 text-left font-medium text-white/55">Задача</th>
              {methods.map((m) => (
                <th key={m} className="px-1 py-1.5 font-medium text-white/70" title={METHODS[m].name}>
                  <span className="mx-auto mb-1 block h-1.5 w-6 rounded-full" style={{ background: METHODS[m].color }} />
                  <span className="whitespace-nowrap">{METHODS[m].short}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {verdicts.map((v) => {
              const b = specBadge(v.specId);
              const ref = arenaStore.refs.get(v.specId);
              return (
                <tr key={v.specId}>
                  <td className="sticky left-0 z-10 max-w-[150px] bg-[#0b0d1f] px-2 py-1 text-white/80 sm:max-w-[260px]" title={specShort(v.specId)}>
                    <span className="mr-1">{b.emoji}</span>
                    <span className="font-mono text-[11px] text-[var(--accent)]">{b.num}</span>{" "}
                    <span className="hidden truncate align-bottom sm:inline-block sm:max-w-[190px]">{specShort(v.specId)}</span>
                  </td>
                  {methods.map((m) => {
                    if (!ref || !v.ready)
                      return (
                        <td key={m} className="rounded-md bg-white/[0.03] px-1 py-1.5 text-center text-white/25">
                          …
                        </td>
                      );
                    if (!v.evaluable)
                      return (
                        <td key={m} className="rounded-md bg-white/[0.02] px-1 py-1.5 text-center text-white/25" title="ε нижча за межу довіри еталона">
                          ·
                        </td>
                      );
                    const r = v.ratio[m];
                    const reach = v.reach[m];
                    if (r === undefined || !reach)
                      return (
                        <td key={m} className="rounded-md bg-[#ff5d73]/[0.07] px-1 py-1.5 text-center text-[#ff8a9a]" title={`${METHODS[m].short}: не досяг ε`}>
                          ✗
                        </td>
                      );
                    const win = v.winner === m;
                    return (
                      <td
                        key={m}
                        className="rounded-md px-1 py-1.5 text-center font-mono font-semibold text-black"
                        style={{ background: ratioColor(r) }}
                        title={`${METHODS[m].short}: ${reach.upper ? "≤ " : ""}${Math.round(reach.value).toLocaleString("uk-UA")} (f + n·J), ×${r.toFixed(2)} від переможця`}
                      >
                        {win ? "🏆" : r < 10 ? `×${r.toFixed(1)}` : `×${Math.round(r)}`}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${ratioColor(1)}, ${ratioColor(10)}, ${ratioColor(100)}, ${ratioColor(1000)})` }} />
          ×1 … ×1000
        </span>
        <span>🏆 переможець</span>
        <span className="text-[#ff8a9a]">✗ не досяг ε</span>
        <span>· ε не оцінюється</span>
        <span>… ще рахується</span>
        {mode === "sci" && <span>колір — lg(вартість / вартість переможця), вартість = f + n·J</span>}
      </div>
    </div>
  );
}

/** Таблиця «вартість досягнення ε»: рядки — методи, стовпці — задачі. */
export function ReachTable({ specIds, methods, eps, axis, version }: { specIds: string[]; methods: MethodId[]; eps: number; axis: CostAxis; version: number }) {
  const verdicts = useVerdicts(specIds, methods, eps, axis, version);
  const fmtV = (v: number) => (axis === "f" ? costShort(v) : msShort(v));
  return (
    <div className="overflow-x-auto rounded-xl border border-white/8" data-arena-reach="">
      <table className="w-full text-left text-[12.5px]">
        <thead className="bg-white/[0.04] text-white/55">
          <tr>
            <th className="sticky left-0 z-10 bg-[#101225] px-3 py-2 font-medium">Метод</th>
            {verdicts.map((v) => {
              const b = specBadge(v.specId);
              return (
                <th key={v.specId} className="whitespace-nowrap px-2 py-2 text-center font-medium" title={specShort(v.specId)}>
                  {b.emoji} {b.num}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m} className="border-t border-white/[0.06]">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-[#0d0f22] px-3 py-1.5 text-white/85">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: METHODS[m].color }} />
                {METHODS[m].short}
              </td>
              {verdicts.map((v) => {
                const r = v.reach[m];
                let cell: ReactNode;
                let cls = "text-white/80";
                if (!v.ready) {
                  cell = "…";
                  cls = "text-white/25";
                } else if (!v.evaluable) {
                  cell = "·";
                  cls = "text-white/25";
                } else if (!r) {
                  cell = "✗";
                  cls = "text-[#ff8a9a]";
                } else {
                  cell = `${r.upper ? "≤" : ""}${fmtV(r.value)}`;
                  if (v.winner === m) cls = "font-semibold text-[#3ee6a8]";
                }
                return (
                  <td key={v.specId} className={`whitespace-nowrap px-2 py-1.5 text-center font-mono ${cls}`}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-white/[0.06] px-3 py-2 text-[11.5px] text-white/45">
        Ціль ε = {pow10(eps)}; {axis === "f" ? "вартість у f-обчисленнях (f + n·J)" : "вартість у мілісекундах (шумна: залежить від браузера й навантаження)"}; «≤» — найдешевший прогін уже точніший за ε, тож справжня
        вартість не більша; зелений — переможець.
      </div>
    </div>
  );
}
