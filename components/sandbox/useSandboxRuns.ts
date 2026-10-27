"use client";

import { useEffect, useMemo, useState } from "react";
import { isAdaptive, type MethodId, type Problem } from "@/lib/ode";
import { compileSpec, type ProblemSpec } from "@/lib/problem-spec";
import { checkStart, recLimits, recommendFrom, runMethod, type Recommendation, type RunResult } from "@/lib/sandbox-analysis";
import { specKey } from "@/lib/sandbox-spec";

/** Налаштування методів сторінки. */
export interface RunSettings {
  h: number;
  rtol: number;
  maxSteps: number;
  blowup: number;
}

/** Ліміт часу на один метод, мс (і на кожен із двох порівняльних запусків). */
export const RUN_TIME_MS = 1200;
/** Затримка перед стартом обчислень: поки тягнуть повзунок, нічого не рахується «даремно». */
const START_DELAY_MS = 120;

// ------------------------------------------------------------------------------------------------- LRU cache
// weighed by the number of stored solution points: 40 entries × 300 000 steps would otherwise keep ~1 GB alive
const CACHE_MAX_ENTRIES = 40;
const CACHE_MAX_POINTS = 1_500_000;
const cache = new Map<string, { v: unknown; w: number }>();
let cacheWeight = 0;
function cacheGet<T>(k: string): T | undefined {
  const e = cache.get(k);
  if (!e) return undefined;
  cache.delete(k);
  cache.set(k, e);
  return e.v as T;
}
function cacheSet(k: string, v: unknown, w: number) {
  const old = cache.get(k);
  if (old) {
    cacheWeight -= old.w;
    cache.delete(k);
  }
  cache.set(k, { v, w });
  cacheWeight += w;
  while (cache.size > 1 && (cache.size > CACHE_MAX_ENTRIES || cacheWeight > CACHE_MAX_POINTS)) {
    const first = cache.keys().next().value as string;
    cacheWeight -= cache.get(first)!.w;
    cache.delete(first);
  }
}
const weightOf = (r: RunResult) => r.sol.t.length;

/** Наступна макрозадача без затримки: на відміну від setTimeout(0), MessageChannel не гальмується у фонових вкладках. */
function nextTask(fn: () => void): () => void {
  if (typeof MessageChannel === "undefined") {
    const id = setTimeout(fn, 0);
    return () => clearTimeout(id);
  }
  const ch = new MessageChannel();
  let alive = true;
  ch.port1.onmessage = () => {
    ch.port1.close();
    if (alive) fn();
  };
  ch.port2.postMessage(0);
  return () => {
    alive = false;
    ch.port1.close();
  };
}

export interface RunsState {
  key: string;
  /** кількість змінних системи, для якої пораховано (старі результати показуються лише за тієї ж розмірності) */
  n: number;
  runs: Partial<Record<MethodId, RunResult>>;
  rec: Recommendation | null;
  /** результати від попередньої версії системи (показуються приглушено, поки рахується нова) */
  stale: boolean;
  pending: number;
  total: number;
}

export interface SandboxRuns {
  problem: Problem | null;
  compileError: string | null;
  startError: string | null;
  state: RunsState;
}

const EMPTY: RunsState = { key: "", n: 0, runs: {}, rec: null, stale: false, pending: 0, total: 0 };

/**
 * Запускає вибрані методи і порівняльний аналіз (DOPRI vs Розенброк, rtol = 10⁻⁶) по одному за макрозадачу:
 * між методами браузер встигає перемалювати сторінку й обробити введення; кожен метод обмежений `maxSteps` і
 * {@link RUN_TIME_MS}. Результати кешуються (LRU) за вмістом системи і налаштуваннями — повернення до попередньої
 * системи чи методу миттєве. Зміна входу скасовує ще не виконані задачі.
 */
export function useSandboxRuns(spec: ProblemSpec | null, methods: MethodId[], s: RunSettings): SandboxRuns {
  const compiled = useMemo(() => {
    if (!spec) return null;
    try {
      return { problem: compileSpec(spec), key: specKey(spec), vars: spec.vars, error: null as string | null };
    } catch (e) {
      return { problem: null, key: "", vars: spec.vars, error: (e as Error).message };
    }
  }, [spec]);
  const problem = compiled?.problem ?? null;
  const startError = useMemo(() => (problem && compiled ? checkStart(problem, compiled.vars) : null), [problem, compiled]);

  const runKeyOf = (m: MethodId) => `${compiled?.key}|${m}|${isAdaptive(m) ? `r${s.rtol}` : `h${s.h}`}|${s.maxSteps}|${s.blowup}`;
  const allKey = problem && !startError ? `${compiled!.key}|${methods.join(",")}|${s.h}|${s.rtol}|${s.maxSteps}|${s.blowup}` : "";
  const [state, setState] = useState<RunsState>(EMPTY);

  useEffect(() => {
    if (!allKey || !problem || !compiled) return;
    const vars = compiled.vars;
    const n = vars.length;
    let cancelled = false;
    const jobs: (() => void)[] = [];
    const update = (fn: (st: RunsState) => RunsState) => {
      if (!cancelled) setState((st) => (st.key === allKey ? fn(st) : st));
    };
    const runs: Partial<Record<MethodId, RunResult>> = {};
    const missing: MethodId[] = [];
    for (const m of methods) {
      const k = runKeyOf(m);
      const c = cacheGet<RunResult>(k);
      if (c) runs[m] = c;
      else {
        missing.push(m);
        jobs.push(() => {
          const r = runMethod(problem, m, { h: s.h, rtol: s.rtol, maxSteps: s.maxSteps, blowup: s.blowup, timeMs: RUN_TIME_MS }, vars);
          cacheSet(k, r, weightOf(r));
          update((st) => ({ ...st, runs: { ...st.runs, [m]: r } }));
        });
      }
    }
    const recKey = `${compiled.key}|rec`;
    const rec = cacheGet<Recommendation>(recKey) ?? null;
    if (!rec) {
      const lim = recLimits(problem, { timeMs: RUN_TIME_MS });
      let d: RunResult | null = null,
        r: RunResult | null = null;
      jobs.push(() => {
        d = runMethod(problem, "dopri", lim, vars);
      });
      jobs.push(() => {
        r = runMethod(problem, "ros", lim, vars);
      });
      jobs.push(() => {
        if (!d || !r) return;
        const rr = recommendFrom(problem, d, r);
        cacheSet(recKey, rr, weightOf(d) + weightOf(r));
        update((st) => ({ ...st, rec: rr }));
      });
    }
    setState((prev) => {
      const sameDim = prev.n === n;
      const carried: Partial<Record<MethodId, RunResult>> = {};
      if (sameDim) for (const m of missing) if (prev.runs[m]) carried[m] = prev.runs[m];
      return {
        key: allKey,
        n,
        runs: { ...carried, ...runs },
        rec: rec ?? (sameDim ? prev.rec : null),
        stale: jobs.length > 0 && sameDim && (Object.keys(carried).length > 0 || (!rec && !!prev.rec)),
        pending: jobs.length,
        total: jobs.length,
      };
    });
    let cancelNext: (() => void) | null = null;
    const step = () => {
      if (cancelled) return;
      const job = jobs.shift();
      if (!job) return;
      job();
      const left = jobs.length;
      update((st) => ({ ...st, pending: left, stale: left > 0 ? st.stale : false }));
      // yield to the browser (paint, input) between methods
      if (left) cancelNext = nextTask(step);
    };
    const timer = jobs.length ? setTimeout(step, START_DELAY_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelNext?.();
    };
    // allKey captures spec content, methods and settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allKey]);

  return {
    problem,
    compileError: compiled?.error ?? null,
    startError,
    // until the effect has started the new runs, keep the previous results (dimmed) instead of flashing empty plots
    state: !allKey ? EMPTY : state.key === allKey ? state : state.n === compiled?.vars.length && state.key ? { ...state, stale: true, pending: Math.max(state.pending, 1) } : EMPTY,
  };
}
