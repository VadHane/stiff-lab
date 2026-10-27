import {
  CLEAN_TASKS,
  CRITERION_TEXT,
  GENERAL_RECOMMENDATIONS,
  KIND_META,
  SEVERITY_META,
  type Erratum,
} from "@/lib/errata";
import { taskById } from "@/lib/tasks";
import { parseRich } from "./rich";

export const METHODICHKA_TITLE = "12. Числові методи розв'язування жорстких систем";

/** «№18» for the numbered tasks, the custom label («Дод. №14») otherwise */
export const badgeOfTask = (taskId: string) => {
  const t = taskById(taskId);
  return t ? (t.label ?? `№${t.num}`) : taskId;
};
export const titleOfTask = (taskId: string) => taskById(taskId)?.title ?? "";

/** `$$…$$` → `$…$`: Markdown renderers and spreadsheets handle inline math more reliably. */
const inlineMath = (s: string) => s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => `$${m.trim()}$`);

// ───────────────────────────────────────────── CSV

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** CSV for spreadsheets: `;` separator (Ukrainian Excel locale), UTF-8 with BOM, CRLF line ends. */
export function buildCsv(entries: Erratum[]): string {
  const head = [
    "Задача",
    "Назва задачі",
    "Тип",
    "Важливість",
    "Неточність",
    "Надруковано в методичці (TeX)",
    "Як правильно (TeX)",
    "Як виявлено",
    "Наслідок дослівного виконання",
    "Де в роботі",
  ];
  const rows = entries.map((e) => [
    badgeOfTask(e.taskId),
    titleOfTask(e.taskId),
    KIND_META[e.kind].label,
    SEVERITY_META[e.severity].label,
    e.title,
    inlineMath(e.printed),
    inlineMath(e.correct),
    e.why,
    e.impact,
    e.where,
  ]);
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

// ───────────────────────────────────────────── Markdown

/** A table cell: pipes are escaped in text and written as `\vert`/`\Vert` inside math, so that the GFM table survives. */
function mdCell(s: string): string {
  return parseRich(inlineMath(s))
    .map((seg) =>
      seg.t === "text"
        ? seg.v.replace(/\|/g, "\\|")
        : `$${seg.v.replace(/\\\|/g, "\\Vert ").replace(/\|/g, "\\vert ")}$`,
    )
    .join("")
    .replace(/\s*\n\s*/g, " ");
}

export function buildMarkdown(entries: Erratum[], selection: string): string {
  const L: string[] = [];
  L.push(`# Неточності методички «${METHODICHKA_TITLE}»`);
  L.push("");
  L.push(
    "Зведення з наукової роботи (табл. Г.6 додатка Г, п. 4.4, підрозділи 3.k.2 «Зауваження щодо умови»; для моделі Лоренца — сторінка задачі й п. 4.6 стислої версії). Формули — TeX у `$…$`; «[…]» — символи, нечитабельні чи втрачені в документі методички.",
  );
  L.push("");
  L.push(`**Критерій «16 з 18».** ${CRITERION_TEXT}`);
  L.push("");
  L.push(`**Вибірка:** ${selection}. **Записів:** ${entries.length}.`);
  L.push("");
  L.push("## Зведена таблиця");
  L.push("");
  L.push("| Задача | Тип | Важливість | Неточність | Надруковано | Правильно | Де в роботі |");
  L.push("|---|---|---|---|---|---|---|");
  for (const e of entries) {
    L.push(
      `| ${mdCell(badgeOfTask(e.taskId))} | ${mdCell(KIND_META[e.kind].label)} | ${SEVERITY_META[e.severity].label} | ${mdCell(e.title)} | ${mdCell(e.printed)} | ${mdCell(e.correct)} | ${mdCell(e.where)} |`,
    );
  }
  L.push("");
  L.push("## Подробиці за задачами");
  let current = "";
  let n = 0;
  for (const e of entries) {
    if (e.taskId !== current) {
      current = e.taskId;
      n = 0;
      L.push("");
      L.push(`### ${badgeOfTask(e.taskId)}. ${titleOfTask(e.taskId)}`);
    }
    n += 1;
    L.push("");
    L.push(`**${n}. ${inlineMath(e.title)}** — ${KIND_META[e.kind].label.toLowerCase()}, ${SEVERITY_META[e.severity].label.toLowerCase()}.`);
    L.push("");
    L.push(`- **Надруковано:** ${inlineMath(e.printed)}`);
    L.push(`- **Правильно:** ${inlineMath(e.correct)}`);
    L.push(`- **Як виявлено:** ${inlineMath(e.why)}`);
    L.push(`- **Наслідок дослівного виконання:** ${inlineMath(e.impact)}`);
    L.push(`- **Де в роботі:** ${e.where}`);
  }
  L.push("");
  L.push("## Задачі без неточностей за критерієм");
  for (const c of CLEAN_TASKS) {
    L.push("");
    L.push(`### ${badgeOfTask(c.taskId)}. ${titleOfTask(c.taskId)}`);
    L.push("");
    L.push(`- **Перевірено:** ${inlineMath(c.checked)}`);
    for (const g of c.generalGaps) L.push(`- **Загальна прогалина:** ${inlineMath(g)}`);
    if (c.recommendation) L.push(`- **Рекомендація:** ${inlineMath(c.recommendation)}`);
    L.push(`- **Де в роботі:** ${c.where}`);
  }
  L.push("");
  L.push("## Загальні рекомендації для редагування методички (п. 4.4)");
  L.push("");
  GENERAL_RECOMMENDATIONS.forEach((r, i) => L.push(`${i + 1}. ${inlineMath(r)}`));
  L.push("");
  return L.join("\n");
}

// ───────────────────────────────────────────── download

export function downloadText(fileName: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
