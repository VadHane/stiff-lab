"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ModeToggle } from "@/components/mode/Mode";
import ShareButton from "@/components/share/ShareButton";
import { BUILDER_ACCENT } from "./theme";

// the heavy page (KaTeX, canvas, solvers) renders only on the client: its state lives in the address bar
const Builder = dynamic(() => import("./Builder"), {
  ssr: false,
  loading: () => (
    <div className="mt-10 grid h-64 place-items-center rounded-2xl border border-white/10 text-white/40">
      <span className="animate-pulse">Збираємо таблицю Батчера…</span>
    </div>
  ),
});

const TAGS = ["Рунге–Кутта", "таблиця Батчера", "умови порядку", "R(z)", "A-стійкість", "L-стійкість"];

export default function BuilderClient() {
  return (
    <div style={{ ["--accent" as string]: BUILDER_ACCENT }} className="mx-auto max-w-7xl px-4 pb-10 sm:px-6" data-task-root="">
      <div className="fade-up pt-10 sm:pt-14">
        <Link href="/" className="text-[13px] text-white/45 hover:text-white">
          ← на головну
        </Link>
        <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-3xl border border-white/10 bg-white/[0.04] text-5xl shadow-[0_0_60px_-20px_var(--accent)]">
            <span className="animate-float">🧩</span>
            <span className="font-display absolute -right-2 -top-2 whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[13px] text-black">
              RK
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="font-display glow-text text-3xl leading-tight text-white sm:text-[44px]">Конструктор методу</h1>
            <p className="mt-2 max-w-3xl text-[16px] text-white/65">
              Задайте метод Рунге–Кутти таблицею Батчера — явний чи неявний — і одразу побачите його порядок, функцію стійкості, область стійкості й те, як він
              поводиться на задачах курсу.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ModeToggle />
              <ShareButton />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TAGS.map((t) => (
                <span key={t} className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2.5 py-0.5 text-[12px] text-white/80">
                  #{t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Builder />
    </div>
  );
}
