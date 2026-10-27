/**
 * Копіювання в буфер обміну з запасним шляхом і завантаження текстового файлу — спільне для кнопок «Поділитися»
 * і «Код Python / MATLAB».
 */

/**
 * Копіює текст: `navigator.clipboard` (потрібен безпечний контекст — https або localhost), інакше —
 * прихована `<textarea>` + `document.execCommand("copy")`. Повертає `true`, якщо копіювання вдалося.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // permission denied / not focused — fall through to the legacy path
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  const prevFocus = document.activeElement as HTMLElement | null;
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  prevFocus?.focus?.();
  return ok;
}

/** Завантажує текст як файл (UTF-8). */
export function downloadText(fileName: string, text: string, mime = "text/plain"): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
