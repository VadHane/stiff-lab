"use client";

import { useMemo } from "react";
import QuizBlock from "@/components/quiz/Quiz";
import { Tex } from "@/components/ui/Tex";
import { parseTableau, presetById, realR, stabilityInfo, type ButcherPreset, type TableauSrc } from "@/lib/butcher";
import { fmt } from "@/lib/format";
import type { Analysis } from "./Passport";
import { orderLabel } from "./Passport";

const stabOf = (id: string) => stabilityInfo(parseTableau(presetById(id)!.src).tableau!);

export default function BuilderQuiz({
  a,
  name,
  load,
}: {
  a: Analysis;
  name: string;
  /** set the tableau / problem / step in the lab (for the «show me» buttons) */
  load: (src: TableauSrc, pr: string, h: number) => void;
}) {
  const nums = useMemo(() => {
    const rk4 = stabOf("rk4"),
      dp = stabOf("dopri5"),
      ie = stabOf("ieuler"),
      tr = stabOf("trap"),
      ra = stabOf("radau2");
    return {
      rk4bound: rk4.realBound,
      dpBound: dp.realBound,
      rk4m3: realR(rk4.P, rk4.Q, -3),
      rk4m10: realR(rk4.P, rk4.Q, -10),
      ie1000: realR(ie.P, ie.Q, -1000),
      ra1000: realR(ra.P, ra.Q, -1000),
      tr100: realR(tr.P, tr.Q, -100),
      tr1000: realR(tr.P, tr.Q, -1000),
    };
  }, []);
  const passed3 = a.order.conditions.filter((c) => c.order <= 3 && c.ok).length;
  const p = (id: string) => presetById(id) as ButcherPreset;
  // t1: λ₂ ≈ −1001, so RK4 needs h < 2.785/1001 ≈ 0.00278
  const hBoom = 0.003;

  return (
    <QuizBlock
      taskId="builder"
      intro="Спершу дайте відповідь «на око», а потім перевірте себе в конструкторі вище."
      questions={[
        {
          id: "conds3",
          q: <>Скільки рівнянь (умов порядку) мають задовольнити числа таблиці, щоб метод мав порядок 3?</>,
          options: ["2", "3", "4", "8"],
          correct: 2,
          explain: (
            <>
              Кількість кореневих дерев порядку 1, 2, 3 — це 1 + 1 + 2 = 4: <Tex>{"\\sum b_i=1,\\ \\sum b_ic_i=\\tfrac12,\\ \\sum b_ic_i^2=\\tfrac13,\\ \\sum b_ia_{ij}c_j=\\tfrac16"}</Tex>. Для
              порядку 4 їх уже 8, для 5 — 17. Ваша таблиця «{name}» виконує {passed3} з цих 4 (порядок {orderLabel(a.order)}).
            </>
          ),
          explainSimple: (
            <>
              Чотири: одне — щоб ваги в сумі давали 1, одне для порядку 2 і ще два для порядку 3. Далі росте швидко: для порядку 4 — вісім, для 5 — сімнадцять. Ваша
              таблиця «{name}» виконує {passed3} з перших чотирьох.
            </>
          ),
        },
        {
          id: "explicitA",
          q: <>Чи можна, підібравши багато стадій і хитрі коефіцієнти, зробити явний метод Рунге–Кутти A-стійким?</>,
          options: ["Так, якщо стадій ≥ 5", "Так, якщо всі b_i > 0", "Ні: R(z) — многочлен, і |R(z)| → ∞", "Лише для лінійних задач"],
          correct: 2,
          explain: (
            <>
              Для явного методу <Tex>{"\\det(I-zA)=1"}</Tex>, тож R(z) — многочлен степеня ≤ s, і він необмежений у лівій півплощині. Напр., RK4: R(−3) = {fmt(nums.rk4m3, 4)},
              R(−10) = {fmt(nums.rk4m10, 4)}; межа на дійсній осі −{fmt(nums.rk4bound, 4)}, у 7-стадійного DOPRI5 — лише −{fmt(nums.dpBound, 4)}.
            </>
          ),
          explainSimple: (
            <>
              Ні. Множник явного методу — многочлен, а многочлен для великих |hλ| завжди стає величезним. RK4 при hλ = −10 множить похибку на {fmt(nums.rk4m10, 4)} щокроку.
              Більше стадій лише трохи розсуває межу: RK4 −{fmt(nums.rk4bound, 3)}, DOPRI5 −{fmt(nums.dpBound, 3)}.
            </>
          ),
          show: { label: "RK4 на задачі №1 з h = 0.003", run: () => load(p("rk4").src, "t1", hBoom) },
        },
        {
          id: "rinf0",
          q: <>Що дає методу властивість R(∞) = 0 (разом з A-стійкістю)?</>,
          options: [
            "Вищий порядок точності",
            "Жорсткі компоненти гаснуть за крок за будь-якого великого h (L-стійкість)",
            "Метод стає явним",
            "Ньютон завжди збігається за одну ітерацію",
          ],
          correct: 1,
          explain: (
            <>
              Це L-стійкість: для <Tex>{"h\\lambda\\to-\\infty"}</Tex> множник прямує до 0. Неявний Ейлер: R(−1000) = {fmt(nums.ie1000, 3)}; Радо IIA (s = 2): R(−1000) ={" "}
              {fmt(nums.ra1000, 3)}; а трапеції (R(∞) = −1): R(−1000) = {fmt(nums.tr1000, 4)}.
            </>
          ),
          explainSimple: (
            <>
              Найшвидші процеси, які в реальності згасають миттєво, метод теж «гасить» за один крок, хоч би який великий крок ви взяли. Неявний Ейлер при hλ = −1000 залишає
              від них {fmt(nums.ie1000, 3)}, трапеції — {fmt(Math.abs(nums.tr1000), 3)} (і ще перевертають знак).
            </>
          ),
          show: { label: "Радо IIA на задачі №1 з h = 0.05", run: () => load(p("radau2").src, "t1", 0.05) },
        },
        {
          id: "trap",
          q: <>Трапеції A-стійкі. Чому ж на жорсткій задачі з великим кроком вони «дзвенять» замість гасити швидку компоненту?</>,
          options: ["Бо метод насправді явний", "Бо R(z) → −1 при z → −∞", "Бо порядок лише 2", "Бо Ньютон не збігається"],
          correct: 1,
          explain: (
            <>
              <Tex>{"R(z)=\\frac{1+z/2}{1-z/2}\\to-1"}</Tex>: при z = −100 множник {fmt(nums.tr100, 4)}, при z = −1000 — {fmt(nums.tr1000, 4)}. За 10 кроків швидка мода
              зменшиться лише до {fmt(Math.pow(Math.abs(nums.tr1000), 10), 3)} від початкової, щоразу міняючи знак. Метод стійкий (|R| &lt; 1), але не L-стійкий.
            </>
          ),
          explainSimple: (
            <>
              Їхній множник для дуже швидких процесів близький до −1: швидка складова щокроку перекидається з плюса на мінус і майже не зменшується. При hλ = −1000 за 10 кроків
              від неї лишається {fmt(Math.pow(Math.abs(nums.tr1000), 10) * 100, 3)} %.
            </>
          ),
          show: { label: "Трапеції на задачі №1 з h = 0.05", run: () => load(p("trap").src, "t1", 0.05) },
        },
      ]}
    />
  );
}
