import type { Transform } from "@/components/plot/Plot";

/** Draws a normalised arrow field of (dx, dy) = f(x, y) on a Plot underlay. */
export function drawArrowField(
  ctx: CanvasRenderingContext2D,
  tr: Transform,
  f: (x: number, y: number) => [number, number],
  opts: { nx?: number; ny?: number; color?: string; scaleY?: number } = {},
) {
  const nx = opts.nx ?? 22;
  const ny = opts.ny ?? 14;
  const color = opts.color ?? "160,180,255";
  const [x0, x1] = tr.xDomain;
  const [y0, y1] = tr.yDomain;
  const cell = Math.min(tr.width / nx, tr.height / ny);
  ctx.lineWidth = 1;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = x0 + ((i + 0.5) / (nx + 1)) * (x1 - x0);
      const y = y0 + ((j + 0.5) / (ny + 1)) * (y1 - y0);
      const [dx, dy] = f(x, y);
      const px = tr.X(x),
        py = tr.Y(y);
      const vx = tr.X(x + dx * 1e-6) - px;
      const vy = tr.Y(y + dy * 1e-6) - py;
      const len = Math.hypot(vx, vy);
      if (!(len > 0) || !Number.isFinite(len)) continue;
      const ux = vx / len,
        uy = vy / len;
      const L = cell * 0.42;
      const speed = Math.min(1, Math.log10(1 + Math.hypot(dx, dy)) / 2);
      ctx.strokeStyle = `rgba(${color},${0.18 + 0.32 * speed})`;
      ctx.fillStyle = ctx.strokeStyle;
      const ax = px - ux * L * 0.5,
        ay = py - uy * L * 0.5;
      const bx = px + ux * L * 0.5,
        by = py + uy * L * 0.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - ux * 4 - uy * 2.4, by - uy * 4 + ux * 2.4);
      ctx.lineTo(bx - ux * 4 + uy * 2.4, by - uy * 4 - ux * 2.4);
      ctx.closePath();
      ctx.fill();
    }
  }
}
