"use client";

import { useMode } from "@/components/mode/Mode";
import { MethodPicker } from "@/components/ui/controls";
import { ARENA_ALL_SPECS, ARENA_MAIN_SPECS, ARENA_METHODS, DEFAULT_ARENA_SPECS, EXPLICIT_METHODS, IMPLICIT_METHODS, sortMethods, sortSpecs } from "@/lib/arena";
import type { MethodId } from "@/lib/ode";
import { METHODS } from "@/lib/methods";
import { specById } from "@/lib/task-specs";
import { specBadge, type Runner } from "./shared";

const VARIANTS = ARENA_ALL_SPECS.filter((id) => !ARENA_MAIN_SPECS.includes(id));

function SpecChip({ id, on, toggle, variant }: { id: string; on: boolean; toggle: () => void; variant?: boolean }) {
  const spec = specById(id)!;
  const b = specBadge(id);
  const text = variant ? spec.variant ?? spec.title : spec.title;
  return (
    <button
      onClick={toggle}
      title={variant ? `${spec.title} — ${spec.variant}` : spec.title}
      aria-pressed={on}
      className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-[12.5px] transition-all ${
        on ? "text-white" : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/85"
      }`}
      style={on ? { borderColor: b.accent, background: `${b.accent}1f`, boxShadow: `0 0 14px -6px ${b.accent}` } : undefined}
    >
      <span>{b.emoji}</span>
      <span className="font-mono text-[11px] opacity-80">{b.num}</span>
      <span className="truncate">{text}</span>
      {spec.stiff ? <span className="text-[10px] opacity-60">жорстк.</span> : null}
    </button>
  );
}

export default function ArenaControls({
  specIds,
  setSpecIds,
  methods,
  setMethods,
  runner,
}: {
  specIds: string[];
  setSpecIds: (v: string[]) => void;
  methods: MethodId[];
  setMethods: (v: MethodId[]) => void;
  runner: Runner;
}) {
  const { mode } = useMode();
  const toggleSpec = (id: string) => setSpecIds(sortSpecs(specIds.includes(id) ? specIds.filter((x) => x !== id) : [...specIds, id]));
  const pct = runner.total ? Math.min(100, (100 * runner.done) / runner.total) : 0;
  const complete = runner.total > 0 && runner.done >= runner.total;
  const variantsOn = VARIANTS.filter((id) => specIds.includes(id)).length;
  const empty = !specIds.length || !methods.length;
  const sameAsDefault = specIds.length === DEFAULT_ARENA_SPECS.length && DEFAULT_ARENA_SPECS.every((id) => specIds.includes(id));
  const allMain = ARENA_MAIN_SPECS.every((id) => specIds.includes(id)) && specIds.length === ARENA_MAIN_SPECS.length;
  const small = "rounded-full border border-white/12 px-2.5 py-1 text-[12px] text-white/70 hover:border-white/30 hover:text-white disabled:opacity-40";
  const p = runner.progress;
  return (
    <div className="glass space-y-5 rounded-2xl p-4 sm:p-5" data-arena-controls="">
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-white/75">
            Задачі <span className="text-white/40">({specIds.length})</span>
          </span>
          <span className="ml-auto flex flex-wrap gap-1.5">
            <button className={small} disabled={sameAsDefault} onClick={() => setSpecIds(sortSpecs(DEFAULT_ARENA_SPECS))}>
              Типовий набір
            </button>
            <button className={small} disabled={allMain} onClick={() => setSpecIds(sortSpecs(ARENA_MAIN_SPECS))} title="Основні постановки всіх 19 задач (на кшталт 25–60 с розрахунку)">
              Усі задачі (19)
            </button>
            <button className={small} disabled={!specIds.length} onClick={() => setSpecIds([])}>
              Очистити
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ARENA_MAIN_SPECS.map((id) => (
            <SpecChip key={id} id={id} on={specIds.includes(id)} toggle={() => toggleSpec(id)} />
          ))}
        </div>
        <details className="group mt-2" open={variantsOn > 0 ? true : undefined}>
          <summary className="cursor-pointer select-none text-[12.5px] text-white/55 hover:text-white">
            Варіанти задач ({VARIANTS.length}){variantsOn ? ` · вибрано ${variantsOn}` : ""}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {VARIANTS.map((id) => (
              <SpecChip key={id} id={id} on={specIds.includes(id)} toggle={() => toggleSpec(id)} variant />
            ))}
          </div>
        </details>
      </div>
      <div>
        <MethodPicker methods={ARENA_METHODS} value={methods} onChange={(v) => setMethods(sortMethods(v))} label={`Учасники (${methods.length} з ${ARENA_METHODS.length})`} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button className={small} onClick={() => setMethods(ARENA_METHODS)} disabled={methods.length === ARENA_METHODS.length}>
            Усі 11
          </button>
          <button className={small} onClick={() => setMethods(sortMethods(EXPLICIT_METHODS))}>
            Лише явні
          </button>
          <button className={small} onClick={() => setMethods(sortMethods(IMPLICIT_METHODS))}>
            Лише неявні
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {runner.running ? (
          <button onClick={runner.stop} className="rounded-full border border-[#ff5d73]/60 bg-[#ff5d73]/15 px-5 py-2 text-[14px] font-semibold text-white hover:bg-[#ff5d73]/25" data-arena-stop="">
            ⏹ Зупинити
          </button>
        ) : (
          <button
            onClick={runner.start}
            disabled={empty || complete}
            className="rounded-full bg-white px-5 py-2 text-[14px] font-semibold text-black shadow-[0_0_40px_-10px_var(--accent)] transition-transform enabled:hover:scale-[1.03] disabled:opacity-50"
            data-arena-start=""
          >
            {complete ? "✓ Пораховано" : runner.done > 0 ? "▶ Продовжити" : "🏁 Почати змагання"}
          </button>
        )}
        <div className="min-w-[180px] flex-1">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-white/55">
            <span className="min-w-0 truncate">
              {runner.running && p
                ? `Зараз: ${p.specId ? `${specBadge(p.specId).emoji} ${specBadge(p.specId).num}` : ""} ${p.method ? `· ${METHODS[p.method].short} ` : ""}· ${p.label}`
                : complete
                  ? "Усі забіги пораховано"
                  : runner.done > 0
                    ? "Призупинено — пораховане збережено"
                    : empty
                      ? "Виберіть задачі й методи"
                      : mode === "simple"
                        ? "Натисніть «Почати» — сторінка не завмре, можна гортати й клікати"
                        : `${runner.total} одиниць роботи; розрахунок порціями по ~40 мс`}
            </span>
            <span className="font-mono text-white/70">
              {pct.toFixed(0)}%{runner.elapsed > 0 ? ` · ${(runner.elapsed / 1000).toFixed(1)} с` : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      {runner.error && <div className="rounded-xl border border-[#ff5d73]/40 bg-[#ff5d73]/10 px-3 py-2 text-[13px] text-[#ff9aa8]">Помилка розрахунку: {runner.error}</div>}
    </div>
  );
}
