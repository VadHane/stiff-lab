import type { Metadata } from "next";
import VariantClient from "@/components/variant/VariantClient";

export const metadata: Metadata = {
  title: "Мій варіант — Лаб",
  description:
    "Індивідуальний варіант лабораторної за кодом викладача: системи з вашими параметрами, питання з допусками й самоперевірка відповідей прямо в браузері.",
};

export default function VariantPage() {
  return <VariantClient />;
}
