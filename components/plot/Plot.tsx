"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/format";

export interface Series {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  label?: string;
  width?: number;
  dash?: number[];
  opacity?: number;
  /** draw only markers instead of a line */
  dots?: boolean;
  dotSize?: number;
  /** ignore this series when computing the automatic range */
  noRange?: boolean;
  /** gradient along the curve (phase portraits) */
  fade?: boolean;
}

export interface Transform {
  X: (x: number) => number;
  Y: (y: number) => number;
  invX: (px: number) => number;
  invY: (py: number) => number;
  xDomain: [number, number];
  yDomain: [number, number];
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlotProps {
  series: Series[];
  height?: number;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  logX?: boolean;
  logY?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** time-series (x sorted). Enables hover readout + decimation. */
  sorted?: boolean;
  /** vertical cursor at this x (for playback) */
  cursorX?: number;
  /** marker points (e.g. current phase-space position) */
  markers?: { x: number; y: number; color: string; r?: number }[];
  /** draw extra things below the series (vector fields, nullclines) */
  underlay?: (ctx: CanvasRenderingContext2D, tr: Transform) => void;
  equalAspect?: boolean;
  legend?: boolean;
  className?: string;
}

const PAD = { l: 58, r: 14, t: 12, b: 38 };

function niceTicks(a: number, b: number, n = 6): number[] {
  const span = b - a;
  if (!(span > 0) || !Number.isFinite(span)) return [a];
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function logTicks(a: number, b: number): number[] {
  const out: number[] = [];
  const e0 = Math.floor(a),
    e1 = Math.ceil(b);
  const stride = Math.max(1, Math.ceil((e1 - e0) / 8));
  for (let e = e0; e <= e1; e += stride) if (e >= a - 1e-9 && e <= b + 1e-9) out.push(e);
  return out;
}

function autoRange(series: Series[], key: "x" | "y", log: boolean): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const s of series) {
    if (s.noRange) continue;
    const arr = s[key];
    for (let i = 0; i < arr.length; i++) {
      let v = arr[i];
      if (log) {
        if (!(v > 0)) continue;
        v = Math.log10(v);
      }
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) {
    const d = log ? 0.5 : Math.max(Math.abs(hi) * 0.1, 1e-6);
    return [lo - d, hi + d];
  }
  if (key === "y") {
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

/** Min-max decimation for sorted series to roughly 2 points per pixel column. */
function decimate(x: ArrayLike<number>, y: ArrayLike<number>, X: (v: number) => number, cols: number) {
  const n = x.length;
  if (n <= cols * 3) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  let col = -1;
  let minI = -1,
    maxI = -1;
  const flush = () => {
    if (minI < 0) return;
    const a = Math.min(minI, maxI),
      b = Math.max(minI, maxI);
    xs.push(x[a]);
    ys.push(y[a]);
    if (b !== a) {
      xs.push(x[b]);
      ys.push(y[b]);
    }
  };
  for (let i = 0; i < n; i++) {
    const c = Math.floor(X(x[i]));
    if (c !== col) {
      flush();
      col = c;
      minI = maxI = i;
    } else {
      if (y[i] < y[minI]) minI = i;
      if (y[i] > y[maxI]) maxI = i;
    }
  }
  flush();
  return { xs, ys };
}

export default function Plot(props: PlotProps) {
  const {
    series,
    height = 300,
    title,
    xLabel,
    yLabel,
    logX = false,
    logY = false,
    sorted = true,
    cursorX,
    markers,
    underlay,
    equalAspect,
    legend = true,
    className,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState<{ x: [number, number]; y: [number, number] } | null>(null);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // reset zoom when the data changes shape
  const dataKey = series.map((s) => `${s.label}:${s.x.length}`).join("|");
  useEffect(() => setZoom(null), [dataKey]);

  const tr: Transform = useMemo(() => {
    const w = width - PAD.l - PAD.r;
    const h = height - PAD.t - PAD.b;
    let xd: [number, number] = props.xDomain
      ? logX
        ? [Math.log10(props.xDomain[0]), Math.log10(props.xDomain[1])]
        : props.xDomain
      : autoRange(series, "x", logX);
    let yd: [number, number] = props.yDomain
      ? logY
        ? [Math.log10(props.yDomain[0]), Math.log10(props.yDomain[1])]
        : props.yDomain
      : autoRange(series, "y", logY);
    if (zoom) {
      xd = zoom.x;
      yd = zoom.y;
    }
    if (equalAspect && !zoom) {
      const sx = (xd[1] - xd[0]) / w,
        sy = (yd[1] - yd[0]) / h;
      if (sx > sy) {
        const c = (yd[0] + yd[1]) / 2,
          half = (sx * h) / 2;
        yd = [c - half, c + half];
      } else {
        const c = (xd[0] + xd[1]) / 2,
          half = (sy * w) / 2;
        xd = [c - half, c + half];
      }
    }
    const fx = (v: number) => (logX ? Math.log10(v) : v);
    const fy = (v: number) => (logY ? Math.log10(v) : v);
    return {
      X: (x) => PAD.l + ((fx(x) - xd[0]) / (xd[1] - xd[0])) * w,
      Y: (y) => PAD.t + h - ((fy(y) - yd[0]) / (yd[1] - yd[0])) * h,
      invX: (px) => {
        const v = xd[0] + ((px - PAD.l) / w) * (xd[1] - xd[0]);
        return logX ? Math.pow(10, v) : v;
      },
      invY: (py) => {
        const v = yd[0] + ((PAD.t + h - py) / h) * (yd[1] - yd[0]);
        return logY ? Math.pow(10, v) : v;
      },
      xDomain: xd,
      yDomain: yd,
      left: PAD.l,
      top: PAD.t,
      width: w,
      height: h,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, series, logX, logY, props.xDomain, props.yDomain, zoom, equalAspect]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { left, top, width: w, height: h } = tr;

    // grid & ticks
    ctx.font = "11px var(--font-mono), ui-monospace, monospace";
    ctx.strokeStyle = "rgba(160,180,255,0.08)";
    ctx.fillStyle = "rgba(200,210,255,0.55)";
    ctx.lineWidth = 1;
    const xt = logX ? logTicks(tr.xDomain[0], tr.xDomain[1]) : niceTicks(tr.xDomain[0], tr.xDomain[1], Math.max(3, Math.floor(w / 90)));
    const yt = logY ? logTicks(tr.yDomain[0], tr.yDomain[1]) : niceTicks(tr.yDomain[0], tr.yDomain[1], Math.max(3, Math.floor(h / 50)));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of xt) {
      const px = left + ((v - tr.xDomain[0]) / (tr.xDomain[1] - tr.xDomain[0])) * w;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + h);
      ctx.stroke();
      ctx.fillText(logX ? `1e${v}` : fmt(v, 3), px, top + h + 6);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of yt) {
      const py = top + h - ((v - tr.yDomain[0]) / (tr.yDomain[1] - tr.yDomain[0])) * h;
      ctx.beginPath();
      ctx.moveTo(left, py);
      ctx.lineTo(left + w, py);
      ctx.stroke();
      ctx.fillText(logY ? `1e${v}` : fmt(v, 3), left - 6, py);
    }
    // zero lines
    ctx.strokeStyle = "rgba(160,180,255,0.22)";
    if (!logY && tr.yDomain[0] < 0 && tr.yDomain[1] > 0) {
      const py = tr.Y(0);
      ctx.beginPath();
      ctx.moveTo(left, py);
      ctx.lineTo(left + w, py);
      ctx.stroke();
    }
    if (!logX && tr.xDomain[0] < 0 && tr.xDomain[1] > 0) {
      const px = tr.X(0);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + h);
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w, h);
    ctx.clip();

    underlay?.(ctx, tr);

    for (const s of series) {
      let xs: ArrayLike<number> = s.x,
        ys: ArrayLike<number> = s.y;
      if (sorted && !s.dots) {
        const d = decimate(s.x, s.y, tr.X, w);
        if (d) {
          xs = d.xs;
          ys = d.ys;
        }
      }
      const n = Math.min(xs.length, ys.length);
      let stride = 1;
      if (!sorted && n > 12000) stride = Math.ceil(n / 12000);
      ctx.globalAlpha = s.opacity ?? 1;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width ?? 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(s.dash ?? []);
      if (s.dots) {
        const r = s.dotSize ?? 2;
        for (let i = 0; i < n; i += stride) {
          const px = tr.X(xs[i]),
            py = tr.Y(ys[i]);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      if (s.fade) {
        // draw segments with increasing alpha
        const chunks = 40;
        const per = Math.ceil(n / chunks);
        for (let c = 0; c < chunks; c++) {
          ctx.globalAlpha = (s.opacity ?? 1) * (0.15 + (0.85 * (c + 1)) / chunks);
          ctx.beginPath();
          let started = false;
          for (let i = c * per; i < Math.min(n, (c + 1) * per + 1); i += stride) {
            const px = tr.X(xs[i]),
              py = tr.Y(ys[i]);
            if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(py) > 1e6 || Math.abs(px) > 1e6) {
              started = false;
              continue;
            }
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        continue;
      }
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i += stride) {
        const px = tr.X(xs[i]),
          py = tr.Y(ys[i]);
        if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(py) > 1e6 || Math.abs(px) > 1e6) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    if (cursorX !== undefined) {
      const px = tr.X(cursorX);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const m of markers ?? []) {
      const px = tr.X(m.x),
        py = tr.Y(m.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      ctx.fillStyle = m.color;
      ctx.shadowColor = m.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(px, py, m.r ?? 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (drag) {
      ctx.fillStyle = "rgba(120,160,255,0.12)";
      ctx.strokeStyle = "rgba(120,160,255,0.6)";
      const x = Math.min(drag.x0, drag.x1),
        y = Math.min(drag.y0, drag.y1);
      ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      ctx.strokeRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    }
    ctx.restore();

    // hover readout
    if (hover && !drag) {
      const xv = tr.invX(hover.px);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(hover.px, top);
      ctx.lineTo(hover.px, top + h);
      ctx.stroke();
      const lines: { c: string; t: string }[] = [];
      if (sorted) {
        lines.push({ c: "#cfd6ff", t: `${xLabel ?? "x"} = ${fmt(xv, 5)}` });
        for (const s of series) {
          if (!s.label || s.x.length === 0) continue;
          // binary search
          let lo = 0,
            hi = s.x.length - 1;
          if (xv < s.x[0] || xv > s.x[hi]) continue;
          while (hi - lo > 1) {
            const m = (lo + hi) >> 1;
            if (s.x[m] <= xv) lo = m;
            else hi = m;
          }
          const i = Math.abs(s.x[lo] - xv) < Math.abs(s.x[hi] - xv) ? lo : hi;
          const yv = s.y[i];
          const py = tr.Y(yv);
          if (Number.isFinite(py)) {
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(tr.X(s.x[i]), py, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
          lines.push({ c: s.color, t: `${s.label}: ${fmt(yv, 5)}` });
        }
      } else {
        lines.push({ c: "#cfd6ff", t: `${xLabel ?? "x"} = ${fmt(xv, 4)}` });
        lines.push({ c: "#cfd6ff", t: `${yLabel ?? "y"} = ${fmt(tr.invY(hover.py), 4)}` });
      }
      ctx.font = "11px var(--font-mono), ui-monospace, monospace";
      const bw = Math.max(...lines.map((l) => ctx.measureText(l.t).width)) + 16;
      const bh = lines.length * 16 + 8;
      let bx = hover.px + 12;
      if (bx + bw > width - 4) bx = hover.px - bw - 12;
      const by = Math.min(Math.max(top + 4, hover.py - bh / 2), top + h - bh);
      ctx.fillStyle = "rgba(10,12,30,0.88)";
      ctx.strokeStyle = "rgba(140,160,255,0.35)";
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 8);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      lines.forEach((l, i) => {
        ctx.fillStyle = l.c;
        ctx.fillText(l.t, bx + 8, by + 6 + i * 16);
      });
    }

    // axis labels
    ctx.fillStyle = "rgba(200,210,255,0.7)";
    ctx.font = "12px var(--font-sans), system-ui, sans-serif";
    if (xLabel) {
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(xLabel, left + w, height - 2);
    }
    if (yLabel) {
      ctx.save();
      ctx.translate(12, top + h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
  }, [tr, series, width, height, sorted, cursorX, markers, underlay, hover, drag, xLabel, yLabel, logX, logY]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  return (
    <div className={`relative ${className ?? ""}`} data-report-plot="" data-plot-title={typeof title === "string" ? title : undefined}>
      {(title || (legend && series.some((s) => s.label))) && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {title && <span className="font-semibold text-[13px] text-white/85">{title}</span>}
          {legend &&
            series
              .filter((s) => s.label)
              .map((s) => (
                <span key={s.label} className="flex items-center gap-1.5 text-white/65">
                  <span
                    className="inline-block h-[3px] w-4 rounded-full"
                    style={{
                      background: s.dash ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` : s.color,
                    }}
                  />
                  {s.label}
                </span>
              ))}
          {zoom && (
            <button
              onClick={() => setZoom(null)}
              className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
            >
              ⟲ скинути масштаб
            </button>
          )}
        </div>
      )}
      <div ref={wrapRef} className="w-full">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, touchAction: "none" }}
          className="block cursor-crosshair select-none rounded-xl"
          onPointerMove={(e) => {
            const p = pos(e);
            setHover(p);
            if (drag) setDrag({ ...drag, x1: p.px, y1: p.py });
          }}
          onPointerLeave={() => {
            setHover(null);
          }}
          onPointerDown={(e) => {
            const p = pos(e);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            setDrag({ x0: p.px, y0: p.py, x1: p.px, y1: p.py });
          }}
          onPointerUp={() => {
            if (drag && Math.abs(drag.x1 - drag.x0) > 8 && Math.abs(drag.y1 - drag.y0) > 8) {
              const toD = (px: number, inv: (v: number) => number, log: boolean) => {
                const v = inv(px);
                return log ? Math.log10(v) : v;
              };
              const xa = toD(Math.min(drag.x0, drag.x1), tr.invX, logX),
                xb = toD(Math.max(drag.x0, drag.x1), tr.invX, logX);
              const ya = toD(Math.max(drag.y0, drag.y1), tr.invY, logY),
                yb = toD(Math.min(drag.y0, drag.y1), tr.invY, logY);
              setZoom({ x: [xa, xb], y: [ya, yb] });
            }
            setDrag(null);
          }}
          onDoubleClick={() => setZoom(null)}
        />
      </div>
    </div>
  );
}
