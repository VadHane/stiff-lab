"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OnlySci, Say, useMode } from "@/components/mode/Mode";
import { copyText, downloadText } from "@/components/share/clipboard";
import { Insight, Stat } from "@/components/ui/blocks";
import { Tex } from "@/components/ui/Tex";
import PageHeader from "@/components/variant/PageHeader";
import QuestionCard from "@/components/variant/QuestionCard";
import Rich from "@/components/variant/Rich";
import TaskHead from "@/components/variant/TaskHead";
import { fmtMs } from "@/lib/format";
import { specById } from "@/lib/task-specs";
import { TASKS, taskById } from "@/lib/tasks";
import { codecs, useUrlState } from "@/lib/url-state";
import {
  computeVariants,
  keyNumber,
  makeSet,
  TEMPLATE_IDS,
  TEMPLATES,
  TOL_LEVELS,
  valuesSummary,
  VARIANT_TASKS,
  variantConfigs,
  type TemplateId,
  type VariantOutcome,
} from "@/lib/variants";
import { buildCsv, buildLinks } from "./csv";
import { keyHtml, variantsHtml } from "./print";
import PrintDialog from "./PrintDialog";

const ACCENT = "#a78bfa";
const DEFAULT_TASKS = ["2", "12", "21", "lorenz"];
const MAX_COUNT = 60;
const TOL_INDEX = [0, 1, 2, 3] as const;

const badgeOf = (id: string) => {
  const t = taskById(id);
  return t ? (t.label ?? `№${t.num}`) : id;
};
const tolTex = (tol: number) => `10^{${Math.round(Math.log10(tol))}}`;

/** Адреси сторінки студента з урахуванням basePath (GitHub Pages): беремо шлях поточної сторінки /…/teacher/. */
function variantPageUrl(): string {
  if (typeof window === "undefined") return "/variant/";
  const base = window.location.pathname.replace(/\/teacher\/?$/, "");
  return `${window.location.origin}${base}/variant/`;
}
const urlOf = (code: string) => `${variantPageUrl()}?code=${code}`;

interface Job {
  key: string;
  group: string;
  results: VariantOutcome[];
  ms: number;
}

const chipCls = (on: boolean) =>
  `rounded-full border px-3 py-1 text-[12.5px] transition-all ${
    on ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white shadow-[0_0_18px_-6px_var(--accent)]" : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white"
  }`;
const btnCls =
  "flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/85 transition-all hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 disabled:opacity-40";

/** Сторінка викладача: налаштування → попередній перегляд → генерація всіх варіантів → ключ, друк, CSV, посилання. */
export default function TeacherApp() {
  const { mode } = useMode();
  const [group, setGroup] = useUrlState("g", "", codecs.string);
  const [countRaw, setCount] = useUrlState("n", 30, codecs.int);
  const [tasks, setTasks] = useUrlState<string[]>("t", DEFAULT_TASKS, codecs.strings(VARIANT_TASKS));
  const [templates, setTemplates] = useUrlState<TemplateId[]>("q", [...TEMPLATE_IDS], codecs.strings(TEMPLATE_IDS));
  const [tolLevel, setTolLevel] = useUrlState<number>("tol", 0, codecs.enum(TOL_INDEX));
  const count = Math.max(1, Math.min(MAX_COUNT, Number.isFinite(countRaw) ? countRaw : 30));

  const tasksKey = tasks.join(",");
  const tplKey = templates.join(",");
  const set = useMemo(() => makeSet({ salt: group, tasks, templates, tolLevel }), [group, tasksKey, tplKey, tolLevel]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = set.tasks.length > 0 && set.templates.length > 0;
  const setKey = `${set.salt}|${set.tasks.join(",")}|${set.templates.join("")}|${set.tolLevel}|${count}`;

  // ── preview of one variant (computed automatically, debounced)
  const [previewN, setPreviewN] = useState(1);
  const pn = Math.min(previewN, count);
  const [preview, setPreview] = useState<VariantOutcome | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  useEffect(() => {
    if (!valid) {
      setPreview(null);
      return;
    }
    const signal = { aborted: false };
    setPreviewBusy(true);
    const id = setTimeout(() => {
      computeVariants([{ ...set, n: pn }], { signal }).then((r) => {
        if (signal.aborted) return;
        setPreview(r[0] ?? null);
        setPreviewBusy(false);
      });
    }, 350);
    return () => {
      signal.aborted = true;
      clearTimeout(id);
    };
  }, [set, pn, valid]);

  // ── all variants
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const running = useRef<{ aborted: boolean } | null>(null);
  const generate = useCallback(async () => {
    if (!valid) return;
    if (running.current) running.current.aborted = true;
    const signal = { aborted: false };
    running.current = signal;
    const cfgs = variantConfigs(set, count);
    const start = performance.now();
    setProgress([0, cfgs.length * set.tasks.length]);
    const results = await computeVariants(cfgs, { signal, onProgress: (d, t) => !signal.aborted && setProgress([d, t]) });
    if (signal.aborted) return;
    running.current = null;
    setProgress(null);
    setJob({ key: setKey, group: group.trim(), results, ms: performance.now() - start });
  }, [valid, set, count, setKey, group]);
  const cancel = () => {
    if (running.current) running.current.aborted = true;
    running.current = null;
    setProgress(null);
  };
  useEffect(() => () => void (running.current && (running.current.aborted = true)), []);
  const stale = job !== null && job.key !== setKey;

  // ── actions
  const [dialog, setDialog] = useState<null | { html: string; title: string; fileName: string; hint: string }>(null);
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const [linksText, setLinksText] = useState("");
  const ctx = () => ({ group: job?.group ?? "", urlOf, variantPage: variantPageUrl() });
  const printVariants = () =>
    job &&
    setDialog({
      html: variantsHtml(job.results, ctx()),
      title: `🖨 Варіанти (${job.results.length}) — без відповідей`,
      fileName: "variants.html",
      hint: "Кожен варіант — окрема сторінка: умова, система з параметрами, питання з допусками, код варіанта й адреса самоперевірки. «Друк» → «Зберегти як PDF», щоб надіслати файлом.",
    });
  const printKey = () =>
    job &&
    setDialog({
      html: keyHtml(job.results, ctx()),
      title: "🔑 Ключ відповідей — лише для викладача",
      fileName: "variants-key.html",
      hint: "Відповіді з 7 значущими цифрами, допуски й деталі обчислення (метод і крок для «б», власні числа для «в», «г»).",
    });
  const downloadCsv = () => job && downloadText(`variants${job.group ? "-" + job.group.replace(/[^\p{L}\p{N}]+/gu, "_") : ""}.csv`, buildCsv(job.results, { group: job.group, urlOf }), "text/csv");
  const copyLinks = async () => {
    if (!job) return;
    const text = buildLinks(job.results, urlOf);
    const ok = await copyText(text);
    setCopied(ok ? "ok" : "fail");
    setLinksText(ok ? "" : text);
    setTimeout(() => setCopied(""), 2500);
  };

  const toggleTask = (id: string) => setTasks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const toggleTpl = (id: TemplateId) => setTemplates((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const shownTemplates = (job?.results[0]?.cfg.templates ?? set.templates) as TemplateId[];
  const totals = useMemo(() => {
    if (!job) return null;
    let q = 0;
    // skips per (task, template): in every variant → the template does not apply to the task at all
    const per = new Map<string, { n: number; reasons: Map<string, number> }>();
    for (const v of job.results)
      for (const t of v.tasks) {
        q += t.questions.length;
        for (const k of t.skipped) {
          const id = `${badgeOf(t.taskId)}, «${TEMPLATES[k.template].letter}»`;
          const e = per.get(id) ?? { n: 0, reasons: new Map<string, number>() };
          e.n++;
          const r = k.reason.split(";")[0];
          e.reasons.set(r, (e.reasons.get(r) ?? 0) + 1);
          per.set(id, e);
        }
      }
    const all = job.results.length;
    const never: string[] = [];
    const some: [string, number][] = [];
    let s = 0;
    for (const [id, e] of per) {
      const top = [...e.reasons.entries()].sort((a, b) => b[1] - a[1])[0][0];
      if (e.n === all) never.push(`${id}: ${top}`);
      else {
        s += e.n;
        for (const [r, k] of e.reasons) some.push([`${id}: ${r}`, k]);
      }
    }
    return { q, s, never, some: some.sort((a, b) => b[1] - a[1]) };
  }, [job]);

  return (
    <div style={{ ["--accent" as string]: ACCENT }} className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">
      {dialog && <PrintDialog {...dialog} onClose={() => setDialog(null)} />}
      <PageHeader
        emoji="🧑‍🏫"
        badge="викладач"
        title="Варіанти для викладача"
        tagline={
          <Say simple="Кожен студент отримує свої числа в тих самих задачах. Ви роздаєте коди, студенти перевіряють себе на сайті, а у вас — ключ відповідей.">
            Індивідуальні варіанти з детермінованими кодами: параметри з перевірених діапазонів задач, питання з еталонними відповідями, друк, CSV і посилання
            для самоперевірки.
          </Say>
        }
      />

      <div className="mt-8">
        <Insight tone="warn" title="Чесно про перевірку" simpleTitle="Перевірка на сайті — це самоперевірка">
          <Say
            simple={
              <>
                Сайт працює без сервера, тож відповіді рахуються в браузері студента. Це зручно для самоконтролю, але не захищає від списування: дуже
                наполегливий студент може дістати відповідь із браузера чи порахувати її інструментами сайту. Для оцінки звіряйте відповіді з ключем (CSV чи
                «Друк ключа») і просіть показати розв&apos;язок.
              </>
            }
          >
            <>
              Сайт статичний (GitHub Pages): еталони обчислюються на клієнті з коду варіанта, і сторінка студента звіряє відповідь із ними. Тому перевірка
              там — самоконтроль: технічно підготовлений студент може отримати еталон з консолі браузера або порахувати величину інструментами «Лаб».
              Для оцінювання звіряйте відповіді з ключем (CSV або «Друк ключа») і просіть показати код чи хід розв&apos;язання.
            </>
          </Say>
        </Insight>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* ─────────────── settings */}
        <div className="glass h-fit space-y-5 rounded-2xl p-4 sm:p-5">
          <div>
            <label htmlFor="t-group" className="mb-1.5 block text-[13px] text-white/75">
              Група / семестр («сіль» варіантів)
            </label>
            <input
              id="t-group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="напр. КН-31 весна 2027"
              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-[14px] text-white placeholder:text-white/30 focus:border-[var(--accent)] focus:outline-none"
            />
            <div className="mt-1 text-[11.5px] text-white/45">
              {group.trim()
                ? "Інша назва → інші числа у варіантах. Регістр і зайві пробіли не важливі."
                : "Порожньо: варіанти будуть такими ж, як у всіх, хто теж не ввів назву. Краще вказати групу."}
            </div>
          </div>

          <div>
            <label htmlFor="t-count" className="mb-1.5 flex items-baseline justify-between text-[13px] text-white/75">
              <span>Кількість варіантів</span>
              <span className="font-mono text-[var(--accent)]">{count}</span>
            </label>
            <input
              id="t-count"
              type="range"
              min={1}
              max={MAX_COUNT}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="range w-full"
              style={{ ["--p" as string]: `${((count - 1) / (MAX_COUNT - 1)) * 100}%` }}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[10, 20, 25, 30, 60].map((k) => (
                <button key={k} type="button" onClick={() => setCount(k)} className={chipCls(count === k)}>
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[13px] text-white/75">
              <span>Задачі ({set.tasks.length})</span>
              <button type="button" onClick={() => setTasks(DEFAULT_TASKS)} className="text-[11.5px] text-white/45 hover:text-white">
                типовий набір
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TASKS.filter((t) => VARIANT_TASKS.includes(t.id)).map((t) => (
                <button key={t.id} type="button" onClick={() => toggleTask(t.id)} title={t.title} aria-pressed={tasks.includes(t.id)} className={chipCls(tasks.includes(t.id))}>
                  <span aria-hidden>{t.emoji}</span> {badgeOf(t.id)}
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-[11.5px] leading-relaxed text-white/45">
              {set.tasks.length ? set.tasks.map((id) => `${badgeOf(id)} ${taskById(id)?.title}`).join(" · ") : "Оберіть хоча б одну задачу."}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[13px] text-white/75">Питання</div>
            <div className="space-y-1.5">
              {TEMPLATE_IDS.map((id) => {
                const m = TEMPLATES[id];
                const on = templates.includes(id);
                const tol = m.tol ?? TOL_LEVELS[tolLevel];
                return (
                  <label key={id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-1.5 ${on ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.07]" : "border-white/8"}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleTpl(id)} className="mt-1 accent-[var(--accent)]" />
                    <span className="min-w-0 text-[12.5px] leading-snug text-white/75">
                      <b className="text-white">
                        {m.letter}) {m.title}
                      </b>{" "}
                      <span className="whitespace-nowrap text-white/45">
                        (допуск <Tex>{tolTex(tol)}</Tex>)
                      </span>
                      <br />
                      <span className="text-white/50">{m.about}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[13px] text-white/75">Допуск для «а» і «ґ» (відносна похибка)</div>
            <div className="flex flex-wrap gap-1.5">
              {TOL_INDEX.map((k) => (
                <button key={k} type="button" onClick={() => setTolLevel(k)} className={chipCls(tolLevel === k)}>
                  <Tex>{tolTex(TOL_LEVELS[k])}</Tex>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={generate}
              disabled={!valid || progress !== null}
              className="w-full rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[14px] font-semibold text-black hover:opacity-90 disabled:opacity-40"
            >
              {job && !stale ? "↻ Згенерувати знову" : `Згенерувати ${count} варіант${count % 10 === 1 && count !== 11 ? "" : count % 10 >= 2 && count % 10 <= 4 && (count < 12 || count > 14) ? "и" : "ів"}`}
            </button>
            {!valid && <div className="text-[12px] text-[#ffb547]">Потрібні хоча б одна задача й один тип питань.</div>}
            {progress && (
              <div role="status" aria-live="polite">
                <div className="mb-1 flex justify-between text-[12px] text-white/60">
                  <span>
                    Обчислюємо еталони: {progress[0]} / {progress[1]}
                  </span>
                  <button type="button" onClick={cancel} className="text-white/50 hover:text-white">
                    скасувати
                  </button>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(100 * progress[0]) / Math.max(1, progress[1])}%` }} />
                </div>
              </div>
            )}
            <OnlySci>
              <div className="text-[11.5px] leading-relaxed text-white/45">
                Код варіанта кодує версію генератора, хеш назви групи, задачі, типи питань і допуск; числа задачі залежать лише від групи, номера й задачі.
                Еталон — ROS4 (rtol 10⁻¹⁰), перевірка — DOPRI5 (10⁻¹¹) або ROS4 (10⁻⁸); розбіжність понад 10⁻⁶ — питання не генерується.
              </div>
            </OnlySci>
          </div>
        </div>

        {/* ─────────────── preview */}
        <div className="min-w-0 space-y-4">
          <div className="glass rounded-2xl p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-display mr-auto text-[18px] text-white">Попередній перегляд</h2>
              <label className="flex items-center gap-2 text-[13px] text-white/70">
                варіант №
                <input
                  type="number"
                  min={1}
                  max={count}
                  value={pn}
                  onChange={(e) => setPreviewN(Math.max(1, Math.min(count, Number(e.target.value) || 1)))}
                  className="w-16 rounded-lg border border-white/15 bg-black/30 px-2 py-1 font-mono text-[13px] text-white"
                />
              </label>
              {preview && (
                <a href={urlOf(preview.code)} target="_blank" rel="noopener" className={btnCls}>
                  Відкрити як студент ↗
                </a>
              )}
            </div>
            {!valid ? (
              <div className="text-[13px] text-white/50">Оберіть задачі й питання.</div>
            ) : !preview || previewBusy ? (
              <div className="grid h-40 place-items-center rounded-xl border border-white/10 text-white/40">
                <span className="animate-pulse">Рахуємо варіант №{pn}…</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-white/70">
                  <span>Код:</span>
                  <span className="rounded-lg border border-white/20 bg-black/30 px-2.5 py-1 font-mono text-[15px] tracking-wider text-white">{preview.code}</span>
                  <span className="text-white/45">· еталони за {fmtMs(preview.tasks.reduce((s, t) => s + t.ms, 0))}</span>
                </div>
                {preview.tasks.map((t) => (
                  <div key={t.taskId} className="rounded-xl border border-white/8 p-3 sm:p-4">
                    <TaskHead taskId={t.taskId} specId={t.specId} values={t.values} />
                    <div className="mt-3 space-y-2.5">
                      {t.questions.map((q) => (
                        <QuestionCard key={q.key} q={q} teacher />
                      ))}
                      {t.skipped.map((s) => (
                        <div key={s.template} className="rounded-lg border border-dashed border-white/12 px-3 py-2 text-[12.5px] text-white/50">
                          «{TEMPLATES[s.template].letter}» не згенеровано: {s.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─────────────── results */}
      {job && totals && (
        <section className="mt-10">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--accent)]">Ключ відповідей</div>
          <h2 className="font-display mb-4 text-2xl text-white sm:text-[28px]">Усі варіанти</h2>
          {stale && (
            <div className="mb-4">
              <Insight tone="warn" title="Налаштування змінилися">
                Таблиця нижче — для попередніх налаштувань{job.group ? ` (група «${job.group}»)` : ""}. Натисніть «Згенерувати», щоб оновити ключ, друк і посилання.
              </Insight>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Варіантів" value={job.results.length} sub={job.group || "без назви групи"} />
            <Stat label="Питань" value={totals.q} sub={`у ${job.results[0]?.tasks.length ?? 0} задачах кожного`} />
            <Stat
              label="Пропущено у варіантах"
              value={totals.s}
              tone={totals.s ? "warn" : "good"}
              sub={totals.never.length ? `+ ${totals.never.length} шабл. не підходять до задач` : "усі шаблони підходять"}
            />
            <Stat label="Час" value={fmtMs(job.ms)} sub="у вашому браузері" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={printVariants} className={btnCls}>
              🖨 Друк варіантів
            </button>
            <button type="button" onClick={printKey} className={btnCls}>
              🔑 Друк ключа
            </button>
            <button type="button" onClick={downloadCsv} className={btnCls} title="Таблиця для Excel / LibreOffice: роздільник «;», UTF-8, десяткова кома; рядок = питання варіанта">
              ⬇ Завантажити CSV
            </button>
            <button type="button" onClick={copyLinks} className={btnCls} title="Рядки «Варіант N — код — посилання» для розсилки студентам">
              {copied === "ok" ? "✓ Посилання скопійовано" : copied === "fail" ? "Скопіюйте вручну ↓" : "📋 Скопіювати список посилань"}
            </button>
          </div>
          {linksText && (
            <textarea
              readOnly
              value={linksText}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-3 h-40 w-full rounded-xl border border-white/15 bg-black/40 p-3 font-mono text-[12px] text-white/85"
              aria-label="Список посилань"
            />
          )}
          {(totals.some.length > 0 || totals.never.length > 0) && (
            <details className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[13px] text-white/70">
              <summary className="cursor-pointer text-white/80">Чому деяких питань немає</summary>
              <p className="mt-2 text-[12.5px] text-white/55">
                {mode === "simple"
                  ? "Генератор пропускає питання, на яке не можна дати чесну однозначну відповідь: розв'язок згас чи вже «встановився», метод не дає цікавого результату, власні числа не підходять."
                  : "Пропускаються питання з погано обумовленою або тривіальною відповіддю: |y(T)| < 10⁻⁶·max|y|, значення біля граничного (оцінка Ейткена), різкий фронт, розбіжність еталонів > 10⁻⁶; для «б» — немає кроку, з яким метод стійкий і відрізняється від точного на 0.2–80 %; для «в», «г» — Re λ ≥ 0 або якобіан не залежить від варіанта."}
              </p>
              {totals.never.length > 0 && (
                <>
                  <div className="mt-2 text-[12.5px] font-semibold text-white/75">Шаблон не підходить до задачі (немає в жодному варіанті):</div>
                  <ul className="mt-1 space-y-0.5 text-[12.5px]">
                    {totals.never.map((r) => (
                      <li key={r}>— {r}</li>
                    ))}
                  </ul>
                </>
              )}
              {totals.some.length > 0 && (
                <>
                  <div className="mt-2 text-[12.5px] font-semibold text-white/75">Пропущено в окремих варіантах:</div>
                  <ul className="mt-1 space-y-0.5 text-[12.5px]">
                    {totals.some.slice(0, 12).map(([r, k]) => (
                      <li key={r}>
                        ×{k} — {r}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          )}
          <KeyTable results={job.results} templates={shownTemplates} onPreview={(n) => setPreviewN(n)} />
        </section>
      )}
    </div>
  );
}

function KeyTable({ results, templates, onPreview }: { results: VariantOutcome[]; templates: TemplateId[]; onPreview: (n: number) => void }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-white/8">
      <table className="w-full min-w-[820px] text-left text-[12.5px]">
        <thead className="bg-white/[0.04] text-white/55">
          <tr>
            <th className="px-2.5 py-2 font-medium">№</th>
            <th className="px-2.5 py-2 font-medium">Код</th>
            <th className="min-w-[15rem] px-2.5 py-2 font-medium">Задача й параметри</th>
            {templates.map((t) => (
              <th key={t} className="px-2.5 py-2 font-medium" title={TEMPLATES[t].title}>
                {TEMPLATES[t].letter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((v) => (
            <Fragment key={v.cfg.n}>
              {v.tasks.map((t, i) => {
                const spec = specById(t.specId)!;
                return (
                  <tr key={t.taskId} className={i === 0 ? "border-t border-white/[0.12]" : "border-t border-white/[0.04]"}>
                    {i === 0 && (
                      <>
                        <td rowSpan={v.tasks.length} className="px-2.5 py-1.5 align-top font-mono text-white/85">
                          <button type="button" onClick={() => onPreview(v.cfg.n)} className="hover:text-[var(--accent)]" title="Показати в попередньому перегляді">
                            {v.cfg.n}
                          </button>
                        </td>
                        <td rowSpan={v.tasks.length} className="whitespace-nowrap px-2.5 py-1.5 align-top">
                          <a href={urlOf(v.code)} target="_blank" rel="noopener" className="font-mono text-white/85 hover:text-[var(--accent)]">
                            {v.code}
                          </a>
                        </td>
                      </>
                    )}
                    <td className="px-2.5 py-1.5 align-top text-white/70">
                      <span className="text-white/90">{badgeOf(t.taskId)}</span> <span className="text-white/50">{valuesSummary(spec, t.values)}</span>
                    </td>
                    {templates.map((tp) => {
                      const q = t.questions.find((x) => x.template === tp);
                      const s = t.skipped.find((x) => x.template === tp);
                      return (
                        <td key={tp} className="whitespace-nowrap px-2.5 py-1.5 align-top font-mono text-white/85" title={q ? `${q.details.join(" · ")}` : s?.reason}>
                          {q ? (
                            <>
                              {keyNumber(q.answer)}
                              <div className="font-sans text-[10.5px] text-white/40">
                                <Rich text={q.title} />
                              </div>
                            </>
                          ) : (
                            <span className="text-white/30">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
