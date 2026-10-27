import type { Metadata } from "next";
import ArenaHeader from "@/components/arena/ArenaHeader";
import ArenaClient from "@/components/arena/ArenaClient";

export const metadata: Metadata = {
  title: "Арена методів — Лаб",
  description:
    "Усі 11 методів платформи змагаються на задачах курсу: діаграми «похибка — вартість», хто найдешевше досягає заданої точності, де явні методи програють через стійкість, а де неявні — через ціну Ньютона.",
};

export default function ArenaPage() {
  return (
    <div style={{ ["--accent" as string]: "#ffc857" }} className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">
      <ArenaHeader />
      <ArenaClient />
    </div>
  );
}
