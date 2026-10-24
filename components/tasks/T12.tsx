"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot from "@/components/plot/Plot";
import StiffnessPanel from "@/components/plot/StiffnessPanel";
import BeakersScene from "@/components/scenes/BeakersScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs, sup } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { cached } from "@/lib/stiffc-cache";
import { isAdaptive, sampleAt, solve, stiffnessAt, type MethodId, type Problem, type Solution } from "@/lib/ode";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import CampfireTimelineScene from "@/components/analogy/CampfireTimelineScene";
import StepDebugger, { type DebuggerView } from "@/components/debugger/StepDebugger";
import { Say } from "@/components/mode/Mode";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

const SHORT: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2", "ros", "dopri"];
const LONG: MethodId[] = ["ros", "thetaA", "dopri"];
const FIXED: MethodId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"];
const RK_BOUND: Partial<Record<MethodId, string>> = { rk2: "2", rk3: "2.513", rk4: "2.785" };
const H_LIST = [1e-4, 1e-3, 1e-2, 1e-1];
const IC = [
  { y0: [1, 0, 0], label: "(1, 0, 0)" },
  { y0: [3.00657, 4.00151e-6, 2.99343], label: "(3.00657, 4.00151·10⁻⁶, 2.99343)" },
];
const LONG_T = [40, 4e5, 1e11];
const MAX_N = 100000;

const f = (_t: number, u: number[]) => [-0.04 * u[0] + 1e4 * u[1] * u[2], 0.04 * u[0] - 1e4 * u[1] * u[2] - 3e7 * u[1] * u[1], 3e7 * u[1] * u[1]];
const jac = (_t: number, u: number[]) => [
  [-0.04, 1e4 * u[2], 1e4 * u[1]],
  [0.04, -1e4 * u[2] - 6e7 * u[1], -1e4 * u[1]],
  [0, 6e7 * u[1], 0],
];
const prob = (ic: number, T: number): Problem => ({ f, jac, y0: IC[ic].y0, T });
/**
 * Nonzero eigenvalues of J in closed form. The columns of J sum to zero (conservation law), so det J = 0 and the
 * other two roots solve λ² − τλ + M = 0 with τ = tr J and M = sum of the principal 2×2 minors = 2.4·10⁶u₂ + 6·10¹¹u₂²
 * (written out, so nothing cancels). λ_slow = M/λ_fast stays exact even when it is 10¹⁵ times smaller than λ_fast.
 */
function robEig(u: number[]) {
  const tau = -0.04 - 1e4 * u[2] - 6e7 * u[1];
  const M = 2.4e6 * u[1] + 6e11 * u[1] * u[1];
  const fast = (tau - Math.sqrt(Math.max(tau * tau - 4 * M, 0))) / 2;
  return { fast, slow: fast < 0 ? M / fast : 0 };
}
/** |λ_slow| at the second (quasi-steady) initial condition. */
const SLOW_IC2 = -robEig(IC[1].y0).slow;
/** |v| in scientific notation with Unicode superscripts outside [10⁻², 10³) (fmt switches to it only from 10⁵), e.g. 3.3·10⁴, 2·10⁹. */
const sci = (v: number, d = 2) => {
  const a = Math.abs(v);
  if (!Number.isFinite(a)) return fmt(a); // "—" / "∞" instead of a TypeError on "NaN".split("e")
  if (a >= 1e-2 && a < 1e3) return fmt(a, d);
  const [m, e] = a.toExponential(d - 1).split("e");
  return Number(m) === 1 ? `10${sup(e)}` : `${Number(m)}·10${sup(e)}`;
};
// stable references for the step debugger: u₂(t) in the first 0.03 time units from (1, 0, 0)
const DBG_Y0 = [1, 0, 0];
const DBG_VIEW: DebuggerView = { x: "t", y: 1, xLabel: "t", yLabel: "u₂", xDomain: [0, 0.03], yDomain: [-1e-5, 7e-5] };
const DBG_H = [1e-4, 1e-3, 5e-3];

function runFixed(m: MethodId, ic: number, T: number, h: number): Solution {
  const he = Math.max(h, T / MAX_N);
  return cached(`T12|${m}|${ic}|${T}|${he}`, () => solve(m, prob(ic, T), { h: he, blowup: 1e3 }));
}
function runAdaptive(m: MethodId, ic: number, T: number, tol: number): Solution {
  return cached(`T12|${m}|${ic}|${T}|${tol}`, () => solve(m, prob(ic, T), { rtol: tol, atol: tol * 1e-6, maxSteps: 60000, blowup: 1e3 }));
}
function reference(ic: number, T: number): Solution {
  return cached(`T12|ref|${ic}|${T}`, () => solve("ros", prob(ic, T), { rtol: T > 100 ? 1e-8 : 1e-10, atol: 1e-14, maxSteps: 400000 }));
}

/** Loop-based max: solutions can hold 10⁵ points, more than spread arguments allow in some browsers. */
function maxOf(a: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}

/** Max over t of component errors normalised by the component's max magnitude. */
function relErr(s: Solution, ref: Solution) {
  const scale = [0, 1, 2].map((i) => maxOf(ref.y.map((v) => Math.abs(v[i]))) || 1);
  const comps = [0, 1, 2].map((i) => ref.y.map((v) => v[i]));
  const e: number[] = [];
  let mx = 0;
  for (let k = 0; k < s.t.length; k++) {
    let ek = 0;
    for (let i = 0; i < 3; i++) ek = Math.max(ek, Math.abs(s.y[k][i] - sampleAt(ref.t, comps[i], s.t[k])) / scale[i]);
    e.push(ek);
    if (!(ek <= mx)) mx = ek;
  }
  return { max: mx, e };
}

const tone = (s: Solution, e: number) => (s.failed || !(e < 0.5) ? "bad" : e > 1e-2 ? "warn" : "good");

export default function T12() {
  const [ic, setIc] = useState(0);
  const [mode, setMode] = useState<"short" | "long">("short");
  const [h, setH] = useState(1e-4);
  const [T, setT] = useState(10);
  const [Tl, setTl] = useState(4e5);
  const [tol, setTol] = useState(1e-4);
  const [mShort, setMShort] = useState<MethodId[]>(["euler", "rk4", "bdf2", "ros"]);
  const [mLong, setMLong] = useState<MethodId[]>(["ros", "thetaA", "dopri"]);
  const [table, setTable] = useState<null | { s: Solution; e: number }[][]>(null);
  const dh = useDeferredValue(h);
  const dT = useDeferredValue(T);
  const dtol = useDeferredValue(tol);
  const ensureShort = (...ms: MethodId[]) => setMShort((cur) => [...cur, ...ms.filter((m) => !cur.includes(m))]);
  const ensureLong = (...ms: MethodId[]) => setMLong((cur) => [...cur, ...ms.filter((m) => !cur.includes(m))]);

  const Tcur = mode === "short" ? dT : Tl;
  const ref = useMemo(() => reference(ic, Tcur), [ic, Tcur]);
  const problem = useMemo(() => prob(ic, Tcur), [ic, Tcur]);
  const S0 = IC[ic].y0.reduce((s, v) => s + v, 0);
  const hEff = Math.max(dh, dT / MAX_N);

  const sols = useMemo(() => {
    const list = mode === "short" ? mShort : mLong;
    return list.map((m) => {
      const s = isAdaptive(m) ? runAdaptive(m, ic, Tcur, dtol) : runFixed(m, ic, Tcur, hEff);
      const err = relErr(s, ref);
      const cons = s.y.map((v) => Math.max(Math.abs(v[0] + v[1] + v[2] - S0), 1e-17));
      return { m, s, err, cons };
    });
  }, [mode, mShort, mLong, ic, Tcur, dtol, hEff, ref, S0]);

  const lamInfo = useMemo(() => {
    let mx = 0,
      tAt = 0;
    const n = ref.t.length;
    for (let k = 0; k < 200; k++) {
      const i = Math.floor((k / 199) * (n - 1));
      const ev = stiffnessAt(problem, ref.t[i], ref.y[i]).ev;
      const v = Math.max(...ev.map((e) => Math.abs(e.re)));
      if (v > mx) {
        mx = v;
        tAt = ref.t[i];
      }
    }
    return { mx, tAt };
  }, [ref, problem]);
  const lamEnd = useMemo(() => {
    const n = ref.t.length - 1;
    return Math.max(...stiffnessAt(problem, ref.t[n], ref.y[n]).ev.map((e) => Math.abs(e.re)));
  }, [ref, problem]);
  /** max|λ| along the reference on the assignment's interval [0, 10] for both initial conditions. */
  const lam10 = useMemo(
    () =>
      [0, 1].map((i) => {
        const r = reference(i, 10);
        const p = prob(i, 10);
        let mx = 0;
        for (let k = 0; k < 200; k++) {
          const j = Math.floor((k / 199) * (r.t.length - 1));
          mx = Math.max(mx, ...stiffnessAt(p, r.t[j], r.y[j]).ev.map((e) => Math.abs(e.re)));
        }
        return mx;
      }),
    [],
  );
  /** Stiffness ratio |λ_fast/λ_slow| (closed form) along the reference on [0, 10] for both initial conditions. */
  const ratio10 = useMemo(
    () =>
      [0, 1].map((i) => {
        const r = reference(i, 10);
        let mx = 0;
        for (let k = 0; k < 200; k++) {
          const e = robEig(r.y[Math.floor((k / 199) * (r.t.length - 1))]);
          if (e.slow < 0) mx = Math.max(mx, e.fast / e.slow);
        }
        return mx;
      }),
    [],
  );
  /** From (1, 0, 0) on long intervals: |λ_slow| and the stiffness ratio at t = 4·10⁵ and 10¹¹ (cheap run, rtol 10⁻⁵, ≈ 10⁻⁴ accurate). */
  const ratioLong = useMemo(
    () =>
      [4e5, 1e11].map((TT) => {
        const s = cached(`T12|stiffLong|${TT}`, () => solve("ros", prob(0, TT), { rtol: 1e-5, atol: 1e-20, maxSteps: 20000 }));
        const e = robEig(s.y[s.y.length - 1]);
        return { slow: -e.slow, ratio: e.fast / e.slow };
      }),
    [],
  );
  /** Closed-form slow mode at the end of the shown reference and the time it falls below the panel's 10⁻¹¹·max cut-off. */
  const stiffEnd = useMemo(() => {
    const n = ref.t.length - 1;
    const e = robEig(ref.y[n]);
    const below = (i: number) => {
      const ei = robEig(ref.y[i]);
      return -ei.slow <= 1e-11 * -ei.fast;
    };
    // start of the final stretch where the slow mode is below the cut-off (NaN if the end is above it)
    let tCut = NaN;
    if (below(n)) {
      let i = n;
      while (i > 1 && below(i - 1)) i--;
      tCut = ref.t[i];
    }
    return { t: ref.t[n], slow: -e.slow, ratio: e.slow < 0 ? e.fast / e.slow : NaN, tCut };
  }, [ref]);

  const tMin = mode === "short" ? Math.min(1e-6, hEff / 2) : 1e-6;
  const pos = (arr: number[]) => arr.map((v) => (v > 0 ? v : NaN));
  const cutT = (s: Solution) => s.t.map((t) => Math.max(t, tMin));

  const u13 = useMemo(
    () => [
      { x: cutT(ref), y: ref.y.map((v) => v[0]), color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      { x: cutT(ref), y: ref.y.map((v) => v[2]), color: "#ffffff", width: 4, opacity: 0.3 },
      ...sols.flatMap(({ m, s, err }) => {
        const bad = !!s.failed || err.max > 0.5;
        const st = { color: METHODS[m].color, width: bad ? 1 : 1.6, opacity: bad ? 0.45 : 1 };
        return [
          { x: cutT(s), y: s.y.map((v) => v[0]), label: METHODS[m].short, ...st },
          { x: cutT(s), y: s.y.map((v) => v[2]), ...st, dash: [5, 3] },
        ];
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref, sols, tMin],
  );
  const u2 = useMemo(
    () => [
      { x: cutT(ref), y: pos(ref.y.map((v) => v[1])), color: "#ffffff", width: 4, opacity: 0.3, label: "еталон" },
      ...sols.map(({ m, s, err }) => {
        const bad = !!s.failed || err.max > 0.5;
        return { x: cutT(s), y: pos(s.y.map((v) => v[1])), color: METHODS[m].color, label: METHODS[m].short, width: bad ? 1 : 1.6, opacity: bad ? 0.45 : 1 };
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref, sols, tMin],
  );
  const classic = useMemo(
    () => [
      { x: cutT(ref), y: ref.y.map((v) => v[0] / S0), color: "#ffb547", width: 2.2, label: "u₁" },
      { x: cutT(ref), y: ref.y.map((v) => (v[1] * 1e4) / S0), color: "#ff5d73", width: 2.2, label: "u₂ × 10⁴" },
      { x: cutT(ref), y: ref.y.map((v) => v[2] / S0), color: "#5cc8ff", width: 2.2, label: "u₃" },
      ...sols
        .filter(({ m }) => m !== "ros")
        .flatMap(({ m, s }) => [0, 1, 2].map((i) => ({ x: cutT(s), y: s.y.map((v) => (v[i] * (i === 1 ? 1e4 : 1)) / S0), color: METHODS[m].color, width: 1, opacity: 0.8, dash: [4, 3] }))),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref, sols, tMin, S0],
  );

  const eul = sols.find((r) => r.m === "euler");
  const rkFail = sols.filter((r) => (r.m === "rk2" || r.m === "rk3" || r.m === "rk4") && r.s.failed);
  const dop = sols.find((r) => r.m === "dopri");
  const ros = sols.find((r) => r.m === "ros");
  const hlam = hEff * lamInfo.mx;
  /** steps for the linear factor |1 + hλ| to blow round-off (~1e-16) up to O(1) */
  const linSteps = Math.round(Math.log(1e16) / Math.log(Math.max(hlam - 1, 1.001)));
  /**
   * Why explicit Euler outlives the linear estimate. With u₁, u₃ frozen its step for u₂ is the quadratic map z ↦ z + h(A − Bz − Cz²)
   * (A = 0.04u₁, B = 10⁴u₃, C = 3·10⁷), affinely conjugate to the logistic map with r = 1 + q, q = h√(B² + 4AC) ≈ h|λ_fast|: a 2-cycle for
   * 2 < q < √6, period doubling up to q ≈ 2.57, bounded chaos, escape only for q > 3. q is measured on Euler's own solution (where C
   * accumulates faster than in reality) and, for comparison, on the reference at the moment Euler's q reaches 3.
   */
  const eulEsc = useMemo(() => {
    if (mode !== "short" || !eul?.s.failed) return null;
    const { t, y } = eul.s;
    const qOf = (u1: number, u3: number) => hEff * Math.sqrt(Math.max((1e4 * u3) ** 2 + 4 * 0.04 * u1 * 3e7, 0));
    const levels = [Math.sqrt(6), 2.57, 3];
    const cross = levels.map(() => NaN);
    let tNeg = NaN,
      k3 = -1;
    for (let k = 0; k < t.length; k++) {
      const u = y[k];
      if (!(Math.abs(u[0]) < 1e3 && Math.abs(u[1]) < 1e3 && Math.abs(u[2]) < 1e3)) break;
      const q = qOf(u[0], u[2]);
      levels.forEach((L, i) => {
        if (Number.isNaN(cross[i]) && q >= L) cross[i] = t[k];
      });
      if (k3 < 0 && q >= 3) k3 = k;
      if (Number.isNaN(tNeg) && u[1] < 0) tNeg = t[k];
    }
    const at3 =
      k3 >= 0
        ? {
            steps: t.length - 1 - k3,
            u3: y[k3][2],
            u3ref: sampleAt(ref.t, ref.y.map((v) => v[2]), t[k3]),
            qRef: qOf(sampleAt(ref.t, ref.y.map((v) => v[0]), t[k3]), sampleAt(ref.t, ref.y.map((v) => v[2]), t[k3])),
          }
        : null;
    return { q0: qOf(y[0][0], y[0][2]), cross, tNeg, at3 };
  }, [mode, eul, hEff, ref]);
  /** "при t ≈ …" for a threshold crossing of q (or "уже на старті" when q is above it from t = 0). */
  const whenQ = (tc: number) => (tc === 0 ? "уже на старті" : `при t ≈ ${fmt(tc, 3)}`);
  /** "N крок / кроки / кроків" with the Ukrainian plural. */
  const nSteps = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "крок" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "кроки" : "кроків"}`;

  const computeTable = () => {
    const rows = FIXED.map((m) =>
      H_LIST.map((hh) => {
        const s = runFixed(m, ic, 10, hh);
        return { s, e: relErr(s, reference(ic, 10)).max };
      }),
    );
    setTable(rows);
  };

  const analogy = useMemo(
    () => (
      <>
        <AnalogyCard
          emoji="🔥"
          title="Багаття: спалах за мить, горіння — годинами, жар — тисячоліттями"
          story={
            <>
              Чиркнули сірником — полум&apos;я спалахує за <b>мілісекунди</b>. Дрова горять години, а жар тліє днями. Полум&apos;я весь час крихітне — його в
              десятки тисяч разів менше, ніж дров, — але саме через нього дрова перетворюються на попіл. У реакції Робертсона так само: речовина A (дрова)
              повільно переходить у B (полум&apos;я), B майже миттєво перетворює себе на C (попіл), а C ще й гасить B. Процеси, що тривають мілісекунди й
              тисячоліття, — в одній системі рівнянь.
            </>
          }
          mapping={[
            ["дрова", <>речовина A, u₁ (на старті 1)</>],
            ["полум'я — крихітне, але все вирішує", <>проміжна B, u₂ ≤ 3.7·10⁻⁵</>],
            ["попіл", <>речовина C, u₃</>],
            ["спалах за мілісекунди", <>швидке власне число, |λ| до ~10⁴</>],
            ["«нічого не зникає»", <>закон збереження u₁ + u₂ + u₃ = const</>],
          ]}
        >
          <CampfireTimelineScene />
        </AnalogyCard>
      </>
    ),
    // static block (only stable setters inside): keep it out of slider-driven re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const extras = useMemo(
    () => (
      <>
        <Section kicker="Під мікроскопом" title="Один крок методу — покроково" simpleTitle="Як метод робить один крок" report={false}>
          <StepDebugger
            f={f}
            y0={DBG_Y0}
            T={0.03}
            view={DBG_VIEW}
            h0={1e-3}
            hMin={2e-5}
            hMax={6e-3}
            hPresets={DBG_H}
            hPresetsLabel="Кроки для порівняння"
            hint={
              <Say
                simple={
                  <>
                    Дивимося лише на полум&apos;я B (u₂) у перші 0.03 одиниці часу, старт (1, 0, 0). Справжнє B плавно росте до 3.65·10⁻⁵ і там тримається.
                    Явний Ейлер з h = 10⁻³ (удесятеро більше, ніж в умові) перестрибує: 4.0·10⁻⁵, 3.2·10⁻⁵, 4.1·10⁻⁵, 3.0·10⁻⁵… — зигзаг навколо правди. З h =
                    5·10⁻³ перший же крок закидає B у 5 разів вище за максимум, а далі — вибух. Неявний Ейлер з тим самим кроком за 2–3 кроки сідає на «поличку».
                  </>
                }
              >
                Компонента u₂(t) задачі Робертсона з (1, 0, 0) на [0, 0.03]. Уже при t ≈ 10⁻² швидке власне число ≈ −2.2·10³, тож для h = 10⁻³ маємо h|λ| ≈ 2.2
                &gt; 2: явний крок для u₂ — логістичне відображення в режимі періоду 2, зигзаг навколо квазістаціонарного значення, а не розбіжність. З h = 5·10⁻³
                перший крок дає u₂ = 0.04h = 2·10⁻⁴ (у 5.5 раза більше за максимум 3.65·10⁻⁵) і вибух на 4-му кроці; RK2, RK3 і RK4 уже першим кроком дають
                від&apos;ємне u₂ (≈ −1.3·10⁻³, −0.2 і −99.7 відповідно), а на другому вибухають. Неявний
                Ейлер і BDF2 за 2–3 кроки виходять на квазістаціонарний многовид.
              </Say>
            }
          />
        </Section>

        <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
          <QuizBlock
            taskId="12"
            questions={[
              {
                id: "ic1",
                q: <>Старт (1, 0, 0), явний Ейлер з кроком із методички h = 10⁻⁴ на [0, 10]. Що буде?</>,
                options: ["💥 Вибухне — задача ж «найжорсткіша»", "Пройде стійко до кінця", "Пройде, але сума u₁ + u₂ + u₃ «попливе» на відсотки", "Розгойдається й вибухне біля t ≈ 9"],
                correct: 1,
                explain: (
                  <>
                    На [0, 10] з (1, 0, 0) max|λ| ≈ 2.56·10³ (при t = 10), тож h|λ| ≈ 0.26 &lt; 2 — усередині області стійкості. Ейлер робить свої 100 000 кроків
                    без пригод, сума зберігається з точністю округлення. Вибух біля t ≈ 9.4 справді буває — але з кроком удесятеро більшим, h = 10⁻³.
                  </>
                ),
                explainSimple: <>Найшвидший процес тут має темп лише ~2.5 тисячі, і крок 10⁻⁴ для нього достатньо дрібний (h·|λ| ≈ 0.26 &lt; 2). Жорстка задача не забороняє явний метод — вона змушує його дріботіти: 100 000 кроків.</>,
                show: {
                  label: "Показати h = 10⁻⁴, старт (1, 0, 0)",
                  run: () => {
                    setMode("short");
                    setIc(0);
                    setT(10);
                    setH(1e-4);
                    ensureShort("euler");
                  },
                },
              },
              {
                id: "ic2",
                q: <>Той самий явний Ейлер з h = 10⁻⁴, але друга умова — (3.00657, 4.00151·10⁻⁶, 2.99343). Що тепер?</>,
                options: ["Так само стійко", "💥 Вибух майже одразу, при t ≈ 0.005", "Стійко, але похибка ≈ 1 %", "Повільне розгойдування, вибух лише біля t ≈ 9"],
                correct: 1,
                explain: (
                  <>
                    Тут u₃ ≈ 3, і реакція B + C → A + C гасить B дуже швидко: швидке власне число одразу ≈ −3.0·10⁴, h|λ| ≈ 3.02 &gt; 2. Множник |1 + hλ| ≈ 2.02 —
                    похибка подвоюється щокроку, і вже на 46-му кроці (t ≈ 0.0046) розв&apos;язок перетинає поріг 10³. RK3 (межа 2.513) і RK4 (межа 2.785) тримаються
                    довше, але теж вибухають (t ≈ 0.16 і 0.25); RK2 не вибухає, але з&apos;їжджає на хибне від&apos;ємне u₂ ≈ −3.4·10⁻⁴.
                  </>
                ),
                explainSimple: <>У цій суміші попелу C багато, і полум&apos;я B гасне в ~12 разів швидше (темп ~3·10⁴). Тепер крок 10⁻⁴ задовгий: h·|λ| ≈ 3 &gt; 2, похибка подвоюється щокроку — і за 46 кроків усе вибухає.</>,
                show: {
                  label: "Показати другу умову",
                  run: () => {
                    setMode("short");
                    setIc(1);
                    setT(10);
                    setH(1e-4);
                    ensureShort("euler");
                  },
                },
              },
              {
                id: "dopri",
                q: (
                  <>
                    Режим «довгий час», T = 4·10⁵, rtol = 10⁻⁴. DOPRI — чудовий адаптивний метод 5-го порядку, але явний; ліміт — 60 000 кроків. Як далеко він
                    зайде?
                  </>
                ),
                options: ["Пройде весь відрізок за ~500 кроків, як Розенброк", "Пройде весь, але за ~50 000 кроків", "Застрягне біля t ≈ 60 — це 0.015 % шляху", "Вибухне на першому кроці"],
                correct: 2,
                explain: (
                  <>
                    DOPRI вичерпує 60 000 спроб (57 496 прийнятих + 2 504 відхилених кроків) і зупиняється при t ≈ 61: його крок прикутий до межі стійкості ~3.3/|λ|
                    ≈ 10⁻³. Розенброк проходить увесь [0, 4·10⁵] за 382 кроки, θA — за 228 (+9 відхилених).
                  </>
                ),
                explainSimple: <>Явний метод мусить крокувати під найшвидший процес, навіть коли все давно заспокоїлось: крок ~0.001. 60 000 таких кроків — це лише до t ≈ 61. Розенброку на весь шлях вистачає 382 кроків.</>,
                show: {
                  label: "Показати довгий час",
                  run: () => {
                    setMode("long");
                    setTl(4e5);
                    setTol(1e-4);
                    ensureLong("dopri", "ros");
                  },
                },
              },
            ]}
          />
        </Section>
      </>
    ),
    // static block (only stable setters inside): keep it out of slider-driven re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      {analogy}

      <Section kicker="Постановка" title="Три реакції — три різні часові масштаби" simpleTitle="Три реакції: одна повільна, дві блискавичні">
        <Grid>
          <Card title="Модель із методички" icon="📜">
            <Tex block>{String.raw`A \xrightarrow{\;0.04\;} B,\qquad B + B \xrightarrow{\;3\cdot10^{7}\;} C + B,\qquad B + C \xrightarrow{\;10^{4}\;} A + C`}</Tex>
            <Tex block>{String.raw`\begin{aligned} u_1' &= -0.04\,u_1 + 10^4 u_2 u_3,\\ u_2' &= 0.04\,u_1 - 10^4 u_2u_3 - 3\cdot10^7 u_2^2,\\ u_3' &= 3\cdot 10^7 u_2^2 .\end{aligned}`}</Tex>
            <Say
              simple={
                <p className="mt-1 text-[14px] leading-relaxed text-white/75">
                  u₁, u₂, u₃ — скільки є речовин A, B, C (образно: дрова, полум&apos;я, попіл). Старт: або лише A — (1, 0, 0), або вже «розгорілена» суміш
                  (3.00657, 4.00151·10⁻⁶, 2.99343). Рахуємо на [0, 10] з кроком h = 10⁻⁴, тобто 100 000 кроків.
                </p>
              }
            >
              <p className="mt-1 text-[14px] leading-relaxed text-white/75">
                Початкові умови: <Tex>{"(1, 0, 0)"}</Tex> або <Tex>{String.raw`(3.00657,\ 4.00151\cdot10^{-6},\ 2.99343)`}</Tex>. Крок <Tex>{"h = 10^{-4}"}</Tex> на{" "}
                <Tex>{"[0, 10]"}</Tex>. <Tex>{"u_1, u_2, u_3"}</Tex> — концентрації речовин A, B, C.
              </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="info"
                title="Закон збереження"
                simpleTitle="Нічого не зникає"
                simple={
                  <>
                    Якщо скласти три рівняння, праві частини взаємно знищаться: сума A + B + C не змінюється — речовина лише переходить з однієї форми в іншу.
                    Кожен наш метод зберігає цю суму точно (до округлення), тож це зручна перевірка: помітне порушення — ознака біди.
                  </>
                }
              >
                Додавши рівняння, отримаємо <Tex>{"(u_1+u_2+u_3)' = 0"}</Tex>: загальна маса не змінюється. Це лінійний інваріант, і будь-який лінійний багатокроковий
                чи Рунге–Кутта метод зберігає його <b>точно</b> (до похибки округлення і точності розв&apos;язання рівнянь Ньютона) — перевіримо нижче.
              </Insight>
            </div>
          </Card>
          <Card title="Чому це «найвідоміша жорстка задача»" icon="🔬">
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Швидкості трьох реакцій відрізняються в мільярд разів. Полум&apos;я B з&apos;являється повільно, а зникає миттєво — тому його завжди лише дещиця
                  (не більше 3.7·10⁻⁵). Матриця нижче (якобіан) описує, як швидко система «відповідає» на маленький поштовх:
                </p>
              }
            >
              <p className="text-[14px] leading-relaxed text-white/75">
                Константи швидкостей відрізняються в <Tex>{"10^9"}</Tex> разів. Проміжна речовина B утворюється повільно, а зникає миттєво, тому її концентрація
                крихітна (<Tex>{"u_2 \\lesssim 3.7\\cdot 10^{-5}"}</Tex>). Якобіан:
              </p>
            </Say>
            <Tex block>{String.raw`J = \begin{pmatrix} -0.04 & 10^4 u_3 & 10^4 u_2 \\ 0.04 & -10^4u_3 - 6\cdot10^7u_2 & -10^4 u_2 \\ 0 & 6\cdot 10^7 u_2 & 0\end{pmatrix}`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/75">
                  Одне з її чисел завжди нуль — це закон збереження. Зі старту (1, 0, 0) найшвидший процес спершу «спить» (B і C ще немає), за 0.01 вже має темп
                  ~2 200 за одиницю часу, а на [0, 10] сягає ≈ {fmt(lam10[0], 3)}. З другої умови — одразу ≈ {fmt(lam10[1], 3)}, тоді як найповільніший тягнеться з
                  темпом ~{sci(SLOW_IC2)}: на [0, 10] вони відрізняються в ≈ {sci(ratio10[1])} разів (з першої умови — в ≈ {sci(ratio10[0])}).{" "}
                  <Relatable kind="ratio" n={ratio10[1]} /> А з часом розрив лише росте: найповільніший процес згасає разом із полум&apos;ям B, тож при t = 4·10⁵
                  відношення ≈ {sci(ratioLong[0].ratio)}, а при t = 10¹¹ — ≈ {sci(ratioLong[1].ratio)}.
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/75">
              Одне власне число завжди нуль (закон збереження). Для першої умови повільне <Tex>{"\\sim -0.04\\ldots-0.4"}</Tex>, а швидке стартує з нуля (при{" "}
              <Tex>{"t=0"}</Tex> ще <Tex>{"u_2=u_3=0"}</Tex>), за <Tex>{"t\\approx10^{-5}"}</Tex> сягає <Tex>{"-24"}</Tex>, за <Tex>{"t\\approx10^{-2}"}</Tex> — вже{" "}
              <Tex>{"-2.2\\cdot10^{3}"}</Tex> і далі повільно росте за модулем разом з <Tex>{"u_3"}</Tex>: на <Tex>{"[0,10]"}</Tex> максимум{" "}
              <Tex>{`\\approx ${fmt(lam10[0], 3)}`}</Tex> (при <Tex>{"t=10"}</Tex>), на <Tex>{"[0,40]"}</Tex> — <Tex>{"\\approx 3.4\\cdot10^3"}</Tex>. Для другої умови
              (квазістаціонарний старт) швидке власне число одразу <Tex>{`\\approx -${fmt(lam10[1], 3)}`}</Tex>, а повільне лише ≈ −{sci(SLOW_IC2)}. Коефіцієнт
              жорсткості на <Tex>{"[0,10]"}</Tex>: ≈ {sci(ratio10[0])} для першої умови і ≈ {sci(ratio10[1])} для другої. На довгому інтервалі він необмежено росте:
              оскільки <Tex>{"\\det J = 0"}</Tex>, ненульові власні числа — корені <Tex>{"\\lambda^2 - \\tau\\lambda + M = 0"}</Tex>, де{" "}
              <Tex>{"M = 2.4\\cdot10^6u_2 + 6\\cdot10^{11}u_2^2"}</Tex>, тож <Tex>{"\\lambda_{\\text{slow}} \\approx M/\\tau \\to 0"}</Tex> разом з <Tex>{"u_2"}</Tex>. Для
              першої умови при <Tex>{"t = 4\\cdot10^5"}</Tex> повільне ≈ −{sci(ratioLong[0].slow, 3)} (коефіцієнт ≈ {sci(ratioLong[0].ratio)}), при{" "}
              <Tex>{"t = 10^{11}"}</Tex> — ≈ −{sci(ratioLong[1].slow, 1)} (≈ {sci(ratioLong[1].ratio)}).
            </p>
            </Say>
            <div className="mt-3">
              <Insight
                tone="note"
                title="Цікавий поворот умови"
                simple={
                  <>
                    З кроком з умови h = 10⁻⁴ і стартом (1, 0, 0) навіть явний Ейлер не вибухає: h·|λ| ≈ {fmt(1e-4 * lam10[0], 2)} &lt; 2. А з другою умовою (попелу
                    багато, полум&apos;я гасне швидко) h·|λ| ≈ {fmt(1e-4 * lam10[1], 3)} &gt; 2 — і він вибухає (RK3 і RK4 теж; RK2 не вибухає, але рахує нісенітницю:
                    полум&apos;я B у нього стає від&apos;ємним). Жорсткість залежить не лише від рівнянь, а й від того, де ми на траєкторії.
                  </>
                }
              >
                З кроком <Tex>{"h=10^{-4}"}</Tex> і першою початковою умовою <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(1e-4 * lam10[0], 2)} < 2`}</Tex> — навіть явний Ейлер
                стійкий! Для другої умови <Tex>{`h|\\lambda| \\approx ${fmt(1e-4 * lam10[1], 3)} > 2`}</Tex> — і він вибухає (RK3 і RK4 теж: межі 2.513 і 2.785; RK2 з межею
                2 не вибухає, але це не порятунок — його u₂ з&apos;їжджає на хибну від&apos;ємну «поличку» ≈ −3.4·10⁻⁴ замість 4·10⁻⁶). Жорсткість — властивість не лише
                рівнянь, а й траєкторії.
              </Insight>
            </div>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Лабораторія" title="Колби, кроки і вибухи">
        <Lab
          controls={
            <>
              <Chips label="Початкова умова" value={ic} onChange={setIc} options={IC.map((c, i) => ({ value: i, label: c.label }))} />
              <Chips
                label="Режим"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "short", label: "Умова: [0, T], фіксований h" },
                  { value: "long", label: "Довгий час (адаптивні)" },
                ]}
              />
              {mode === "short" ? (
                <>
                  <MethodPicker methods={SHORT} value={mShort} onChange={setMShort} />
                  <Chips label="Крок h" value={H_LIST.includes(h) ? h : -1} onChange={(v) => v > 0 && setH(v)} options={H_LIST.map((v) => ({ value: v, label: fmt(v, 1) }))} />
                  <Slider label="Довільний крок h" value={h} onChange={setH} min={1e-4} max={0.2} log format={(v) => fmt(v, 3)} />
                  <Slider label="Кінець відрізка T" value={T} onChange={setT} min={0.5} max={40} step={0.5} hint={hEff > dh ? `крок обмежено до T/${MAX_N} = ${fmt(hEff, 2)}` : undefined} />
                </>
              ) : (
                <>
                  <MethodPicker methods={LONG} value={mLong} onChange={setMLong} />
                  <Chips label="Кінець T" value={Tl} onChange={setTl} options={LONG_T.map((v) => ({ value: v, label: fmt(v, 1) }))} />
                </>
              )}
              <Slider label="Точність rtol (адаптивні)" value={tol} onChange={setTol} min={1e-7} max={1e-2} log format={(v) => fmt(v, 2)} />
              <div className="rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/65">
                <Say
                  simple={
                    <>
                      Найшвидший процес на цій траєкторії має темп ≈ <span className="font-mono text-white">{fmt(lamInfo.mx, 3)}</span> за одиницю часу (при t ≈{" "}
                      {fmt(lamInfo.tAt, 2)}).
                      {mode === "short" && <> Крок × темп = {fmt(hlam, 3)}: явний Ейлер і RK2 витримують до 2, RK3 — до 2.513, RK4 — до 2.785.</>}
                    </>
                  }
                >
                  max|λ| вздовж траєкторії ≈ <span className="font-mono text-white">{fmt(lamInfo.mx, 3)}</span> (при t ≈ {fmt(lamInfo.tAt, 2)}).
                  {mode === "short" && (
                    <>
                      {" "}
                      <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(hlam, 3)}`}</Tex>; межа Ейлера і RK2 — 2, RK3 — 2.513, RK4 — 2.785.
                    </>
                  )}
                </Say>
              </div>
            </>
          }
        >
          {mode === "short" ? (
            <>
              <Grid>
                <Card>
                  <Plot title="u₁ (суцільні) і u₃ (пунктир), лог. час" height={260} logX xLabel="t" xDomain={[tMin, dT]} yDomain={ic ? [-0.2, S0 * 0.62] : [-0.05, 1.05]} series={u13} />
                </Card>
                <Card>
                  <Plot title="u₂ — проміжна речовина B (log–log)" height={260} logX logY xLabel="t" xDomain={[tMin, dT]} yDomain={[1e-9, 1e-3]} series={u2} />
                </Card>
              </Grid>
              <Grid>
                <Card>
                  <Plot
                    title="Нормована похибка відносно еталону"
                    height={230}
                    logX
                    logY
                    xLabel="t"
                    xDomain={[tMin, dT]}
                    yDomain={[1e-14, 10]}
                    series={sols.map(({ m, s, err }) => ({ x: cutT(s), y: err.e.map((v) => Math.max(v, 1e-16)), color: METHODS[m].color, label: METHODS[m].short, width: 1.3 }))}
                  />
                </Card>
                <Card>
                  <Plot
                    title="Порушення закону збереження |Σuᵢ − Σuᵢ(0)|"
                    height={230}
                    logX
                    logY
                    xLabel="t"
                    xDomain={[tMin, dT]}
                    yDomain={[1e-17, 1e2]}
                    series={sols.map(({ m, s, cons }) => ({ x: cutT(s), y: cons, color: METHODS[m].color, label: METHODS[m].short, width: 1.3 }))}
                  />
                </Card>
              </Grid>
            </>
          ) : (
            <>
              <Card>
                <Plot
                  title="Класична картинка: u₁, 10⁴·u₂, u₃ (нормовані на Σu) на лог. шкалі часу"
                  height={320}
                  logX
                  xLabel="t"
                  xDomain={[1e-6, Tl]}
                  yDomain={[-0.03, 1.08]}
                  series={classic}
                />
                <p className="mt-2 text-[12.5px] text-white/50">
                  <Say
                    simple={
                      <>
                        Суцільні — дуже точний еталон; пунктир — інші вибрані методи. Дрова A тануть, попіл C росте, а полум&apos;я B (×10⁴) спершу спалахує, а потім
                        повільно згасає разом із дровами. DOPRI обривається там, де вичерпав 60 000 кроків.
                      </>
                    }
                  >
                    Суцільні — еталон (Розенброк, rtol 10⁻⁸); пунктир — інші вибрані методи. DOPRI обривається там, де вичерпав 60 000 кроків.
                  </Say>
                </p>
              </Card>
              <Card>
                <Plot
                  title="Розмір кроку h(t) (log–log): від 10⁻⁶ до 10¹⁰"
                  height={250}
                  logX
                  logY
                  xLabel="t"
                  yLabel="h"
                  xDomain={[1e-6, Tl]}
                  series={sols.map(({ m, s }) => ({ x: s.t.slice(1), y: s.hs, color: METHODS[m].color, label: METHODS[m].short, width: 1.5 }))}
                />
              </Card>
            </>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sols.map(({ m, s, err, cons }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? (s.failed.includes("ліміт") ? "⛔" : "💥") : `${s.steps.toLocaleString("uk-UA")} кр.`}
                sub={
                  s.failed
                    ? `${s.failed} · ${s.steps.toLocaleString("uk-UA")} кр.`
                    : `${isAdaptive(m) ? `відхил. ${s.rejected} · ` : ""}${fmtMs(s.ms)} · похибка ${fmt(err.max, 2)} · Σ: ${fmt(maxOf(cons), 1)}`
                }
                tone={tone(s, err.max)}
              />
            ))}
          </div>

          {mode === "short" && eul && !eul.s.failed && (
            <Insight
              tone="good"
              title="Явний Ейлер вижив!"
              simple={
                <>
                  Крок × темп ≈ {fmt(hlam, 3)} &lt; 2 — крок достатньо дрібний, і явний Ейлер стійкий. Жорсткість не забороняє явні методи, вона змушує їх дріботіти:
                  тут {eul.s.steps.toLocaleString("uk-UA")} кроків{ros && !ros.s.failed ? `, а Розенброку вистачає ${ros.s.steps}` : ""}.{" "}
                  <Relatable kind="steps" n={eul.s.steps} />
                </>
              }
            >
              <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(hlam, 3)} < 2`}</Tex> — крок <Tex>{`h=${fmt(hEff, 2)}`}</Tex> лежить в області стійкості. Жорсткість не забороняє
              явні методи — вона лише змушує брати дрібний крок: тут {eul.s.steps.toLocaleString("uk-UA")} кроків
              {ros && !ros.s.failed ? ` там, де Розенброку вистачає ${ros.s.steps}` : ""}.
            </Insight>
          )}
          {mode === "short" && eul && eul.s.failed && (
            <Insight
              tone="bad"
              title="Явний Ейлер вибухнув"
              simple={
                <>
                  Крок × темп ≈ {fmt(hlam, 3)} &gt; 2: крок задовгий для найшвидшого процесу.
                  {hlam < 3.2 &&
                    (eul.s.steps > 2 * linSteps ? (
                      <>
                        {" "}
                        Вибухнув не одразу: за лінійною оцінкою (множник ≈ {fmt(hlam - 1, 3)} на крок) вистачило б ~{linSteps.toLocaleString("uk-UA")} кроків, а він
                        протримався {eul.s.steps.toLocaleString("uk-UA")}. Полум&apos;я B «тремтить» — то вище, то нижче правди
                        {eulEsc && Number.isFinite(eulEsc.tNeg) ? ` (з t ≈ ${fmt(eulEsc.tNeg, 3)} буває навіть від'ємним)` : ""}, але не розбігається. Через
                        це тремтіння попіл C накопичується швидше, ніж насправді, процес пришвидшується, і тремтіння ускладнюється (період 2 → 4 → хаос).
                        {eulEsc?.at3 ? (
                          <>
                            {" "}
                            Розв&apos;язок тікає, лише коли «крок × темп» на власному розв&apos;язку Ейлера сягає 3 ({whenQ(eulEsc.cross[2])}; на правильному
                            розв&apos;язку в цей момент лише {fmt(eulEsc.at3.qRef, 3)}) — після цього вистачає {nSteps(eulEsc.at3.steps)}.
                          </>
                        ) : (
                          <> Розв&apos;язок тікає, лише коли «крок × темп» на власному розв&apos;язку Ейлера перевищує 3.</>
                        )}
                      </>
                    ) : (
                      <>
                        {" "}
                        Щокроку похибка множиться на ≈ {fmt(hlam - 1, 3)}, тож уже за ~{linSteps.toLocaleString("uk-UA")} кроків навіть похибка округлення виростає до
                        розміру розв&apos;язку (Ейлер протримався {eul.s.steps.toLocaleString("uk-UA")}).
                      </>
                    ))}
                </>
              }
            >
              <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(hlam, 3)} > 2`}</Tex>. {eul.s.failed}.{" "}
              {hlam < 3.2 && (
                <>
                  Чому не одразу? Лінійний множник <Tex>{`|1+h\\lambda| \\approx ${fmt(hlam - 1, 3)}`}</Tex> роздув би похибку округлення до O(1) за ~
                  {linSteps.toLocaleString("uk-UA")} кроків, а Ейлер протримався {eul.s.steps.toLocaleString("uk-UA")}.
                  {eul.s.steps > 2 * linSteps ? (
                    <>
                      {" "}
                      Річ у нелінійності: якщо заморозити <Tex>{"u_1, u_3"}</Tex>, крок Ейлера для <Tex>{"u_2"}</Tex> — квадратичне відображення{" "}
                      <Tex>{"z \\mapsto z + h(A - Bz - Cz^2)"}</Tex> (<Tex>{"A = 0.04u_1,\\ B = 10^4u_3,\\ C = 3\\cdot10^7"}</Tex>), афінно спряжене з логістичним з{" "}
                      <Tex>{"r = 1 + q"}</Tex>, де <Tex>{"q = h\\sqrt{B^2 + 4AC} \\approx h|\\lambda_{\\text{fast}}|"}</Tex>. При <Tex>{"2 < q < \\sqrt6 \\approx 2.45"}</Tex> воно не
                      розбігається, а «тремтить» з періодом 2 навколо квазістаціонарного значення; далі — подвоєння періоду (4, 8, …), з <Tex>{"q \\approx 2.57"}</Tex>{" "}
                      — обмежений хаос, а розбігається воно лише при <Tex>{"q > 3"}</Tex>.
                      {eulEsc && Number.isFinite(eulEsc.tNeg) && (
                        <>
                          {" "}
                          Від&apos;ємне <Tex>{"u_2"}</Tex> (тут уперше при t ≈ {fmt(eulEsc.tNeg, 3)}) — ще не вибух.
                        </>
                      )}{" "}
                      На тремтливому розв&apos;язку <Tex>{"\\langle u_2^2\\rangle > u_2^{*2}"}</Tex>, тож C накопичується швидше, ніж насправді, і <Tex>{"q"}</Tex> на власному
                      розв&apos;язку Ейлера росте швидше за еталонне
                      {eulEsc && (
                        <>
                          {" "}
                          (на старті <Tex>{`q \\approx ${fmt(eulEsc.q0, 3)}`}</Tex>
                          {Number.isFinite(eulEsc.cross[0]) && `; √6 — ${whenQ(eulEsc.cross[0])}`}
                          {Number.isFinite(eulEsc.cross[1]) && `; 2.57 — ${whenQ(eulEsc.cross[1])}`})
                        </>
                      )}
                      .
                      {eulEsc?.at3 ? (
                        <>
                          {" "}
                          Рівень <Tex>{"q = 3"}</Tex> досягається {whenQ(eulEsc.cross[2])} (<Tex>{"u_3"}</Tex> = {fmt(eulEsc.at3.u3, 3)} проти {fmt(eulEsc.at3.u3ref, 3)} в еталоні,
                          де <Tex>{"q"}</Tex> лише {fmt(eulEsc.at3.qRef, 3)}) — і через {nSteps(eulEsc.at3.steps)} розв&apos;язок тікає.
                        </>
                      ) : (
                        <> Розв&apos;язок тікає, лише коли q на власному розв&apos;язку Ейлера перевищує 3.</>
                      )}
                    </>
                  ) : (
                    " Тобто вибух іде за лінійною теорією — нелінійність тут не встигає втрутитися."
                  )}
                </>
              )}
            </Insight>
          )}
          {mode === "short" && rkFail.length > 0 && (
            <Insight
              tone="bad"
              title={`${rkFail.map((r) => METHODS[r.m].short).join(", ")} теж не ${rkFail.length > 1 ? "рятують" : "рятує"}`}
              simple={
                <>
                  У методів Рунге–Кутти запас стійкості трохи більший (RK2 витримує до 2, RK3 — до 2.513, RK4 — до 2.785), але тут крок × темп ≈ {fmt(hlam, 3)}.
                  Висока точність не рятує, якщо метод нестійкий.
                </>
              }
            >
              Межа стійкості на дійсній осі: {rkFail.map((r) => `${METHODS[r.m].short} — h|λ| < ${RK_BOUND[r.m]}`).join(", ")}, а маємо{" "}
              <Tex>{`h|\\lambda|_{\\max} \\approx ${fmt(hlam, 3)}`}</Tex>. Вищий порядок точності не допомагає, коли метод нестійкий.
            </Insight>
          )}
          {mode === "long" && dop && dop.s.failed && (
            <Insight
              tone="bad"
              title="DOPRI здається"
              simple={
                <>
                  {dop.s.failed}. DOPRI — явний, тож його крок прикутий до найшвидшого процесу: спершу ≈ 10⁻³, а коли попелу багато — лише ≈{" "}
                  {fmt(3.3 / lamEnd, 2)}. Щоб дійти до t = {fmt(Tl, 2)}, йому треба ~{fmt((Tl * lamEnd) / 3.3, 2)} кроків. <Relatable kind="steps" n={(Tl * lamEnd) / 3.3} />
                  {ros && !ros.s.failed ? ` Розенброк обійшовся ${ros.s.steps.toLocaleString("uk-UA")}.` : ""}
                </>
              }
            >
              {dop.s.failed}. Його крок назавжди прикутий до межі стійкості <Tex>{"h \\lesssim 3.3/|\\lambda|"}</Tex>: спочатку ≈ 10⁻³, а коли <Tex>{"u_3 \\to 1"}</Tex> і{" "}
              <Tex>{`|\\lambda| \\to ${fmt(lamEnd, 3)}`}</Tex> — лише <Tex>{`${fmt(3.3 / lamEnd, 2)}`}</Tex>. До <Tex>{`t = ${fmt(Tl, 2)}`}</Tex> треба було б ~{fmt((Tl * lamEnd) / 3.3, 2)}{" "}
              кроків.{ros && !ros.s.failed ? ` Розенброк обійшовся ${ros.s.steps.toLocaleString("uk-UA")} — і його крок зріс до ${fmt(maxOf(ros.s.hs), 2)}.` : ""}
            </Insight>
          )}
          {mode === "long" && (
            <Insight
              tone="info"
              title="Що відбувається на довгому часі"
              simple={
                <>
                  Дрова A повільно перетворюються на попіл C; полум&apos;я B увесь час крихітне й «підлаштоване» під A — і гасне разом із ним. Зрештою лишається
                  самий попіл: (0, 0, {fmt(S0, 4)}). Крок розумних (неявних адаптивних) методів росте майже пропорційно часу.
                </>
              }
            >
              A повільно перетворюється на C; B живе у квазістаціонарному балансі <Tex>{"0.04\\,u_1 \\approx 10^4u_2u_3 + 3\\cdot10^7u_2^2"}</Tex> і згасає разом з A.
              При <Tex>{"t\\to\\infty"}</Tex>: <Tex>{`u \\to (0,\\ 0,\\ ${fmt(S0, 4)})`}</Tex> (уся маса <Tex>{"\\Sigma u_i(0)"}</Tex> переходить у C). Помітно, що крок адаптивних неявних методів росте майже пропорційно <Tex>{"t"}</Tex>.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Сцена" title="Три колби в логарифмічному часі" simpleTitle="Три колби: від мілісекунд до тисячоліть">
        <Card>
          <BeakersScene sol={ref} tMin={1e-6} />
          <p className="mt-3 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Колба B (полум&apos;я) збільшена в 10⁴ разів — інакше її вмісту не видно. B «наливається» за тисячні частки одиниці часу, а далі тримається майже
                  сталою, поки A повільно переливається в C. Ця «миттєва підлаштованість» B під повільний процес і робить задачу жорсткою.
                </>
              }
            >
              Колба B підсилена в 10⁴ разів — інакше її вміст не побачити. Зверніть увагу: B «наповнюється» за ~10⁻³ і далі тримається майже сталою, поки A повільно
              переливається в C. Це і є квазістаціонарність, що робить задачу жорсткою.
            </Say>
          </p>
        </Card>
      </Section>

      <Section
        kicker="Результати"
        title={`Таблиця: фіксовані методи × крок на [0, 10], початкова умова ${IC[ic].label}`}
        simpleTitle={`Хто з методів який крок витримав (старт ${IC[ic].label})`}
      >
        <Card>
          {table ? (
            <Table
              head={["Метод", ...H_LIST.map((v) => `h = ${fmt(v, 1)}`)]}
              rows={FIXED.map((m, j) => [
                <span key={m} style={{ color: METHODS[m].color }}>
                  {METHODS[m].name}
                </span>,
                ...H_LIST.map((_, i) => {
                  const { s, e } = table[j][i];
                  if (s.failed) return <span className="text-[#ff5d73]">{s.failed.includes("Ньютона") ? "✗ Ньютон" : "💥 вибух"}</span>;
                  return (
                    <span className={e > 0.5 ? "text-[#ff5d73]" : e > 1e-2 ? "text-[#ffb547]" : "text-[#3ee6a8]"}>
                      {fmt(e, 2)} <span className="text-white/35">· {fmtMs(s.ms)}</span>
                    </span>
                  );
                }),
              ])}
            />
          ) : (
            <button
              onClick={computeTable}
              className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/15 px-4 py-2 text-[13px] text-white hover:bg-[var(--accent)]/25"
            >
              Порахувати таблицю (32 розв&apos;язки, ~1–2 с)
            </button>
          )}
          <p className="mt-3 text-[13px] text-white/55">
            <Say
              simple={
                <>
                  У клітинках — найбільший промах відносно еталону, поділений на розмір відповідної речовини (щоб крихітне B важило стільки ж, скільки A і C).
                  Неявні методи на кожному кроці розв&apos;язують рівняння повним методом Ньютона — тому витримують навіть h = 0.1.
                </>
              }
            >
              Нормована максимальна похибка (за кожною компонентою ділимо на її максимум). Неявні методи розв&apos;язують свої рівняння демпфованим методом Ньютона
              з повним якобіаном — тому стійкі навіть при h = 0.1.
            </Say>
          </p>
          {table && (
            <button onClick={computeTable} className="mt-2 text-[12px] text-[var(--accent)] underline-offset-2 hover:underline">
              перерахувати з поточними налаштуваннями
            </button>
          )}
        </Card>
      </Section>

      <Section kicker="Жорсткість" title="Власні числа якобіана вздовж еталонної траєкторії" simpleTitle="Наскільки швидкі процеси в кожен момент">
        <Card>
          <StiffnessPanel problem={problem} sol={ref} logT />
          <p className="mt-2 text-[12.5px] text-white/50">
            <Say
              simple={
                <>
                  Темпи найшвидшого й найповільнішого процесів уздовж розв&apos;язку (нульовий — закон збереження — не показано). Що далі вони розходяться, то жорсткіша
                  задача: наприкінці відрізка найповільніший процес має темп ≈ {sci(stiffEnd.slow)}, і відношення ≈ {sci(stiffEnd.ratio)}.
                  {Number.isFinite(stiffEnd.tCut) && (
                    <>
                      {" "}
                      Після t ≈ {sci(stiffEnd.tCut)} найповільніший процес стає меншим за 10⁻¹¹ від найшвидшого, і графік уже не відрізняє його від нуля закону
                      збереження: там видно лише швидку лінію, а справжнє відношення більше, ніж показує картка.
                    </>
                  )}
                  {dop ? ` DOPRI зробив ${dop.s.steps.toLocaleString("uk-UA")} кроків.` : ""}
                </>
              }
            >
              Нульове власне число (закон збереження) панель відкидає разом з усім, що менше за <Tex>{"10^{-11}\\max|\\operatorname{Re}\\lambda|"}</Tex>. «Повільна мода» тут —
              найменше ненульове; точно його дає замкнена формула <Tex>{"\\lambda_{\\text{slow}} = M/\\lambda_{\\text{fast}}"}</Tex>: при t = {sci(stiffEnd.t, 3)}{" "}
              <Tex>{"\\lambda_{\\text{slow}}"}</Tex> ≈ −{sci(stiffEnd.slow, 3)}, коефіцієнт жорсткості ≈ {sci(stiffEnd.ratio)}.
              {Number.isFinite(stiffEnd.tCut) &&
                ` Після t ≈ ${sci(stiffEnd.tCut)} відношення перевищує 10¹¹: повільна мода опускається нижче порогу панелі, тож там панель показує лише швидку моду, а її «коеф. жорсткості» — нижня оцінка.`}
              {dop ? ` DOPRI зробив ${dop.s.steps.toLocaleString("uk-UA")} кроків.` : ""}
            </Say>
          </p>
        </Card>
      </Section>

      {extras}

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="info"
            title="Жорсткість залежить від траєкторії"
            simple={
              <>
                Зі старту (1, 0, 0) на [0, 10] найшвидший процес має темп лише ~2.5 тисячі, і кроку 10⁻⁴ вистачає навіть явному Ейлеру. З другої умови попелу C
                багато (≈ 3), полум&apos;я гасне в рази швидше (темп ~3·10⁴) — і явні методи вибухають (а RK2 замість вибуху «застрягає» на хибному від&apos;ємному B).
              </>
            }
          >
            На <Tex>{"[0,10]"}</Tex> з <Tex>{"(1,0,0)"}</Tex> швидке власне число лише <Tex>{"\\approx -(2.2\\ldots2.6)\\cdot10^3"}</Tex>, і <Tex>{"h=10^{-4}"}</Tex> — достатньо мало навіть
            для явного Ейлера. Але з другої початкової умови (більше C → швидше B+C→A+C) <Tex>{"|\\lambda| \\approx 3\\cdot10^4"}</Tex>, і явні методи вибухають (RK2 — не вибухає, а
            застрягає на хибному від&apos;ємному u₂).
          </Insight>
          <Insight
            tone="good"
            title="Неявні + адаптивність = мільярди разів економії"
            simple={
              <>
                Розенброк проходить аж до t = 10¹¹ за кілька сотень кроків (≈ 500 при rtol = 10⁻⁴), розтягуючи крок до ~10¹⁰. Явному методу знадобилося б
                ~3·10¹⁴ кроків. <Relatable kind="steps" n={3e14} />
              </>
            }
          >
            Розенброк проходить <Tex>{"[0, 10^{11}]"}</Tex> за кілька сотень кроків (≈ 500 при rtol = 10⁻⁴, ≈ 100 при 10⁻²), збільшуючи h до <Tex>{"\\sim 10^{10}"}</Tex>. Будь-якому
            явному методу знадобилося б ~<Tex>{"3\\cdot10^{14}"}</Tex> кроків (бо <Tex>{"|\\lambda| \\to 10^4"}</Tex>, коли <Tex>{"u_3 \\to 1"}</Tex>) — роки обчислень.
          </Insight>
          <Insight
            tone="warn"
            title="Неявність — це ще й нелінійні рівняння"
            simpleTitle="Неявний метод — це ще й рівняння на кожному кроці"
            simple={
              <>
                Неявний метод на кожному кроці розв&apos;язує рівняння. Спрощений варіант (матриця «заморожена» на початку кроку) тут ламається вже з h = 10⁻³: на
                старті полум&apos;я B ще немає, і спрощений Ньютон не бачить, як швидко воно гасить само себе, — гойдається між двома хибними відповідями. Повний
                Ньютон проходить навіть h = 0.1.
              </>
            }
          >
            A-стійкість методу не гарантує успіху: на кожному кроці треба розв&apos;язати нелінійну систему. Спрощений Ньютон із якобіаном, «замороженим» у точці <Tex>{"y_n"}</Tex>, тут не
            збігається вже на першому кроці з <Tex>{"h = 10^{-3}"}</Tex>: на старті <Tex>{"u_2=u_3=0"}</Tex>, квадратичного члена <Tex>{"3\\cdot10^7u_2^2"}</Tex> лінеаризація не бачить, і
            ітерації коливаються між <Tex>{"u_2 \\approx 4\\cdot10^{-5}"}</Tex> та <Tex>{"-7\\cdot10^{-6}"}</Tex>. Наш розв&apos;язувач використовує повний демпфований Ньютон — і проходить
            навіть <Tex>{"h=0.1"}</Tex>. У промислових пакетах (DASSL, CVODE) цьому присвячено половину коду.
          </Insight>
          <Insight
            tone="info"
            title="Закон збереження — безкоштовний тест"
            simple={
              <>
                Сума A + B + C в усіх стійких методах зберігається з точністю 10⁻¹⁵…10⁻¹¹ — це лише округлення. Помітне порушення — ознака вибуху або збою
                Ньютона. Безкоштовна перевірка, яку варто робити завжди.
              </>
            }
          >
            Сума концентрацій для всіх стійких методів зберігається з точністю 10⁻¹⁵…10⁻¹¹ — це лише округлення (стовпці якобіана сумуються в нуль, тож і ітерації Ньютона зберігають
            суму; у BDF2 на 10⁵ кроках накопичується трохи більше через коефіцієнти 4/3 і 1/3). Помітне порушення — ознака вибуху або незбіжності Ньютона.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Г. Робертсон придумав цю «реакцію» у 1966 р. як іспит для програм-розв&apos;язувачів — і відтоді вона в кожному підручнику. Класичний графік з
                полум&apos;ям B ×10⁴ на часі від 10⁻⁵ до 10¹¹ — саме той, що в режимі «довгий час».
              </>
            }
          >
            Г. Робертсон запропонував цю систему у 1966 р. як тест для інтеграторів. Відтоді вона в кожному підручнику й кожному наборі тестів (Hairer–Wanner, test set for IVP
            solvers). Класичний графік із <Tex>{"10^4 u_2"}</Tex> на <Tex>{"t \\in [10^{-5}, 10^{11}]"}</Tex> — це саме те, що ви бачите в режимі «довгий час».
          </Insight>
        </Grid>
      </Section>
    </>
  );
}
