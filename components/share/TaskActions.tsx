"use client";

/**
 * Кнопки «🔗 Поділитися» і «🐍 Код Python / MATLAB» у шапці сторінки задачі.
 *
 * `TaskShell` (серверний компонент) огортає шапку й тіло задачі в {@link TaskActionsProvider} і ставить
 * {@link TaskHeaderActions} поруч із `ModeToggle` / `ReportButton`. Сторінка задачі (`components/tasks/T*.tsx`)
 * викликає {@link useTaskExport} з поточною специфікацією, параметрами й методами — шапка показує кнопку коду
 * з цими даними. Поки сторінка нічого не зареєструвала (завантажується), кнопки коду немає.
 *
 * Контексти розділено: сторінка бачить лише стабільний сеттер, тож реєстрація не перерендерює сторінку,
 * а оновлюється тільки шапка.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import CodeExportButton from "./CodeExportButton";
import ShareButton from "./ShareButton";
import type { TaskExport } from "./TaskExports";

export type { TaskExport } from "./TaskExports";

const SetCtx = createContext<((e: TaskExport | null) => void) | null>(null);
const ValueCtx = createContext<TaskExport | null>(null);

export function TaskActionsProvider({ children }: { children: ReactNode }) {
  const [exp, setExp] = useState<TaskExport | null>(null);
  return (
    <SetCtx.Provider value={setExp}>
      <ValueCtx.Provider value={exp}>{children}</ValueCtx.Provider>
    </SetCtx.Provider>
  );
}

/** Ключ вмісту реєстрації: сторінки передають нові об'єкти на кожному рендері, оновлюємо шапку лише при зміні даних. */
const keyOf = (e: TaskExport | null) => (e ? JSON.stringify([e.spec.id, e.values ?? null, e.methods, e.opts ?? null, e.note ?? ""]) : "");

/**
 * Реєструє дані для кнопки «Код Python / MATLAB» у шапці. Викликати на кожному рендері сторінки з поточними
 * значеннями (`null` — сховати кнопку). Після розмонтування сторінки реєстрація знімається.
 */
export function useTaskExport(exp: TaskExport | null): void {
  const set = useContext(SetCtx);
  const latest = useRef(exp);
  const key = keyOf(exp);
  useEffect(() => {
    latest.current = exp;
  });
  useEffect(() => {
    set?.(latest.current);
  }, [set, key]);
  useEffect(() => () => set?.(null), [set]);
}

/**
 * Застереження біля кнопки коду (напр. «сторінка рахує власним розв'язувачем»): ⓘ з підказкою, по кліку — текст.
 * Панель рендериться порталом у `document.body` з `position: fixed` біля кнопки й притискається до країв вікна,
 * тож не виходить за екран ні на телефоні, ні коли ⓘ стоїть біля правого краю рядка кнопок.
 */
function TaskExportNote({ text }: { text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const open = pos !== null;
  const toggle = () => {
    if (open || !btn.current) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const width = Math.min(352, vw - 32);
    setPos({ top: r.bottom + 8, left: Math.max(16, Math.min(r.right - width, vw - 16 - width)), width });
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const close = () => setPos(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        title={text}
        aria-label="Чим код відрізняється від розрахунку сторінки"
        aria-expanded={open}
        className="-ml-1 grid h-7 w-7 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-[12.5px] text-white/60 transition-all hover:border-[var(--accent)] hover:text-white"
      >
        ⓘ
      </button>
      {pos &&
        createPortal(
          <span
            ref={panel}
            role="note"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-50 rounded-xl border border-white/15 bg-[#12152b] p-3 text-[12.5px] leading-snug text-white/80 shadow-xl"
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}

/** «🔗 Поділитися» + «🐍 Код Python / MATLAB» (коли сторінка зареєструвала дані) — для рядка кнопок шапки. */
export function TaskHeaderActions() {
  const exp = useContext(ValueCtx);
  return (
    <>
      <ShareButton />
      {exp && (
        <>
          <CodeExportButton spec={exp.spec} values={exp.values} methods={exp.methods} opts={exp.opts} />
          {exp.note && <TaskExportNote text={exp.note} />}
        </>
      )}
    </>
  );
}
