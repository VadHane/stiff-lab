"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMode } from "@/components/mode/Mode";
import { scriptFileName, toMatlabScript, toPythonScript, type CodeLang, type CodegenOptions } from "@/lib/codegen";
import type { MethodId } from "@/lib/ode";
import type { ProblemSpec, SpecValues } from "@/lib/problem-spec";
import { currentShareUrl } from "@/lib/url-state";
import { copyText, downloadText } from "./clipboard";
import { highlight, TOKEN_CLASS } from "./highlight";
import { HEADER_BUTTON_CLASS } from "./ShareButton";

const LANGS: { id: CodeLang; label: string; ext: string; mime: string }[] = [
  { id: "python", label: "Python", ext: ".py", mime: "text/x-python" },
  { id: "matlab", label: "MATLAB / Octave", ext: ".m", mime: "text/x-matlab" },
];

/**
 * Кнопка «🐍 Код Python / MATLAB»: модальне вікно (портал у `document.body`, закриття Esc / ✕ / клік по тлу) з
 * вкладками Python | MATLAB, підсвіченим кодом, «Копіювати» і «Завантажити .py/.m». Код генерується при
 * відкритті з поточних параметрів (`lib/codegen.ts`) і містить посилання на сторінку з тим самим станом.
 *
 * @param spec     задача (див. `lib/task-specs.ts`)
 * @param values   поточні значення параметрів / початкових умов / T сторінки
 * @param methods  вибрані на сторінці методи
 * @param opts     крок і допуски, з якими рахує сторінка (`h`, `rtol`, `atol`; також `T`, `theta`, `blowup`, `maxSteps`)
 */
export default function CodeExportButton({
  spec,
  values,
  methods,
  opts,
  className,
  label = "Код Python / MATLAB",
}: {
  spec: ProblemSpec;
  values?: SpecValues;
  methods: MethodId[];
  opts?: Omit<CodegenOptions, "sourceUrl">;
  className?: string;
  label?: string;
}) {
  const { mode } = useMode();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<CodeLang>("python");
  const [sourceUrl, setSourceUrl] = useState("");
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const closeBtn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // props are often fresh objects on every render: key the memo by content
  const key = JSON.stringify([spec.id, values ?? null, methods, opts ?? null, sourceUrl, lang]);
  const result = useMemo(() => {
    if (!open) return null;
    try {
      const o = { ...opts, sourceUrl: sourceUrl || undefined };
      const code = lang === "python" ? toPythonScript(spec, values, methods, o) : toMatlabScript(spec, values, methods, o);
      return { code, error: "" };
    } catch (e) {
      return { code: "", error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);
  const tokens = useMemo(() => (result?.code ? highlight(result.code, lang) : []), [result, lang]);
  const meta = LANGS.find((l) => l.id === lang)!;
  const fileName = scriptFileName(spec, lang);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const openModal = () => {
    setSourceUrl(currentShareUrl());
    setCopied("");
    setOpen(true);
  };
  const copy = async () => {
    if (!result?.code) return;
    const ok = await copyText(result.code);
    setCopied(ok ? "ok" : "fail");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 2200);
  };
  const lines = result?.code ? result.code.split("\n").length : 0;

  return (
    <>
      <button type="button" onClick={openModal} title="Згенерувати самодостатній скрипт Python або MATLAB з поточними параметрами" className={className ?? HEADER_BUTTON_CLASS}>
        🐍 {label}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col bg-black/75 p-3 backdrop-blur-sm sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Код Python / MATLAB"
            onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 pb-3">
              <div className="font-display mr-auto text-[15px] text-white">🐍 Код задачі — {spec.variant ? `${spec.title} (${spec.variant})` : spec.title}</div>
              <div className="flex items-center rounded-full border border-white/15 bg-white/[0.04] p-0.5" role="tablist">
                {LANGS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="tab"
                    aria-selected={lang === l.id}
                    onClick={() => setLang(l.id)}
                    className={`rounded-full px-3 py-1 text-[12.5px] transition-all ${lang === l.id ? "bg-white text-black" : "text-white/65 hover:text-white"}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={copy} disabled={!result?.code} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50">
                {copied === "ok" ? "✓ Скопійовано" : copied === "fail" ? "Не вдалося скопіювати" : "📋 Копіювати"}
              </button>
              <button
                type="button"
                onClick={() => result?.code && downloadText(fileName, result.code, meta.mime)}
                disabled={!result?.code}
                className="rounded-full border border-white/25 px-4 py-1.5 text-[13px] text-white hover:bg-white/10 disabled:opacity-50"
              >
                ⬇ {meta.ext}
              </button>
              <button ref={closeBtn} type="button" onClick={() => setOpen(false)} className="rounded-full border border-white/25 px-3 py-1.5 text-[13px] text-white hover:bg-white/10" aria-label="Закрити">
                ✕
              </button>
              <div className="w-full text-[12px] text-white/55 sm:order-last">
                {mode === "simple"
                  ? "Цей код повторює розрахунок сторінки: збережіть файл і запустіть у Python або MATLAB — отримаєте ті самі числа й графіки."
                  : lang === "python"
                    ? `Файл ${fileName} · ${lines} рядків · numpy + matplotlib${methods.includes("dopri") ? " + scipy (RK45)" : ""}. Методи зі сталим кроком, Розенброк 2(3) і θ-адаптивний записано вручну як у ядрі «Лаб» — y(T) збігається до округлення.`
                    : `Файл ${fileName} · ${lines} рядків · MATLAB R2016b+ / GNU Octave 7+. DOPRI → ode45, Розенброк → ode23s; методи зі сталим кроком і θ-адаптивний — вручну, як у ядрі «Лаб».`}
              </div>
            </div>
            <div className="mx-auto w-full max-w-5xl flex-1 overflow-auto rounded-xl border border-white/10 bg-[#0a0d1f]">
              {result?.error ? (
                <div className="p-4 text-[13px] text-[#ff8a9a]">Не вдалося згенерувати код: {result.error}</div>
              ) : (
                <pre className="min-w-max p-4 font-mono text-[12.5px] leading-[1.55] text-white/85" aria-label={`Код ${meta.label}`}>
                  <code>
                    {tokens.map((t, i) =>
                      t.kind === "plain" ? (
                        t.text
                      ) : (
                        <span key={i} className={TOKEN_CLASS[t.kind]}>
                          {t.text}
                        </span>
                      ),
                    )}
                  </code>
                </pre>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
