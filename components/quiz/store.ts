"use client";

import { useEffect, useState } from "react";

const KEY = "stifflab.quiz";
const TOTALS = "stifflab.quizTotals";
const EVT = "stifflab-quiz";

export interface Answer {
  chosen: number;
  ok: boolean;
}

type Store = Record<string, Answer>;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

export function saveAnswer(taskId: string, qid: string, a: Answer | null) {
  const s = read<Store>(KEY, {});
  const k = `${taskId}:${qid}`;
  if (a) s[k] = a;
  else delete s[k];
  write(KEY, s);
}

export function registerTotal(taskId: string, n: number) {
  const t = read<Record<string, number>>(TOTALS, {});
  if (t[taskId] !== n) {
    t[taskId] = n;
    write(TOTALS, t);
  }
}

export function useQuizStore() {
  const [state, setState] = useState<{ answers: Store; totals: Record<string, number> }>({ answers: {}, totals: {} });
  useEffect(() => {
    const load = () => setState({ answers: read<Store>(KEY, {}), totals: read<Record<string, number>>(TOTALS, {}) });
    load();
    window.addEventListener(EVT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVT, load);
      window.removeEventListener("storage", load);
    };
  }, []);
  return state;
}

export function taskScore(answers: Store, taskId: string) {
  let ok = 0,
    done = 0;
  for (const [k, a] of Object.entries(answers)) {
    if (!k.startsWith(taskId + ":")) continue;
    done++;
    if (a.ok) ok++;
  }
  return { ok, done };
}
