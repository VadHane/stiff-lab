"use client";

import { KIND_META, SEVERITY_META, type Erratum, type ErratumKind, type Severity } from "@/lib/errata";
import { Say } from "@/components/mode/Mode";
import { Rich } from "./rich";

export function KindBadge({ kind }: { kind: ErratumKind }) {
  const m = KIND_META[kind];
  return (
    <span
      title={m.about}
      className="errata-badge inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] text-white/85"
      style={{ borderColor: `${m.color}55`, background: `${m.color}14` }}
    >
      <span aria-hidden>{m.icon}</span>
      {m.short}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity];
  return (
    <span
      title={m.about}
      className="errata-badge inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold"
      style={{ borderColor: `${m.color}66`, color: m.color, background: `${m.color}12` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  );
}

function Label({ children }: { children: string }) {
  return <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{children}</div>;
}

export default function ErrataEntry({ e, n, open, onToggle }: { e: Erratum; n: number; open: boolean; onToggle: () => void }) {
  const detailsId = `e-${e.id}-details`;
  return (
    <article id={`e-${e.id}`} className="errata-entry scroll-mt-24 rounded-xl border border-white/8 bg-white/[0.02] p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[12px] text-white/40">{n}.</span>
        <SeverityBadge severity={e.severity} />
        <KindBadge kind={e.kind} />
      </div>
      <h4 className="mt-2 break-words text-[15px] font-semibold leading-snug text-white">
        <Rich>{e.title}</Rich>
      </h4>

      <div className="mt-3 grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-2">
        <div className="errata-printed min-w-0 rounded-lg border border-[#ff5d73]/25 bg-[#ff5d73]/[0.06] px-3 py-2.5">
          <Label>📜 Надруковано в методичці</Label>
          <Rich className="errata-rich block min-w-0 overflow-x-auto overflow-y-hidden break-words pb-2 pt-0.5 text-[14px] leading-relaxed text-white/85">{e.printed}</Rich>
        </div>
        <div className="grid place-items-center text-lg text-white/35" aria-hidden>
          <span className="md:hidden">↓</span>
          <span className="hidden md:inline">→</span>
        </div>
        <div className="errata-correct min-w-0 rounded-lg border border-[#3ee6a8]/25 bg-[#3ee6a8]/[0.06] px-3 py-2.5">
          <Label>✅ Як правильно</Label>
          <Rich className="errata-rich block min-w-0 overflow-x-auto overflow-y-hidden break-words pb-2 pt-0.5 text-[14px] leading-relaxed text-white/85">{e.correct}</Rich>
        </div>
      </div>

      <Say
        simple={
          <p className="mt-3 break-words text-[14px] leading-relaxed text-white/75">
            <span aria-hidden>🧸 </span>
            <Rich>{e.simple}</Rich>
          </p>
        }
      >
        <div className="mt-3 break-words text-[14px] leading-relaxed text-white/75">
          <span className="font-semibold text-white/90">Наслідок дослівного виконання: </span>
          <Rich>{e.impact}</Rich>
        </div>
      </Say>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={detailsId}
        className="errata-noprint mt-2 text-[12.5px] text-[var(--accent)] hover:underline"
      >
        {open ? "▴ Сховати подробиці" : "▾ Як виявлено і де в роботі"}
      </button>

      <dl id={detailsId} className={`errata-details mt-2 space-y-2 border-t border-white/[0.06] pt-2 text-[13.5px] leading-relaxed ${open ? "" : "hidden"}`}>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/45">🔎 Як виявлено</dt>
          <dd className="break-words text-white/75">
            <Rich>{e.why}</Rich>
          </dd>
        </div>
        <Say
          simple={
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/45">💥 Наслідок дослівного виконання</dt>
              <dd className="break-words text-white/75">
                <Rich>{e.impact}</Rich>
              </dd>
            </div>
          }
        >
          {null}
        </Say>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/45">📚 Де в роботі</dt>
          <dd className="text-white/75">{e.where}</dd>
        </div>
      </dl>
    </article>
  );
}
