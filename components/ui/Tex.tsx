import katex from "katex";

export function Tex({ children, block = false, className }: { children: string; block?: boolean; className?: string }) {
  const html = katex.renderToString(children, { displayMode: block, throwOnError: false, strict: false });
  return block ? (
    <div className={`tex-block overflow-x-auto py-1 ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
