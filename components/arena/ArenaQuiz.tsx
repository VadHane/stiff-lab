"use client";

import { useMemo } from "react";
import QuizBlock, { type QuizQuestion } from "@/components/quiz/Quiz";
import { quizExplicitWins, quizRk4, quizRobertson, type QuizData } from "@/lib/arena";
import type { MethodId } from "@/lib/ode";
import { NAMES, pow10, specShort } from "./shared";

const Q1_EPS = 1e-6;
const Q2_EPS = 1e-6;
const Q3_EPS = 1e-3;

interface Locked {
  key: string;
  text: string;
  action?: { label: string; run: () => void };
}

/**
 * Три квізи про результати змагання. Правильні відповіді й пояснення беруться з обчислених даних; квіз відкривається,
 * щойно пораховано потрібні задачі. id питання містить «відбиток» даних: якщо результат зміниться (інший вибір задач),
 * збережена відповідь не підставиться до іншого питання.
 */
export default function ArenaQuiz({
  specIds,
  methods,
  version,
  addSpec,
  addMethod,
}: {
  specIds: string[];
  methods: MethodId[];
  version: number;
  addSpec: (id: string) => void;
  addMethod: (m: MethodId) => void;
}) {
  const { questions, locked } = useMemo(() => {
    void version;
    const qs: QuizQuestion[] = [];
    const lk: Locked[] = [];
    // 1. Robertson
    const q1 = quizRobertson(methods, Q1_EPS, NAMES);
    if (q1.ready) {
      const f = q1.facts;
      qs.push({
        id: q1.id,
        q: (
          <>
            Хто переміг на задачі Робертсона (№12, хімічна кінетика) при точності ε = {pow10(Q1_EPS)}, тобто чия крива перетнула ціль найлівіше?
          </>
        ),
        options: q1.options,
        correct: q1.correct,
        explain: (
          <>
            Переможець — <b>{f.winner}</b>: {Number(f.cost).toLocaleString("uk-UA")} f + n·J.
            {f.second ? (
              <>
                {" "}
                Наступний — {f.second}, дорожчий у {f.secondRatio} раза.
              </>
            ) : null}{" "}
            Фінішували {f.finished} з {f.total} методів.{" "}
            {f.winnerExplicit ? (
              <>Цікаво: переміг явний метод — на цьому відрізку жорсткість ще не встигла обмежити його крок сильніше, ніж точність.</>
            ) : (
              <>
                Задача жорстка (швидкі реакції з константами 10⁴ і 3·10⁷ проти повільної 0.04): явним методам стійкість не дає великого кроку, а неявний метод бере великі
                кроки там, де розв&apos;язок уже гладкий.
              </>
            )}
          </>
        ),
        explainSimple: (
          <>
            Найменше праці витратив <b>{f.winner}</b> — {Number(f.cost).toLocaleString("uk-UA")} обчислень.
            {f.second ? <> Другим був {f.second}, але він працював у {f.secondRatio} раза більше.</> : null} Хімія Робертсона «жорстка»: одні реакції блискавичні,
            інші повільні{f.winnerExplicit ? "." : ", і переміг той, хто вміє робити великі кроки, не боячись блискавичних."}
          </>
        ),
      });
    } else
      lk.push({
        key: "q1",
        text: specIds.includes("t12") ? "Питання про Робертсона відкриється, коли задачу №12 буде пораховано." : "Питання про Робертсона: додайте задачу №12 до змагання.",
        action: specIds.includes("t12") ? undefined : { label: "➕ Додати Робертсона", run: () => addSpec("t12") },
      });
    // 2. RK4 on a stiff task
    const q2 = quizRk4(specIds, methods, Q2_EPS, NAMES);
    if (q2.ready) {
      const f = q2.facts;
      qs.push({
        id: q2.id,
        q: (
          <>
            Чому RK4 не досяг ε = {pow10(Q2_EPS)} на задачі «{String(f.spec)}», хоча він 4-го порядку?
          </>
        ),
        options: q2.options,
        correct: q2.correct,
        explain: (
          <>
            {Number(f.blowups) > 0 ? (
              <>
                З {f.runs} прогонів RK4 {f.blowups} «вибухнули» — аж до N = {Number(f.worstN).toLocaleString("uk-UA")} (h ≈ {f.hWorst}).{" "}
                {f.firstOkN ? (
                  <>
                    Лише з N = {Number(f.firstOkN).toLocaleString("uk-UA")} розв&apos;язок не вибухає, а найкраща досягнута похибка — {String(f.bestErr)}; більших N бюджет
                    (до {Number(f.maxN).toLocaleString("uk-UA")} кроків) не дозволяє.
                  </>
                ) : (
                  <>Навіть N = {Number(f.maxN).toLocaleString("uk-UA")} кроків замало для стійкості.</>
                )}{" "}
                Це межа стійкості явного методу: для RK4 потрібно <i>h·|λ| ≲ 2.79</i>, а |λ| у жорсткій задачі величезне. Поки крок нестійкий, похибка росте, а не
                зменшується — порядок тут ні до чого; Ньютона RK4 не використовує взагалі.
              </>
            ) : (
              <>
                RK4 не вибухав, але й не дійшов до ε у межах бюджету кроків: найкраща похибка {String(f.bestErr)}.
              </>
            )}
          </>
        ),
        explainSimple: (
          <>
            {Number(f.blowups) > 0 ? (
              <>
                RK4 «вибухав» у {f.blowups} забігах з {f.runs}: з великим кроком він не встигає за найшвидшими процесами задачі й розгойдується. Щоб не вибухнути,
                крок треба зробити крихітним — а тоді кроків стільки, що бюджет закінчується раніше, ніж метод дійде до потрібної точності.
              </>
            ) : (
              <>RK4 не вибухав, але не встиг дійти до потрібної точності, поки не закінчився бюджет кроків.</>
            )}
          </>
        ),
      });
    } else {
      const why = q2.waitFor;
      lk.push({
        key: "q2",
        text:
          why === "rk4"
            ? "Питання про RK4: увімкніть метод RK4."
            : why === "stiff-rk4"
              ? `Питання про RK4: серед вибраних жорстких задач немає такої, де RK4 не досяг ε = ${pow10(Q2_EPS)}. Додайте, наприклад, орегонатор (№24).`
              : `Питання про RK4 відкриється, коли буде пораховано задачу «${specShort(why ?? "")}».`,
        action: why === "rk4" ? { label: "➕ Додати RK4", run: () => addMethod("rk4") } : why === "stiff-rk4" ? { label: "➕ Додати орегонатор", run: () => addSpec("t24") } : undefined,
      });
    }
    // 3. explicit cheaper than implicit
    const q3 = quizExplicitWins(specIds, methods, Q3_EPS, NAMES);
    if (q3.ready) {
      const f = q3.facts;
      qs.push({
        id: q3.id,
        q: <>На якій із цих задач найкращий явний метод досягає ε = {pow10(Q3_EPS)} дешевше, ніж найкращий неявний?</>,
        options: q3.options,
        correct: q3.correct,
        explain: (
          <>
            На «{String(f.spec)}» {f.explicit} обійшов {f.implicit ? <>найкращий неявний ({f.implicit}) у {f.ratio} раза</> : "усі неявні (жоден не фінішував)"}.{" "}
            {f.stiff
              ? "Задача формально жорстка, але на цьому відрізку й при цій точності крок явного методу обмежувала точність, а не стійкість, тож неявним не було чим відігратися за якобіан і Ньютона."
              : "Задача нежорстка: крок явного методу обмежує лише точність, а неявні на кожному кроці платять за якобіан (n обчислень f) та ітерації Ньютона."} На «{String(f.loser)}» навпаки:{" "}
            {f.loserExplicitDnf ? "жоден явний метод не досяг ε" : <>явний дорожчий у {f.loserRatio} раза</>}. Явні методи дешевші на {f.count} з {f.total} порахованих задач.
          </>
        ),
        explainSimple: (
          <>
            На «{String(f.spec)}» {f.stiff ? "при такій точності швидкі процеси не заважали" : "усі процеси повільні"}, тож простий явний {f.explicit} робить кроки,
            обмежені лише точністю, і не витрачається на складні рівняння кожного кроку. Там, де є блискавичні процеси, як у «{String(f.loser)}», картина протилежна.
          </>
        ),
      });
    } else {
      const why = q3.waitFor;
      lk.push({
        key: "q3",
        text:
          why === "none"
            ? `Питання «де явний метод дешевший»: серед вибраних задач немає такої, де найкращий явний метод досяг ε = ${pow10(Q3_EPS)} дешевше за неявний (або немає жодної, де навпаки). Додайте нежорстку задачу, напр. RLC-коло (№22).`
            : why === "methods"
              ? "Питання «де явний метод дешевший»: потрібні і явні, і неявні методи."
              : `Питання «де явний метод дешевший» відкриється, коли буде пораховано задачу «${specShort(why ?? "")}».`,
        action: why === "none" ? { label: "➕ Додати №22", run: () => addSpec("t22") } : undefined,
      });
    }
    return { questions: qs, locked: lk };
  }, [specIds, methods, version, addSpec, addMethod]);

  return (
    <div className="space-y-3" data-arena-quiz="">
      {questions.length > 0 && <QuizBlock taskId="arena" questions={questions} intro="Відповіді — з даних цього змагання. Спершу подумайте, потім перевірте на графіках вище." />}
      {locked.map((l) => (
        <div key={l.key} className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] p-4 text-[14px] text-white/55">
          <span className="text-lg">🔒</span>
          <span className="min-w-0 flex-1">{l.text}</span>
          {l.action && (
            <button onClick={l.action.run} className="rounded-full border border-white/15 px-3 py-1 text-[12.5px] text-white/80 hover:bg-white/10">
              {l.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export type { QuizData };
