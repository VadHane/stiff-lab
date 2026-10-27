"use client";

import { useMemo } from "react";
import { useMode } from "@/components/mode/Mode";
import { Insight } from "@/components/ui/blocks";
import {
  NOMINAL_ORDER,
  arenaStore,
  conclusions,
  evaluableTargets,
  isExplicitFamily,
  observedOrder,
  ranking,
  taskVerdict,
  type RankRow,
} from "@/lib/arena";
import { METHODS } from "@/lib/methods";
import type { MethodId } from "@/lib/ode";
import { fmt } from "@/lib/format";
import { NAMES, int, pow10, specBadge, specShort } from "./shared";

export function useRanking(specIds: string[], methods: MethodId[], eps: number, version: number) {
  return useMemo(() => {
    void version;
    const verdicts = specIds.map((id) => taskVerdict(id, methods, eps, "f"));
    const rows = ranking(verdicts, methods);
    const counted = verdicts.filter((v) => v.ready && v.evaluable).length;
    return { rows, counted, verdicts };
  }, [specIds, methods, eps, version]);
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Загальний рейтинг: більше фінішів — вище; за рівності — менше геометричне середнє відношення до переможця. */
export function RankingTable({ specIds, methods, eps, version }: { specIds: string[]; methods: MethodId[]; eps: number; version: number }) {
  const { mode } = useMode();
  const { rows, counted } = useRanking(specIds, methods, eps, version);
  if (!counted)
    return <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-[13px] text-white/45">Рейтинг з'явиться, коли буде пораховано хоча б одну задачу, де ціль ε = {pow10(eps)} оцінюється.</div>;
  return (
    <div className="space-y-4">
      {mode === "simple" && <Podium rows={rows} counted={counted} />}
      <div className="overflow-x-auto rounded-xl border border-white/8" data-arena-ranking="">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.04] text-white/55">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Метод</th>
              <th className="px-3 py-2 text-center font-medium">{mode === "simple" ? "Дійшов до цілі" : "Фініші"}</th>
              <th className="px-3 py-2 text-center font-medium">{mode === "simple" ? "Перемоги" : "Перемоги"}</th>
              <th className="px-3 py-2 text-center font-medium">{mode === "simple" ? "Дорожче за переможця (в середньому)" : "Геом. середнє ×"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.method} className="border-t border-white/[0.06]">
                <td className="px-3 py-1.5 font-mono text-white/60">{i < 3 && r.finishes ? MEDALS[i] : i + 1}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-white/90">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: METHODS[r.method].color }} />
                  {METHODS[r.method].name}
                  <span className="ml-1.5 text-[11px] text-white/35">{isExplicitFamily(r.method) ? "явний" : "неявний"}</span>
                </td>
                <td className="px-3 py-1.5 text-center font-mono text-white/85">
                  {r.finishes}/{r.entered}
                </td>
                <td className="px-3 py-1.5 text-center font-mono text-white/85">{r.wins || "—"}</td>
                <td className="px-3 py-1.5 text-center font-mono text-white/85">{r.geoMean === null ? "—" : `×${r.geoMean.toFixed(2)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[12px] text-white/45">
        {mode === "simple" ? (
          <>Порядок: спершу — хто дійшов до точності {pow10(eps)} на більшій кількості задач, потім — хто в середньому дешевший. Враховано задач: {counted}.</>
        ) : (
          <>
            Сортування: кількість фінішів (досягнуто ε = {pow10(eps)}) за спаданням, потім геометричне середнє відношення вартості до переможця задачі (лише по задачах, де метод фінішував). Задач, де ε оцінюється: {counted}.
          </>
        )}
      </div>
    </div>
  );
}

function Podium({ rows, counted }: { rows: RankRow[]; counted: number }) {
  const top = rows.filter((r) => r.finishes > 0).slice(0, 3);
  if (!top.length) return null;
  // visual order: 2nd, 1st, 3rd
  const order = [top[1], top[0], top[2]];
  const h = [92, 124, 72];
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4" data-arena-podium="">
      {order.map((r, k) => {
        if (!r) return <div key={k} className="w-[30%] max-w-[170px]" />;
        const place = rows.indexOf(r);
        return (
          <div key={r.method} className="flex w-[30%] max-w-[170px] flex-col items-center">
            <div className="text-3xl">{MEDALS[place]}</div>
            <div className="mt-1 text-center text-[13px] font-semibold leading-tight" style={{ color: METHODS[r.method].color }}>
              {METHODS[r.method].short}
            </div>
            <div className="mb-1.5 text-center text-[11px] text-white/50">
              {r.finishes} з {counted} · {r.geoMean === null ? "" : r.geoMean < 1.05 ? "завжди найдешевший" : `×${r.geoMean.toFixed(1)}`}
            </div>
            <div
              className="font-display grid w-full place-items-center rounded-t-xl border border-white/10 text-2xl text-white/80"
              style={{ height: h[k], background: `linear-gradient(180deg, ${METHODS[r.method].color}33, rgba(255,255,255,0.02))` }}
            >
              {place + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Автоматичні висновки (лише те, що прямо випливає з чисел). */
export function Conclusions({ specIds, methods, eps, version }: { specIds: string[]; methods: MethodId[]; eps: number; version: number }) {
  const list = useMemo(() => {
    void version;
    return conclusions(specIds, methods, eps, NAMES);
  }, [specIds, methods, eps, version]);
  if (!list.length) return <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-[13px] text-white/45">Висновки з'являться після розрахунку.</div>;
  return (
    <div className="space-y-2.5" data-arena-conclusions="">
      {list.map((c, i) => (
        <Insight key={i} tone={c.tone === "bad" ? "bad" : c.tone === "good" ? "good" : c.tone === "warn" ? "warn" : "info"}>
          {c.text}
        </Insight>
      ))}
    </div>
  );
}

/** Спостережені порядки методів зі сталим кроком (нахил lg E від lg h). */
export function OrdersTable({ specIds, methods, version }: { specIds: string[]; methods: MethodId[]; version: number }) {
  const fixed = methods.filter((m) => NOMINAL_ORDER[m] !== undefined);
  const rows = useMemo(() => {
    void version;
    return specIds
      .filter((id) => arenaStore.refs.get(id) && !arenaStore.refs.get(id)!.failed)
      .map((id) => ({ id, stiff: arenaStore.refs.get(id)!.stiff, fits: fixed.map((m) => observedOrder(id, m)) }));
  }, [specIds, fixed, version]);
  if (!fixed.length || !rows.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-white/8" data-arena-orders="">
      <table className="w-full text-left text-[12.5px]">
        <thead className="bg-white/[0.04] text-white/55">
          <tr>
            <th className="px-3 py-2 font-medium">Задача</th>
            {fixed.map((m) => (
              <th key={m} className="whitespace-nowrap px-2 py-2 text-center font-medium">
                {METHODS[m].short} <span className="text-white/35">({NOMINAL_ORDER[m]})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-white/[0.06]">
              <td className="whitespace-nowrap px-3 py-1.5 text-white/80">
                {specBadge(r.id).emoji} {specBadge(r.id).num} <span className="text-white/40">{r.stiff ? "жорстка" : "нежорстка"}</span>
              </td>
              {r.fits.map((f, k) => {
                const p = NOMINAL_ORDER[fixed[k]]!;
                const ok = f && Math.abs(f.slope - p) <= 0.25;
                return (
                  <td key={k} className={`px-2 py-1.5 text-center font-mono ${!f ? "text-white/25" : ok ? "text-[#3ee6a8]" : "text-[#ffb547]"}`} title={f ? `${f.points} точок` : "замало точок в асимптотичній зоні"}>
                    {f ? f.slope.toFixed(2) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-white/[0.06] px-3 py-2 text-[11.5px] text-white/45">
        МНК-нахил lg E від lg h по вдалих прогонах з 3F ≤ E ≤ 10⁻²; у дужках — теоретичний порядок. Зелений — у межах ±0.25 від порядку. На жорстких задачах відхилення
        (пониження порядку, перехідний шар, межа стійкості) — очікуване; «—» — замало точок.
      </div>
    </div>
  );
}

/** Еталони: метод, кроки, розбіжність, межа довіри, горизонт порівняння. */
export function ReferenceTable({ specIds, version }: { specIds: string[]; version: number }) {
  const rows = useMemo(() => {
    void version;
    return specIds.map((id) => ({ id, ref: arenaStore.refs.get(id) }));
  }, [specIds, version]);
  const name = (m: MethodId, rtol: number, N?: number) => (m === "rk4" ? `RK4, N = ${int(N ?? 0)}` : `${METHODS[m].short}, rtol ${pow10(rtol)}`);
  return (
    <div className="overflow-x-auto rounded-xl border border-white/8" data-arena-refs="">
      <table className="w-full text-left text-[12.5px]">
        <thead className="bg-white/[0.04] text-white/55">
          <tr>
            <th className="px-3 py-2 font-medium">Задача</th>
            <th className="px-3 py-2 font-medium">Відрізок порівняння</th>
            <th className="px-3 py-2 font-medium">Кращий еталон</th>
            <th className="px-3 py-2 font-medium">Другий еталон</th>
            <th className="px-3 py-2 text-center font-medium">δ</th>
            <th className="px-3 py-2 text-center font-medium">Межа довіри F</th>
            <th className="px-3 py-2 font-medium">Оцінювані ε</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, ref }) => (
            <tr key={id} className="border-t border-white/[0.06] align-top">
              <td className="whitespace-nowrap px-3 py-1.5 text-white/85" title={specShort(id)}>
                {specBadge(id).emoji} {specBadge(id).num}
              </td>
              {!ref ? (
                <td colSpan={6} className="px-3 py-1.5 text-white/30">
                  ще не пораховано
                </td>
              ) : ref.failed ? (
                <td colSpan={6} className="px-3 py-1.5 text-[#ff8a9a]">
                  {ref.failed}
                </td>
              ) : (
                <>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-white/80">
                    [{fmt(ref.t0, 3)}, {fmt(ref.T, 4)}]
                    {ref.chaotic && (
                      <div className="font-sans text-[11px] text-white/45">
                        з [0, {fmt(ref.Tfull, 3)}]{ref.divergence?.lost !== undefined ? `; еталони розійшлися > 10⁻⁸ при t = ${fmt(ref.divergence.lost, 4)}` : "; передбачуваність не втрачено до кінця"}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-white/80">
                    {name(ref.runs[1].method, ref.runs[1].rtol, ref.runs[1].N)}
                    <div className="text-[11px] text-white/40">{int(ref.runs[1].steps)} кроків</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-white/80">
                    {name(ref.runs[0].method, ref.runs[0].rtol, ref.runs[0].N)}
                    <div className="text-[11px] text-white/40">
                      {int(ref.runs[0].steps)} кроків{ref.dopriNote ? " · DOPRI не вклався в бюджет" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-center font-mono text-white/80">{fmt(ref.delta, 2)}</td>
                  <td className="px-3 py-1.5 text-center font-mono text-white/80">{fmt(ref.floor, 2)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-white/80">{evaluableTargets(ref).map(pow10).join(" ") || "—"}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
