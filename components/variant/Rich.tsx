import { Tex } from "@/components/ui/Tex";
import { splitTex } from "./rich-text";

/** Текст з формулами в `$…$` (KaTeX усередині рядка). */
export default function Rich({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitTex(text).map((p, k) => (p.tex ? <Tex key={k}>{p.v}</Tex> : <span key={k}>{p.v}</span>))}
    </span>
  );
}
