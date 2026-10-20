import type { MethodId } from "./ode";

export interface MethodMeta {
  id: MethodId;
  name: string;
  short: string;
  color: string;
  kind: "explicit" | "implicit" | "adaptive";
  order: number;
  about: string;
}

export const METHODS: Record<MethodId, MethodMeta> = {
  euler: {
    id: "euler",
    name: "Явний Ейлер",
    short: "Ейлер",
    color: "#ff5d73",
    kind: "explicit",
    order: 1,
    about: "y₍ₙ₊₁₎ = yₙ + h·f(tₙ, yₙ). Найпростіший, але стійкий лише при |1 + hλ| ≤ 1.",
  },
  rk4: {
    id: "rk4",
    name: "Рунге–Кутта 4",
    short: "RK4",
    color: "#ffb547",
    kind: "explicit",
    order: 4,
    about: "Класичний 4-стадійний метод. Дуже точний, але все одно явний — обмежений областю стійкості.",
  },
  ieuler: {
    id: "ieuler",
    name: "Неявний Ейлер",
    short: "Неявн. Ейлер",
    color: "#3ee6a8",
    kind: "implicit",
    order: 1,
    about: "y₍ₙ₊₁₎ = yₙ + h·f(tₙ₊₁, yₙ₊₁). L-стійкий: гасить швидкі компоненти при будь-якому h.",
  },
  theta: {
    id: "theta",
    name: "θ-метод (0.55)",
    short: "θ=0.55",
    color: "#5cc8ff",
    kind: "implicit",
    order: 1,
    about: "y₍ₙ₊₁₎ = yₙ + h(0.55·fₙ₊₁ + 0.45·fₙ). A-стійкий лінійний однокроковий метод із завдання.",
  },
  trap: {
    id: "trap",
    name: "Трапеції",
    short: "Трапеції",
    color: "#b18cff",
    kind: "implicit",
    order: 2,
    about: "θ = 0.5. A-стійкий, 2-го порядку, але не гасить жорсткі компоненти (R(−∞) = −1).",
  },
  bdf2: {
    id: "bdf2",
    name: "Гір (BDF2)",
    short: "BDF2",
    color: "#ff7ad9",
    kind: "implicit",
    order: 2,
    about: "3/2·y₍ₙ₊₁₎ − 2yₙ + ½yₙ₋₁ = h·f₍ₙ₊₁₎. Двокроковий метод Гіра — класика для жорстких задач.",
  },
  dopri: {
    id: "dopri",
    name: "Дорманд–Принс 5(4)",
    short: "DOPRI45",
    color: "#ffe66d",
    kind: "adaptive",
    order: 5,
    about: "Адаптивний явний метод (як ode45). Точний, але на жорстких задачах «дріботить» кроком.",
  },
  ros: {
    id: "ros",
    name: "Розенброк 2(3)",
    short: "Розенброк",
    color: "#7cf29c",
    kind: "adaptive",
    order: 2,
    about: "Адаптивний лінійно-неявний метод (як ode23s). L-стійкий, крок росте разом із гладкістю розв'язку.",
  },
  thetaA: {
    id: "thetaA",
    name: "θ-метод, змінний крок",
    short: "θ адапт.",
    color: "#4dd0e1",
    kind: "adaptive",
    order: 1,
    about: "θ-метод із контролем похибки подвоєнням кроку.",
  },
};
