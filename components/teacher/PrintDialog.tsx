"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { downloadText } from "@/components/share/clipboard";

/** Модальне вікно з HTML-документом у iframe: «Друк / PDF», «Завантажити HTML», ✕ / Esc (як «Звіт до лаби»). */
export default function PrintDialog({ html, title, fileName, hint, onClose }: { html: string; title: string; fileName: string; hint: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/75 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 pb-3">
        <div className="font-display mr-auto text-[15px] text-white">{title}</div>
        <button type="button" onClick={() => frame.current?.contentWindow?.print()} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black">
          🖨 Друк / PDF
        </button>
        <button type="button" onClick={() => downloadText(fileName, html, "text/html")} className="rounded-full border border-white/25 px-4 py-1.5 text-[13px] text-white hover:bg-white/10">
          ⬇ HTML
        </button>
        <button ref={closeBtn} type="button" onClick={onClose} className="rounded-full border border-white/25 px-3 py-1.5 text-[13px] text-white hover:bg-white/10" aria-label="Закрити">
          ✕
        </button>
        <div className="w-full text-[12px] text-white/55 sm:order-last">{hint}</div>
      </div>
      <iframe ref={frame} srcDoc={html} title={title} className="mx-auto w-full max-w-5xl flex-1 rounded-xl bg-white" />
    </div>,
    document.body,
  );
}
