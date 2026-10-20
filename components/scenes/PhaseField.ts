import type { Transform } from "@/components/plot/Plot";

/** Normalised direction field of a planar system (x, y)' = F(x, y), drawn in pixel space. */
export function drawField(
  ctx: CanvasRenderingContext2D,
  tr: Transform,
  F: (x: number, y: number) => [number, number],
  opts: { nx?: number; color?: string; len?: number } = {},
) {
  const nx = opts.nx ?? 24;
  const step = tr.width / nx;
  const ny = Math.max(4, Math.round(tr.height / step));
  const sx = tr.width / (tr.xDomain[1] - tr.xDomain[0]);
  const sy = tr.height / (tr.yDomain[1] - tr.yDomain[0]);
  const len = opts.len ?? Math.min(11, step * 0.42);
  ctx.save();
  ctx.strokeStyle = opts.color ?? "rgba(170,190,255,0.32)";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1.1;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const px = tr.left + (i + 0.5) * step;
      const py = tr.top + (j + 0.5) * (tr.height / ny);
      const [dx, dy] = F(tr.invX(px), tr.invY(py));
      let vx = dx * sx,
        vy = -dy * sy;
      const m = Math.hypot(vx, vy);
      if (!Number.isFinite(m) || m === 0) continue;
      vx = (vx / m) * len;
      vy = (vy / m) * len;
      ctx.beginPath();
      ctx.moveTo(px - vx, py - vy);
      ctx.lineTo(px + vx, py + vy);
      ctx.stroke();
      const a = Math.atan2(vy, vx);
      ctx.beginPath();
      ctx.moveTo(px + vx, py + vy);
      ctx.lineTo(px + vx - 4 * Math.cos(a - 0.45), py + vy - 4 * Math.sin(a - 0.45));
      ctx.lineTo(px + vx - 4 * Math.cos(a + 0.45), py + vy - 4 * Math.sin(a + 0.45));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Graph of y = g(x) across the visible x-range (nullclines etc.). */
export function drawCurve(
  ctx: CanvasRenderingContext2D,
  tr: Transform,
  g: (x: number) => number,
  color: string,
  opts: { width?: number; dash?: number[]; label?: string } = {},
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = opts.width ?? 2;
  ctx.setLineDash(opts.dash ?? [7, 5]);
  ctx.beginPath();
  let started = false;
  let lastIn: [number, number] | null = null;
  for (let px = tr.left; px <= tr.left + tr.width; px += 1.5) {
    const y = g(tr.invX(px));
    const py = tr.Y(y);
    if (!Number.isFinite(py) || py < tr.top - 2000 || py > tr.top + tr.height + 2000) {
      started = false;
      continue;
    }
    if (!started) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    started = true;
    if (py > tr.top + 14 && py < tr.top + tr.height - 6) lastIn = [px, py];
  }
  ctx.stroke();
  if (opts.label && lastIn) {
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "12px var(--font-sans), system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.label, Math.min(lastIn[0], tr.left + tr.width - 4), lastIn[1] - 4);
  }
  ctx.restore();
}

/** Vertical bands in a time-series plot (e.g. «excited» intervals). */
export function drawBands(ctx: CanvasRenderingContext2D, tr: Transform, bands: { a: number; b: number; color: string }[]) {
  ctx.save();
  for (const { a, b, color } of bands) {
    const x0 = tr.X(a),
      x1 = tr.X(b);
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
    ctx.fillStyle = color;
    ctx.fillRect(x0, tr.top, Math.max(1, x1 - x0), tr.height);
  }
  ctx.restore();
}
