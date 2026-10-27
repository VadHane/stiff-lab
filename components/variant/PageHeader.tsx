"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ModeToggle } from "@/components/mode/Mode";

/** Шапка сторінок /teacher і /variant у стилі сторінок задач: значок, заголовок, підзаголовок, перемикач режиму. */
export default function PageHeader({ emoji, badge, title, tagline, children }: { emoji: string; badge: string; title: string; tagline: ReactNode; children?: ReactNode }) {
  return (
    <div className="fade-up pt-10 sm:pt-14">
      <Link href="/" className="text-[13px] text-white/45 hover:text-white">
        ← на головну
      </Link>
      <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-3xl border border-white/10 bg-white/[0.04] text-5xl shadow-[0_0_60px_-20px_var(--accent)]">
          <span className="animate-float" aria-hidden>
            {emoji}
          </span>
          <span className="font-display absolute -right-2 -top-2 whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[13px] text-black">{badge}</span>
        </div>
        <div className="min-w-0">
          <h1 className="font-display glow-text text-3xl leading-tight text-white sm:text-[44px]">{title}</h1>
          <p className="mt-2 max-w-3xl text-[16px] text-white/65">{tagline}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ModeToggle />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
