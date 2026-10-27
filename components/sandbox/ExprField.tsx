"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

/** Однакова геометрія тексту для поля і «дзеркала» з підсвіткою (інакше підсвітка з'їде). */
const BOX =
  "rounded-lg border px-2.5 py-1.5 font-mono text-[13.5px] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere] [tab-size:2]";

export interface FieldError {
  message: string;
  pos?: number;
  end?: number;
}

/**
 * Поле для виразу (права частина, допоміжна величина): моноширинний шрифт, автоматична висота (довгий вираз
 * переноситься), підсвітка помилки в діапазоні [pos, end) і текст помилки під полем. Підсвітка — «дзеркало»
 * під прозорим `<textarea>` з тією самою геометрією тексту.
 *
 * @param error    помилка для ПОТОЧНОГО тексту (застарілу, поки користувач друкує, не передавайте)
 */
export default function ExprField({
  value,
  onChange,
  error,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: FieldError | null;
  /** доступна назва поля, напр. «Права частина для x′» */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasPos = !!error && error.pos !== undefined && error.pos >= 0;
  const a = hasPos ? Math.min(error!.pos!, value.length) : 0;
  const b = hasPos ? Math.min(Math.max(error!.end ?? a + 1, a + 1), value.length) : 0;
  const before = hasPos ? value.slice(0, a) : value;
  const mid = hasPos ? value.slice(a, b) : "";
  const after = hasPos ? value.slice(b) : "";

  return (
    <div className={`min-w-0 ${className ?? ""}`}>
      <div className="relative">
        <div aria-hidden className={`${BOX} pointer-events-none absolute inset-0 select-none overflow-hidden border-transparent bg-black/30 text-transparent`}>
          {before}
          {hasPos && <mark className="rounded-[3px] bg-[#ff5d73]/45 text-transparent shadow-[0_2px_0_#ff5d73]">{mid || " "}</mark>}
          {after}
          {"​"}
        </div>
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-label={label}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          placeholder={placeholder}
          className={`${BOX} relative block w-full resize-none overflow-hidden bg-transparent text-white caret-white outline-none placeholder:text-white/25 focus:border-[var(--accent)] ${
            error ? "border-[#ff5d73]/70" : "border-white/12"
          }`}
        />
      </div>
      {error && (
        <div id={`${id}-err`} role="alert" className="mt-1 text-[12px] leading-snug text-[#ff8a9a]">
          {error.message}
        </div>
      )}
    </div>
  );
}

/** Коротке поле для числа / імені. */
export function SmallField({
  value,
  onChange,
  label,
  invalid,
  mono = true,
  className,
  placeholder,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  invalid?: boolean;
  mono?: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={title ?? label}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      className={`min-w-0 rounded-lg border bg-black/30 px-2 py-1.5 text-[13.5px] text-white outline-none placeholder:text-white/25 focus:border-[var(--accent)] ${mono ? "font-mono" : ""} ${
        invalid ? "border-[#ff5d73]/70" : "border-white/12"
      } ${className ?? ""}`}
    />
  );
}
