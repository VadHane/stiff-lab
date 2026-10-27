"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Say } from "@/components/mode/Mode";
import { Card, Grid, Insight, Section } from "@/components/ui/blocks";
import { Tex } from "@/components/ui/Tex";
import {
  BUTCHER_PRESETS,
  MAX_STAGES,
  classify,
  isStifflyAccurate,
  orderInfo,
  parseTableau,
  presetById,
  sameSrc,
  sanitizeTableauSrc,
  stabilityInfo,
  tableauTex,
  type Tableau,
  type TableauSrc,
} from "@/lib/butcher";
import type { MethodId } from "@/lib/ode";
import { codecs, useUrlState } from "@/lib/url-state";
import BuilderQuiz from "./BuilderQuiz";
import ConvergencePanel from "./ConvergencePanel";
import Passport, { type Analysis } from "./Passport";
import { MAIN_IDS } from "./problems";
import RunPanel from "./RunPanel";
import StabilityMap from "./StabilityMap";
import TableauEditor from "./TableauEditor";

const DEFAULT_SRC: TableauSrc = presetById("kutta3")!.src;
const SRC_CODEC = codecs.json<TableauSrc>(sanitizeTableauSrc);
const PR_CODEC = codecs.enum(MAIN_IDS);
const RK4_TEX = tableauTex(presetById("rk4")!.src);

export default function Builder() {
  const [src, setSrc] = useUrlState<TableauSrc>("tb", DEFAULT_SRC, SRC_CODEC);
  const [pr, setPr] = useUrlState<string>("pr", "t1", PR_CODEC);
  const [h, setH] = useUrlState<number>("h", 0);
  const [cmp, setCmp] = useState<MethodId[] | null>(null);

  const parsed = useMemo(() => parseTableau(src), [src]);
  // while a cell has an error, the analysis keeps showing the last valid tableau
  const [lastGood, setLastGood] = useState<Tableau>(() => parsed.tableau ?? parseTableau(DEFAULT_SRC).tableau!);
  useEffect(() => {
    if (parsed.tableau) setLastGood(parsed.tableau);
  }, [parsed.tableau]);
  const tab = useDeferredValue(parsed.tableau ?? lastGood);

  const a: Analysis = useMemo(() => ({ kind: classify(tab), order: orderInfo(tab), stab: stabilityInfo(tab), stiffAcc: isStifflyAccurate(tab) }), [tab]);
  const preset = BUTCHER_PRESETS.find((p) => sameSrc(p.src, src) && p.group !== "empty");
  const name = preset ? preset.short : `Ваш метод (s = ${tab.s})`;
  const stale = !parsed.tableau;

  const load = (s: TableauSrc, problem: string, step: number) => {
    setSrc(structuredClone(s));
    setPr(problem);
    setH(step);
    setCmp(null);
    // the quiz scrolls to the lab at once, but the heavy recomputation can cancel a smooth scroll — repeat it afterwards
    setTimeout(() => document.getElementById("builder-run")?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
  };

  return (
    <>
      <Section kicker="Ідея" title="Що таке таблиця Батчера" simpleTitle="Метод Рунге–Кутти — це рецепт одного кроку">
        <Grid>
          <Card title={<Say simple="Рецепт кроку">Означення</Say>} icon="📜">
            <Say
              simple={
                <div className="space-y-2 text-[14px] leading-relaxed text-white/75">
                  <p>
                    Уявіть, що ви йдете в тумані й маєте компас, який показує, куди змінюється розв&apos;язок (це f). За один крок можна кілька разів{" "}
                    <b>«розвідати» напрямок</b> — подивитися на компас у пробних точках. Таблиця Батчера — рецепт цих розвідок:
                  </p>
                  <ul className="ml-5 list-disc space-y-1">
                    <li>
                      <b>s</b> — скільки розвідок за крок (стадій);
                    </li>
                    <li>
                      <b>рядок A</b> — з якої точки робити i-ту розвідку: змішати попередні напрямки з вагами aᵢⱼ;
                    </li>
                    <li>
                      <b>c</b> — у який момент усередині кроку (частка від h);
                    </li>
                    <li>
                      <b>b</b> — з якими вагами змішати всі розвідані напрямки, щоб зробити справжній крок.
                    </li>
                  </ul>
                  <p>
                    Якщо кожна розвідка спирається лише на вже зроблені (A заповнена тільки під діагоналлю) — метод <b>явний</b>. Якщо розвідки посилаються одна на
                    одну чи на себе — <b>неявний</b>: їх треба знаходити, розв&apos;язуючи систему рівнянь. Дорожче, зате можна йти великими кроками там, де явний метод
                    «розгойдується».
                  </p>
                </div>
              }
            >
              <div className="space-y-2 text-[14px] leading-relaxed text-white/75">
                <p>s-стадійний метод Рунге–Кутти для y′ = f(t, y):</p>
                <Tex block>{String.raw`k_i = f\Big(t_n + c_i h,\ y_n + h\sum_{j=1}^{s} a_{ij}k_j\Big),\ \ i=1,\dots,s;\qquad y_{n+1} = y_n + h\sum_{i=1}^{s} b_i k_i .`}</Tex>
                <p>
                  Коефіцієнти записують таблицею <Tex>{"\\begin{array}{c|c} c & A \\\\ \\hline & b^{\\mathsf T}\\end{array}"}</Tex>, зазвичай з <Tex>{"c_i=\\sum_j a_{ij}"}</Tex>.
                  Якщо <Tex>{"a_{ij}=0"}</Tex> для <Tex>{"j\\ge i"}</Tex> — метод явний (стадії обчислюються по черзі); якщо ненульова лише діагональ і нижче — DIRK (s систем
                  n × n, для SDIRK з однаковою матрицею); інакше — повністю неявний: система <Tex>{"sn"}</Tex> рівнянь, яку тут розв&apos;язує метод Ньютона з матрицею{" "}
                  <Tex>{"I-h\\,(A\\otimes J)"}</Tex>.
                </p>
              </div>
            </Say>
          </Card>
          <Card title="Приклад: класичний RK4" icon="🧮">
            <Tex block>{RK4_TEX}</Tex>
            <Say
              simple={
                <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                  Чотири розвідки: на початку кроку, двічі в середині (кожна — з уточненої точки) і в кінці. Підсумок — середнє з вагами 1/6, 1/3, 1/3, 1/6, як у формулі
                  Сімпсона. Під таблицею нижче — усе, що з неї випливає: точність, стійкість і поведінка на задачах курсу.
                </p>
              }
            >
              <p className="mt-2 text-[14px] leading-relaxed text-white/75">
                Порядок 4 (8 умов порядку), <Tex>{"R(z)=\\sum_{k=0}^{4} z^k/k!"}</Tex>. Усе, що далі на сторінці, обчислюється безпосередньо з (c, A, b): умови порядку для
                всіх 17 дерев до 5-го порядку, <Tex>{"R(z)"}</Tex> через визначники, A-/L-стійкість, а також розв&apos;язувач для довільної таблиці.
              </p>
            </Say>
          </Card>
        </Grid>
      </Section>

      <Section kicker="Редактор" title="Таблиця вашого методу" simpleTitle="Складіть свій рецепт">
        <Card>
          <TableauEditor src={src} onChange={setSrc} parsed={parsed} kind={parsed.tableau ? classify(parsed.tableau) : null} />
        </Card>
      </Section>

      <Section kicker="Паспорт" title={`Паспорт методу «${name}»`} simpleTitle={`Що вміє «${name}»`}>
        {stale && (
          <div className="mb-3">
            <Insight tone="warn" title="У таблиці є помилки">
              Показано паспорт останньої коректної таблиці — виправте клітинки, позначені червоним.
            </Insight>
          </div>
        )}
        <Passport tab={tab} a={a} preset={preset} />
      </Section>

      <Section kicker="Стійкість" title="Карта стійкості" simpleTitle="Де метод не «розгойдується»">
        <StabilityMap P={a.stab.P} Q={a.stab.Q} realBound={a.stab.realBound} imagBound={a.stab.imagBound} explicit={a.kind === "explicit"} name={name} />
      </Section>

      <Section id="builder-run" kicker="Практика" title="Прогін на задачах курсу" simpleTitle="Спробуйте метод на справжніх задачах">
        <RunPanel tab={tab} a={a} name={name} pr={pr} setPr={setPr} h={h} setH={setH} cmp={cmp} setCmp={setCmp} />
      </Section>

      <Section kicker="Збіжність" title="Чи справджується порядок" simpleTitle="Удвічі менший крок — у скільки разів менша похибка?">
        <ConvergencePanel tab={tab} a={a} name={name} />
      </Section>

      <Section kicker="Перевір себе" title="Квіз" report={false}>
        <BuilderQuiz a={a} name={name} load={load} />
      </Section>

      <Section kicker="Для викладача" title="Як користуватися" report={false}>
        <Grid>
          <Card title="Завдання для студентів" icon="🎓">
            <ul className="ml-5 list-disc space-y-2 text-[14px] leading-relaxed text-white/75">
              <li>
                <b>«Збудуйте явний метод 3-го порядку з 3 стадій».</b> Пресет «Порожній», s = 3: чотири умови порядку, шість невідомих (a₂₁, a₃₁, a₃₂, b₁, b₂, b₃ при c = A·1) —
                двопараметрична сім&apos;я (c₂, c₃ вільні). Паспорт миттєво підсвічує, які умови вже виконано; кнопка «c = A·1» заповнює c.
              </li>
              <li>
                <b>«Знайдіть γ, за якого 2-стадійний SDIRK має порядок 3».</b> Відповідь γ = (3 ± √3)/6; A-стійкий лише варіант із «+» (пресет SDIRK3) — карта стійкості
                це показує.
              </li>
              <li>
                <b>«Порівняйте Гаусса s = 2 і Радо IIA s = 2 на задачі Робертсона з великим кроком».</b> Обидва A-стійкі, але лише Радо L-стійкий; на жорсткій задачі
                Протеро–Робінсона у «Збіжності» видно зниження порядку до стадійного.
              </li>
              <li>
                <b>«Чому правило 3/8 і RK4 мають однакову область стійкості?»</b> — бо R(z) однакова (обидва s = p = 4), хоча коефіцієнти різні.
              </li>
            </ul>
          </Card>
          <Card title="Посилання, перевірка, обмеження" icon="🔗">
            <ul className="ml-5 list-disc space-y-2 text-[14px] leading-relaxed text-white/75">
              <li>
                Кнопка <b>«Поділитися»</b> вгорі копіює адресу з таблицею (вирази клітинок як є), вибраною задачею і кроком — студент надсилає її як відповідь, а ви
                відкриваєте ту саму картину.
              </li>
              <li>
                Порядок перевіряється умовами до 5-го включно (поріг нев&apos;язки 10⁻¹²): для методів 6-го порядку (Гаусс s = 3) паспорт пише «≥ 5»; справжній порядок
                видно в «Збіжності» (нахил ≈ 6).
              </li>
              <li>
                Розв&apos;язувач конструктора на тих самих задачах і кроках дає ті самі y(T), що й вбудовані Ейлер, RK2, RK3, RK4, неявний Ейлер і трапеції (розбіжність
                ≤ 10⁻¹¹ відносно). Неявні стадії — Ньютон для всієї системи sn × sn; якщо він не збігся, прогін чесно зупиняється.
              </li>
              <li>
                Обмеження: до {MAX_STAGES} стадій, сталий крок (без оцінки похибки й адаптивності), кількість кроків обмежена (до 8000/s для неявних і 120000/s для явних
                таблиць), щоб сторінка не зависала.
              </li>
            </ul>
          </Card>
        </Grid>
      </Section>
    </>
  );
}
