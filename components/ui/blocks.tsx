"use client";

import type { ReactNode } from "react";
import { useMode } from "@/components/mode/Mode";

export function Card({ children, className, title, icon, right }: { children: ReactNode; className?: string; title?: ReactNode; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className={`glass rounded-2xl p-4 sm:p-5 ${className ?? ""}`}>
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon && <span className="text-lg">{icon}</span>}
          <h3 className="font-display text-[15px] tracking-wide text-white/90">{title}</h3>
          {right && <div className="ml-auto">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Section({
  children,
  title,
  simpleTitle,
  kicker,
  id,
  report = true,
}: {
  children: ReactNode;
  title: ReactNode;
  /** title shown in the plain-language mode */
  simpleTitle?: ReactNode;
  kicker?: ReactNode;
  id?: string;
  /** include this section in the generated lab report */
  report?: boolean;
}) {
  const { mode } = useMode();
  return (
    <section id={id} className="mt-12 scroll-mt-24" data-report-section={report ? "" : undefined} data-report-skip={report ? undefined : ""}>
      {kicker && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--accent)]">{kicker}</div>}
      <h2 className="font-display mb-5 text-2xl text-white sm:text-[28px]">{mode === "simple" && simpleTitle ? simpleTitle : title}</h2>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone = "default" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "default" | "good" | "bad" | "warn" }) {
  const color = { default: "text-white", good: "text-[#3ee6a8]", bad: "text-[#ff5d73]", warn: "text-[#ffb547]" }[tone];
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5" data-report-stat="">
      <div className="text-[11px] uppercase tracking-wider text-white/45" data-stat-label="">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-lg leading-tight ${color}`} data-stat-value="">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-white/45" data-stat-sub="">
          {sub}
        </div>
      )}
    </div>
  );
}

const TONES = {
  info: { icon: "💡", cls: "border-[#5cc8ff]/30 bg-[#5cc8ff]/[0.07]" },
  warn: { icon: "⚠️", cls: "border-[#ffb547]/30 bg-[#ffb547]/[0.07]" },
  bad: { icon: "💥", cls: "border-[#ff5d73]/30 bg-[#ff5d73]/[0.07]" },
  good: { icon: "✅", cls: "border-[#3ee6a8]/30 bg-[#3ee6a8]/[0.07]" },
  fun: { icon: "🎲", cls: "border-[#ff7ad9]/30 bg-[#ff7ad9]/[0.07]" },
  note: { icon: "📝", cls: "border-white/15 bg-white/[0.04]" },
};

export function Insight({
  tone = "info",
  title,
  children,
  icon,
  simple,
  simpleTitle,
}: {
  tone?: keyof typeof TONES;
  title?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  /** plain-language version of the content (shown in the "Просто" mode) */
  simple?: ReactNode;
  simpleTitle?: ReactNode;
}) {
  const t = TONES[tone];
  const { mode } = useMode();
  const plain = mode === "simple";
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-[14px] leading-relaxed text-white/80 ${t.cls}`} data-report-insight="">
      <span className="mt-0.5 text-lg leading-none">{icon ?? t.icon}</span>
      <div className="min-w-0">
        {(title || simpleTitle) && <div className="mb-0.5 font-semibold text-white">{plain && simpleTitle ? simpleTitle : title}</div>}
        {plain && simple ? simple : children}
      </div>
    </div>
  );
}

export function Grid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: "", 2: "lg:grid-cols-2", 3: "md:grid-cols-2 xl:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4" }[cols];
  return <div className={`grid grid-cols-1 gap-4 ${c} ${className ?? ""}`}>{children}</div>;
}

/** Two-column lab: controls on the left, output on the right. */
export function Lab({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="glass h-fit space-y-5 rounded-2xl p-4 sm:p-5 lg:sticky lg:top-20" data-report-controls="">
        {controls}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

export function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/8" data-report-table="">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-white/[0.04] text-white/55">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/[0.06]">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 font-mono text-white/85">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
