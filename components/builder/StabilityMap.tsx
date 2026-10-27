"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Say } from "@/components/mode/Mode";
import { Tex } from "@/components/ui/Tex";
import { absR, polyEvalC, type Cx, type Poly } from "@/lib/butcher";
import { fmt } from "@/lib/format";
import { METHODS } from "@/lib/methods";
import { BUILDER_ACCENT } from "./theme";

/** Методи платформи, чиї області можна накласти (функції стійкості — як у StabilityExplorer). */
export type OverlayId = "euler" | "rk2" | "rk3" | "rk4" | "ieuler" | "trap" | "bdf2";
export const OVERLAYS: OverlayId[] = ["euler", "rk2", "rk3", "rk4", "ieuler", "trap", "bdf2"];

const RATIONAL: Record<Exclude<OverlayId, "bdf2">, [Poly, Poly]> = {
  euler: [[1, 1], [1]],
  rk2: [[1, 1, 1 / 2], [1]],
  rk3: [[1, 1, 1 / 2, 1 / 6], [1]],
  rk4: [[1, 1, 1 / 2, 1 / 6, 1 / 24], [1]],
  ieuler: [[1], [1, -1]],
  trap: [
    [1, 1 / 2],
    [1, -1 / 2],
  ],
};

const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const csqrt = (a: Cx): Cx => {
  const r = Math.hypot(a[0], a[1]);
  return [Math.sqrt((r + a[0]) / 2), Math.sign(a[1] || 1) * Math.sqrt(Math.max(0, (r - a[0]) / 2))];
};

/** |R(z)| методу платформи; для BDF2 — спектральний радіус кореня (3/2 − z)ζ² − 2ζ + 1/2 = 0. */
export function overlayAmp(m: OverlayId, z: Cx): number {
  if (m !== "bdf2") {
    const [P, Q] = RATIONAL[m];
    return absR(P, Q, z);
  }
  const a: Cx = [1.5 - z[0], -z[1]];
  const disc = csqrt([4 - 4 * 0.5 * a[0], -4 * 0.5 * a[1]]);
  const r1 = cdiv([2 + disc[0], disc[1]], [2 * a[0], 2 * a[1]]);
  const r2 = cdiv([2 - disc[0], -disc[1]], [2 * a[0], 2 * a[1]]);
  return Math.max(Math.hypot(r1[0], r1[1]), Math.hypot(r2[0], r2[1]));
}

const OVERLAY_NAME: Record<OverlayId, string> = {
  euler: "Ейлер",
  rk2: "RK2",
  rk3: "RK3",
  rk4: "RK4",
  ieuler: "Неявн. Ейлер",
  trap: "Трапеції",
  bdf2: "BDF2",
};

/** Контур рівня 0 сітки значень (marching squares, лінійна інтерполяція на ребрах). */
function contour(ctx: CanvasRenderingContext2D, g: Float32Array, nx: number, ny: number, cell: number) {
  const v = (i: number, j: number) => g[j * nx + i];
  const lerp = (a: number, b: number) => a / (a - b);
  ctx.beginPath();
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = v(i, j),
        b = v(i + 1, j),
        c = v(i + 1, j + 1),
        d = v(i, j + 1);
      const pts: [number, number][] = [];
      if (a <= 0 !== b <= 0) pts.push([i + lerp(a, b), j]);
      if (b <= 0 !== c <= 0) pts.push([i + 1, j + lerp(b, c)]);
      if (c <= 0 !== d <= 0) pts.push([i + 1 - lerp(c, d), j + 1]);
      if (d <= 0 !== a <= 0) pts.push([i, j + 1 - lerp(d, a)]);
      for (let k = 0; k + 1 < pts.length; k += 2) {
        ctx.moveTo((pts[k][0] + 0.5) * cell, (pts[k][1] + 0.5) * cell);
        ctx.lineTo((pts[k + 1][0] + 0.5) * cell, (pts[k + 1][1] + 0.5) * cell);
      }
    }
  ctx.stroke();
}

const hexRgb = (col: string) => {
  const n = parseInt(col.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export default function StabilityMap({
  P,
  Q,
  realBound,
  imagBound,
  explicit,
  name,
}: {
  P: Poly;
  Q: Poly;
  realBound: number;
  imagBound: number;
  explicit: boolean;
  name: string;
}) {
  const [overlays, setOverlays] = useState<OverlayId[]>(explicit ? ["rk4"] : ["trap"]);
  const [range, setRange] = useState<number>(explicit ? 4 : 8);
  const [z, setZ] = useState<Cx>([-1.5, 0.8]);
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(600);
  const height = w < 520 ? 300 : 400;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    const yr = range * 0.75;
    const xr = yr * (w / height);
    const cx = -range * 0.35;
    return { x0: cx - xr, x1: cx + xr, y0: -yr, y1: yr };
  }, [w, height, range]);

  const toPx = (c: Cx): [number, number] => [((c[0] - view.x0) / (view.x1 - view.x0)) * w, ((view.y1 - c[1]) / (view.y1 - view.y0)) * height];
  const fromPx = (px: number, py: number): Cx => [view.x0 + (px / w) * (view.x1 - view.x0), view.y1 - (py / height) * (view.y1 - view.y0)];

  // rasters: log|R| on a coarse grid for the region, the contour and the overlays
  const grids = useMemo(() => {
    const cell = 3;
    const nx = Math.ceil(w / cell) + 1,
      ny = Math.ceil(height / cell) + 1;
    const at = (i: number, j: number): Cx => [view.x0 + (((i + 0.5) * cell) / w) * (view.x1 - view.x0), view.y1 - (((j + 0.5) * cell) / height) * (view.y1 - view.y0)];
    const val = (a: number) => (Number.isFinite(a) ? Math.max(-30, Math.min(30, Math.log(a))) : 30);
    const own = new Float32Array(nx * ny);
    const amp = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = absR(P, Q, at(i, j));
        amp[j * nx + i] = a;
        own[j * nx + i] = val(a);
      }
    const ov: Partial<Record<OverlayId, Float32Array>> = {};
    for (const m of overlays) {
      const g = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = val(overlayAmp(m, at(i, j)));
      ov[m] = g;
    }
    return { cell, nx, ny, own, amp, ov };
  }, [P, Q, overlays, view, w, height]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext("2d")!;
    const { cell, nx, ny, amp, own, ov } = grids;
    const img = ctx.createImageData(nx, ny);
    const [r, g, b] = hexRgb(BUILDER_ACCENT);
    for (let k = 0; k < nx * ny; k++) {
      const a = amp[k];
      if (a <= 1) {
        img.data[4 * k] = r;
        img.data[4 * k + 1] = g;
        img.data[4 * k + 2] = b;
        img.data[4 * k + 3] = Math.round(255 * (0.18 + 0.32 * (1 - a)));
      }
    }
    const off = document.createElement("canvas");
    off.width = nx;
    off.height = ny;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, nx * cell * dpr, ny * cell * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // grid & axes
    const span = view.x1 - view.x0;
    const tick = span > 120 ? 20 : span > 60 ? 10 : span > 24 ? 5 : span > 10 ? 2 : 1;
    ctx.strokeStyle = "rgba(160,180,255,0.09)";
    ctx.lineWidth = 1;
    for (let x = Math.ceil(view.x0 / tick) * tick; x <= view.x1; x += tick) {
      const [px] = toPx([x, 0]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
    for (let y = Math.ceil(view.y0 / tick) * tick; y <= view.y1; y += tick) {
      const [, py] = toPx([0, y]);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }
    const [ox, oy] = toPx([0, 0]);
    ctx.strokeStyle = "rgba(220,230,255,0.45)";
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, height);
    ctx.stroke();
    ctx.fillStyle = "rgba(220,230,255,0.6)";
    ctx.font = "11px var(--font-jetbrains), monospace";
    ctx.textAlign = "center";
    for (let x = Math.ceil(view.x0 / tick) * tick; x <= view.x1; x += tick) if (x !== 0) ctx.fillText(String(x), toPx([x, 0])[0], oy + 14);
    ctx.textAlign = "left";
    ctx.fillText("Re z", w - 34, oy - 6);
    ctx.fillText("Im z", ox + 6, 13);

    // overlays: contours only
    for (const m of overlays) {
      const gr = ov[m];
      if (!gr) continue;
      ctx.strokeStyle = METHODS[m].color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.2;
      contour(ctx, gr, nx, ny, cell);
    }
    ctx.globalAlpha = 1;
    // own contour
    ctx.strokeStyle = BUILDER_ACCENT;
    ctx.lineWidth = 2.2;
    contour(ctx, own, nx, ny, cell);

    // boundaries on the axes
    ctx.fillStyle = "#ffffff";
    if (Number.isFinite(realBound) && realBound > 0 && -realBound > view.x0) {
      const [px] = toPx([-realBound, 0]);
      ctx.beginPath();
      ctx.arc(px, oy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillText(`−${fmt(realBound, 4)}`, px, oy - 8);
    }
    if (Number.isFinite(imagBound) && imagBound > 0 && imagBound < view.y1) {
      for (const sg of [1, -1]) {
        const [, py] = toPx([0, sg * imagBound]);
        ctx.beginPath();
        ctx.arc(ox, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textAlign = "left";
      ctx.fillText(`${fmt(imagBound, 4)}i`, ox + 7, toPx([0, imagBound])[1] - 4);
    }

    // the point z
    const [px, py] = toPx(z);
    const stable = absR(P, Q, z) <= 1 + 1e-12;
    ctx.fillStyle = stable ? "#3ee6a8" : "#ff5d73";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grids, z, w, height, realBound, imagBound]);

  const drag = useRef(false);
  const onPtr = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    setZ(fromPx(((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * height));
  };

  const Rz = (() => {
    const p = polyEvalC(P, z),
      q = polyEvalC(Q, z);
    return cdiv(p, q);
  })();
  const aOwn = Math.hypot(Rz[0], Rz[1]);
  const okOwn = aOwn <= 1 + 1e-12;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-white/50">Накласти:</span>
          {OVERLAYS.map((m) => {
            const on = overlays.includes(m);
            return (
              <button
                key={m}
                onClick={() => setOverlays((v) => (on ? v.filter((x) => x !== m) : [...v, m]))}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition-all ${on ? "text-white" : "border-white/10 text-white/45 hover:text-white/80"}`}
                style={on ? { borderColor: METHODS[m].color, background: `${METHODS[m].color}22` } : undefined}
              >
                <span className="h-0.5 w-3 rounded" style={{ background: METHODS[m].color }} />
                {OVERLAY_NAME[m]}
              </button>
            );
          })}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-white/50">Масштаб:</span>
          {[2, 4, 8, 16, 40].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-[12px] ${range === r ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-white/10 text-white/50 hover:text-white"}`}
            >
              ±{r * 0.75}
            </button>
          ))}
        </div>
        <div ref={wrap} className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
          <canvas
            ref={ref}
            style={{ width: "100%", height, touchAction: "none" }}
            className="block cursor-crosshair"
            role="img"
            aria-label={`Область стійкості методу «${name}»`}
            onPointerDown={(e) => {
              drag.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              onPtr(e);
            }}
            onPointerMove={(e) => drag.current && onPtr(e)}
            onPointerUp={() => (drag.current = false)}
          />
        </div>
        <div className="mt-2 text-[12px] text-white/45">
          <Say simple={<>Зафарбовано — де метод не «розгойдується» (|R| ≤ 1). Клацніть або тягніть точку z = hλ.</>}>
            Заливка — <Tex>{"|R(z)|\\le1"}</Tex> (яскравіше — менше |R|), товстий контур — <Tex>{"|R(z)|=1"}</Tex> вашої таблиці, тонкі кольорові — методи платформи. Білі точки —
            межі на осях. Клацніть або тягніть точку <Tex>{"z=h\\lambda"}</Tex>.
          </Say>
        </div>
      </div>
      <div className="space-y-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 font-mono text-[13px]">
          <div className="text-white/50">z = hλ</div>
          <div className="text-lg text-white">
            {fmt(z[0], 4)} {z[1] >= 0 ? "+" : "−"} {fmt(Math.abs(z[1]), 4)}i
          </div>
          <div className="mt-1 text-white/50">R(z) = {fmt(Rz[0], 4)} {Rz[1] >= 0 ? "+" : "−"} {fmt(Math.abs(Rz[1]), 4)}i</div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: `${BUILDER_ACCENT}66`, background: `${BUILDER_ACCENT}12` }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: BUILDER_ACCENT }} />
          <span className="min-w-0 truncate text-white">{name}</span>
          <span className={`ml-auto font-mono ${okOwn ? "text-[#3ee6a8]" : "text-[#ff5d73]"}`}>|R| = {fmt(aOwn, 4)}</span>
          <span>{okOwn ? "🛡️" : "💥"}</span>
        </div>
        {overlays.map((m) => {
          const a = overlayAmp(m, z);
          const ok = a <= 1 + 1e-12;
          return (
            <div key={m} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: METHODS[m].color }} />
              <span className="text-white/75">{OVERLAY_NAME[m]}</span>
              <span className={`ml-auto font-mono ${ok ? "text-[#3ee6a8]" : "text-[#ff5d73]"}`}>|R| = {fmt(a, 4)}</span>
              <span>{ok ? "🛡️" : "💥"}</span>
            </div>
          );
        })}
        <div className="pt-1 text-[12px] leading-relaxed text-white/45">
          За 50 кроків збурення множиться на |R|⁵⁰: для вашого методу в цій точці — {fmt(Math.pow(aOwn, 50), 3)}.
        </div>
      </div>
    </div>
  );
}
