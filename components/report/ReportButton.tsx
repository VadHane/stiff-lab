"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMode } from "@/components/mode/Mode";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Replace KaTeX HTML by its MathML twin (renders natively in browsers, no fonts/CSS needed). */
function mathify(el: Element): string {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(".katex").forEach((k) => {
    const math = k.querySelector("math");
    const span = document.createElement("span");
    if (math) span.appendChild(math.cloneNode(true));
    k.replaceWith(span);
  });
  c.querySelectorAll("svg, button, input, canvas").forEach((n) => n.remove());
  c.querySelectorAll("*").forEach((n) => {
    n.removeAttribute("class");
    n.removeAttribute("style");
  });
  return c.innerHTML;
}

function snapshot(canvas: HTMLCanvasElement): string {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#0d1024";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out.toDataURL("image/png");
}

const MATCH = [
  "[data-report-skip]",
  "h2",
  ".tex-block",
  "[data-report-insight]",
  "[data-report-table]",
  "[data-report-plot]",
  "[data-report-stat]",
  "[data-report-controls]",
  "p",
].join(",");

function collectSection(sec: Element): string {
  const parts: string[] = [];
  let stats: string[] = [];
  const flushStats = () => {
    if (stats.length) parts.push(`<table class="stats"><thead><tr><th>Показник</th><th>Значення</th><th>Примітка</th></tr></thead><tbody>${stats.join("")}</tbody></table>`);
    stats = [];
  };
  const visit = (el: Element) => {
    for (const ch of Array.from(el.children)) {
      if (!ch.matches(MATCH)) {
        visit(ch);
        continue;
      }
      if (ch.matches("[data-report-skip]")) continue;
      if (!ch.matches("[data-report-stat]")) flushStats();
      if (ch.matches("h2")) parts.push(`<h2>${esc(ch.textContent ?? "")}</h2>`);
      else if (ch.matches(".tex-block")) parts.push(`<div class="formula">${mathify(ch)}</div>`);
      else if (ch.matches("[data-report-insight]")) {
        const body = ch.querySelector(":scope > div") ?? ch;
        parts.push(`<div class="insight">${mathify(body)}</div>`);
      } else if (ch.matches("[data-report-table]")) {
        const t = ch.querySelector("table");
        if (t) parts.push(`<table>${mathify(t)}</table>`);
      } else if (ch.matches("[data-report-plot]")) {
        const cv = ch.querySelector("canvas");
        const title = ch.getAttribute("data-plot-title") ?? "";
        const legend = Array.from(ch.querySelectorAll("span > span[style]"))
          .map((sw) => {
            const color = (sw as HTMLElement).style.background || "#888";
            const label = sw.parentElement?.textContent?.trim() ?? "";
            return label ? `<span class="lg"><i style="background:${color}"></i>${esc(label)}</span>` : "";
          })
          .join(" ");
        if (cv && cv.width > 0)
          parts.push(
            `<figure><img src="${snapshot(cv)}" alt="${esc(title)}"/><figcaption>${title ? `<b>${esc(title)}</b>` : ""}${legend ? `<div class="legend">${legend}</div>` : ""}</figcaption></figure>`,
          );
      } else if (ch.matches("[data-report-stat]")) {
        const g = (s: string) => ch.querySelector(s)?.textContent?.trim() ?? "";
        stats.push(`<tr><td>${esc(g("[data-stat-label]"))}</td><td><b>${esc(g("[data-stat-value]"))}</b></td><td>${esc(g("[data-stat-sub]"))}</td></tr>`);
      } else if (ch.matches("[data-report-controls]")) {
        const rows: string[] = [];
        ch.querySelectorAll("[data-param-label]").forEach((lab) => {
          const box = lab.parentElement?.closest("label, div");
          const val = box?.querySelector("[data-param-value]")?.textContent?.trim();
          const multi = Array.from(box?.querySelectorAll("[data-param-multi]") ?? []).map((b) => b.getAttribute("data-param-multi"));
          const v = multi.length ? multi.join(", ") : val;
          if (v) rows.push(`<tr><td>${esc(lab.textContent?.trim() ?? "")}</td><td><b>${esc(v)}</b></td></tr>`);
        });
        if (rows.length) parts.push(`<h3>Параметри розрахунку</h3><table class="params"><tbody>${rows.join("")}</tbody></table>`);
      } else if (ch.matches("p")) {
        const html = mathify(ch).trim();
        if (html) parts.push(`<p>${html}</p>`);
      }
    }
  };
  visit(sec);
  flushStats();
  return parts.join("\n");
}

function buildHtml(num: number, title: string) {
  const root = document.querySelector("[data-task-root]");
  const secs = Array.from(root?.querySelectorAll("[data-report-section]") ?? []).filter((s) => !s.closest("[data-report-skip]"));
  const body = secs.map(collectSection).join("\n<hr/>\n");
  const date = new Date().toLocaleDateString("uk-UA");
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Звіт — задача №${num}</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.55 "Times New Roman", Georgia, serif; color:#111; background:#fff; max-width: 820px; margin: 0 auto; padding: 32px 28px 60px; }
  h1 { font-size: 22px; text-align:center; margin: 6px 0 2px; }
  .sub { text-align:center; color:#444; margin-bottom: 22px; }
  h2 { font-size: 18px; margin: 26px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  h3 { font-size: 15px; margin: 14px 0 6px; }
  .student { display:grid; grid-template-columns: 140px 1fr; gap: 6px 12px; margin: 14px 0 22px; }
  .student input { font: inherit; border: none; border-bottom: 1px dotted #888; padding: 2px 4px; }
  .formula { margin: 8px 0; text-align:center; overflow-x:auto; }
  math { font-size: 1.08em; }
  .insight { border-left: 3px solid #6b7cff; background:#f5f6ff; padding: 6px 12px; margin: 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13.5px; }
  th, td { border: 1px solid #bbb; padding: 4px 8px; text-align:left; vertical-align: top; }
  th { background: #f0f0f0; }
  table.params { width: auto; min-width: 50%; }
  figure { margin: 12px 0; text-align:center; page-break-inside: avoid; }
  figure img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }
  figcaption { font-size: 13px; color:#444; margin-top: 4px; }
  .legend { margin-top: 3px; display:flex; flex-wrap:wrap; gap: 4px 12px; justify-content:center; }
  .lg i { display:inline-block; width: 14px; height: 3px; margin-right: 5px; vertical-align: middle; border-radius: 2px; }
  hr { border: none; border-top: 1px dashed #ccc; margin: 22px 0; }
  textarea { width: 100%; min-height: 140px; font: inherit; border: 1px solid #bbb; padding: 8px; }
  .bar { position: sticky; top: 0; background: #fff; padding: 10px 0; display:flex; gap: 8px; justify-content:flex-end; border-bottom: 1px solid #eee; margin-bottom: 10px; }
  .bar button { font: 14px system-ui, sans-serif; padding: 7px 14px; border-radius: 8px; border: 1px solid #999; background: #fafafa; cursor: pointer; }
  .bar button.primary { background: #111; color: #fff; border-color: #111; }
  @media print { .bar { display:none; } body { padding: 0; } textarea { border: none; } }
  table, .insight, .formula { page-break-inside: avoid; }
</style></head><body>
<div class="bar"><button onclick="(function(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html'}));a.download='zvit-zadacha-${num}.html';a.click();})()">⬇ Завантажити HTML</button><button class="primary" onclick="window.print()">🖨 Друк / зберегти PDF</button></div>
<div style="text-align:center;color:#555">Звіт до лабораторної роботи · Розділ 12 «Числові методи розв'язування жорстких систем»</div>
<h1>Задача №${num}. ${esc(title)}</h1>
<div class="sub">Сформовано ${date}</div>
<div class="student"><span>Студент(ка):</span><input placeholder="ПІБ"/><span>Група:</span><input placeholder="група"/><span>Викладач:</span><input placeholder="ПІБ викладача"/></div>
${body}
<hr/>
<h2>Висновки студента</h2>
<textarea placeholder="Сформулюйте власні висновки: які методи стійкі при заданих кроках, як поводиться похибка, чому…"></textarea>
<script>if (window.self !== window.top) document.querySelector(".bar").style.display = "none";</script>
</body></html>`;
}

export default function ReportButton({ num, title }: { num: number; title: string }) {
  const { mode, setMode } = useMode();
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const run = async () => {
    setBusy(true);
    const prev = mode;
    if (prev !== "sci") setMode("sci");
    await new Promise((r) => setTimeout(r, 300));
    const doc = buildHtml(num, title);
    if (prev !== "sci") setMode(prev);
    setBusy(false);
    setHtml(doc);
  };
  const download = () => {
    if (!html) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `zvit-zadacha-${num}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  useEffect(() => {
    if (!html) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHtml(null);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [html]);
  return (
    <>
      <button
        onClick={run}
        disabled={busy}
        title="Зібрати звіт із поточними параметрами: умова, графіки, таблиці, висновки"
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/85 transition-all hover:border-[var(--accent)] hover:bg-[var(--accent)]/15"
      >
        📄 {busy ? "Збираємо…" : "Звіт до лаби"}
      </button>
      {html &&
        createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-black/75 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-label="Звіт до лабораторної">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 pb-3">
            <div className="font-display mr-auto text-[15px] text-white">📄 Звіт до лабораторної — задача №{num}</div>
            <div className="w-full text-[12px] text-white/55 sm:order-last">
              Заповніть ПІБ і групу, допишіть власні висновки внизу, потім «Друк» → «Зберегти як PDF». Графіки й таблиці — з поточними параметрами сторінки.
            </div>
            <button onClick={() => frame.current?.contentWindow?.print()} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black">
              🖨 Друк / PDF
            </button>
            <button onClick={download} className="rounded-full border border-white/25 px-4 py-1.5 text-[13px] text-white hover:bg-white/10">
              ⬇ HTML
            </button>
            <button onClick={() => setHtml(null)} className="rounded-full border border-white/25 px-3 py-1.5 text-[13px] text-white hover:bg-white/10" aria-label="Закрити">
              ✕
            </button>
          </div>
          <iframe ref={frame} srcDoc={html} title="Звіт" className="mx-auto w-full max-w-5xl flex-1 rounded-xl bg-white" />
        </div>,
          document.body,
        )}
    </>
  );
}
