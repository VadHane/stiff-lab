"use client";

import { useCallback, useMemo } from "react";
import { OnlySci, Say, useMode } from "@/components/mode/Mode";
import { Section } from "@/components/ui/blocks";
import { Chips } from "@/components/ui/controls";
import { ARENA_ALL_SPECS, ARENA_METHODS, DEFAULT_ARENA_SPECS, TARGETS, sortMethods, sortSpecs, type CostAxis } from "@/lib/arena";
import { codecs, encodeNumber, useUrlState, type UrlCodec } from "@/lib/url-state";
import type { MethodId } from "@/lib/ode";
import ArenaControls from "./ArenaControls";
import ArenaExplainer, { Methodology } from "./ArenaExplainer";
import ArenaQuiz from "./ArenaQuiz";
import { Heatmap, ReachTable } from "./ArenaResults";
import { Conclusions, OrdersTable, RankingTable, ReferenceTable } from "./ArenaSummary";
import WorkPrecisionPlot from "./WorkPrecisionPlot";
import { pow10, useArenaRunner } from "./shared";

/** ціль ε в адресі: лише одна з TARGETS */
const EPS_CODEC: UrlCodec<number> = {
  encode: encodeNumber,
  decode: (s) => {
    const v = Number(s);
    return TARGETS.find((t) => Math.abs(t - v) <= t * 1e-9);
  },
};
const AXIS_CODEC = codecs.enum<CostAxis>(["f", "ms"]);
const SPECS_CODEC = codecs.strings(ARENA_ALL_SPECS);

function TargetChips({ eps, setEps, axis, setAxis, showAxis = true }: { eps: number; setEps: (v: number) => void; axis?: CostAxis; setAxis?: (v: CostAxis) => void; showAxis?: boolean }) {
  const { mode } = useMode();
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <Chips
        label={mode === "simple" ? "Ціль: скільки правильних цифр" : "Цільова точність ε"}
        options={TARGETS.map((t) => ({ value: t, label: mode === "simple" ? `${pow10(t)} (≈${Math.round(-Math.log10(t))} цифр)` : `ε = ${pow10(t)}` }))}
        value={eps}
        onChange={setEps}
      />
      {showAxis && axis && setAxis && (
        <Chips
          label="Вісь вартості на графіках"
          options={[
            { value: "f" as CostAxis, label: "f-обчислення", title: "f + n·J: відтворювано, не залежить від комп'ютера" },
            { value: "ms" as CostAxis, label: "час, мс", title: "настінний час прогону в браузері (шумний)" },
          ]}
          value={axis}
          onChange={setAxis}
        />
      )}
    </div>
  );
}

export default function ArenaApp() {
  const [specRaw, setSpecRaw] = useUrlState<string[]>("t", DEFAULT_ARENA_SPECS, SPECS_CODEC);
  const [methodRaw, setMethodRaw] = useUrlState<MethodId[]>("m", ARENA_METHODS, codecs.methods);
  const [eps, setEps] = useUrlState<number>("eps", 1e-6, EPS_CODEC);
  const [axis, setAxis] = useUrlState<CostAxis>("x", "f", AXIS_CODEC);
  // registry order everywhere (rows of the tables, the address)
  const specIds = useMemo(() => sortSpecs(specRaw), [specRaw]);
  const methods = useMemo(() => sortMethods(methodRaw), [methodRaw]);
  const setSpecIds = useCallback((v: string[]) => setSpecRaw(sortSpecs(v)), [setSpecRaw]);
  const setMethods = useCallback((v: MethodId[]) => setMethodRaw(sortMethods(v)), [setMethodRaw]);
  const addSpec = useCallback((id: string) => setSpecRaw((cur) => sortSpecs([...cur, id])), [setSpecRaw]);
  const addMethod = useCallback((m: MethodId) => setMethodRaw((cur) => sortMethods([...cur, m])), [setMethodRaw]);
  const runner = useArenaRunner(specIds, methods);
  const v = runner.version;

  return (
    <>
      <Section kicker="Ідея" title="Що таке діаграма «похибка — вартість»" simpleTitle="Скільки праці коштує кожна наступна цифра точності">
        <ArenaExplainer />
      </Section>

      <Section kicker="Старт" title="Учасники і траси" simpleTitle="Хто змагається і де" report={false}>
        <ArenaControls specIds={specIds} setSpecIds={setSpecIds} methods={methods} setMethods={setMethods} runner={runner} />
      </Section>

      <Section kicker="Забіги" title="Діаграми «похибка — вартість»" simpleTitle="Забіги: праця проти помилки">
        <div className="mb-4">
          <TargetChips eps={eps} setEps={setEps} axis={axis} setAxis={setAxis} />
          <p className="mt-2 text-[13px] text-white/55">
            <Say simple={<>Кожна точка — один забіг методу. Нижче й лівіше — краще. Жовта риска — ціль; ✗ у підписі — забіги, що «вибухнули» чи не змогли зробити крок.</>}>
              Точка — один прогін (N кроків або rtol); лінія — крива методу; жовта риска — ε; затінено — нижче межі довіри еталона. Невдалі прогони — лише в легенді (✗ і причина).
              Перетягніть мишею, щоб збільшити; подвійний клік — скинути.
            </Say>
          </p>
        </div>
        {specIds.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-arena-plots="">
            {specIds.map((id) => (
              <WorkPrecisionPlot key={id} specId={id} methods={methods} axis={axis} eps={eps} version={v} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-white/45">Виберіть хоча б одну задачу.</div>
        )}
      </Section>

      <Section kicker="Рахунок" title={`Хто скільки заплатив за ε = ${pow10(eps)}`} simpleTitle={`Скільки праці коштувала точність ${pow10(eps)}`}>
        <div className="mb-4">
          <TargetChips eps={eps} setEps={setEps} showAxis={false} />
        </div>
        <div className="space-y-6">
          <div>
            <h3 className="font-display mb-2 text-[15px] text-white/90">🌡️ Теплова карта: у скільки разів дорожче за переможця</h3>
            <Heatmap specIds={specIds} methods={methods} eps={eps} version={v} />
          </div>
          <div>
            <h3 className="font-display mb-2 text-[15px] text-white/90">🧾 Вартість досягнення ε = {pow10(eps)}</h3>
            <ReachTable specIds={specIds} methods={methods} eps={eps} axis={axis} version={v} />
          </div>
        </div>
      </Section>

      <Section kicker="Підсумок" title="Загальний рейтинг" simpleTitle="П'єдестал">
        <RankingTable specIds={specIds} methods={methods} eps={eps} version={v} />
      </Section>

      <Section kicker="Аналіз" title="Висновки з чисел" simpleTitle="Що показало змагання">
        <Conclusions specIds={specIds} methods={methods} eps={eps} version={v} />
        <OnlySci>
          <h3 className="font-display mb-2 mt-8 text-[15px] text-white/90">📐 Спостережені порядки методів зі сталим кроком</h3>
          <OrdersTable specIds={specIds} methods={methods} version={v} />
          <h3 className="font-display mb-2 mt-8 text-[15px] text-white/90">🎯 Еталони і межа довіри</h3>
          <ReferenceTable specIds={specIds} version={v} />
        </OnlySci>
      </Section>

      <OnlySci>
        <Section kicker="Методика" title="Як рахується арена">
          <Methodology />
        </Section>
      </OnlySci>

      <Section kicker="Перевір себе" title="Квізи за результатами" simpleTitle="Вгадай переможця" report={false}>
        <ArenaQuiz specIds={specIds} methods={methods} version={v} addSpec={addSpec} addMethod={addMethod} />
      </Section>

      {runner.running && (
        <button
          onClick={runner.stop}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-white/15 bg-[#12152b]/95 px-4 py-2 text-[13px] text-white shadow-xl backdrop-blur"
          title="Зупинити розрахунок"
          data-arena-float=""
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
          {runner.total ? Math.floor((100 * runner.done) / runner.total) : 0}% · ⏹ Зупинити
        </button>
      )}
    </>
  );
}
