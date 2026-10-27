"use client";

import dynamic from "next/dynamic";

const Loading = () => (
  <div className="mt-10 grid h-64 place-items-center rounded-2xl border border-white/10 text-white/40">
    <span className="animate-pulse">Готуємо арену…</span>
  </div>
);

/** Арена рахує лише в браузері: без SSR (адреса читається на клієнті, `useSearchParams` не потрібен). */
const ArenaApp = dynamic(() => import("./ArenaApp"), { ssr: false, loading: Loading });

export default function ArenaClient() {
  return <ArenaApp />;
}
