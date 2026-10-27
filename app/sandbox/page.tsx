import type { Metadata } from "next";
import SandboxClient from "@/components/sandbox/SandboxClient";

export const metadata: Metadata = {
  title: "Своя система — Лаб",
  description:
    "Введіть власну систему ОДР формулами: розв'язок усіма методами платформи, графіки, власні числа якобіана й аналіз жорсткості, рекомендація методу і код Python / MATLAB.",
};

export default function SandboxPage() {
  return <SandboxClient />;
}
