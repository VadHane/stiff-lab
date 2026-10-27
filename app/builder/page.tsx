import type { Metadata } from "next";
import BuilderClient from "@/components/builder/BuilderClient";

export const metadata: Metadata = {
  title: "Конструктор методу — Лаб",
  description:
    "Задайте метод Рунге–Кутти таблицею Батчера (явний чи неявний) і одразу побачите його порядок, функцію стійкості R(z), область стійкості, A- і L-стійкість, поведінку на задачах курсу та спостережену збіжність.",
};

export default function BuilderPage() {
  return <BuilderClient />;
}
