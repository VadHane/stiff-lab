/**
 * HTML-документи для друку (iframe, як у «Звіті до лаби»): варіанти — по одному на сторінку, без відповідей;
 * ключ — таблиця відповідей. Формули — MathML з KaTeX (браузер малює їх сам, без шрифтів і CSS KaTeX).
 */
import katex from "katex";
import { specDefsTex, specInitialTex, specParamsTex, specRhsTex } from "@/lib/problem-spec";
import { sup } from "@/lib/format";
import { specById } from "@/lib/task-specs";
import { taskById } from "@/lib/tasks";
import { keyNumber, TEMPLATES, TOL_LEVELS, valuesSummary, type VariantOutcome } from "@/lib/variants";
import { splitTex } from "@/components/variant/rich-text";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mm = (tex: string, display = false) => katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: false, strict: false });
const rich = (s: string) =>
  splitTex(s)
    .map((p) => (p.tex ? mm(p.v) : esc(p.v)))
    .join("");
const tolTex = (tol: number) => `10^{${Math.round(Math.log10(tol))}}`;
const tolText = (tol: number) => `10${sup(String(Math.round(Math.log10(tol))))}`;
/** система рівнянь без фігурної дужки (MathML у браузерах не розтягує її): вирівнювання за «=» */
const systemTex = (lines: string[]) => (lines.length === 1 ? lines[0] : `\\begin{aligned} ${lines.map((l) => l.replace(" = ", " &= ")).join(" \\\\ ")} \\end{aligned}`);
const badgeOf = (taskId: string) => {
  const t = taskById(taskId);
  return t ? (t.label ?? `№${t.num}`) : taskId;
};

export interface PrintContext {
  /** назва групи («сіль»), як її ввів викладач */
  group: string;
  /** повна адреса сторінки варіанта з кодом */
  urlOf: (code: string) => string;
  /** адреса сторінки /variant/ без коду */
  variantPage: string;
}

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 14.5px/1.5 "Times New Roman", Georgia, serif; color: #111; background: #fff; margin: 0; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 24px 24px 60px; }
  .bar { position: sticky; top: 0; background: #fff; padding: 10px 0; display: flex; gap: 8px; justify-content: flex-end; border-bottom: 1px solid #eee; margin-bottom: 10px; }
  .bar button { font: 14px system-ui, sans-serif; padding: 7px 14px; border-radius: 8px; border: 1px solid #999; background: #fafafa; cursor: pointer; }
  .page { break-after: page; page-break-after: always; padding-bottom: 8px; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  header.v { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 6px; }
  h1 { font-size: 21px; margin: 2px 0; }
  h2 { font-size: 16px; margin: 16px 0 2px; }
  .small { font-size: 12px; color: #444; }
  .code { text-align: right; }
  .cv { font: 600 19px/1.2 "Courier New", monospace; letter-spacing: 1px; border: 1.5px solid #111; padding: 4px 8px; border-radius: 4px; white-space: nowrap; }
  .student { margin: 10px 0 4px; font-size: 14px; }
  .line { display: inline-block; min-width: 160px; border-bottom: 1px solid #555; height: 1em; vertical-align: bottom; }
  .line.long { min-width: 300px; }
  .sub { font-size: 13px; color: #444; }
  .sys { margin: 4px 0 2px; overflow-x: auto; }
  math { font-size: 1.06em; }
  math[display="block"] { margin: 3px 0; }
  ul.qs { margin: 6px 0 0; padding-left: 0; list-style: none; }
  ul.qs li { margin: 6px 0 10px; break-inside: avoid; page-break-inside: avoid; }
  .f { margin: 2px 0; overflow-x: auto; font-size: 13px; }
  .ans { margin-top: 4px; }
  .tol { font-size: 12px; color: #444; }
  section.task { break-inside: auto; }
  footer.v { margin-top: 14px; border-top: 1px dashed #999; padding-top: 6px; font-size: 12.5px; color: #333; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 14px; font-size: 12.5px; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  td.num { font-family: "Courier New", monospace; white-space: nowrap; }
  .keyhead { border-bottom: 2px solid #111; margin-bottom: 8px; }
  .warn { border: 1px solid #c9a227; background: #fff8e1; padding: 6px 10px; font-size: 12.5px; margin: 8px 0; }
  .vblock { break-inside: avoid; page-break-inside: avoid; }
  @page { size: A4; margin: 13mm 12mm; }
  @media print { .bar { display: none; } .wrap { padding: 0; max-width: none; } }
`;

function doc(title: string, body: string, fileName: string): string {
  const dl = `(function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html'}));a.download='${esc(fileName)}';a.click();})()`;
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">
<div class="bar"><button onclick="${esc(dl)}">⬇ Завантажити HTML</button><button onclick="window.print()">🖨 Друк / PDF</button></div>
${body}
</div><script>if (window.self !== window.top) document.querySelector(".bar").style.display = "none";</script></body></html>`;
}

function taskHtml(t: VariantOutcome["tasks"][number]): string {
  const spec = specById(t.specId)!;
  const task = taskById(t.taskId);
  const opts = { values: t.values };
  const defs = specDefsTex(spec, opts);
  const parts = [
    mm(systemTex(specRhsTex(spec, opts)), true),
    defs.length ? mm(`\\text{де}\\quad ${defs.join(",\\quad ")}`, true) : "",
    spec.params.length ? mm(specParamsTex(spec, t.values), true) : "",
    mm(specInitialTex(spec, t.values), true),
  ].join("");
  const qs = t.questions
    .map(
      (q) =>
        `<li><b>${TEMPLATES[q.template].letter})</b> ${rich(q.text)}${q.formula ? `<div class="f">${mm(q.formula, true)}</div>` : ""}<div class="ans">Відповідь: <span class="line"></span> <span class="tol">(допуск: відносна похибка ≤ ${mm(tolTex(q.tol))})</span></div></li>`,
    )
    .join("");
  return `<section class="task"><h2>${task ? `${badgeOf(t.taskId)}. ${esc(task.title)}` : esc(t.taskId)}</h2>${spec.variant ? `<div class="sub">${esc(spec.variant)}</div>` : ""}<div class="sys">${parts}</div>${qs ? `<ul class="qs">${qs}</ul>` : `<div class="sub">Питань немає.</div>`}</section>`;
}

/** Аркуші варіантів: умова, система, параметри, питання з допусками, код і адреса самоперевірки. Без відповідей. */
export function variantsHtml(list: VariantOutcome[], c: PrintContext): string {
  const pages = list.map((v) => {
    const tasks = v.tasks.map(taskHtml).join("");
    return `<div class="page">
<header class="v"><div><div class="small">Лабораторна робота · Розділ 12 «Числові методи розв'язування жорстких систем»</div><h1>Індивідуальний варіант №${v.cfg.n}</h1>${c.group ? `<div class="small">${esc(c.group)}</div>` : ""}</div>
<div class="code"><div class="small">Код варіанта</div><div class="cv">${v.code}</div></div></header>
<div class="student">Студент(ка): <span class="line long"></span> &nbsp; Група: <span class="line"></span></div>
${tasks}
<footer class="v">Самоперевірка: <b>${esc(c.urlOf(v.code))}</b> (або сторінка ${esc(c.variantPage)} і код <b>${v.code}</b>). Сайт підкаже, чи відповідь у межах допуску; остаточно відповіді звіряє викладач. Числа можна писати з комою чи крапкою, напр. 1,62e-5.</footer>
</div>`;
  });
  return doc(`Варіанти${c.group ? ` — ${c.group}` : ""}`, pages.join("\n"), "variants.html");
}

/** Ключ відповідей: для кожного варіанта — параметри, відповіді з 7 значущими цифрами, допуски, деталі обчислення. */
export function keyHtml(list: VariantOutcome[], c: PrintContext): string {
  const date = new Date().toLocaleDateString("uk-UA");
  const set = list[0]?.cfg;
  const head = `<div class="keyhead"><div class="small">Лише для викладача · сформовано ${date}</div><h1>Ключ відповідей${c.group ? ` — ${esc(c.group)}` : ""}</h1>
<div class="small">Варіантів: ${list.length}${set ? ` · допуск «а», «ґ»: відносна похибка ≤ ${mm(tolTex(TOL_LEVELS[set.tolLevel]))} · «б»: ${mm("10^{-6}")} · «в»: ${mm("10^{-3}")} · «г»: ${mm("10^{-2}")}` : ""}</div></div>
<div class="warn">Сайт статичний: студентська сторінка перевіряє відповіді у браузері, тому це самоперевірка. Для оцінювання звіряйте відповіді з цим ключем і просіть показати розв'язок.</div>`;
  const blocks = list.map((v) => {
    const rows = v.tasks
      .map((t) => {
        const spec = specById(t.specId)!;
        const qRows = t.questions.map(
          (q) =>
            `<tr><td>${TEMPLATES[q.template].letter}) ${rich(q.title)}</td><td class="num">${esc(keyNumber(q.answer))}</td><td class="num">${tolText(q.tol)}</td><td>${esc(q.details.join(" · "))}</td></tr>`,
        );
        const skip = t.skipped.map((s) => `<tr><td>${TEMPLATES[s.template].letter}) —</td><td colspan="3" class="small">не згенеровано: ${esc(s.reason)}</td></tr>`);
        const n = qRows.length + skip.length;
        const first = `<td rowspan="${Math.max(1, n)}"><b>${badgeOf(t.taskId)}</b> ${esc(taskById(t.taskId)?.title ?? "")}<div class="small">${esc(valuesSummary(spec, t.values))}</div></td>`;
        const all = [...qRows, ...skip];
        if (!all.length) return `<tr>${first}<td colspan="4">—</td></tr>`;
        return all.map((r, i) => (i === 0 ? r.replace("<tr>", `<tr>${first}`) : r)).join("");
      })
      .join("");
    return `<div class="vblock"><h2>Варіант №${v.cfg.n} · <span class="cv" style="font-size:14px">${v.code}</span></h2>
<table><thead><tr><th style="width:30%">Задача і параметри</th><th>Питання</th><th>Відповідь</th><th>Відн. допуск</th><th>Деталі</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  });
  return doc(`Ключ відповідей${c.group ? ` — ${c.group}` : ""}`, head + blocks.join("\n"), "variants-key.html");
}
