"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Plot, { type Series } from "@/components/plot/Plot";
import Plot3D from "@/components/plot/Plot3D";
import StroboscopeScene from "@/components/scenes/StroboscopeScene";
import { Card, Grid, Insight, Lab, Section, Stat, Table } from "@/components/ui/blocks";
import { Chips, MethodPicker, Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { Tex } from "@/components/ui/Tex";
import { fmt, fmtMs } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { comp, denseOutput, indexAt, sampleAt, solve, type MethodId, type Problem, type Solution } from "@/lib/ode";
import { plural } from "@/lib/relatable";
import AnalogyCard from "@/components/analogy/AnalogyCard";
import ForcedSwingScene from "@/components/analogy/ForcedSwingScene";
import { Say } from "@/components/mode/Mode";
import PhasePlayground from "@/components/playground/PhasePlayground";
import QuizBlock from "@/components/quiz/Quiz";
import Relatable from "@/components/ui/Relatable";

const W_BOOK = (2 * Math.PI) / 10;
const ALL: MethodId[] = ["ros", "dopri", "rk4", "euler"];

const PRESETS = [
  { id: 0, mu: 8.5, a: 0.5, w: W_BOOK, label: "умова: μ=8.5, a=0.5" },
  { id: 1, mu: 8.53, a: 1.2, w: W_BOOK, label: "μ=8.53, a=1.2 · слабкий хаос" },
  { id: 2, mu: 5, a: 5, w: 2.466, label: "μ=5, a=5, ω=2.466 · сильний хаос" },
  { id: 3, mu: 8.5, a: 2, w: W_BOOK, label: "a=2 · захоплення частоти" },
  { id: 4, mu: 8.5, a: 0, w: W_BOOK, label: "a=0 · без сили" },
];

const PG_PRESETS = [0, 3, 1];
const PG_LABELS: [string, string] = ["u", "u′"];
const PG_DOMAIN = { x: [-3, 3] as [number, number], y: [-14, 14] as [number, number] };
const PG_INIT = [2, 1, 0];

const forced = (mu: number, a: number, w: number, T: number, y0 = [2, 1]): Problem => ({
  f: (t, y) => [y[1], mu * (1 - y[0] * y[0]) * y[1] - y[0] + a * Math.sin(w * t)],
  jac: (_t, y) => [
    [0, 1],
    [-2 * mu * y[0] * y[1] - 1, mu * (1 - y[0] * y[0])],
  ],
  y0,
  T,
});

/** Stroboscopic map + largest Lyapunov exponent (variational equation, renormalised every forcing period). */
function scanForced(mu: number, a: number, w: number, theta0: number, nTrans: number, nKeep: number, hTarget = 0.02) {
  const Tp = (2 * Math.PI) / w;
  let u = 2,
    v = 1,
    du = 1,
    dv = 0,
    t = 0;
  const F = (tt: number, uu: number, vv: number, d1: number, d2: number) => {
    const g = mu * (1 - uu * uu);
    return [vv, g * vv - uu + a * Math.sin(w * tt), d2, (-2 * mu * uu * vv - 1) * d1 + g * d2];
  };
  const step = (h: number) => {
    const k1 = F(t, u, v, du, dv);
    const k2 = F(t + h / 2, u + (h / 2) * k1[0], v + (h / 2) * k1[1], du + (h / 2) * k1[2], dv + (h / 2) * k1[3]);
    const k3 = F(t + h / 2, u + (h / 2) * k2[0], v + (h / 2) * k2[1], du + (h / 2) * k2[2], dv + (h / 2) * k2[3]);
    const k4 = F(t + h, u + h * k3[0], v + h * k3[1], du + h * k3[2], dv + h * k3[3]);
    u += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    v += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    du += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    dv += (h / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    t += h;
  };
  const off = (((theta0 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / w;
  if (off > 0) {
    const s0 = Math.ceil(off / hTarget);
    for (let k = 0; k < s0; k++) step(off / s0);
  }
  const sub = Math.ceil(Tp / hTarget);
  const h = Tp / sub;
  const pu: number[] = [];
  const pv: number[] = [];
  const trace: { t: number; L: number }[] = [];
  let sum = 0,
    cnt = 0,
    ups = 0;
  for (let n = 0; n < nTrans + nKeep; n++) {
    for (let k = 0; k < sub; k++) {
      const u0 = u;
      step(h);
      if (n >= nTrans && u0 < 0 && u >= 0) ups++;
    }
    if (!Number.isFinite(u) || Math.abs(u) > 1e6) break;
    const nr = Math.hypot(du, dv);
    du /= nr;
    dv /= nr;
    if (n >= nTrans) {
      sum += Math.log(nr);
      cnt++;
      pu.push(u);
      pv.push(v);
      trace.push({ t, L: sum / (cnt * Tp) });
    }
  }
  return { pu, pv, L: cnt ? sum / (cnt * Tp) : NaN, trace, rho: cnt ? ups / cnt : NaN };
}

function classify(pu: number[], pv: number[], L: number) {
  const n = pu.length;
  for (let p = 1; p <= 60; p++) {
    let m = 0;
    for (let i = Math.max(0, n - 150); i + p < n; i++) m = Math.max(m, Math.hypot(pu[i] - pu[i + p], pv[i] - pv[i + p]));
    if (m < 5e-3) return { kind: "periodic" as const, p, label: p === 1 ? "захоплення частоти (період-1)" : `субгармоніка: період-${p}` };
  }
  if (L > 0.003) return { kind: "chaos" as const, p: 0, label: "хаос" };
  return { kind: "quasi" as const, p: 0, label: "квазіперіодичний рух (тор)" };
}

function gcdFrac(x: number, maxDen = 12): [number, number] {
  let best: [number, number] = [Math.round(x), 1];
  let err = Math.abs(x - best[0]);
  for (let q = 2; q <= maxDen; q++) {
    const p = Math.round(x * q);
    const e = Math.abs(x - p / q);
    if (e < err - 1e-9) {
      err = e;
      best = [p, q];
    }
  }
  return best;
}

export default function T16() {
  const [mu, setMu] = useState(8.5);
  const [a, setA] = useState(0.5);
  const [w, setW] = useState(W_BOOK);
  const [T, setT] = useState(40);
  const [h, setH] = useState(0.01);
  const [theta0, setTheta0] = useState(0);
  const [delta, setDelta] = useState(1e-8);
  const [win, setWin] = useState(0);
  const [methods, setMethods] = useState<MethodId[]>(["ros", "dopri", "rk4"]);
  const [pgId, setPgId] = useState(0);
  const pg = PRESETS[pgId];
  // sandbox state (u, u′, θ) with θ′ = 1: the forcing phase keeps running when the swing is clicked or kicked
  const pgF = useMemo(() => (_t: number, y: number[]) => [y[1], pg.mu * (1 - y[0] * y[0]) * y[1] - y[0] + pg.a * Math.sin(pg.w * y[2]), 1], [pg]);
  const pgFree = useMemo(() => {
    const s = solve("dopri", forced(pg.mu, 0, pg.w, 120), { rtol: 1e-8, atol: 1e-10 });
    const i0 = indexAt(s.t, 80);
    return { u: comp(s, 0).slice(i0), v: comp(s, 1).slice(i0) };
  }, [pg]);

  const dMu = useDeferredValue(mu);
  const dA = useDeferredValue(a);
  const dW = useDeferredValue(w);
  const dT = useDeferredValue(T);
  const dH = useDeferredValue(h);
  const dTheta = useDeferredValue(theta0);
  const dDelta = useDeferredValue(delta);
  const Tp = (2 * Math.PI) / dW;

  const problem = useMemo(() => forced(dMu, dA, dW, dT), [dMu, dA, dW, dT]);
  const ref = useMemo(() => solve("dopri", problem, { rtol: 1e-9, atol: 1e-11, maxSteps: 600000 }), [problem]);
  // Двійник рахуємо РАЗОМ з оригіналом як одну систему (u, u′, ũ, ũ′): спільна послідовність кроків DOPRI робить похибки
  // інтегрування обох копій однаковими, і в різницю Δu вони не потрапляють. Два окремі прогони з rtol 10⁻⁹ давали «шум»
  // 10⁻⁹…10⁻⁶ (різні адаптивні сітки + лінійна інтерполяція), який при δ ≲ 10⁻⁸ перекривав справжню |Δu|. Ціна — ~+20 мс при T = 1000.
  const pair = useMemo(() => {
    const f = (t: number, y: number[]) => {
      const s = dA * Math.sin(dW * t);
      return [y[1], dMu * (1 - y[0] * y[0]) * y[1] - y[0] + s, y[3], dMu * (1 - y[2] * y[2]) * y[3] - y[2] + s];
    };
    return { f, sol: solve("dopri", { f, y0: [2, 1, 2 + dDelta, 1], T: dT }, { rtol: 1e-9, atol: 1e-11, maxSteps: 600000 }) };
  }, [dMu, dA, dW, dT, dDelta]);
  const refU = useMemo(() => comp(ref, 0), [ref]);

  const sols = useMemo(
    () =>
      methods.map((m) => {
        const s =
          m === "ros"
            ? solve(m, problem, { rtol: 1e-4, atol: 1e-7, maxSteps: 200000 })
            : m === "dopri"
              ? solve(m, problem, { rtol: 1e-6, atol: 1e-8, maxSteps: 200000 })
              : solve(m, problem, { h: Math.max(dH, dT / 200000), blowup: 1e6 });
        let tDiv = NaN;
        const stride = Math.max(1, Math.floor(s.t.length / 4000));
        for (let k = 0; k < s.t.length; k += stride)
          if (!(Math.abs(s.y[k][0] - sampleAt(ref.t, refU, s.t[k])) < 0.5)) {
            tDiv = s.t[k];
            break;
          }
        return { m, s, tDiv };
      }),
    [methods, problem, dH, dT, ref, refU],
  );

  const scan = useMemo(() => {
    const r = scanForced(dMu, dA, dW, dTheta, 60, 400);
    return { ...r, cls: classify(r.pu, r.pv, r.L) };
  }, [dMu, dA, dW, dTheta]);

  const dist = useMemo(() => {
    const { sol, f } = pair;
    const D = denseOutput(sol, f);
    const gap = (tt: number) => {
      const y = D(tt);
      return Math.abs(y[0] - y[2]);
    };
    const n = 1200;
    const t: number[] = [];
    const d: number[] = [];
    for (let k = 0; k <= n; k++) {
      const tt = (dT * k) / n;
      t.push(tt);
      d.push(Math.max(1e-16, gap(tt)));
    }
    // перший вихід |Δu| за 0.5: по всіх вузлах розв'язку, далі бісекція за ермітовою інтерполяцією
    let tHit = NaN;
    for (let k = 1; k < sol.t.length; k++) {
      if (Math.abs(sol.y[k][0] - sol.y[k][2]) > 0.5) {
        let lo = sol.t[k - 1],
          hi = sol.t[k];
        for (let i = 0; i < 40; i++) {
          const m = 0.5 * (lo + hi);
          if (gap(m) > 0.5) hi = m;
          else lo = m;
        }
        tHit = hi;
        break;
      }
    }
    return { t, d, ou: comp(sol, 0), tu: comp(sol, 2), tHit };
  }, [pair, dT]);

  const strobeTraj = useMemo(() => {
    const out: { t: number; u: number; v: number }[] = [];
    const v = comp(ref, 1);
    const off = (((dTheta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / dW;
    for (let n = 0; off + n * Tp <= dT; n++) {
      const tt = off + n * Tp;
      if (tt === 0) continue;
      out.push({ t: tt, u: sampleAt(ref.t, refU, tt), v: sampleAt(ref.t, v, tt) });
    }
    return out;
  }, [ref, refU, dTheta, dW, Tp, dT]);

  const L = scan.L;
  const cls = scan.cls;
  // власний горизонт еталона в хаосі: його похибка (~10⁻⁹ при rtol 10⁻⁹) виростає до 0.5 за ln(0.5/10⁻⁹)/λ₁
  // (для μ = 5, a = 5, ω = 2.466 це ≈ 199; виміряно проти збіжного RK4 — 188.5)
  const refHorizon = L > 0 ? Math.log(0.5 / 1e-9) / L : Infinity;
  const [rp, rq] = gcdFrac(scan.rho);
  const view: [number, number] = win === 1 && dT >= 700 ? [300, 700] : win === 2 ? [Math.max(0, dT - 10 * Tp), dT] : [0, dT];
  const activePreset = PRESETS.find((p) => p.mu === mu && p.a === a && Math.abs(p.w - w) < 1e-9)?.id ?? -1;
  const failed = sols.filter((x) => x.s.failed);
  const loadPreset = (id: number) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setMu(p.mu);
    setA(p.a);
    setW(p.w);
    if (id === 2 && T < 300) setT(300);
    if (id === 1 && T < 300) setT(400);
  };

  return (
    <>
      <AnalogyCard
        emoji="🛝"
        title="Гойдалка, яку штовхають не в такт"
        story={
          <>
            Дитина гойдається у власному ритмі, а тато штовхає гойдалку — у своєму. Якщо ритми близькі, гойдалка «підлаштовується» і йде в такт поштовхам.
            Якщо ні — то синхронно, то врозбрід, а іноді картина не повторюється ніколи, хоча й тато, і гойдалка діють цілком передбачувано. Це і є
            детермінований хаос. Генератор ван дер Поля з зовнішньою силою — та сама гойдалка, лише «з характером»: він сам себе розгойдує.
          </>
        }
        mapping={[
          ["власний ритм гойдалки", <>релаксаційні коливання, період ≈ 16.8 при μ = 8.5</>],
          ["ритм поштовхів", <>a·sin ωt, період 2π/ω (в умові 10)</>],
          ["сила поштовху", <>амплітуда a</>],
          ["«гойдалка підлаштувалась»", <>захоплення частоти, субгармоніка p:q</>],
          ["фото в момент поштовху", <>переріз Пуанкаре (стробоскоп)</>],
        ]}
      >
        <ForcedSwingScene />
      </AnalogyCard>

      <Section kicker="Постановка" title="Генератор, якого смикають за ниточку" simpleTitle="Гойдалка з характером і тато з власним ритмом">
        <Grid>
          <Card title="Рівняння з методички" icon="📜">
            <Tex block>{String.raw`u'' + u = \mu\,(1-u^2)\,u' + a\sin\omega t,`}</Tex>
            <Tex block>{String.raw`\mu = 8.5,\quad a = 0.5,\quad \omega = \frac{2\pi}{10},\qquad u(0) = 2u'(0) = 2\ \Rightarrow\ u(0)=2,\ u'(0)=1.`}</Tex>
            <Say
              simple={
                <p className="text-[14px] leading-relaxed text-white/70">
                  Це генератор ван дер Поля із задачі №14 (власна частота 1), якого періодично «штовхає» зовнішня сила з періодом 10. Рахуємо на [0, 40]; у
                  лабораторії можна до 1000 (у методичці на рисунку — відрізок від 300 до 700).
                </p>
              }
            >
            <p className="text-[14px] leading-relaxed text-white/70">
              Відрізок <Tex>{"[0, 40]"}</Tex> (у лабораторії — до 1000; рис. 12.6 у методичці показує вікно 300…700). Це генератор ван дер Поля з
              задачі №14 (тут <Tex>{"\\omega_0 = 1"}</Tex>), до якого підключили зовнішню періодичну силу з періодом <Tex>{"2\\pi/\\omega = 10"}</Tex>.
            </p>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                  Два ритми — власний (одне гойдання за ≈ 16.8 при μ = 8.5) і поштовхи (раз на 10) — змагаються. Вони можуть <b>домовитися</b> (гойдалка йде в
                  такт або «через раз»), жити кожен своїм життям, або… розсваритися остаточно — хаос.
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/70">
              Два «годинники» — власні релаксаційні коливання (період ≈ 16.8 при μ = 8.5) і зовнішня сила (період 10) — змагаються. Вони можуть
              <b> синхронізуватися</b> (захоплення частоти, «субгармоніки»), рухатися незалежно (квазіперіодичність) або… розсваритися остаточно — хаос.
            </p>
            </Say>
          </Card>
          <Card title="Як розпізнати хаос" icon="🔎">
            <Say
              simple={
                <ul className="space-y-2 text-[14px] leading-relaxed text-white/75">
                  <li>
                    <b>Фото в момент поштовху (стробоскоп)</b>: дивимося на гойдалку лише раз за період поштовхів. Гойдалка в такт — одна точка; «через раз» —
                    кілька точок; незалежні ритми — замкнена крива; хаос — розсип точок, що складається у химерний візерунок.
                  </li>
                  <li>
                    <b>Чи ростуть розбіжності</b>: запускаємо дві майже однакові гойдалки й дивимося, чи розходяться вони. Розходяться лавиною — хаос.
                  </li>
                </ul>
              }
            >
            <ul className="space-y-2 text-[14px] leading-relaxed text-white/75">
              <li>
                <b>Переріз Пуанкаре (стробоскоп)</b>: дивимося на <Tex>{"(u, u')"}</Tex> лише в моменти <Tex>{"t_n = \\theta_0/\\omega + nT"}</Tex>,{" "}
                <Tex>{"T = 2\\pi/\\omega"}</Tex>. Період-k → k точок, квазіперіодичність → замкнена крива, хаос → фрактальна «хмара».
              </li>
              <li>
                <b>Старший показник Ляпунова</b>: інтегруємо разом із рівнянням варіацію <Tex>{String.raw`\delta' = J\delta`}</Tex>, нормуючи її щоперіоду:{" "}
                <Tex>{String.raw`\lambda_1 = \lim \frac{1}{t}\ln\frac{|\delta(t)|}{|\delta(0)|}`}</Tex>. Хаос ⇔ <Tex>{"\\lambda_1 > 0"}</Tex>.
              </li>
              <li>
                <b>Чутливість</b>: дві траєкторії, що стартують на відстані <Tex>{"\\delta"}</Tex>, розходяться як <Tex>{"\\delta e^{\\lambda_1 t}"}</Tex>.
              </li>
            </ul>
            </Say>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  Жорсткість — як у №14: поки гойдалка «повзе», відхилення від її шляху гаснуть у темпі ≈ 25 за одиницю часу, тож явному Ейлеру потрібен крок,
                  менший за ~0.08, а під час ривків — ще менший.
                </p>
              }
            >
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Жорсткість та сама, що у №14: на повільних гілках <Tex>{"\\lambda \\approx \\mu(1-u^2) \\approx -3\\mu \\approx -25"}</Tex>, тож явний Ейлер
              потребує <Tex>{"h < 0.08"}</Tex>, а на стрибках — ще менше.
            </p>
            </Say>
          </Card>
        </Grid>
        <div className="mt-4">
          <Insight
            tone="note"
            title="Чесна перевірка: при a = 0.5 хаосу немає (але є дуже цікаве)"
            simple={
              <>
                Ми перевірили: за параметрів умови хаосу <b>немає</b>. «Фото в момент поштовху» після довгого розгону показують рівно <b>5 точок</b>: за 5
                поштовхів (50 од. часу) гойдалка робить рівно 3 гойдання — домовленість 3:5. На [0, 40] і навіть на [300, 700] це виглядає хаотично, бо
                гойдалка дуже довго «домовляється». Справжній хаос — поруч: пресети «μ = 8.53, a = 1.2» і «μ = 5, a = 5, ω = 2.466».
              </>
            }
          >
            Ми порахували показник Ляпунова для параметрів умови: <Tex>{"\\lambda_1 \\approx -0.002"}</Tex>, а стробоскоп після перехідного процесу
            показує <b>5 точок</b>: рух періодичний з періодом 50 = 5·(2π/ω), за який генератор робить рівно 3 власних коливання — резонанс 3:5. На [0, 40]
            і навіть на [300, 700] траєкторія виглядає хаотично, але це «химерна синхронізація». Справжній хаос є поряд у просторі параметрів — пресети
            «μ = 8.53, a = 1.2» (класичний приклад із літератури, <Tex>{"\\lambda_1 \\approx +0.007"}</Tex>) і «μ = 5, a = 5, ω = 2.466» (Парліц і Лаутерборн,{" "}
            <Tex>{"\\lambda_1 \\approx +0.1"}</Tex>).
          </Insight>
        </div>
      </Section>

      <Section kicker="Лабораторія" title="Між синхронізацією і хаосом" simpleTitle="У такт, через раз чи врозбрід">
        <Lab
          controls={
            <>
              <Chips
                label="Пресети"
                value={activePreset}
                onChange={loadPreset}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
              <Slider label="μ (нелінійне тертя)" value={mu} onChange={setMu} min={0.5} max={15} step={0.01} />
              <Slider label="a (амплітуда сили)" value={a} onChange={setA} min={0} max={6} step={0.01} />
              <Slider label="ω (частота сили)" value={w} onChange={setW} min={0.2} max={3} step={0.001} hint={`період сили 2π/ω = ${fmt((2 * Math.PI) / w, 4)}`} />
              <Chips
                label="Відрізок [0, T]"
                value={[40, 300, 700, 1000].includes(T) ? T : -1}
                onChange={(v) => v > 0 && setT(v)}
                options={[40, 300, 700, 1000].map((v) => ({ value: v, label: `T = ${v}` }))}
              />
              <Slider label="T" value={T} onChange={setT} min={20} max={1000} step={10} />
              <Chips
                label="Вікно графіків"
                value={win}
                onChange={setWin}
                options={[
                  { value: 0, label: "увесь відрізок" },
                  { value: 1, label: "300…700 (рис. 12.6)" },
                  { value: 2, label: "останні 10 періодів" },
                ]}
              />
              <MethodPicker methods={ALL} value={methods} onChange={setMethods} />
              <Slider label="Крок h (RK4, Ейлер)" value={h} onChange={setH} min={0.001} max={0.2} log />
              <Slider label="Фаза перерізу θ₀" value={theta0} onChange={setTheta0} min={0} max={6.28} step={0.01} format={(v) => `${fmt(v / Math.PI, 3)}π`} />
              <Slider
                label="Збурення u(0): δ"
                value={delta}
                onChange={setDelta}
                min={1e-12}
                max={1e-2}
                log
                format={(v) => fmt(v, 2)}
                hint={
                  <Say simple="Двійника рахуємо в парі з оригіналом однаковими кроками, тож похибки методу в обох однакові й різниці не псують: навіть δ = 10⁻¹² не тоне в шумі.">
                    Двійник інтегрується разом з оригіналом як одна система (спільні кроки DOPRI, rtol 10⁻⁹): похибки інтегрування в Δu скорочуються, і різниця
                    розрізняється аж до δ = 10⁻¹².
                  </Say>
                }
              />
              {win === 1 && dT < 700 && <div className="text-[12px] text-[#ffb547]">Для вікна 300…700 встановіть T ≥ 700.</div>}
            </>
          }
        >
          <Playground ref0={ref} sols={sols} T={dT} w={dW} a={dA} strobe={strobeTraj} view={view} />

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label="Режим"
              value={cls.kind === "chaos" ? "хаос" : cls.kind === "periodic" ? `P-${cls.p}` : "тор"}
              sub={cls.label}
              tone={cls.kind === "chaos" ? "bad" : cls.kind === "periodic" ? "good" : "warn"}
            />
            <Stat label="λ₁ (Ляпунов)" value={fmt(L, 3)} sub={L > 0.003 ? "> 0: експоненційна чутливість" : L < -0.003 ? "< 0: притягувальний цикл" : "≈ 0: нейтрально"} tone={L > 0.003 ? "bad" : "good"} />
            <Stat label="Обертове число" value={`${fmt(scan.rho, 4)}`} sub={`власних коливань на період сили ≈ ${rp}:${rq}`} />
            <Stat label="Двійник відійшов на 0.5" value={Number.isFinite(dist.tHit) ? `t ≈ ${fmt(dist.tHit, 3)}` : "не відійшов"} sub={`δ = ${fmt(dDelta, 2)}`} tone={Number.isFinite(dist.tHit) ? "warn" : "good"} />
            {sols.map(({ m, s, tDiv }) => (
              <Stat
                key={m}
                label={METHODS[m].short}
                value={s.failed ? "💥" : `${s.steps} кр.`}
                sub={s.failed ? s.failed : `${fmtMs(s.ms)} · ${s.rejected} відх. · від еталона ${Number.isFinite(tDiv) ? `відійшов при t≈${fmt(tDiv, 3)}` : "не відійшов"}`}
                tone={s.failed ? "bad" : Number.isFinite(tDiv) ? "warn" : "good"}
              />
            ))}
          </div>

          {cls.kind === "chaos" && (
            <Insight
              tone="bad"
              title="Детермінований хаос"
              simple={
                <>
                  Жодної випадковості в рівнянні немає, а передбачити не можна: різниця між двома майже однаковими гойдалками росте в e ≈ 2.7 раза кожні{" "}
                  {fmt(1 / L, 3)} од. часу. Стартова різниця {fmt(dDelta, 2)} стає помітною (~1) за t ≈ {fmt(Math.log(1 / dDelta) / L, 3)}, а за весь відрізок
                  T = {fmt(dT, 4)} — <Relatable kind="growth" n={Math.exp(L * dT)} />. Тому різні методи згодом малюють різні траєкторії — але однакові «фото в
                  момент поштовху».
                </>
              }
            >
              Рівняння не містить жодної випадковості, але λ₁ ≈ {fmt(L, 3)} &gt; 0: похибка e-кратно зростає кожні {fmt(1 / L, 3)} одиниць часу. Початкова
              різниця δ = {fmt(dDelta, 2)} стає порядку 1 приблизно за ln(1/δ)/λ₁ ≈ {fmt(Math.log(1 / dDelta) / L, 3)}. Тому методи, що мають різні (хоч і
              малі) похибки, згодом малюють різні траєкторії — але однаковий переріз Пуанкаре.
            </Insight>
          )}
          {cls.kind === "periodic" && (
            <Insight
              tone="good"
              title={`Синхронізація: ${cls.label}`}
              simpleTitle={cls.p === 1 ? "Гойдалка йде в такт поштовхам" : `Гойдалка домовилась: ${Math.round(scan.rho * cls.p)} гойдань на ${cls.p} поштовхів`}
              simple={
                <>
                  Через {cls.p} {plural(cls.p, ["поштовх", "поштовхи", "поштовхів"])} усе повторюється: гойдалка робить {Math.round(scan.rho * cls.p)}{" "}
                  {plural(Math.round(scan.rho * cls.p), ["гойдання", "гойдання", "гойдань"])} за цей час.{" "}
                  {L < -0.01
                    ? "Домовленість міцна: якщо гойдалку збити, вона швидко повертається в ритм."
                    : "Але домовленість слабка (показник розбігання майже нуль), тож гойдалка дуже довго «торгується» — на коротких відрізках це схоже на хаос."}
                </>
              }
            >
              Через {cls.p} період(и) сили стан повторюється: генератор робить {Math.round(scan.rho * cls.p)} власних коливань за {cls.p} періодів сили
              (резонанс {Math.round(scan.rho * cls.p)}:{cls.p}). {L < -0.01 ? "Цикл сильно притягує — збурення швидко гасне." : "Але притягування слабке (λ₁ майже 0), тому перехідний процес довгий і на коротких відрізках виглядає хаотично."}
            </Insight>
          )}
          {cls.kind === "quasi" && (
            <Insight
              tone="warn"
              title="Квазіперіодичність"
              simpleTitle="Кожен у своєму ритмі"
              simple={
                <>
                  Ритми не домовилися: на один поштовх припадає ≈ {fmt(scan.rho, 4)} гойдання — число, яке не записується простим дробом. «Фото в момент
                  поштовху» щоразу трохи зсуваються й поступово обводять замкнену криву. Розбіжності при цьому не ростуть і не гаснуть.
                </>
              }
            >
              Частоти генератора і сили не узгоджені (обертове число ≈ {fmt(scan.rho, 4)} — «ірраціональне»): точки стробоскопа заповнюють замкнену криву
              — переріз інваріантного тора. λ₁ ≈ 0: збурення не росте і не гасне.
            </Insight>
          )}
          {failed.length > 0 && (
            <Insight
              tone="bad"
              title="Хтось вибухнув"
              simple={
                <>
                  {failed.map((x) => METHODS[x.m].short).join(", ")}: крок {fmt(Math.max(dH, dT / 200000), 2)} задовгий для явного методу. Поки гойдалка
                  «повзе», відхилення гаснуть у темпі ≈ {fmt(3 * dMu, 3)}, а під час ривків — ще швидше; явний метод перестрибує і розгойдується до
                  нескінченності.
                </>
              }
            >
              {failed.map((x) => `${METHODS[x.m].short}: ${x.s.failed}`).join("; ")}. На повільних гілках λ ≈ −3μ = {fmt(-3 * dMu, 3)}, а під час стрибків
              ще більше — явним методам із кроком {fmt(Math.max(dH, dT / 200000), 2)} цього досить, щоб вийти з області стійкості.
            </Insight>
          )}
        </Lab>
      </Section>

      <Section kicker="Хаос під мікроскопом" title="Переріз Пуанкаре і показник Ляпунова" simpleTitle="Фото в момент поштовху і швидкість розбігання">
        <Grid>
          <Card>
            <Plot
              title={`Стробоскоп: (u, u′) при t = θ₀/ω + n·${fmt(Tp, 3)}, n = 60…460`}
              height={340}
              xLabel="u"
              yLabel="u′"
              sorted={false}
              series={[
                { x: scan.pu, y: scan.pv, color: "#ff7ad9", dots: true, dotSize: 2, label: `${scan.pu.length} точок` },
                ...(strobeTraj.length ? [{ x: strobeTraj.map((p) => p.u), y: strobeTraj.map((p) => p.v), color: "#ffe66d", dots: true, dotSize: 3, label: "з еталона на [0,T]", noRange: true }] : []),
              ]}
            />
            <Say
              simple={
                <p className="mt-2 text-[12.5px] text-white/55">
                  Кожна точка — де була гойдалка (положення u і швидкість u′) у момент чергового поштовху; перші 60 поштовхів відкинуто як «розгін». Покрутіть
                  фазу θ₀ (у яку мить поштовху фотографуємо) — у хаотичному режимі візерунок згинається і складається, як тісто.
                </p>
              }
            >
            <p className="mt-2 text-[12.5px] text-white/55">
              Перехідні 60 періодів відкинуто. Покрутіть фазу θ₀ — «хмара» хаосу згинається і складається, як тісто: це і є механізм розтягування-складання.
            </p>
            </Say>
          </Card>
          <Card>
            <Plot
              title="Збіжність оцінки λ₁ (метод Бенеттіна)"
              height={340}
              xLabel="t"
              yLabel="λ₁"
              series={[
                { x: scan.trace.map((p) => p.t), y: scan.trace.map((p) => p.L), color: "#ff7ad9", label: "λ₁(t)", width: 1.6 },
                { x: [scan.trace[0]?.t ?? 0, scan.trace[scan.trace.length - 1]?.t ?? 1], y: [0, 0], color: "#ffffff", width: 1, dash: [4, 4], opacity: 0.4 },
              ]}
            />
          </Card>
        </Grid>
        <div className="mt-4">
          <Grid>
            <Card>
              <Plot
                title="u(t): оригінал і двійник"
                height={260}
                xLabel="t"
                xDomain={view}
                series={[
                  { x: pair.sol.t, y: dist.ou, color: "#ff7ad9", label: "u(0) = 2", width: 1.5 },
                  { x: pair.sol.t, y: dist.tu, color: "#5cc8ff", label: `u(0) = 2 + ${fmt(dDelta, 2)}`, width: 1.2, opacity: 0.85 },
                ]}
              />
            </Card>
            <Card>
              <Plot
                title="|Δu(t)| (лог. шкала)"
                height={260}
                xLabel="t"
                logY
                yDomain={[Math.min(dDelta / 100, 1e-10), 10]}
                series={[
                  { x: dist.t, y: dist.d, color: "#ffe66d", label: "|Δu|", width: 1.2 },
                  ...(L > 0.003
                    ? [{ x: dist.t, y: dist.t.map((t) => dDelta * Math.exp(L * t)), color: "#ffffff", label: "δ·exp(λ₁t)", width: 1, dash: [5, 5], opacity: 0.5, noRange: true }]
                    : []),
                ]}
              />
            </Card>
          </Grid>
          {L > 0.003 && dDelta < 1e-8 && refHorizon < dT && (
            <div className="mt-4">
              <Insight
                tone="warn"
                title="Межа самого еталона"
                simple={
                  <>
                    У сильному хаосі крихітну похибку має й сам «оригінал»: вона теж росте лавиною і десь до t ≈ {fmt(refHorizon, 3)} стає помітною. Тож для δ, меншого
                    за 10⁻⁸, двійник порівнюється вже з трохи іншою (так само чесною) хаотичною траєкторією: швидкість розбігання показано правильно, а точний момент
                    відходу — лише оцінка.
                  </>
                }
              >
                Похибка інтегрування оригіналу (DOPRI, rtol 10⁻⁹) сама діє як збурення порядку 10⁻⁹ і виростає до O(1) за t ≈ ln(0.5/10⁻⁹)/λ₁ ≈{" "}
                {fmt(refHorizon, 3)}. Спільні кроки прибирають шум із різниці Δu, але не з самої траєкторії: для δ ≲ 10⁻⁸ пара «оригінал — двійник» після цього
                моменту йде вже іншою (так само законною) хаотичною траєкторією. Закон росту δ·e<sup>λ₁t</sup> зберігається, а момент відходу — лише оцінка.
              </Insight>
            </div>
          )}
        </div>
      </Section>

      <Section kicker="Результати" title="Методи на [0, T]" simpleTitle="Хто скільки працював і коли збився">
        <Card>
          <Table
            head={["Метод", "Кроки", "Відхилено", "f-обчислень", "Час", "Відхід від еталона (|Δu| > 0.5)"]}
            rows={sols.map(({ m, s, tDiv }) => [
              <span key={m} style={{ color: METHODS[m].color }}>
                {METHODS[m].name}
              </span>,
              s.failed ? <span className="text-[#ff5d73]">💥</span> : s.steps,
              s.rejected,
              s.fevals,
              fmtMs(s.ms),
              s.failed ? <span className="text-[#ff5d73]">{s.failed}</span> : Number.isFinite(tDiv) ? `t ≈ ${fmt(tDiv, 3)}` : "—",
            ])}
          />
          <Say
            simple={
              <p className="mt-3 text-[13px] text-white/55">
                Порівнюємо з дуже точним розрахунком (DOPRI, rtol 10⁻⁹). У хаотичному режимі навіть точні методи рано чи пізно «збиваються» з нього — це
                властивість задачі, а не помилка. У режимі «в такт» методи збігаються до кінця.
              </p>
            }
          >
          <p className="mt-3 text-[13px] text-white/55">
            Еталон — DOPRI з rtol = 10⁻⁹. На хаотичних режимах «відхід» неминучий навіть для точних методів; на періодичних — методи збігаються до кінця.
          </p>
          </Say>
        </Card>
      </Section>

      <Section kicker="Пісочниця" title="Штовхніть гойдалку самі" report={false}>
        <div className="mb-3">
          <Chips label="Режим" value={pgId} onChange={setPgId} options={PG_PRESETS.map((id) => ({ value: id, label: PRESETS[id].label }))} />
        </div>
        <PhasePlayground
          f={pgF}
          init={PG_INIT}
          axes={[0, 1]}
          labels={PG_LABELS}
          domain={PG_DOMAIN}
          autonomous={false}
          speed={8}
          speedRange={[0.5, 40]}
          trail={40}
          strip={[{ comp: 0, label: "u", color: "#ff7ad9" }]}
          window={80}
          kicks={[
            { label: "Штовхнути", emoji: "🫸", apply: (y) => [y[0], y[1] + 1, y[2]], hint: "u′ += 1" },
            { label: "Сильно штовхнути", emoji: "💪", apply: (y) => [y[0], y[1] + 4, y[2]], hint: "u′ += 4" },
            { label: "Зупинити гойдалку", emoji: "✋", apply: (y) => [0, 0, y[2]], hint: "u = u′ = 0" },
          ]}
          underlay={(ctx, { X, Y }) => {
            ctx.setLineDash([4, 5]);
            ctx.strokeStyle = "rgba(255,255,255,0.3)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            pgFree.u.forEach((u, k) => (k ? ctx.lineTo(X(u), Y(pgFree.v[k])) : ctx.moveTo(X(u), Y(pgFree.v[k]))));
            ctx.stroke();
            ctx.setLineDash([]);
          }}
          hint={
            <Say
              simple={
                <>
                  Площина «положення u — швидкість u′». Біла пунктирна петля — як гойдалась би гойдалка без поштовхів; сірі
                  рисочки показують, куди її тягне саме зараз, з урахуванням поштовху. Поштовхи тата тривають своїм ритмом,
                  навіть коли ви клацаєте чи натискаєте кнопки. Спробуйте «Зупинити гойдалку»: вона знову розгойдується сама. У режимі «a = 2» за кілька поштовхів
                  повертається в такт; в умові до ритму 3:5 «домовляється» дуже довго (сотні одиниць часу), а в режимі «слабкий хаос» щоразу виходить нова
                  картина.
                </>
              }
            >
              Фазова площина (u, u′) вимушеного рівняння ван дер Поля; система розширена фазою сили θ (θ′ = 1), тож клік і кнопки змінюють лише u, u′, а
              сила a·sin ωθ продовжується без розриву. Інтегрування — Розенброк у реальному часі. Пунктир — граничний цикл без сили (a = 0). Поле напрямків
              побудоване для поточної фази сили θ і перемальовується разом з нею.
            </Say>
          }
        />
      </Section>

      <Section kicker="Перевір себе" title="Спершу вгадай — потім перевір" report={false}>
        <QuizBlock
          taskId="16"
          questions={[
            {
              id: "strobe",
              q: <>Параметри умови (μ = 8.5, a = 0.5, ω = 2π/10). Скільки точок покаже стробоскоп (переріз Пуанкаре) після перехідного процесу?</>,
              options: ["Одну — генератор іде в такт силі", "П'ять", "Хмару без ладу — це ж хаос", "Замкнену криву"],
              correct: 1,
              explain: (
                <>
                  Після 60 відкинутих періодів точки повторюються через 5 періодів сили: обертове число 0.6 = 3/5, λ₁ ≈ −0.002 &lt; 0. Це резонанс 3:5 — за 50
                  одиниць часу генератор робить рівно 3 власних коливання. Хаосу за цих параметрів немає.
                </>
              ),
              explainSimple: <>П&apos;ять: за 5 поштовхів гойдалка робить рівно 3 гойдання, і далі все повторюється. Вона «домовилась» — просто дуже довго до цього йшла.</>,
              show: { label: "Показати умову", run: () => loadPreset(0) },
            },
            {
              id: "strong",
              q: <>Штовхаємо сильніше: a = 2 (μ = 8.5, ω = 2π/10). Що буде з рухом?</>,
              options: ["Хаос посилиться", "Генератор піде в такт силі: на стробоскопі одна точка", "Амплітуда зросте вчетверо", "Нічого не зміниться — ті самі 5 точок"],
              correct: 1,
              explain: (
                <>
                  Сильна сила захоплює частоту: обертове число 1 (одне власне коливання на період сили), переріз — одна точка, λ₁ ≈ −0.19 — цикл сильно притягує,
                  збурення гасне за кілька періодів. Амплітуда при цьому лишається ≈ 2: її задає нелінійне тертя.
                </>
              ),
              explainSimple: <>Сильний тато «нав&apos;язує» свій ритм: одне гойдання на кожен поштовх, і будь-який збій швидко виправляється. Розмах гойдань при цьому майже той самий.</>,
              show: { label: "Показати a = 2", run: () => loadPreset(3) },
            },
            {
              id: "euler",
              q: <>Явний Ейлер з кроком h = 0.05 на параметрах умови, T = 40. Що станеться?</>,
              options: ["Дорахує з невеликою похибкою", "Вибухне на першому ж ривку генератора (t ≈ 9.5)", "Вибухне одразу, на першому кроці", "Застигне в рівновазі"],
              correct: 1,
              explain: (
                <>
                  На повільній гілці λ ≈ −3μ ≈ −25, h|λ| ≈ 1.3 &lt; 2 — Ейлер тримається. Але під час першого стрибка (u перетинає нуль при t ≈ 8.45) власні
                  числа якобіана стають комплексними з великою уявною частиною (|λ| ~ 15), а круг стійкості |1 + hλ| ≤ 1 уявної осі не містить: розв&apos;язок
                  перевищує поріг 10⁶ при t ≈ 9.45. З h = 0.04 Ейлер доходить до кінця.
                </>
              ),
              explainSimple: <>Поки гойдалка повзе, крок 0.05 ще терпимий. Але на першому ж різкому ривку (t ≈ 8.5) Ейлер починає розгойдуватись і за секунду вибухає. З кроком 0.04 — доживає до кінця.</>,
              show: {
                label: "Показати Ейлера з h = 0.05",
                run: () => {
                  loadPreset(0);
                  setT(40);
                  setH(0.05);
                  setMethods((m) => (m.includes("euler") ? m : [...m, "euler"]));
                },
              },
            },
          ]}
        />
      </Section>

      <Section kicker="Аналіз" title="Висновки" simpleTitle="Що з цього запам'ятати">
        <Grid>
          <Insight
            tone="info"
            title="Три сценарії"
            simple={
              <>
                Зовнішні поштовхи або «нав&apos;язують» свій ритм (у такт чи «p гойдань на q поштовхів» — як 3:5 в умові), або живуть паралельно з власним
                ритмом, або за певних μ, a, ω зриваються в хаос, де картина не повторюється ніколи.
              </>
            }
          >
            Зовнішня сила або «підкоряє» генератор (захоплення частоти, субгармоніки p:q — як резонанс 3:5 в умові), або співіснує з ним
            (квазіперіодичний тор), або при певних μ, a, ω розриває тор і породжує дивний атрактор із λ₁ &gt; 0.
          </Insight>
          <Insight
            tone="warn"
            title="Хаос ≠ шум"
            simple={
              <>
                Хаос — не випадковість: знаючи старт точно, можна передбачити все. Але точно ми його не знаємо, а похибка росте лавиною. Покращити точність у
                10 разів — означає продовжити прогноз лише на сталий проміжок ln(10)/λ₁, а не вдесятеро.
              </>
            }
          >
            Розв&apos;язок повністю визначений початковими умовами, але передбачуваний лише на горизонті ~ln(1/δ)/λ₁. Збільшення точності методу в 10 разів
            додає до горизонту лише ln(10)/λ₁ — лінійний виграш за експоненційну ціну.
          </Insight>
          <Insight
            tone="good"
            title="Методи"
            simple={
              <>
                Жорсткість помірна. Розенброк і DOPRI витрачають порівнянно кроків, RK4 з h = 0.01 надійний, а явний Ейлер вибухає вже при h = 0.05. У хаосі
                методи порівнюють за «фото в момент поштовху» і швидкістю розбігання, а не точка в точку.
              </>
            }
          >
            Жорсткість помірна (λ ≈ −3μ). Розенброк і DOPRI витрачають порівнянну кількість кроків, RK4 з h = 0.01 надійний, явний Ейлер вибухає вже
            при h ≈ 0.05. Для хаосу правильніше порівнювати методи за інваріантами (переріз Пуанкаре, λ₁), а не поточково.
          </Insight>
          <Insight
            tone="fun"
            title="Цікавий факт"
            simple={
              <>
                Ще 1927 року ван дер Поль і ван дер Марк чули в навушниках свого генератора з зовнішньою напругою «нерегулярний шум» і вважали його дефектом.
                Лише через півстоліття зрозуміли: це був хаос — задовго до того, як це слово з&apos;явилося в науці.
              </>
            }
          >
            Ще 1927 року ван дер Поль і ван дер Марк, підключивши до свого генератора зовнішню напругу, чули в навушниках «нерегулярний шум» між
            «сходинками» синхронізації і вважали його дефектом приладу. Через півстоліття (зокрема, у роботах Парліца і Лаутерборна 1980-х) стало зрозуміло: це був хаос — задовго до
            того, як слово «хаос» з&apos;явилося в науці.
          </Insight>
        </Grid>
      </Section>
    </>
  );
}

function Playground({
  ref0,
  sols,
  T,
  w,
  a,
  strobe,
  view,
}: {
  ref0: Solution;
  sols: { m: MethodId; s: Solution }[];
  T: number;
  w: number;
  a: number;
  strobe: { t: number; u: number; v: number }[];
  view: [number, number];
}) {
  const pb = usePlayback(Math.min(60, Math.max(14, T / 4)));
  const time = view[0] + pb.progress * (view[1] - view[0]);
  const data = useMemo(() => {
    const u = comp(ref0, 0);
    const v = comp(ref0, 1);
    let vMax = 0;
    for (const x of v) vMax = Math.max(vMax, Math.abs(x));
    const force = ref0.t.map((t) => a * Math.sin(w * t));
    const ts: Series[] = [
      { x: ref0.t, y: force, color: "#ffffff", label: "a·sin ωt", width: 1, dash: [4, 4], opacity: 0.45 },
      { x: ref0.t, y: u, color: "#ffffff", label: "еталон", width: 4, opacity: 0.25 },
      ...sols.map(({ m, s }) => ({ x: s.t, y: comp(s, 0), color: METHODS[m].color, label: METHODS[m].short, width: s.failed ? 1 : 1.4, opacity: s.failed ? 0.45 : 1 })),
    ];
    const i0 = indexAt(ref0.t, view[0]),
      i1 = indexAt(ref0.t, view[1]);
    const phase: Series[] = [{ x: u.slice(i0, i1 + 1), y: v.slice(i0, i1 + 1), color: "#ff7ad9", width: 1.2, fade: true, label: "еталон" }];
    const R = 4;
    const stride = Math.max(1, Math.ceil(ref0.t.length / 7000));
    const torus: [number, number, number][] = [];
    for (let k = i0; k <= i1; k += stride) {
      const th = w * ref0.t[k];
      torus.push([(R + u[k]) * Math.cos(th), (R + u[k]) * Math.sin(th), v[k] / Math.max(1, vMax / 3)]);
    }
    return { u, v, vMax, ts, phase, torus };
  }, [ref0, sols, w, a, view]);

  const i = indexAt(ref0.t, time);
  const prog = (time - view[0]) / Math.max(1e-9, view[1] - view[0]);

  return (
    <>
      <Card title="Сцена: двигун, осцилятор і стробоскоп" icon="🎢">
        <StroboscopeScene t={ref0.t} u={data.u} v={data.v} time={time} w={w} a={a} strobe={strobe} vMax={data.vMax} />
        <div className="mt-3">
          <PlaybackBar pb={pb} label={`t = ${time.toFixed(1)}`} />
        </div>
        <Say
          simple={
            <p className="mt-2 text-[12.5px] text-white/55">
              Колесо крутиться в ритмі поштовхів. Щоразу, як воно проходить ту саму позначку, спалахує стробоскоп і «фотографує» положення й швидкість
              генератора — з цих фото складається переріз Пуанкаре.
            </p>
          }
        >
        <p className="mt-2 text-[12.5px] text-white/55">
          Колесо обертається з частотою сили ω; щоразу, як воно проходить фазу θ₀, спалахує стробоскоп і «фотографує» стан осцилятора (u, u′) — так
          будується переріз Пуанкаре праворуч.
        </p>
        </Say>
      </Card>
      <Card>
        <Plot title="u(t) і зовнішня сила" height={260} xLabel="t" xDomain={view} cursorX={time} series={data.ts} />
      </Card>
      <Grid>
        <Card>
          <Plot
            title="Фазовий портрет (u, u′)"
            height={300}
            xLabel="u"
            yLabel="u′"
            sorted={false}
            markers={[
              ...strobe.filter((s) => s.t >= view[0] && s.t <= view[1]).map((s) => ({ x: s.u, y: s.v, color: "#ffe66d", r: 3 })),
              { x: data.u[i], y: data.v[i], color: "#ffffff", r: 5 },
            ]}
            series={data.phase}
          />
        </Card>
        <Card title="Тор (u, u′, фаза сили ωt)" icon="🍩">
          <Plot3D curves={[{ pts: data.torus, colors: ["#3a1d6e", "#ff7ad9"], width: 1 }]} progress={Math.max(0.002, prog)} height={300} labels={["", "", "u′"]} />
          <Say simple={<p className="mt-1 text-[12px] text-white/45">Обертаємо фазовий портрет навколо осі в ритмі поштовхів: виходить «бублик». Переріз Пуанкаре — це зріз бублика ножем.</p>}>
            <p className="mt-1 text-[12px] text-white/45">Кут навколо осі — фаза сили ωt, відстань від осі — 4 + u, висота — u′.</p>
          </Say>
        </Card>
      </Grid>
    </>
  );
}
