"use client";

import dynamic from "next/dynamic";

/**
 * Клієнтська обгортка сторінки «Своя система»: важкий компонент (редактор, методи, графіки) завантажується лише
 * в браузері — стан читається з адреси (`useUrlState`), а обчислення йдуть на клієнті.
 */
const SandboxLab = dynamic(() => import("./SandboxLab"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <div className="grid h-64 place-items-center rounded-2xl border border-white/10 text-white/40">
        <span className="animate-pulse">Готуємо редактор системи…</span>
      </div>
    </div>
  ),
});

export default function SandboxClient() {
  return <SandboxLab />;
}
