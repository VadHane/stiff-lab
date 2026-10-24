"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

const Loading = () => (
  <div className="mt-10 grid h-64 place-items-center rounded-2xl border border-white/10 text-white/40">
    <span className="animate-pulse">Інтегруємо рівняння…</span>
  </div>
);


const MAP: Record<string, ComponentType> = {
  "1": dynamic(() => import("./T1"), { ssr: false, loading: Loading }),
  "2": dynamic(() => import("./T2"), { ssr: false, loading: Loading }),
  "3": dynamic(() => import("./T3"), { ssr: false, loading: Loading }),
  "4": dynamic(() => import("./T4"), { ssr: false, loading: Loading }),
  "5": dynamic(() => import("./T5"), { ssr: false, loading: Loading }),
  "11": dynamic(() => import("./T11"), { ssr: false, loading: Loading }),
  "12": dynamic(() => import("./T12"), { ssr: false, loading: Loading }),
  "13": dynamic(() => import("./T13"), { ssr: false, loading: Loading }),
  "14": dynamic(() => import("./T14"), { ssr: false, loading: Loading }),
  "16": dynamic(() => import("./T16"), { ssr: false, loading: Loading }),
  "18": dynamic(() => import("./T18"), { ssr: false, loading: Loading }),
  "19": dynamic(() => import("./T19"), { ssr: false, loading: Loading }),
  "20": dynamic(() => import("./T20"), { ssr: false, loading: Loading }),
  "21": dynamic(() => import("./T21"), { ssr: false, loading: Loading }),
  "22": dynamic(() => import("./T22"), { ssr: false, loading: Loading }),
  "23": dynamic(() => import("./T23"), { ssr: false, loading: Loading }),
  "24": dynamic(() => import("./T24"), { ssr: false, loading: Loading }),
  "25": dynamic(() => import("./T25"), { ssr: false, loading: Loading }),
  lorenz: dynamic(() => import("./TLorenz"), { ssr: false, loading: Loading }),
};

export default function TaskBody({ id }: { id: string }) {
  const C = MAP[id];
  return C ? <C /> : null;
}
