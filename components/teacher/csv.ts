/**
 * CSV ключа для Excel / LibreOffice: роздільник «;», UTF-8 з BOM, CRLF (як вивантаження «Неточностей методички»),
 * десяткова кома в числах (українська локаль). Один рядок — одне питання одного варіанта; незгенеровані питання
 * теж є (з причиною), щоб таблиця була повною.
 */
import { specById } from "@/lib/task-specs";
import { taskById } from "@/lib/tasks";
import { TEMPLATES, valuesSummary, type VariantOutcome } from "@/lib/variants";
import { plainTex } from "@/components/variant/rich-text";

const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
/** число з 10 значущими цифрами і десятковою комою: 0,8413701234 · 1,623390000e-5 → 1,62339e-5 */
export const csvNumber = (x: number) => {
  const s = String(Number(x.toPrecision(10)));
  return s.replace(".", ",").replace("e+", "e");
};

export function buildCsv(list: VariantOutcome[], o: { group: string; urlOf: (code: string) => string }): string {
  const head = ["Група", "Варіант", "Код", "Посилання", "Задача", "Назва задачі", "Параметри варіанта", "Питання", "Що питають", "Відповідь", "Відносний допуск", "Деталі"];
  const rows: string[][] = [];
  for (const v of list) {
    for (const t of v.tasks) {
      const spec = specById(t.specId)!;
      const task = taskById(t.taskId);
      const base = [o.group, String(v.cfg.n), v.code, o.urlOf(v.code), task ? (task.label ?? `№${task.num}`) : t.taskId, task?.title ?? "", valuesSummary(spec, t.values)];
      for (const q of t.questions)
        rows.push([...base, TEMPLATES[q.template].letter, plainTex(q.title), csvNumber(q.answer), csvNumber(q.tol), q.details.join(" · ")]);
      for (const s of t.skipped) rows.push([...base, TEMPLATES[s.template].letter, "не згенеровано", "", "", s.reason]);
    }
  }
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Список посилань для розсилки: «Варіант 1 — КОД — адреса» по рядку. */
export function buildLinks(list: VariantOutcome[], urlOf: (code: string) => string): string {
  return list.map((v) => `Варіант ${v.cfg.n}\t${v.code}\t${urlOf(v.code)}`).join("\n");
}
