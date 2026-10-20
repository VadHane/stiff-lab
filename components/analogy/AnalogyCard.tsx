"use client";

import type { ReactNode } from "react";
import { Section } from "@/components/ui/blocks";

/** «Що це в житті?» — an everyday picture of the task with a mini interactive scene and a «життя ↔ задача» dictionary. */
export default function AnalogyCard({
  emoji,
  title,
  story,
  mapping,
  children,
}: {
  emoji: string;
  title: ReactNode;
  story: ReactNode;
  /** pairs: everyday thing ↔ what it is in the model */
  mapping: [ReactNode, ReactNode][];
  /** the interactive mini scene */
  children?: ReactNode;
}) {
  return (
    <Section kicker="Що це в житті?" title={title} report={false}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="glass rounded-2xl p-4 sm:p-5">
          <div className="mb-3 flex items-start gap-3">
            <span className="text-4xl leading-none">{emoji}</span>
            <div className="text-[15px] leading-relaxed text-white/80">{story}</div>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-white/8">
            <div className="grid grid-cols-2 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">
              <span>У житті</span>
              <span>У задачі</span>
            </div>
            {mapping.map(([a, b], i) => (
              <div key={i} className="grid grid-cols-2 gap-3 border-t border-white/[0.06] px-3 py-2 text-[13.5px]">
                <span className="text-white/85">{a}</span>
                <span className="text-white/60">{b}</span>
              </div>
            ))}
          </div>
        </div>
        {children && <div className="glass min-w-0 rounded-2xl p-4 sm:p-5">{children}</div>}
      </div>
    </Section>
  );
}
