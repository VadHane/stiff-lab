"use client";

import dynamic from "next/dynamic";

/**
 * Клієнтська обгортка сторінки викладача: налаштування живуть в адресі (`useUrlState`), варіанти й ключ
 * обчислюються в браузері порціями.
 */
const TeacherApp = dynamic(() => import("./TeacherApp"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <div className="grid h-64 place-items-center rounded-2xl border border-white/10 text-white/40">
        <span className="animate-pulse">Готуємо генератор варіантів…</span>
      </div>
    </div>
  ),
});

export default function TeacherClient() {
  return <TeacherApp />;
}
