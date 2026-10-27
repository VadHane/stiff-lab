"use client";

import dynamic from "next/dynamic";

/**
 * Клієнтська обгортка сторінки «Мій варіант»: код читається з адреси (`useUrlState`), еталонні відповіді
 * обчислюються в браузері, тож компонент рендериться лише на клієнті.
 */
const VariantApp = dynamic(() => import("./VariantApp"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-5xl px-4 pt-16 sm:px-6">
      <div className="grid h-64 place-items-center rounded-2xl border border-white/10 text-white/40">
        <span className="animate-pulse">Відкриваємо варіант…</span>
      </div>
    </div>
  ),
});

export default function VariantClient() {
  return <VariantApp />;
}
