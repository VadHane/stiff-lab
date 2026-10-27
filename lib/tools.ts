/** Standalone tool pages (not tied to a single task) shown on the home page and in the header. */
export interface ToolMeta {
  href: string;
  emoji: string;
  title: string;
  tagline: string;
  accent: string;
  audience: "student" | "teacher";
  tags: string[];
}

export const TOOLS: ToolMeta[] = [
  {
    href: "/builder",
    emoji: "🧩",
    title: "Конструктор методу",
    tagline: "Задайте таблицю Батчера — і отримайте порядок, R(z), A- і L-стійкість, карту стійкості та прогін на будь-якій задачі курсу",
    accent: "#ffb547",
    audience: "student",
    tags: ["таблиця Батчера", "умови порядку", "R(z)"],
  },
  {
    href: "/sandbox",
    emoji: "🧪",
    title: "Своя система",
    tagline: "Введіть власні рівняння формулами: сайт розв'яже їх будь-яким методом, оцінить жорсткість і порадить, чим рахувати",
    accent: "#3ee6a8",
    audience: "student",
    tags: ["редактор формул", "аналіз жорсткості", "Python/MATLAB"],
  },
  {
    href: "/arena",
    emoji: "🏟️",
    title: "Арена методів",
    tagline: "Усі 11 методів змагаються на задачах курсу: діаграми «похибка — вартість», теплова карта і рейтинг",
    accent: "#ff7ad9",
    audience: "student",
    tags: ["work-precision", "рейтинг", "порядки"],
  },
  {
    href: "/teacher",
    emoji: "🎓",
    title: "Варіанти для групи",
    tagline: "Індивідуальні параметри для кожного студента, коди варіантів, ключ відповідей, друк і CSV",
    accent: "#7c9cff",
    audience: "teacher",
    tags: ["генератор", "ключ", "друк"],
  },
  {
    href: "/variant",
    emoji: "✅",
    title: "Мій варіант",
    tagline: "Студент вводить код варіанта, бачить своє завдання і сам перевіряє відповіді",
    accent: "#5cc8ff",
    audience: "teacher",
    tags: ["самоперевірка", "стартовий код"],
  },
  {
    href: "/errata",
    emoji: "🔍",
    title: "Неточності методички",
    tagline: "Усі знайдені помилки умов: що надруковано, як правильно, як виявлено — з експортом у CSV і Markdown",
    accent: "#ff9f5a",
    audience: "teacher",
    tags: ["16 з 18 задач", "друк", "CSV"],
  },
];
