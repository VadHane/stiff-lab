"use client";

import { useEffect, useRef, useState } from "react";
import { useMode } from "@/components/mode/Mode";
import { currentShareUrl } from "@/lib/url-state";
import { copyText } from "./clipboard";

/** Той самий вигляд, що й «📄 Звіт до лаби» в шапці сторінки задачі. */
export const HEADER_BUTTON_CLASS =
  "flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/85 transition-all hover:border-[var(--accent)] hover:bg-[var(--accent)]/15";

/**
 * Кнопка «🔗 Поділитися»: копіює поточну адресу сторінки разом зі станом (`useUrlState`) у буфер обміну.
 * Якщо буфер недоступний, показує адресу в полі, щоб скопіювати вручну. У режимі «Просто» після копіювання
 * пояснює, що посилання відкриє ту саму картину.
 */
export default function ShareButton({ className, label = "Поділитися" }: { className?: string; label?: string }) {
  const { mode } = useMode();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [url, setUrl] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => {
    if (state === "failed") input.current?.select();
  }, [state]);

  const run = async () => {
    const u = currentShareUrl();
    setUrl(u);
    const ok = await copyText(u);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? (mode === "simple" ? 4500 : 2200) : 12000);
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={run}
        title="Скопіювати посилання на сторінку з усіма поточними параметрами: повзунками, методами, режимами"
        className={className ?? HEADER_BUTTON_CLASS}
        aria-live="polite"
      >
        {state === "copied" ? "✓ Скопійовано!" : `🔗 ${label}`}
      </button>
      {state === "copied" && mode === "simple" && (
        <span
          role="status"
          className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-white/15 bg-[#12152b] p-3 text-[12.5px] leading-snug text-white/80 shadow-xl"
        >
          Посилання в буфері обміну. Хто його відкриє, побачить ту саму картину: ті самі повзунки, методи й графіки.
        </span>
      )}
      {state === "failed" && (
        <span role="dialog" aria-label="Скопіюйте посилання" className="absolute left-0 top-full z-40 mt-2 w-[min(28rem,80vw)] rounded-xl border border-white/15 bg-[#12152b] p-3 shadow-xl">
          <span className="mb-1.5 block text-[12px] text-white/60">Не вдалося скопіювати автоматично — виділіть і скопіюйте (Ctrl+C / ⌘C):</span>
          <input
            ref={input}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-[12px] text-white"
          />
          <button type="button" onClick={() => setState("idle")} className="mt-2 text-[12px] text-white/55 hover:text-white">
            Закрити
          </button>
        </span>
      )}
    </span>
  );
}
