import { Tex } from "@/components/ui/Tex";

/** Segment of a «text with TeX» string: plain text, inline `$…$` or display `$$…$$` math. */
export type RichSeg = { t: "text" | "inline" | "block"; v: string };

const RICH_RE = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

export function parseRich(s: string): RichSeg[] {
  const out: RichSeg[] = [];
  let last = 0;
  RICH_RE.lastIndex = 0;
  for (let m = RICH_RE.exec(s); m; m = RICH_RE.exec(s)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: "block", v: m[1] } : { t: "inline", v: m[2] });
    last = RICH_RE.lastIndex;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

/** Renders a «text with TeX» string; display math becomes a scrollable block. */
export function Rich({ children, className }: { children: string; className?: string }) {
  const segs = parseRich(children);
  const hasBlock = segs.some((s) => s.t === "block");
  const body = segs.map((s, i) =>
    s.t === "text" ? <span key={i}>{s.v}</span> : s.t === "inline" ? <Tex key={i}>{s.v}</Tex> : <Tex key={i} block className="errata-tex-block">{s.v}</Tex>,
  );
  return hasBlock ? <div className={className}>{body}</div> : <span className={className}>{body}</span>;
}
