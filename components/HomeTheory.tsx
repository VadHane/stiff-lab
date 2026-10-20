"use client";

import StabilityExplorer from "@/components/plot/StabilityExplorer";

export default function HomeTheory() {
  return (
    <div className="glass mt-6 rounded-2xl p-4 sm:p-6">
      <div className="font-display mb-1 text-[17px] text-white">🗺️ Карта стійкості: зіграйте в «вибухне чи ні»</div>
      <p className="mb-4 text-[14px] text-white/60">
        Будь-який однокроковий метод на тестовому рівнянні u′ = λu робить yₙ₊₁ = R(hλ)·yₙ. Перетягніть точку z = hλ — і побачите, які методи виживуть.
      </p>
      <StabilityExplorer />
    </div>
  );
}
