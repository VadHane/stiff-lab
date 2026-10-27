"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { arenaDone, arenaJobs, arenaStore, arenaTotal, runSliced, type ArenaProgress, type Namer, type SliceHandle } from "@/lib/arena";
import { METHODS } from "@/lib/methods";
import type { MethodId } from "@/lib/ode";
import { specById, specTitle } from "@/lib/task-specs";
import { taskById } from "@/lib/tasks";
import { sup } from "@/lib/format";

/** Емодзі й номер сторінки задачі для специфікації: «⚗️», «№12». */
export function specBadge(id: string): { emoji: string; num: string; accent: string } {
  const spec = specById(id);
  const t = spec ? taskById(spec.taskId) : undefined;
  return { emoji: t?.emoji ?? "🧩", num: t ? (t.label ?? `№${t.num}`) : id, accent: t?.accent ?? "#7c9cff" };
}

/** Коротка назва: «Робертсон» без варіанта — «№12 Хімічна кінетика…»; варіант — після крапки. */
export function specShort(id: string): string {
  const spec = specById(id);
  if (!spec) return id;
  return spec.variant ? `${spec.title} · ${spec.variant}` : spec.title;
}

export const NAMES: Namer = {
  method: (m: MethodId) => METHODS[m].short,
  spec: (id: string) => {
    const s = specById(id);
    return s ? `${specBadge(id).num} ${specTitle(s)}` : id;
  },
};

/** 1e-6 → «10⁻⁶» */
export const pow10 = (v: number) => `10${sup(String(Math.round(Math.log10(v))))}`;

/** Ціле з пробілами: 12 345 */
export const int = (v: number) => Math.round(v).toLocaleString("uk-UA");

/** Компактна вартість: 950, 12 тис., 3.4 млн */
export function costShort(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v < 1e4) return int(v);
  if (v < 1e6) return `${(v / 1e3).toPrecision(v < 1e5 ? 2 : 3)} тис.`;
  return `${(v / 1e6).toPrecision(2)} млн`;
}

export const msShort = (v: number) => (v < 0.1 ? "<0.1 мс" : v < 10 ? `${v.toFixed(1)} мс` : `${Math.round(v)} мс`);

export interface Runner {
  running: boolean;
  progress: ArenaProgress | null;
  /** номер оновлення сховища (для useMemo) */
  version: number;
  done: number;
  total: number;
  start: () => void;
  stop: () => void;
  error: string | null;
  /** настінний час розрахунку цього вибору (без пауз), мс */
  elapsed: number;
}

/**
 * Керування розрахунком: генератор `arenaJobs` виконується порціями по ~40 мс (`runSliced`), стан React оновлюється
 * не частіше ніж раз на ~200 мс. Зупинка лишає генератор призупиненим: «Продовжити» з тим самим вибором продовжує
 * з того самого місця; зі зміненим — стартує новий генератор, а вже пораховане береться з кешу.
 */
export function useArenaRunner(specIds: string[], methods: MethodId[]): Runner {
  const key = specIds.join(",") + "|" + methods.join(",");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ArenaProgress | null>(null);
  const [version, setVersion] = useState(arenaStore.version);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<SliceHandle | null>(null);
  const gen = useRef<{ key: string; g: Generator<ArenaProgress, void, void> } | null>(null);
  const lastUi = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const acc = useRef({ key: "", ms: 0, since: 0 });
  const pauseRef = useRef<() => void>(() => {});
  const sel = useRef({ specIds, methods, key });
  sel.current = { specIds, methods, key };

  const launch = useCallback(() => {
    const { specIds: ids, methods: ms, key: k } = sel.current;
    if (handle.current?.running) return;
    if (!gen.current || gen.current.key !== k) gen.current = { key: k, g: arenaJobs(ids, ms) };
    setError(null);
    setRunning(true);
    lastUi.current = 0;
    if (acc.current.key !== k) acc.current = { key: k, ms: 0, since: 0 };
    acc.current.since = performance.now();
    const pause = () => {
      if (acc.current.since) acc.current.ms += performance.now() - acc.current.since;
      acc.current.since = 0;
      setElapsed(acc.current.ms);
    };
    pauseRef.current = pause;
    handle.current = runSliced(gen.current.g, {
      sliceMs: 40,
      onProgress: (p) => {
        const t = performance.now();
        if (t - lastUi.current < 200) return;
        lastUi.current = t;
        setProgress(p);
        setVersion(arenaStore.version);
        setElapsed(acc.current.ms + (t - acc.current.since));
      },
      onDone: () => {
        pause();
        gen.current = null;
        handle.current = null;
        setRunning(false);
        setProgress(null);
        setVersion(arenaStore.version);
      },
      onError: (e) => {
        pause();
        gen.current = null;
        handle.current = null;
        setRunning(false);
        setError(e instanceof Error ? e.message : String(e));
        setVersion(arenaStore.version);
      },
    });
  }, []);

  const stop = useCallback(() => {
    pauseRef.current();
    handle.current?.stop();
    handle.current = null;
    setRunning(false);
    setVersion(arenaStore.version);
  }, []);

  // selection changed while running: restart with the new selection (computed results come from the cache)
  useEffect(() => {
    if (handle.current?.running) {
      handle.current.stop();
      handle.current = null;
      gen.current = null;
      launch();
    }
  }, [key, launch]);

  useEffect(
    () => () => {
      handle.current?.stop();
    },
    [],
  );

  return {
    running,
    progress,
    version,
    done: arenaDone(specIds, methods),
    total: arenaTotal(specIds, methods),
    start: launch,
    stop,
    error,
    elapsed,
  };
}
