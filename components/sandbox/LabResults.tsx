"use client";

import { useMemo, type ReactNode } from "react";
import Plot, { type Series } from "@/components/plot/Plot";
import Plot3D, { type Curve3D } from "@/components/plot/Plot3D";
import { Card } from "@/components/ui/blocks";
import { Say } from "@/components/mode/Mode";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { isAdaptive, type MethodId } from "@/lib/ode";
import { STATUS_LABEL, type Recommendation, type RunResult, type RunStatus } from "@/lib/sandbox-analysis";

const STATUS_TONE: Record<RunStatus, string> = {
  ok: "border-[#3ee6a8]/40 bg-[#3ee6a8]/10 text-[#7df0c4]",
  blowup: "border-[#ff5d73]/40 bg-[#ff5d73]/10 text-[#ff8a9a]",
  nan: "border-[#ff5d73]/40 bg-[#ff5d73]/10 text-[#ff8a9a]",
  newton: "border-[#ff7ad9]/40 bg-[#ff7ad9]/10 text-[#ffa6e6]",
  steps: "border-[#ffb547]/40 bg-[#ffb547]/10 text-[#ffd59a]",
  tiny: "border-[#ffb547]/40 bg-[#ffb547]/10 text-[#ffd59a]",
  time: "border-[#ffb547]/40 bg-[#ffb547]/10 text-[#ffd59a]",
  error: "border-[#ff5d73]/40 bg-[#ff5d73]/10 text-[#ff8a9a]",
};

export function StatusBadge({ r }: { r: RunResult }) {
  return (
    <span title={r.message || "Метод дійшов до T"} className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 font-sans text-[11.5px] ${STATUS_TONE[r.status]}`}>
      {STATUS_LABEL[r.status]}
    </span>
  );
}

const wild = (r: RunResult) => r.status === "blowup" || r.status === "nan";

/** Стовпці розв'язку (по компоненті), обчислюються один раз на результат: новий метод не перебудовує старі. */
const COLS = new WeakMap<RunResult, Float64Array[]>();
function columns(r: RunResult): Float64Array[] {
  let c = COLS.get(r);
  if (!c) {
    const n = r.sol.y[0]?.length ?? 0;
    const len = r.sol.y.length;
    c = Array.from({ length: n }, () => new Float64Array(len));
    for (let k = 0; k < len; k++) {
      const y = r.sol.y[k];
      for (let i = 0; i < n; i++) c[i][k] = y[i];
    }
    COLS.set(r, c);
  }
  return c;
}
const comp = (r: RunResult, i: number) => columns(r)[i];

function rangeOf(arrays: ArrayLike<number>[], log: boolean): [number, number] | null {
  let lo = Infinity,
    hi = -Infinity;
  for (const a of arrays)
    for (let k = 0; k < a.length; k++) {
      const v = a[k];
      if (!Number.isFinite(v) || (log && !(v > 0))) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  if (!Number.isFinite(lo)) return null;
  if (log) return hi / lo < 1.0001 ? [lo / 2, hi * 2] : [lo / Math.pow(hi / lo, 0.06), hi * Math.pow(hi / lo, 0.06)];
  const span = hi - lo;
  const pad = span > 1e-12 * Math.max(1, Math.abs(hi)) ? span * 0.06 : Math.max(Math.abs(hi) * 0.1, 1e-6);
  return [lo - pad, hi + pad];
}

function dim(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * 0.35)
    .toString(16)
    .padStart(2, "0");
  return `#${c(16)}${c(8)}${c(0)}`;
}

/** Підписи осей: ім'я змінної (і часу). */
export interface LabResultsProps {
  vars: string[];
  tName: string;
  t0: number;
  T: number;
  methods: MethodId[];
  runs: Partial<Record<MethodId, RunResult>>;
  rec: Recommendation | null;
  logT: boolean;
  logY: boolean;
  phase: [number, number];
  setPhase: (p: [number, number]) => void;
  triple: [number, number, number];
  setTriple: (p: [number, number, number]) => void;
  /** результати — від попередньої версії системи */
  stale: boolean;
}

function VarSelect({ value, onChange, vars, label }: { value: number; onChange: (i: number) => void; vars: string[]; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-lg border border-white/12 bg-[#0d1024] px-2 py-1 font-mono text-[13px] text-white outline-none focus:border-[var(--accent)]"
    >
      {vars.map((v, i) => (
        <option key={i} value={i}>
          {v}
        </option>
      ))}
    </select>
  );
}

/** Графіки компонент, фазова площина, 3D і таблиця методів. */
export default function LabResults(p: LabResultsProps) {
  const { vars, methods, runs, rec, logT, logY, stale } = p;
  const n = vars.length;
  const order = methods.filter((m) => runs[m] && runs[m]!.sol.y[0]?.length === n);
  const ref = rec && rec.reference.sol.t.length > 1 && rec.reference.sol.y[0]?.length === n ? rec.reference : null;
  const refLabel = ref ? `еталон (${ref.method === "ros" ? "Розенброк" : "DOPRI"}, rtol 10⁻⁶)` : "";
  const useLogT = logT && p.t0 >= 0;
  const anyWild = order.some((m) => wild(runs[m]!));

  const comps = useMemo(() => {
    const out: { series: Series[]; yDomain?: [number, number]; positive: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      const series: Series[] = [];
      const trusted: ArrayLike<number>[] = [];
      if (ref) {
        const y = comp(ref, i);
        trusted.push(y);
        series.push({ x: ref.sol.t, y, color: "#ffffff", opacity: 0.55, width: 1.4, dash: [5, 4], label: refLabel });
      }
      for (const m of order) {
        const r = runs[m]!;
        const y = comp(r, i);
        if (!wild(r)) trusted.push(y);
        series.push({ x: r.sol.t, y, color: METHODS[m].color, width: 1.8, label: METHODS[m].short });
      }
      const basis = trusted.length ? trusted : series.map((s) => s.y);
      // log scale is possible when nothing is negative (zeros, e.g. y(t0) = 0, are simply not drawn) and something is > 0
      const positive =
        basis.length > 0 &&
        basis.every((a) => Array.prototype.every.call(a, (v: number) => !Number.isFinite(v) || v >= 0)) &&
        basis.some((a) => Array.prototype.some.call(a, (v: number) => v > 0));
      const lg = logY && positive;
      const yDomain = anyWild ? (rangeOf(trusted, lg) ?? undefined) : undefined;
      out.push({ series, yDomain, positive });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, ref, n, logY, order.join(",")]);

  const [pi, pj] = p.phase;
  const phaseSeries = useMemo(() => {
    const series: Series[] = [];
    const trustedX: ArrayLike<number>[] = [],
      trustedY: ArrayLike<number>[] = [];
    if (ref) {
      const x = comp(ref, pi),
        y = comp(ref, pj);
      trustedX.push(x);
      trustedY.push(y);
      series.push({ x, y, color: "#ffffff", opacity: 0.5, width: 1.3, dash: [5, 4], label: refLabel });
    }
    for (const m of order) {
      const r = runs[m]!;
      const x = comp(r, pi),
        y = comp(r, pj);
      if (!wild(r)) {
        trustedX.push(x);
        trustedY.push(y);
      }
      series.push({ x, y, color: METHODS[m].color, width: 1.6, label: METHODS[m].short });
    }
    return { series, xDomain: anyWild ? (rangeOf(trustedX, false) ?? undefined) : undefined, yDomain: anyWild ? (rangeOf(trustedY, false) ?? undefined) : undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, ref, pi, pj, order.join(",")]);

  const [a, b, c] = p.triple;
  const curves3d = useMemo<Curve3D[]>(() => {
    if (n < 3) return [];
    const list: { r: RunResult; color: string }[] = order.filter((m) => !wild(runs[m]!)).map((m) => ({ r: runs[m]!, color: METHODS[m].color }));
    if (!list.length && ref) list.push({ r: ref, color: "#ffffff" });
    return list.map(({ r, color }) => {
      const stride = Math.max(1, Math.ceil(r.sol.y.length / 15000));
      const pts: [number, number, number][] = [];
      for (let k = 0; k < r.sol.y.length; k += stride) pts.push([r.sol.y[k][a], r.sol.y[k][b], r.sol.y[k][c]]);
      return { pts, colors: [dim(color), color], width: 1.4 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, ref, a, b, c, n, order.join(",")]);

  if (!order.length && !ref)
    return <div className="grid h-40 place-items-center rounded-2xl border border-white/10 text-[14px] text-white/45">Оберіть хоча б один метод ліворуч.</div>;

  const xDomain: [number, number] | undefined = useLogT ? undefined : [p.t0, p.T];
  const legend = [...(ref ? [{ color: "#ffffff", label: refLabel, dashed: true }] : []), ...order.map((m) => ({ color: METHODS[m].color, label: METHODS[m].name, dashed: false }))];

  return (
    <div className={`space-y-4 transition-opacity ${stale ? "opacity-55" : ""}`}>
      <Card
        title="Розв'язок по компонентах"
        icon="📈"
        right={anyWild ? <span className="text-[11.5px] text-[#ffd59a]">шкалу взято з методів без вибуху</span> : undefined}
      >
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/70">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5" style={{ background: l.dashed ? `repeating-linear-gradient(90deg, ${l.color} 0 5px, transparent 5px 9px)` : l.color, opacity: l.dashed ? 0.7 : 1 }} />
              {l.label}
            </span>
          ))}
        </div>
        <div className={`grid grid-cols-1 gap-3 ${n > 1 ? "md:grid-cols-2" : ""}`}>
          {comps.map((cmp, i) => (
            <div key={i} className="min-w-0">
              <Plot
                height={n > 4 ? 190 : 230}
                title={`${vars[i]}(${p.tName})${logY && !cmp.positive ? " · лінійна шкала: є від'ємні значення" : ""}`}
                legend={false}
                series={cmp.series}
                xLabel={p.tName}
                yLabel={vars[i]}
                logX={useLogT}
                logY={logY && cmp.positive}
                xDomain={xDomain}
                yDomain={cmp.yDomain}
              />
            </div>
          ))}
        </div>
        {logT && p.t0 < 0 && <div className="mt-2 text-[12px] text-white/45">Лог-шкала часу можлива лише для t₀ ≥ 0.</div>}
      </Card>

      {n >= 2 && (
        <Grid2 three={n >= 3}>
          <Card
            title="Фазова площина"
            icon="🌀"
            right={
              <div className="flex items-center gap-1.5 text-[12px] text-white/55">
                <VarSelect value={pi} onChange={(i) => p.setPhase([i, pj])} vars={vars} label="Змінна по горизонталі" />
                <span>×</span>
                <VarSelect value={pj} onChange={(j) => p.setPhase([pi, j])} vars={vars} label="Змінна по вертикалі" />
              </div>
            }
          >
            <Plot
              height={320}
              sorted={false}
              legend={false}
              series={phaseSeries.series}
              xLabel={vars[pi]}
              yLabel={vars[pj]}
              xDomain={phaseSeries.xDomain}
              yDomain={phaseSeries.yDomain}
              markers={[{ x: (ref ?? runs[order[0]]!).sol.y[0][pi], y: (ref ?? runs[order[0]]!).sol.y[0][pj], color: "#ffffff", r: 4 }]}
            />
            <div className="mt-1 text-[11.5px] text-white/40">Біла точка — початкова умова. Виділіть область мишею — збільшити, подвійний клік — скинути.</div>
          </Card>
          {n >= 3 && (
            <Card
              title="Траєкторія в 3D"
              icon="🧊"
              right={
                <div className="flex items-center gap-1 text-[12px] text-white/55">
                  <VarSelect value={a} onChange={(i) => p.setTriple([i, b, c])} vars={vars} label="Вісь 1" />
                  <VarSelect value={b} onChange={(i) => p.setTriple([a, i, c])} vars={vars} label="Вісь 2" />
                  <VarSelect value={c} onChange={(i) => p.setTriple([a, b, i])} vars={vars} label="Вісь 3" />
                </div>
              }
            >
              {curves3d.length ? (
                <Plot3D curves={curves3d} height={320} labels={[vars[a], vars[b], vars[c]]} />
              ) : (
                <div className="grid h-[320px] place-items-center text-[13px] text-white/40">Немає траєкторій без вибуху</div>
              )}
              <div className="mt-1 text-[11.5px] text-white/40">Тягніть мишею, щоб повернути. Методи з вибухом не показано.</div>
            </Card>
          )}
        </Grid2>
      )}

      <Card title="Методи: скільки коштував розв'язок" icon="🧮">
        <div className="overflow-x-auto rounded-xl border border-white/8">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-white/[0.04] text-white/55">
              <tr>
                {["Метод", "Кроки", "Відхил.", "f-обч.", "J-обч.", "Час", "Статус", `${vars.length > 1 ? "y" : vars[0]}(${p.tName}) у кінці`].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2.5 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((m) => {
                const r = runs[m]!;
                const yEnd = r.sol.y[r.sol.y.length - 1];
                return (
                  <tr key={m} className="border-t border-white/[0.06] align-top">
                    <td className="whitespace-nowrap px-2.5 py-2 text-white/85">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: METHODS[m].color }} />
                      {METHODS[m].short}
                      <span className="ml-1 text-[11px] text-white/40">{isAdaptive(m) ? "адапт." : `h = ${fmt(r.sol.hs[0] ?? NaN, 3)}`}</span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono text-white/85">
                      {r.sol.steps.toLocaleString("uk-UA")}
                      {r.stepsNeeded !== undefined && r.stepsNeeded > r.sol.steps && r.status === "steps" && (
                        <span className="text-white/40"> з {r.stepsNeeded.toLocaleString("uk-UA")}</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 font-mono text-white/70">{isAdaptive(m) ? r.sol.rejected.toLocaleString("uk-UA") : "—"}</td>
                    <td className="px-2.5 py-2 font-mono text-white/70">{r.sol.fevals.toLocaleString("uk-UA")}</td>
                    <td className="px-2.5 py-2 font-mono text-white/70">{r.sol.jevals.toLocaleString("uk-UA")}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono text-white/70">{fmtMs(r.sol.ms)}</td>
                    <td className="px-2.5 py-2">
                      <StatusBadge r={r} />
                    </td>
                    <td className="px-2.5 py-2 font-mono text-[12px] text-white/80">
                      {r.status !== "ok" && <span className="text-white/45">t = {fmt(r.tEnd, 4)}: </span>}
                      {yEnd.map((v) => fmt(v, 6)).join("; ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {order.some((m) => runs[m]!.status !== "ok") && (
          <ul className="mt-3 space-y-1 text-[12.5px] leading-snug text-white/70">
            {order
              .filter((m) => runs[m]!.status !== "ok")
              .map((m) => (
                <li key={m}>
                  <span className="font-semibold" style={{ color: METHODS[m].color }}>
                    {METHODS[m].short}:
                  </span>{" "}
                  {runs[m]!.message}
                </li>
              ))}
          </ul>
        )}
        <div className="mt-2 text-[11.5px] text-white/40">
          <Say simple="«Кроки» — скільки разів метод «ступив» уздовж часу; f-обч. — скільки разів рахувалися праві частини; J-обч. — якобіан (лише неявні методи й Розенброк).">
            f-обч. включають ∂f/∂t Розенброка і пошук кроку Ньютона; J-обчислення — аналітичний якобіан із символьного диференціювання. Ліміт кроків і часу (1.2 с на метод) — у панелі ліворуч.
          </Say>
        </div>
      </Card>
    </div>
  );
}

function Grid2({ children, three }: { children: ReactNode; three: boolean }) {
  return <div className={`grid grid-cols-1 gap-4 ${three ? "xl:grid-cols-2" : ""}`}>{children}</div>;
}
