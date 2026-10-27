"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CLEAN_TASKS,
  CRITERION_TEXT,
  ERRATA,
  EXTRA_TASK_IDS,
  GENERAL_GAPS,
  GENERAL_RECOMMENDATIONS,
  KIND_META,
  KIND_ORDER,
  LORENZ_NOTES,
  SEVERITY_META,
  SEVERITY_ORDER,
  type Erratum,
  type ErratumKind,
  type Severity,
} from "@/lib/errata";
import { TASKS, type TaskMeta } from "@/lib/tasks";
import { ModeToggle, OnlySci, OnlySimple, Say } from "@/components/mode/Mode";
import { Card, Grid, Insight, Section, Stat } from "@/components/ui/blocks";
import { Chips, Toggle } from "@/components/ui/controls";
import ErrataEntry, { KindBadge, SeverityBadge } from "./ErrataEntry";
import { Rich } from "./rich";
import { badgeOfTask, buildCsv, buildMarkdown, downloadText } from "./export";

const ACCENT = "#ffb547";

/** Print view: no site chrome, filters or animations; light background; every shown entry expanded. */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm 12mm; }
  html, body { background: #fff !important; color: #111 !important; }
  body::before { display: none !important; }
  body > header, body > footer, body > main ~ * { display: none !important; }
  .errata-noprint { display: none !important; }
  .errata-printonly { display: block !important; }
  .errata-details { display: block !important; }
  .errata-root *, .errata-root *::before, .errata-root *::after {
    animation: none !important; transition: none !important;
    color: #111 !important; text-shadow: none !important; box-shadow: none !important;
    backdrop-filter: none !important;
  }
  .errata-root .glass, .errata-root .errata-entry, .errata-root .errata-printed, .errata-root .errata-correct,
  .errata-root .errata-badge, .errata-root table, .errata-root thead { background: #fff !important; }
  .errata-root .glass { border: 1px solid #bbb !important; }
  .errata-root .errata-entry { border: 1px solid #ccc !important; break-inside: avoid; }
  .errata-root .errata-printed { border: 1px solid #d88 !important; }
  .errata-root .errata-correct { border: 1px solid #7b7 !important; }
  .errata-root .errata-task { break-inside: auto; }
  .errata-root .fade-up { opacity: 1 !important; transform: none !important; }
  .errata-root .overflow-x-auto { overflow: visible !important; }
  .errata-root table { min-width: 0 !important; }
  .errata-root .errata-rich, .errata-root .tex-block { overflow: visible !important; }
  .errata-root a { text-decoration: none !important; }
  .errata-root section { margin-top: 18px !important; }
  .errata-root h2 { font-size: 18pt !important; margin-bottom: 8px !important; }
}
.errata-printonly { display: none; }
.errata-rich .tex-block { padding: 4px 0 6px; overflow-y: hidden; }
.errata-rich .katex-display { margin: 0.15em 0; }
`;

const norm = (s: string) => s.toLowerCase().replace(/[’ʼ`]/g, "'").replace(/ё/g, "е");

/** text that the search box matches: every field of the entry plus the task badge, number and title */
const haystack = (e: Erratum, t: TaskMeta | undefined) =>
  norm(
    [
      e.title,
      e.printed,
      e.correct,
      e.why,
      e.impact,
      e.simple,
      e.where,
      KIND_META[e.kind].label,
      SEVERITY_META[e.severity].label,
      t ? `${t.label ?? ""} №${t.num} ${t.num} ${t.title}` : e.taskId,
    ].join(" "),
  );

type KindFilter = ErratumKind | "all";
type SevFilter = Severity | "all";

export default function ErrataClient() {
  const [kind, setKind] = useState<KindFilter>("all");
  const [sev, setSev] = useState<SevFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState(false);

  // ── totals (independent of filters)
  const book = useMemo(() => TASKS.filter((t) => !EXTRA_TASK_IDS.includes(t.id)), []);
  const extra = useMemo(() => TASKS.filter((t) => EXTRA_TASK_IDS.includes(t.id)), []);
  const bookWith = book.filter((t) => ERRATA.some((e) => e.taskId === t.id));
  const bookWithout = book.filter((t) => !ERRATA.some((e) => e.taskId === t.id));
  const countSev = (s: Severity) => ERRATA.filter((e) => e.severity === s).length;
  const extraCount = ERRATA.filter((e) => EXTRA_TASK_IDS.includes(e.taskId)).length;
  const exactTasks = [...new Set(ERRATA.filter((e) => e.kind === "exact").map((e) => e.taskId))];
  const kindCount = (k: ErratumKind) => ERRATA.filter((e) => e.kind === k).length;

  // ── filtering
  const q = norm(query.trim());
  const shown = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    return ERRATA.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      if (sev !== "all" && e.severity !== sev) return false;
      if (words.length) {
        const h = haystack(e, TASKS.find((t) => t.id === e.taskId));
        if (!words.every((w) => h.includes(w))) return false;
      }
      return true;
    });
  }, [kind, sev, q]);
  const filtered = kind !== "all" || sev !== "all" || q.length > 0;
  const selection = filtered
    ? [
        kind !== "all" ? `тип — ${KIND_META[kind].label.toLowerCase()}` : null,
        sev !== "all" ? `важливість — ${SEVERITY_META[sev].label.toLowerCase()}` : null,
        q ? `пошук «${query.trim()}»` : null,
      ]
        .filter(Boolean)
        .join("; ")
    : "усі записи";
  const reset = () => {
    setKind("all");
    setSev("all");
    setQuery("");
  };

  const isOpen = (id: string) => open[id] ?? allOpen;
  const toggleAll = () => {
    setAllOpen(!allOpen);
    setOpen({});
  };

  const exportCsv = () => downloadText("netochnosti-metodychky.csv", buildCsv(shown), "text/csv;charset=utf-8");
  const exportMd = () => downloadText("netochnosti-metodychky.md", buildMarkdown(shown, selection), "text/markdown;charset=utf-8");

  const exportButtons = (
    <div className="errata-noprint flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        title="Друк або збереження в PDF: без навігації й фільтрів, усі показані записи розгорнуті"
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/85 transition-all hover:border-[var(--accent)] hover:bg-[var(--accent)]/15"
      >
        🖨 Друк
      </button>
      <button
        type="button"
        onClick={exportCsv}
        disabled={!shown.length}
        title="Таблиця для Excel / LibreOffice: роздільник «;», кодування UTF-8; формули — TeX"
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/85 transition-all hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 disabled:opacity-40"
      >
        ⬇ Завантажити CSV
      </button>
      <button
        type="button"
        onClick={exportMd}
        disabled={!shown.length}
        title="Markdown для листа чи протоколу: зведена таблиця + подробиці за задачами; формули — TeX у $…$"
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/85 transition-all hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 disabled:opacity-40"
      >
        ⬇ Завантажити Markdown
      </button>
    </div>
  );

  const taskBlock = (t: TaskMeta) => {
    const list = shown.filter((e) => e.taskId === t.id);
    if (!list.length) return null;
    const all = ERRATA.filter((e) => e.taskId === t.id);
    const badge = t.label ?? `№${t.num}`;
    return (
      <div
        key={t.id}
        id={`task-${t.id}`}
        className="errata-task glass scroll-mt-20 rounded-2xl p-3 sm:p-5"
        style={{ ["--accent" as string]: t.accent }}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl">
            <span aria-hidden>{t.emoji}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[12px] text-black">{badge}</span>
              <span className="text-[12px] text-white/45">
                {list.length === all.length ? `${all.length} ${plural(all.length)}` : `показано ${list.length} з ${all.length}`}
              </span>
            </div>
            <h3 className="font-display mt-1.5 text-[17px] leading-snug text-white sm:text-[19px]">{t.title}</h3>
          </div>
          <Link
            href={`/task/${t.id}/`}
            className="errata-noprint ml-auto shrink-0 rounded-full border border-white/12 px-3 py-1 text-[12.5px] text-white/70 hover:border-[var(--accent)] hover:text-white"
          >
            Відкрити задачу →
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {list.map((e) => (
            <ErrataEntry
              key={e.id}
              e={e}
              n={all.indexOf(e) + 1}
              open={isOpen(e.id)}
              onToggle={() => setOpen((o) => ({ ...o, [e.id]: !isOpen(e.id) }))}
            />
          ))}
        </div>
      </div>
    );
  };

  const shownBook = book.filter((t) => shown.some((e) => e.taskId === t.id));
  const shownExtra = extra.filter((t) => shown.some((e) => e.taskId === t.id));

  return (
    <div className="errata-root mx-auto max-w-7xl px-4 pb-10 sm:px-6" style={{ ["--accent" as string]: ACCENT }}>
      <style>{PRINT_CSS}</style>

      {/* ───────────────────────────── шапка */}
      <div className="fade-up pt-10 sm:pt-14">
        <Link href="/" className="errata-noprint text-[13px] text-white/45 hover:text-white">
          ← на головну
        </Link>
        <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-3xl border border-white/10 bg-white/[0.04] text-5xl shadow-[0_0_60px_-20px_var(--accent)]">
            <span className="animate-float" aria-hidden>
              🔍
            </span>
            <span className="font-display absolute -right-2 -top-2 whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[13px] text-black">
              Г.6
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="font-display glow-text text-3xl leading-tight text-white sm:text-[44px]">Неточності методички</h1>
            <p className="mt-2 max-w-3xl text-[16px] text-white/65">
              <Say
                simple={
                  <>
                    У 16 з 18 задач методички знайшлися помилки чи пропуски: десь хибна «правильна відповідь», десь переплутана буква в рівнянні, десь не
                    сказано, скільки часу моделювати. Тут вони всі зібрані — з виправленнями.
                  </>
                }
              >
                <>
                  Розділ «{"12. Числові методи розв'язування жорстких систем"}»: як надруковано → як правильно, як виявлено і що станеться, якщо виконувати
                  умову дослівно. Зведення табл. Г.6 і п. 4.4 наукової роботи.
                </>
              </Say>
            </p>
            <div className="errata-noprint mt-4 flex flex-wrap items-center gap-2">
              <ModeToggle />
              {exportButtons}
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────────── про сторінку */}
      <Section kicker="Про сторінку" title="Що це і для кого" simpleTitle="Навіщо ця сторінка" report={false}>
        <Grid cols={2}>
          <Card title="Для викладача" icon="🧑‍🏫">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Список того, що варто виправити в тексті методички: що надруковано, як має бути і чим це перевірено. Кнопки «CSV» і «Markdown» вивантажують
                  поточну вибірку, щоб вставити в протокол чи лист; «Друк» дає чисту світлу версію.
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Перелік неточностей і специфічних прогалин умов з пропозиціями виправлення (табл. Г.6 додатка Г). Кожен запис містить надрукований і
                правильний варіант, спосіб перевірки (підстановка, нев&apos;язка, показник Ляпунова, звірка з першоджерелом), наслідок дослівного виконання і
                посилання на підрозділ роботи. Вивантаження CSV і Markdown містить поточну вибірку з формулами в TeX.
              </p>
            </Say>
          </Card>
          <Card title="Для студентів" icon="🎓">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Перш ніж звіряти свій розрахунок із «точною відповіддю» з методички або шукати в розв&apos;язку обіцяний хаос, перевірте свою задачу тут.
                  Інакше можна довго шукати помилку в програмі, якої там немає. Сторінки задач у застосунку вже працюють з виправленими формулами.
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Хибна формула-еталон чи хибна модель робить похибку «методу» похибкою формули, а параметри, що не відповідають описаній динаміці, змушують
                шукати режим, якого немає. Сторінки задач застосунку працюють з виправленими формулами й трактуваннями, прийнятими в роботі; посилання «Відкрити
                задачу» веде до них.
              </p>
            </Say>
          </Card>
        </Grid>

        <div className="mt-4">
          <Insight tone="note" title="Критерій «16 з 18»" simpleTitle="Як рахували «16 з 18»" simple={<CriterionSimple without={bookWithout} />}>
            <p>{CRITERION_TEXT}</p>
            <p className="mt-1.5">
              За цим критерієм неточності є в {bookWith.length} з {book.length} задач методички. Без неточностей —{" "}
              {bookWithout.map((t) => `№${t.num}`).join(" і ")}: формули й параметри там правильні, а прогалини лише загальні (див. нижче). Додаткова задача
              викладача ({extra.map((t) => t.label ?? t.title).join(", ")}) до 18 задач методички не входить і рахується окремо.
            </p>
          </Insight>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Задачі з неточностями" value={`${bookWith.length} з ${book.length}`} sub={`без неточностей: ${bookWithout.map((t) => `№${t.num}`).join(", ")}`} tone="warn" />
          <Stat label="Записів усього" value={ERRATA.length} sub={`у т. ч. ${extraCount} — додаткова задача`} />
          <Stat label={SEVERITY_META.critical.plural} value={countSev("critical")} sub="хибні формули й «точні» розв'язки" tone="bad" />
          <Stat label={SEVERITY_META.major.plural} value={countSev("major")} sub="параметри, дані, неоднозначності" tone="warn" />
          <Stat label={SEVERITY_META.minor.plural} value={countSev("minor")} sub="описки, відрізок не задано" />
          <Stat label="Хибні «точні» розв'язки" value={exactTasks.length} sub={exactTasks.map(badgeOfTask).join(", ")} tone="bad" />
        </div>

        <Grid cols={2} className="mt-4">
          <Card title="Важливість" icon="🚦">
            <ul className="space-y-2 text-[13.5px] leading-relaxed text-white/75">
              {SEVERITY_ORDER.map((s) => (
                <li key={s} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                  <span className="shrink-0">
                    <SeverityBadge severity={s} />
                  </span>
                  <span>{SEVERITY_META[s].about}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-white/45">
              Важливість — класифікація цієї сторінки за наслідком для студента, узгоджена з групуванням п. 4.4 роботи «від найсуттєвіших».
            </p>
          </Card>
          <Card title="Типи неточностей" icon="🗂️">
            <ul className="space-y-2 text-[13.5px] leading-relaxed text-white/75">
              {KIND_ORDER.map((k) => (
                <li key={k} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                  <span className="shrink-0">
                    <KindBadge kind={k} />
                  </span>
                  <span>{KIND_META[k].about}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Grid>
      </Section>

      {/* ───────────────────────────── перелік */}
      <Section kicker="Перелік" title="Неточності за задачами" simpleTitle="Що не так у кожній задачі" id="list" report={false}>
        <div className="errata-noprint glass space-y-4 rounded-2xl p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Пошук</span>
              <input
                type="search"
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                placeholder="Пошук: №12, Робертсон, нев'язка, відрізок…"
                className="w-full rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[14px] text-white placeholder:text-white/35 focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Toggle label="Лише критичні" value={sev === "critical"} onChange={(v) => setSev(v ? "critical" : "all")} />
              <Toggle label="Розгорнути всі подробиці" value={allOpen} onChange={toggleAll} />
            </div>
          </div>
          <Chips<SevFilter>
            label="Важливість"
            value={sev}
            onChange={setSev}
            options={[
              { value: "all", label: `Усі · ${ERRATA.length}` },
              ...SEVERITY_ORDER.map((s) => ({ value: s, label: `${SEVERITY_META[s].plural} · ${countSev(s)}`, title: SEVERITY_META[s].about })),
            ]}
          />
          <Chips<KindFilter>
            label="Тип"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "Усі типи" },
              ...KIND_ORDER.map((k) => ({ value: k, label: `${KIND_META[k].icon} ${KIND_META[k].short} · ${kindCount(k)}`, title: KIND_META[k].about })),
            ]}
          />
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-white/55">
            <span>
              Показано <b className="text-white/85">{shown.length}</b> з {ERRATA.length} записів
              {filtered ? ` (${selection})` : ""}
            </span>
            {filtered && (
              <button type="button" onClick={reset} className="text-[var(--accent)] hover:underline">
                скинути фільтри
              </button>
            )}
          </div>
        </div>

        <p className="errata-printonly mb-3 text-[12px]">
          Вибірка: {selection}. Записів: {shown.length}. Джерело: наукова робота, табл. Г.6, п. 4.4, пп. 3.k.2.
        </p>

        {shown.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/10 px-4 py-10 text-center text-white/50">
            Нічого не знайдено.{" "}
            <button type="button" onClick={reset} className="text-[var(--accent)] hover:underline">
              Скинути фільтри
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {shownBook.map(taskBlock)}
            {shownExtra.length > 0 && (
              <>
                <div className="pt-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--accent)]">Поза методичкою</div>
                  <h3 className="font-display text-xl text-white sm:text-2xl">Додаткова задача викладача</h3>
                  <p className="mt-1 max-w-3xl text-[14px] text-white/60">
                    <Say simple={<>Цю задачу викладач дав окремим файлом. У ній ті самі «хвороби»: дві помилки у формулах.</>}>
                      <>
                        Задача з окремого файлу викладача («14.doc»); до критерію «16 з 18» не входить. Умова містить дві помилки у формулах відносно класичної
                        системи Лоренца.
                      </>
                    </Say>
                  </p>
                </div>
                {shownExtra.map(taskBlock)}
                <OnlySci>
                  <Card title="Інші зауваження до умови (не неточності формул)" icon="📝">
                    <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-white/70">
                      {LORENZ_NOTES.map((n) => (
                        <li key={n} className="break-words">
                          <Rich>{n}</Rich>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[12px] text-white/45">Джерело: картка «Неточності умови» сторінки задачі; п. 4.6 стислої версії.</p>
                  </Card>
                </OnlySci>
              </>
            )}
          </div>
        )}
      </Section>

      {/* ───────────────────────────── без неточностей + загальні прогалини */}
      <Section kicker="Для прозорості критерію" title="Задачі без неточностей і загальні прогалини" simpleTitle="Де помилок немає — і що бракує всюди" report={false}>
        <Grid cols={2}>
          {CLEAN_TASKS.map((c) => {
            const t = TASKS.find((x) => x.id === c.taskId);
            if (!t) return null;
            return (
              <div key={c.taskId} className="glass rounded-2xl p-4 sm:p-5" style={{ ["--accent" as string]: t.accent }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xl" aria-hidden>
                    {t.emoji}
                  </span>
                  <span className="font-display rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[12px] text-black">№{t.num}</span>
                  <h3 className="font-display min-w-0 text-[16px] text-white">{t.title}</h3>
                  <Link
                    href={`/task/${t.id}/`}
                    className="errata-noprint ml-auto rounded-full border border-white/12 px-3 py-1 text-[12.5px] text-white/70 hover:border-[var(--accent)] hover:text-white"
                  >
                    Відкрити задачу →
                  </Link>
                </div>
                <div className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-white/75">
                  <p className="break-words">
                    <span className="font-semibold text-[#3ee6a8]">✓ Перевірено: </span>
                    <Rich>{c.checked}</Rich>
                  </p>
                  {c.generalGaps.map((g) => (
                    <p key={g} className="break-words">
                      <span className="font-semibold text-white/90">Загальна прогалина: </span>
                      <Rich>{g}</Rich>
                    </p>
                  ))}
                  {c.recommendation && (
                    <p className="break-words">
                      <span className="font-semibold text-white/90">Рекомендація: </span>
                      <Rich>{c.recommendation}</Rich>
                    </p>
                  )}
                  <p className="text-[12px] text-white/45">Де в роботі: {c.where}</p>
                </div>
              </div>
            );
          })}
        </Grid>

        <Grid cols={2} className="mt-4">
          <Card title="Метод і крок у 18 задачах методички" icon="🧭">
            <OnlySimple>
              <p className="mb-3 text-[13.5px] leading-relaxed text-white/70">
                Це «загальні» пропуски: вони є майже всюди, тому задачу через них не зараховано до «16 з 18». Метод названо лише в трьох задачах, крок — у
                дев&apos;яти.
              </p>
            </OnlySimple>
            <OnlySci>
              <p className="mb-3 text-[13.5px] leading-relaxed text-white/70">
                Загальні прогалини до критерію не входять. Метод названо в {GENERAL_GAPS.methodNamed.length} задачах, крок — у {GENERAL_GAPS.stepGiven.length} (
                {GENERAL_GAPS.where}).
              </p>
            </OnlySci>
            <div className="overflow-x-auto rounded-xl border border-white/8">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-white/[0.04] text-white/55">
                  <tr>
                    <th className="px-3 py-2 font-medium">Задача</th>
                    <th className="px-3 py-2 font-medium">Метод названо</th>
                    <th className="px-3 py-2 font-medium">Крок задано</th>
                    <th className="px-3 py-2 font-medium">Неточності</th>
                  </tr>
                </thead>
                <tbody>
                  {book.map((t) => {
                    const n = ERRATA.filter((e) => e.taskId === t.id).length;
                    return (
                      <tr key={t.id} className="border-t border-white/[0.06]">
                        <td className="whitespace-nowrap px-3 py-1.5 text-white/85">
                          {t.emoji} №{t.num}
                        </td>
                        <td className="px-3 py-1.5">{GENERAL_GAPS.methodNamed.includes(t.id) ? <Yes /> : <No />}</td>
                        <td className="px-3 py-1.5">{GENERAL_GAPS.stepGiven.includes(t.id) ? <Yes /> : <No />}</td>
                        <td className="px-3 py-1.5 font-mono text-white/75">
                          {n ? (
                            <a href={`#task-${t.id}`} className="errata-link hover:underline">
                              {n}
                            </a>
                          ) : (
                            <span className="text-[#3ee6a8]">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Загальні рекомендації для редагування" icon="🛠️">
            <ol className="list-[lower-alpha] space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-white/75">
              {GENERAL_RECOMMENDATIONS.map((r) => (
                <li key={r} className="break-words">
                  <Rich>{r}</Rich>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[12px] text-white/45">Джерело: п. 4.4 (5) роботи.</p>
          </Card>
        </Grid>
      </Section>

      {/* ───────────────────────────── зведена таблиця */}
      <Section kicker="Зведення" title="Зведена таблиця записів" simpleTitle="Усе однією таблицею" id="summary" report={false}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-white/55">
            {shown.length} з {ERRATA.length} записів{filtered ? ` (${selection})` : ""}. Натисніть на назву, щоб перейти до запису.
          </p>
          {exportButtons}
        </div>
        {shown.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="bg-white/[0.04] text-white/55">
                <tr>
                  <th className="px-3 py-2 font-medium">Задача</th>
                  <th className="min-w-[230px] px-3 py-2 font-medium">Неточність</th>
                  <th className="px-3 py-2 font-medium">Важливість</th>
                  <th className="px-3 py-2 font-medium">Тип</th>
                  <th className="px-3 py-2 font-medium">Де в роботі</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-t border-white/[0.06] align-top">
                    <td className="whitespace-nowrap px-3 py-1.5 text-white/85">{badgeOfTask(e.taskId)}</td>
                    <td className="px-3 py-1.5 text-white/85">
                      <a href={`#e-${e.id}`} className="errata-link hover:underline">
                        <Rich>{e.title}</Rich>
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span style={{ color: SEVERITY_META[e.severity].color }}>● </span>
                      <span className="text-white/75">{SEVERITY_META[e.severity].label}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-white/70">
                      {KIND_META[e.kind].icon} {KIND_META[e.kind].short}
                    </td>
                    <td className="px-3 py-1.5 text-[12px] text-white/55">{e.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "запис";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "записи";
  return "записів";
}

const Yes = () => <span className="text-[#3ee6a8]">✓ так</span>;
const No = () => <span className="text-white/40">— ні</span>;

function CriterionSimple({ without }: { without: TaskMeta[] }) {
  return (
    <>
      <p>
        Задачу рахували «з неточністю», якщо в її умові є хоча б одна справжня помилка (хибна формула, переплутана цифра, параметри, за яких не
        відбувається обіцяне) або пропуск, характерний саме для неї (не сказано, скільки часу моделювати, яку функцію взяти, або посилання на задачу, якої
        немає).
      </p>
      <p className="mt-1.5">
        Не задані метод чи крок — це пропуск майже в усіх задачах, тому його не рахували. У {without.map((t) => `№${t.num}`).join(" і ")} формули правильні, і
        бракує лише кроку (і методу), тож ці задачі — без неточностей.
      </p>
    </>
  );
}
