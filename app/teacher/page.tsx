import type { Metadata } from "next";
import TeacherClient from "@/components/teacher/TeacherClient";

export const metadata: Metadata = {
  title: "Варіанти для викладача — Лаб",
  description:
    "Генератор індивідуальних варіантів лабораторної: детерміновані коди, параметри з перевірених діапазонів, питання з еталонними відповідями, друк варіантів і ключа, CSV і посилання для самоперевірки студентів.",
};

export default function TeacherPage() {
  return <TeacherClient />;
}
