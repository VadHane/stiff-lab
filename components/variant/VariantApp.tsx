"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Say } from "@/components/mode/Mode";
import CodeExportButton from "@/components/share/CodeExportButton";
import ShareButton from "@/components/share/ShareButton";
import { Insight } from "@/components/ui/blocks";
import { Tex } from "@/components/ui/Tex";
import { specById } from "@/lib/task-specs";
import { codecs, useUrlState } from "@/lib/url-state";
import {
  checkAnswer,
  computeVariants,
  decodeVariantCode,
  parseAnswer,
  starterCodeOptions,
  TEMPLATES,
  TOL_LEVELS,
  type TaskOutcome,
} from "@/lib/variants";
import PageHeader from "./PageHeader";
import QuestionCard, { type QResult } from "./QuestionCard";
import TaskHead from "./TaskHead";

const ACCENT = "#4de2c5";
const STORE_PREFIX = "stifflab.variant.";

/** Збережене в браузері для одного коду: введені відповіді, невдалі спроби, останні перевірені значення. */
interface Saved {
  answers: Record<string, string>;
  attempts: Record<string, number>;
  checked: Record<string, string>;
}
const EMPTY: Saved = { answers: {}, attempts: {}, checked: {} };
const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, never>) : {});

function loadSaved(code: string): Saved {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + code);
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return { answers: obj(o.answers), attempts: obj(o.attempts), checked: obj(o.checked) };
    }
  } catch {
    // private mode / blocked storage / broken JSON — start clean
  }
  return EMPTY;
}
function storeSaved(code: string, s: Saved) {
  try {
    localStorage.setItem(STORE_PREFIX + code, JSON.stringify({ ...s, savedAt: new Date().toISOString() }));
  } catch {
    // storage unavailable: answers live only until the page is closed
  }
}

const tolTex = (tol: number) => `10^{${Math.round(Math.log10(tol))}}`;

/** Сторінка студента: код варіанта → задачі й питання → перевірка відповідей. */
export default function VariantApp() {
  const [code, setCode] = useUrlState("code", "", codecs.string);
  const [input, setInput] = useState(code);
  const [inputError, setInputError] = useState("");
  const decoded = useMemo(() => (code ? decodeVariantCode(code) : null), [code]);
  const cfg = decoded?.ok ? decoded.cfg : null;
  const canonical = decoded?.ok ? decoded.code : "";

  // the address may carry a non-canonical code (lowercase, no dashes): show and keep the canonical one
  useEffect(() => {
    if (decoded?.ok && decoded.code !== code) setCode(decoded.code);
    if (decoded?.ok) setInput(decoded.code);
  }, [decoded, code, setCode]);

  const [tasks, setTasks] = useState<TaskOutcome[] | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!cfg) {
      setTasks(null);
      setProgress(null);
      return;
    }
    const signal = { aborted: false };
    setTasks(null);
    setProgress([0, cfg.tasks.length]);
    computeVariants([cfg], { signal, onProgress: (d, t) => !signal.aborted && setProgress([d, t]) }).then((res) => {
      if (signal.aborted) return;
      setTasks(res[0]?.tasks ?? []);
      setProgress(null);
    });
    return () => {
      signal.aborted = true;
    };
    // cfg is derived from the canonical code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical]);

  // answers in localStorage, per code
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [results, setResults] = useState<Record<string, QResult>>({});
  const loadedFor = useRef("");
  useEffect(() => {
    if (!canonical) return;
    setSaved(loadSaved(canonical));
    setResults({});
    loadedFor.current = canonical;
  }, [canonical]);
  useEffect(() => {
    if (!canonical || loadedFor.current !== canonical) return;
    const id = setTimeout(() => storeSaved(canonical, saved), 250);
    return () => clearTimeout(id);
  }, [saved, canonical]);

  const questions = useMemo(() => tasks?.flatMap((t) => t.questions) ?? [], [tasks]);

  /** результат для одного питання (attempts не змінює) */
  const evaluate = (key: string, raw: string): { r: QResult; correct?: boolean } => {
    const q = questions.find((x) => x.key === key)!;
    if (!raw.trim()) return { r: { status: "empty" } };
    const p = parseAnswer(raw);
    if (!p.ok) return { r: { status: "invalid", error: p.error } };
    const c = checkAnswer(q, p.value);
    return { r: { status: c.correct ? "ok" : "bad", relDev: c.relDev, direction: c.direction }, correct: c.correct };
  };

  // after a reload: show the results of answers that were already checked (without counting new attempts)
  useEffect(() => {
    if (!tasks || !canonical) return;
    const res: Record<string, QResult> = {};
    for (const q of questions) {
      const raw = saved.answers[q.key] ?? "";
      if (raw.trim() && saved.checked[q.key] === raw.trim()) res[q.key] = evaluate(q.key, raw).r;
    }
    setResults(res);
    // only when the questions appear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const checkAll = () => {
    const res: Record<string, QResult> = {};
    const attempts = { ...saved.attempts };
    const checked = { ...saved.checked };
    for (const q of questions) {
      const raw = (saved.answers[q.key] ?? "").trim();
      const { r, correct } = evaluate(q.key, raw);
      res[q.key] = r;
      if (r.status === "ok" || r.status === "bad") {
        if (!correct && checked[q.key] !== raw) attempts[q.key] = (attempts[q.key] ?? 0) + 1;
        checked[q.key] = raw;
      }
    }
    setResults(res);
    setSaved((s) => ({ ...s, attempts, checked }));
  };

  const setAnswer = (key: string, v: string) => {
    setSaved((s) => ({ ...s, answers: { ...s.answers, [key]: v } }));
    setResults((r) => {
      if (!r[key]) return r;
      const next = { ...r };
      delete next[key];
      return next;
    });
  };

  const resetAll = () => {
    if (!window.confirm("Стерти всі введені відповіді й лічильники спроб для цього варіанта?")) return;
    setSaved(EMPTY);
    setResults({});
  };

  const open = () => {
    const d = decodeVariantCode(input);
    if (d.ok) {
      setInputError("");
      setCode(d.code);
      setInput(d.code);
    } else setInputError(d.error);
  };

  const okCount = questions.filter((q) => results[q.key]?.status === "ok").length;
  const answered = questions.filter((q) => (saved.answers[q.key] ?? "").trim()).length;
  const urlError = decoded && !decoded.ok ? decoded.error : "";
  const err = inputError || urlError;

  return (
    <div style={{ ["--accent" as string]: ACCENT }} className="mx-auto max-w-5xl px-4 pb-10 sm:px-6">
      <PageHeader
        emoji="🎫"
        badge="студент"
        title="Мій варіант"
        tagline={
          <Say simple="Введіть код від викладача — побачите свої задачі з особистими числами і зможете перевірити відповіді.">
            Індивідуальний варіант за кодом: системи з вашими параметрами, питання з допусками й автоматична перевірка відповідей.
          </Say>
        }
      >
        {cfg && <ShareButton label="Посилання на варіант" />}
      </PageHeader>

      <div className="glass mt-8 rounded-2xl p-4 sm:p-5">
        <label htmlFor="variant-code" className="mb-2 block text-[13px] text-white/70">
          Код варіанта
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="variant-code"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setInputError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && open()}
            placeholder="XXXX-XXXX-XXXX-NN"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-[16px] uppercase tracking-wider text-white placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none sm:max-w-sm"
          />
          <button type="button" onClick={open} className="rounded-xl bg-white px-4 py-2 text-[14px] font-semibold text-black hover:opacity-90">
            Відкрити
          </button>
        </div>
        {err && (
          <div className="mt-2 rounded-lg border border-[#ff5d73]/35 bg-[#ff5d73]/[0.08] px-3 py-2 text-[13px] text-white/85" role="alert">
            {err}
          </div>
        )}
        {!code && !err && (
          <p className="mt-2 text-[12.5px] text-white/45">
            Код надруковано на аркуші з варіантом або надіслано посиланням. Регістр, пробіли й дефіси не важливі; літери O, I, L читаються як 0 і 1.
          </p>
        )}
        {cfg && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[12.5px]">
            <span className="font-display rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-black">Варіант №{cfg.n}</span>
            <span className="rounded-full border border-white/12 px-2.5 py-0.5 text-white/70">задач: {cfg.tasks.length}</span>
            <span className="rounded-full border border-white/12 px-2.5 py-0.5 text-white/70">
              питання: {cfg.templates.map((t) => TEMPLATES[t].letter).join(", ")}
            </span>
            <span className="rounded-full border border-white/12 px-2.5 py-0.5 text-white/70">
              допуск «а», «ґ»: <Tex>{tolTex(TOL_LEVELS[cfg.tolLevel])}</Tex>
            </span>
          </div>
        )}
      </div>

      {cfg && (
        <div className="mt-4">
          <Insight tone="note" title="Як працює перевірка" simpleTitle="Це самоперевірка">
            <Say
              simple={
                <>
                  Сайт підкаже, чи відповідь у межах допуску і наскільки вона відхиляється, — але саму правильну відповідь не показує. Остаточно відповіді
                  звіряє викладач, тож зберігайте свій код і розрахунки.
                </>
              }
            >
              <>
                Еталони рахуються у вашому браузері з коду варіанта (метод Розенброка 4-го порядку з rtol = 10⁻¹⁰ і незалежна перевірка), тому перевірка тут —
                самоконтроль, а не залік: оцінку ставить викладач за ключем і вашим розв&apos;язком. Відхилення показано наближено (1 значуща цифра), після трьох
                невдалих спроб — ще й напрям помилки.
              </>
            </Say>
          </Insight>
        </div>
      )}

      {progress && (
        <div className="glass mt-6 rounded-2xl p-5" role="status" aria-live="polite">
          <div className="mb-2 text-[14px] text-white/75">
            Готуємо варіант: обчислюємо еталонні відповіді… {progress[0]} / {progress[1]} задач
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(100 * progress[0]) / Math.max(1, progress[1])}%` }} />
          </div>
        </div>
      )}

      {tasks && cfg && (
        <div className="mt-6 space-y-6">
          {tasks.map((t) => {
            const spec = specById(t.specId)!;
            const starter = starterCodeOptions(spec, t.values, t.questions);
            return (
              <section key={t.taskId} className="glass rounded-2xl p-4 sm:p-5" aria-label={`Задача ${t.taskId}`}>
                <TaskHead
                  taskId={t.taskId}
                  specId={t.specId}
                  values={t.values}
                  actions={
                    <CodeExportButton
                      spec={spec}
                      values={{ params: t.values.params, y0: t.values.y0, T: t.values.T }}
                      methods={starter.methods}
                      opts={{ h: starter.h, rtol: starter.rtol, atol: starter.atol }}
                      label="Стартовий код Python / MATLAB"
                    />
                  }
                />
                <div className="mt-4 space-y-3">
                  {t.questions.map((q) => (
                    <QuestionCard
                      key={q.key}
                      q={q}
                      value={saved.answers[q.key] ?? ""}
                      onChange={(v) => setAnswer(q.key, v)}
                      onSubmit={checkAll}
                      result={results[q.key]}
                      attempts={saved.attempts[q.key] ?? 0}
                    />
                  ))}
                  {t.questions.length === 0 && <div className="text-[13px] text-white/50">Для цієї задачі у варіанті немає питань.</div>}
                </div>
              </section>
            );
          })}

          <div className="sticky bottom-3 z-30">
            <div className="glass flex flex-wrap items-center gap-3 rounded-2xl border-white/15 bg-[#0b0e22]/90 p-3 sm:p-4">
              <button type="button" onClick={checkAll} disabled={!questions.length} className="rounded-xl bg-[var(--accent)] px-5 py-2 text-[14px] font-semibold text-black hover:opacity-90 disabled:opacity-40">
                ✓ Перевірити
              </button>
              <div className="min-w-[10rem] flex-1 text-[14px] text-white/80" aria-live="polite">
                {Object.keys(results).length ? (
                  <>
                    Правильно <b className="text-white">{okCount}</b> з {questions.length}
                    {okCount === questions.length && questions.length > 0 && " 🎉"}
                  </>
                ) : (
                  <span className="text-white/50">
                    Відповідей: {answered} з {questions.length}. Enter у полі — теж перевірка.
                  </span>
                )}
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#3ee6a8] transition-all" style={{ width: `${(100 * okCount) / Math.max(1, questions.length)}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 text-center text-[12px] text-white/40">
            <span>Відповіді зберігаються лише в цьому браузері (localStorage) — для іншого пристрою перепишіть їх.</span>
            <button type="button" onClick={resetAll} className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/60 hover:text-white">
              Стерти відповіді
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
