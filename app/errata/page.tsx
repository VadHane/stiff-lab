import type { Metadata } from "next";
import ErrataClient from "@/components/errata/ErrataClient";

export const metadata: Metadata = {
  title: "Неточності методички — Лаб",
  description:
    "Неточності й прогалини умов задач розділу 12 «Числові методи розв'язування жорстких систем»: як надруковано і як правильно, як виявлено, наслідки дослівного виконання; вивантаження в CSV і Markdown для викладача.",
};

export default function ErrataPage() {
  return <ErrataClient />;
}
