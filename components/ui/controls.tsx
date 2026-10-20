"use client";

import { METHODS } from "@/lib/methods";
import type { MethodId } from "@/lib/ode";
import { fmt } from "@/lib/format";
import type { ReactNode } from "react";

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  log = false,
  format,
  hint,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  format?: (v: number) => string;
  hint?: ReactNode;
}) {
  const toPos = (v: number) => (log ? (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) : (v - min) / (max - min));
  const fromPos = (p: number) => {
    let v = log ? Math.pow(10, Math.log10(min) + p * (Math.log10(max) - Math.log10(min))) : min + p * (max - min);
    if (step) v = Math.round(v / step) * step;
    if (log) v = Number(v.toPrecision(3));
    return Math.min(max, Math.max(min, v));
  };
  const pos = Math.min(1, Math.max(0, toPos(value)));
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-white/75" data-param-label="">
          {label}
        </span>
        <span className="font-mono text-[13px] text-[var(--accent)]" data-param-value="">
          {format ? format(value) : fmt(value, 4)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(pos * 1000)}
        onChange={(e) => onChange(fromPos(Number(e.target.value) / 1000))}
        className="range w-full"
        style={{ ["--p" as string]: `${pos * 100}%` }}
      />
      {hint && <div className="mt-1 text-[11px] text-white/45">{hint}</div>}
    </label>
  );
}

export function Chips<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label?: ReactNode;
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      {label && (
        <div className="mb-1.5 text-[13px] text-white/75" data-param-label="">
          {label}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              title={o.title}
              data-param-value={on && label ? "" : undefined}
              onClick={() => onChange(o.value)}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition-all ${
                on
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white shadow-[0_0_18px_-6px_var(--accent)]"
                  : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MethodPicker({
  methods,
  value,
  onChange,
  label = "Методи",
}: {
  methods: MethodId[];
  value: MethodId[];
  onChange: (v: MethodId[]) => void;
  label?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] text-white/75" data-param-label="">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {methods.map((m) => {
          const meta = METHODS[m];
          const on = value.includes(m);
          return (
            <button
              key={m}
              title={meta.about}
              onClick={() => onChange(on ? value.filter((x) => x !== m) : [...value, m])}
              data-param-multi={on ? meta.name : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-all ${
                on ? "text-white" : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/80"
              }`}
              style={on ? { borderColor: meta.color, background: `${meta.color}22`, boxShadow: `0 0 16px -6px ${meta.color}` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: meta.color, opacity: on ? 1 : 0.4 }} />
              {meta.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex items-center gap-2.5 text-[13px] text-white/75">
      <span className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-[var(--accent)]" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${value ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}
