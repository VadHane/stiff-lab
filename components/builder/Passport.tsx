"use client";

import { Fragment } from "react";
import { Say, useMode } from "@/components/mode/Mode";
import { Card, Grid, Insight, Stat } from "@/components/ui/blocks";
import { Tex } from "@/components/ui/Tex";
import {
  CONDITIONS_UP_TO,
  KIND_LABEL,
  numTex,
  polyTex,
  stabilityTex,
  type ButcherPreset,
  type OrderInfo,
  type StabilityInfo,
  type Tableau,
  type TableauKind,
  type Tree,
} from "@/lib/butcher";
import { fmt } from "@/lib/format";

export interface Analysis {
  kind: TableauKind;
  order: OrderInfo;
  stab: StabilityInfo;
  stiffAcc: boolean;
}

/** R(∞) і межі — у читабельному вигляді. */
export function fmtR(x: number): string {
  if (x === Infinity || x === -Infinity) return "∞";
  if (Math.abs(x) < 1e-13) return "0";
  return fmt(x, 6);
}

export const fmtBound = (x: number) => (x === Infinity ? "∞" : x === 0 ? "0" : fmt(x, 5));

export const orderLabel = (o: OrderInfo) => (o.atLeast ? "≥ 5" : String(o.p));

/** Мініатюра кореневого дерева (корінь знизу). */
function TreeSvg({ tree }: { tree: Tree }) {
  type N = { x: number; d: number; ch: N[] };
  let next = 0;
  let depth = 0;
  const lay = (t: Tree, d: number): N => {
    depth = Math.max(depth, d);
    if (t.length === 0) return { x: next++, d, ch: [] };
    const ch = t.map((c) => lay(c, d + 1));
    return { x: ch.reduce((a, c) => a + c.x, 0) / ch.length, d, ch };
  };
  const root = lay(tree, 0);
  const W = 46,
    H = 46,
    pad = 6;
  const sx = next > 1 ? (W - 2 * pad) / (next - 1) : 0;
  const sy = depth > 0 ? (H - 2 * pad) / Math.max(depth, 3) : 0;
  const X = (n: N) => (next > 1 ? pad + n.x * sx : W / 2);
  const Y = (n: N) => H - pad - n.d * sy;
  const edges: [N, N][] = [];
  const nodes: N[] = [];
  const walk = (n: N) => {
    nodes.push(n);
    for (const c of n.ch) {
      edges.push([n, c]);
      walk(c);
    }
  };
  walk(root);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={34} height={34} className="shrink-0" aria-hidden>
      {edges.map(([a, b], i) => (
        <line key={i} x1={X(a)} y1={Y(a)} x2={X(b)} y2={Y(b)} stroke="rgba(220,230,255,0.55)" strokeWidth={1.6} />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={X(n)} cy={Y(n)} r={n === root ? 3.6 : 3} fill={n === root ? "var(--accent)" : "#dfe6ff"} />
      ))}
    </svg>
  );
}

export default function Passport({ tab, a, preset }: { tab: Tableau; a: Analysis; preset?: ButcherPreset }) {
  const { mode } = useMode();
  const plain = mode === "simple";
  const { order: o, stab: st, kind } = a;
  const s = tab.s;
  const implicit = kind !== "explicit";
  const kindText = s === 1 && implicit ? "неявний (1 стадія)" : KIND_LABEL[kind];
  const passed = o.conditions.filter((c) => c.ok).length;
  const theoryP = preset?.theory?.p;
  // E(y) as a polynomial in y (only even powers)
  const EyTex = polyTex(st.E.flatMap((e) => [e, 0]).slice(0, -1), "y");
  const poleTex = st.poles.map(([re, im]) => (Math.abs(im) < 1e-12 ? numTex(re) : `${numTex(re)} ${im < 0 ? "-" : "+"} ${numTex(Math.abs(im))}\\,i`)).join(",\\ ");

  return (
    <div className="space-y-4">
      {o.p === 0 && (
        <Insight
          tone="bad"
          title="Метод неузгоджений: Σ bᵢ ≠ 1"
          simple={<>Ваги b мають у сумі давати 1 — інакше метод не наближає розв&apos;язок за жодного кроку. Решта характеристик нижче — формальні.</>}
        >
          <Tex>{`\sum_i b_i = ${fmt(tab.b.reduce((x, v) => x + v, 0), 6)} \ne 1`}</Tex>: умова порядку 1 не виконана, метод не збігається (R(z) = 1 + {fmt(tab.b.reduce((x, v) => x + v, 0), 4)}z + …).
          Решта характеристик нижче — формальні.
        </Insight>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Тип" value={<span className="text-[15px]">{kindText}</span>} sub={implicit ? `система стадій ${s}·n × ${s}·n` : `${s} обчислень f на крок`} />
        <Stat
          label="Порядок p"
          value={orderLabel(o)}
          sub={
            <>
              {passed} з 17 умов виконано
              {o.pAut !== o.p ? ` · для автономних задач ${o.pAut === 5 ? "≥ 5" : o.pAut}` : ""}
              {theoryP !== undefined ? ` · теорія: ${theoryP}` : ""}
            </>
          }
          tone={o.p >= 1 ? "good" : "bad"}
        />
        <Stat label="Стадійний порядок q" value={o.q} sub="B(q) і C(q): точність стадій" />
        <Stat label="R(∞)" value={fmtR(st.rInf)} sub={st.rInfFormula !== null ? `1 − bᵀA⁻¹1 = ${fmtR(st.rInfFormula)}` : st.polynomial ? "R — многочлен" : "A вироджена"} tone={st.rInf === 0 ? "good" : Math.abs(st.rInf) <= 1 ? "warn" : "bad"} />
        <Stat label="A-стійкий" value={st.aStable ? "так 🛡️" : "ні"} tone={st.aStable ? "good" : "bad"} sub={st.aStable ? "|R| ≤ 1 у всій лівій півплощині" : st.polynomial ? "явний: R — многочлен" : "див. пояснення нижче"} />
        <Stat label="L-стійкий" value={st.lStable ? "так 🧯" : "ні"} tone={st.lStable ? "good" : st.aStable ? "warn" : "bad"} sub={st.lStable ? "A-стійкий і R(∞) = 0" : st.aStable ? `R(∞) = ${fmtR(st.rInf)} ≠ 0` : "не A-стійкий"} />
        <Stat label="Межа на дійсній осі" value={st.realBound === Infinity ? "∞" : `−${fmtBound(st.realBound)}`} sub="|R(x)| ≤ 1 для x ∈ [−межа, 0]" />
        <Stat
          label="Межа на уявній осі"
          value={st.imagBound === Infinity ? "∞" : st.imagBound === 0 ? "0" : `±${fmtBound(st.imagBound)}i`}
          sub={st.imagBound === 0 ? "уявної осі (крім 0) область не містить" : "|R(iy)| ≤ 1 для |y| ≤ межа"}
        />
      </div>

      <Grid>
        <Card title="Функція стійкості" icon="📈">
          <Say
            simple={
              <p className="mb-2 text-[13.5px] text-white/70">
                На тестовому рівнянні y′ = λy один крок методу множить розв&apos;язок на число R(z), де z = hλ. Ось це число для вашої таблиці:
              </p>
            }
          >
            <p className="mb-2 text-[13.5px] text-white/70">
              <Tex>{"R(z)=\\dfrac{\\det(I-zA+z\\mathbf 1 b^{\\mathsf T})}{\\det(I-zA)}=1+z\\,b^{\\mathsf T}(I-zA)^{-1}\\mathbf 1"}</Tex>; коефіцієнти: Q — суми головних
              мінорів A, P = Q·(1 + Σ bᵀA<sup>k−1</sup>1·z<sup>k</sup>):
            </p>
          </Say>
          <Tex block>{stabilityTex(st)}</Tex>
          <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-white/75">
            {st.polynomial ? (
              <Say
                simple={
                  <p>
                    Для явного методу R — звичайний многочлен степеня {st.P.length - 1}. Для великих |z| він росте до нескінченності, тому явний метод стійкий лише
                    в обмеженій області: на дійсній осі до hλ = −{fmtBound(st.realBound)}.
                  </p>
                }
              >
                <p>
                  Явний метод: R — многочлен степеня {st.P.length - 1}, <Tex>{"|R(z)|\\to\\infty"}</Tex> при <Tex>{"|z|\\to\\infty"}</Tex>, тож A-стійкості бути не
                  може. Область стійкості обмежена: на дійсній осі <Tex>{`[-${fmtBound(st.realBound)},\\,0]`}</Tex>
                  {st.imagBound > 0 ? (
                    <>
                      , на уявній — <Tex>{`|y|\\le ${fmtBound(st.imagBound)}`}</Tex>
                    </>
                  ) : (
                    <>, уявної осі (крім 0) область не містить</>
                  )}
                  .
                </p>
              </Say>
            ) : (
              <>
                <p>
                  {plain ? "Особливі точки (де знаменник = 0): " : "Полюси (корені Q): "}
                  <Tex>{poleTex || "\\varnothing"}</Tex> —{" "}
                  {st.polesRight ? (
                    <span className="text-[#3ee6a8]">усі в правій півплощині ✓</span>
                  ) : (
                    <span className="text-[#ff5d73]">є полюс у лівій півплощині чи на уявній осі ✗</span>
                  )}
                  {st.removable.length > 0 && <span className="text-white/50"> (спільні з P корені скорочено: {st.removable.length})</span>}
                </p>
                <Say
                  simple={
                    <p>
                      На уявній осі множник {st.imagOk ? "не перевищує 1" : "десь більший за 1"}: найбільше |R(iy)| на щільній сітці = {fmt(st.imagMaxNumeric, 6)}.
                    </p>
                  }
                >
                  <p>
                    Уявна вісь: <Tex>{`E(y)=|Q(iy)|^2-|P(iy)|^2=${EyTex}`}</Tex>{" "}
                    {st.imagOk ? <span className="text-[#3ee6a8]">≥ 0 для всіх y ✓</span> : <span className="text-[#ff5d73]">стає від&apos;ємним ✗</span>}; перевірка
                    сіткою: <Tex>{`\\max_y|R(iy)|=${fmt(st.imagMaxNumeric, 6)}`}</Tex>.
                  </p>
                </Say>
              </>
            )}
          </div>
          <div className="mt-3">
            {st.lStable ? (
              <Insight tone="good" title="L-стійкий" simple={<>Не вибухає за жодного кроку й гасить найшвидші (жорсткі) процеси вже за крок: R(z) → 0, коли hλ → −∞.</>}>
                A-стійкий і <Tex>{"R(\\infty)=0"}</Tex>: жорсткі моди з <Tex>{"h|\\lambda|\\gg1"}</Tex> гасяться за один крок.
              </Insight>
            ) : st.aStable ? (
              <Insight
                tone="warn"
                title={`A-стійкий, але не L-стійкий: R(∞) = ${fmtR(st.rInf)}`}
                simple={
                  <>
                    Не вибухає за жодного кроку, але найшвидші процеси при великому кроці гасить погано: множник прямує до {fmtR(st.rInf)}, тож жорстка складова
                    {Math.abs(st.rInf) > 0.99 ? " майже не зменшується" : " тане повільно"}
                    {st.rInf < 0 ? " і щокроку міняє знак" : ""}.
                  </>
                }
              >
                <Tex>{"|R(z)|\\le1"}</Tex> при <Tex>{"\\operatorname{Re}z\\le0"}</Tex>, але <Tex>{`R(-\\infty)=${numTex(st.rInf)}`}</Tex>: при <Tex>{"h|\\lambda|\\gg1"}</Tex> жорстка мода
                множиться на ≈ {fmtR(st.rInf)} щокроку{Math.abs(st.rInf) > 0.99 ? " — фактично не гаситься" : ""}.
              </Insight>
            ) : (
              <Insight
                tone="bad"
                title="Не A-стійкий"
                simple={<>Є такі hλ з Re &lt; 0 (справжній розв&apos;язок згасає), за яких метод «розгойдується»: для жорстких задач крок обмежений областю стійкості.</>}
              >
                Існують <Tex>{"z,\\ \\operatorname{Re}z<0"}</Tex>, де <Tex>{"|R(z)|>1"}</Tex>. Для жорсткої задачі крок обмежує область стійкості, а не точність.
              </Insight>
            )}
          </div>
        </Card>

        <Card title={`Умови порядку: ${passed} з 17`} icon="🌳">
          <Say
            simple={
              <p className="mb-2 text-[13.5px] text-white/70">
                Щоб метод мав порядок p, його числа мусять задовольнити певну кількість рівнянь: для порядку 1 — одне, 2 — два, 3 — чотири, 4 — вісім, 5 — сімнадцять.
                Кожне рівняння відповідає «дереву» — способу, яким похідні f вкладаються одна в одну. Зелене — виконано.
              </p>
            }
          >
            <p className="mb-2 text-[13.5px] text-white/70">
              Порядок p ⇔ <Tex>{"\\Phi(\\tau)=1/\\gamma(\\tau)"}</Tex> для всіх кореневих дерев <Tex>{"|\\tau|\\le p"}</Tex> (Батчер): {CONDITIONS_UP_TO.slice(1).join(", ")} умов
              для p = 1…5. Умови записано з <Tex>{"c_i=\\sum_j a_{ij}"}</Tex>
              {o.rowSumsOk ? "" : "; оскільки c ≠ A·1, кожну умову перевірено і з c, і з A·1 (нев'язка — найбільша)"}. Поріг: 10⁻¹².
            </p>
          </Say>
          <div className="max-h-[440px] overflow-auto rounded-xl border border-white/8">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-[#0d1024] text-white/50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">дерево</th>
                  <th className="px-2 py-1.5 text-left font-medium">умова</th>
                  <th className="px-2 py-1.5 text-right font-medium">нев&apos;язка</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((k) => {
                  const cs = o.conditions.filter((c) => c.order === k);
                  const allOk = cs.every((c) => c.ok);
                  return (
                    <Fragment key={k}>
                      <tr className="border-t border-white/[0.08] bg-white/[0.025]">
                        <td colSpan={3} className={`px-2 py-1 text-[11px] uppercase tracking-wider ${allOk ? "text-[#3ee6a8]" : "text-[#ff5d73]"}`}>
                          порядок {k}: {cs.length} {cs.length === 1 ? "умова" : cs.length < 5 ? "умови" : "умов"} {allOk ? "✓" : "✗"}
                        </td>
                      </tr>
                      {cs.map((c, i) => (
                        <tr key={i} className={`border-t border-white/[0.05] ${c.ok ? "" : "bg-[#ff5d73]/[0.06]"}`}>
                          <td className="px-2 py-0.5">
                            <TreeSvg tree={c.tree} />
                          </td>
                          <td className="px-2 py-1">
                            <Tex>{`${c.tex} = ${c.gamma === 1 ? "1" : `\\tfrac{1}{${c.gamma}}`}`}</Tex>
                            {!plain && <div className="font-mono text-[10.5px] text-white/40">Φ = {fmt(c.value, 10)}</div>}
                          </td>
                          <td className={`whitespace-nowrap px-2 py-1 text-right font-mono ${c.ok ? "text-[#3ee6a8]" : "text-[#ff5d73]"}`}>
                            {c.residual === 0 ? "0" : fmt(c.residual, 2)}{" "}
                            {c.ok ? "✓" : "✗"}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {o.atLeast && (
            <div className="mt-2 text-[12.5px] text-white/55">
              Усі 17 умов виконано: порядок <b>щонайменше 5</b> (умови 6-го порядку — ще 20 дерев — тут не перевіряються
              {preset?.theory?.p && typeof preset.theory.p !== "number" ? `; теорія для цього методу: ${preset.theory.p}` : ""}).
            </div>
          )}
        </Card>
      </Grid>
    </div>
  );
}
