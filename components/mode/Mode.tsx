"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Mode = "simple" | "sci";

const KEY = "stifflab.mode";
const ModeCtx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: "simple", setMode: () => {} });

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>("simple");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "simple" || v === "sci") setModeState(v);
    } catch {}
  }, []);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {}
  }, []);
  return <ModeCtx.Provider value={{ mode, setMode }}>{children}</ModeCtx.Provider>;
}

export const useMode = () => useContext(ModeCtx);

/** Renders `simple` in the plain-language mode and `children` in the scientific mode. */
export function Say({ simple, children }: { simple: ReactNode; children: ReactNode }) {
  const { mode } = useMode();
  return <>{mode === "simple" ? simple : children}</>;
}

export function OnlySimple({ children }: { children: ReactNode }) {
  return useMode().mode === "simple" ? <>{children}</> : null;
}

export function OnlySci({ children }: { children: ReactNode }) {
  return useMode().mode === "sci" ? <>{children}</> : null;
}

export function ModeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useMode();
  const opt = (m: Mode, icon: string, label: string) => (
    <button
      onClick={() => setMode(m)}
      title={m === "simple" ? "Пояснення побутовою мовою" : "Строгі формулювання, формули, терміни"}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] transition-all ${
        mode === m ? "bg-white text-black shadow-[0_0_18px_-6px_#fff]" : "text-white/60 hover:text-white"
      }`}
    >
      <span>{icon}</span>
      {!compact && label}
    </button>
  );
  return (
    <div className="flex items-center rounded-full border border-white/12 bg-white/[0.04] p-0.5">
      {opt("simple", "🧸", "Просто")}
      {opt("sci", "🎓", "Науково")}
    </div>
  );
}
