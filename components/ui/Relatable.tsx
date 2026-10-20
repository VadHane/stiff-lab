"use client";

import { relatableGrowth, relatableRatio, relatableSteps } from "@/lib/relatable";

/** Small "to put it simply" chip that translates a big number into everyday terms. */
export default function Relatable({ kind, n, className }: { kind: "steps" | "ratio" | "growth"; n: number; className?: string }) {
  const text = kind === "steps" ? relatableSteps(n) : kind === "ratio" ? relatableRatio(n) : relatableGrowth(n);
  if (!text) return null;
  return (
    <span className={`inline-flex items-start gap-1.5 rounded-lg bg-[#ffd84d]/[0.08] px-2 py-1 text-[12px] leading-snug text-[#ffe9a3] ${className ?? ""}`}>
      <span>🗣️</span>
      <span>{text.charAt(0).toUpperCase() + text.slice(1)}</span>
    </span>
  );
}
