"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/format";

type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const abs = (a: C) => Math.hypot(a[0], a[1]);
const sc = (s: number, a: C): C => [s * a[0], s * a[1]];
const csqrt = (a: C): C => {
  const r = abs(a);
  const re = Math.sqrt((r + a[0]) / 2);
  const im = Math.sign(a[1] || 1) * Math.sqrt(Math.max(0, (r - a[0]) / 2));
  return [re, im];
};

export type StabMethod = "euler" | "ieuler" | "theta" | "trap" | "rk2" | "rk3" | "rk4" | "bdf2";

/** amplification factor modulus |R(z)| (for BDF2: spectral radius of the characteristic polynomial) */
export function amp(m: StabMethod, z: C, theta = 0.55): number {
  const one: C = [1, 0];
  switch (m) {
    case "euler":
      return abs(add(one, z));
    case "ieuler":
      return abs(div(one, add(one, sc(-1, z))));
    case "theta":
    case "trap": {
      const th = m === "trap" ? 0.5 : theta;
      return abs(div(add(one, sc(1 - th, z)), add(one, sc(-th, z))));
    }
    case "rk2": {
      const z2 = mul(z, z);
      return abs(add(add(one, z), sc(1 / 2, z2)));
    }
    case "rk3": {
      const z2 = mul(z, z),
        z3 = mul(z2, z);
      return abs(add(add(add(one, z), sc(1 / 2, z2)), sc(1 / 6, z3)));
    }
    case "rk4": {
      const z2 = mul(z, z),
        z3 = mul(z2, z),
        z4 = mul(z3, z);
      return abs(add(add(add(add(one, z), sc(1 / 2, z2)), sc(1 / 6, z3)), sc(1 / 24, z4)));
    }
    case "bdf2": {
      // (3/2 − z) ζ² − 2ζ + 1/2 = 0
      const a: C = [1.5 - z[0], -z[1]];
      const b: C = [-2, 0];
      const c: C = [0.5, 0];
      const disc = csqrt(add(mul(b, b), sc(-4, mul(a, c))));
      const r1 = div(add(sc(-1, b), disc), sc(2, a));
      const r2 = div(add(sc(-1, b), sc(-1, disc)), sc(2, a));
      return Math.max(abs(r1), abs(r2));
    }
  }
}

export const STAB_INFO: Record<StabMethod, { name: string; color: string; R: string }> = {
  euler: { name: "Явний Ейлер", color: "#ff5d73", R: "R(z)=1+z" },
  rk2: { name: "RK2", color: "#ff8a3d", R: "R(z)=1+z+\\tfrac{z^2}{2}" },
  rk3: { name: "RK3", color: "#b5e853", R: "R(z)=1+z+\\tfrac{z^2}{2}+\\tfrac{z^3}{6}" },
  rk4: { name: "RK4", color: "#ffb547", R: "R(z)=1+z+\\tfrac{z^2}{2}+\\tfrac{z^3}{6}+\\tfrac{z^4}{24}" },
  ieuler: { name: "Неявний Ейлер", color: "#3ee6a8", R: "R(z)=\\dfrac{1}{1-z}" },
  theta: { name: "θ = 0.55", color: "#5cc8ff", R: "R(z)=\\dfrac{1+0.45z}{1-0.55z}" },
  trap: { name: "Трапеції", color: "#b18cff", R: "R(z)=\\dfrac{1+z/2}{1-z/2}" },
  bdf2: { name: "BDF2 (Гір)", color: "#ff7ad9", R: "\\rho(\\zeta)=\\tfrac32\\zeta^2-2\\zeta+\\tfrac12" },
};

interface Props {
  methods?: StabMethod[];
  /** controlled point z = hλ */
  z?: C;
  onZ?: (z: C) => void;
  height?: number;
  range?: number;
  extraPoints?: { z: C; color: string; label?: string }[];
}

export default function StabilityExplorer({ methods = ["euler", "rk2", "rk3", "rk4", "ieuler", "theta", "trap", "bdf2"], z: zProp, onZ, height = 380, range = 4, extraPoints }: Props) {
  const [active, setActive] = useState<StabMethod>(methods[0]);
  const [zLocal, setZLocal] = useState<C>([-1.5, 0.6]);
  const z = zProp ?? zLocal;
  const setZ = (v: C) => (onZ ? onZ(v) : setZLocal(v));
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(600);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    const aspect = w / height;
    const yr = range * 0.75;
    const xr = yr * aspect;
    // center slightly left: stiff stuff lives at Re z < 0
    const cx = -range * 0.35;
    return { x0: cx - xr, x1: cx + xr, y0: -yr, y1: yr };
  }, [w, height, range]);

  const toPx = (c: C) => [((c[0] - view.x0) / (view.x1 - view.x0)) * w, ((view.y1 - c[1]) / (view.y1 - view.y0)) * height];
  const fromPx = (px: number, py: number): C => [view.x0 + (px / w) * (view.x1 - view.x0), view.y1 - (py / height) * (view.y1 - view.y0)];

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext("2d")!;
    // region raster (low-res then scaled)
    const cell = 3;
    const nx = Math.ceil(w / cell),
      ny = Math.ceil(height / cell);
    const img = ctx.createImageData(nx, ny);
    const col = STAB_INFO[active].color;
    const n = parseInt(col.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const zz = fromPx(i * cell + cell / 2, j * cell + cell / 2);
        const a = amp(active, zz);
        const k = (j * nx + i) * 4;
        if (a <= 1) {
          const shade = 0.25 + 0.35 * (1 - a);
          img.data[k] = r;
          img.data[k + 1] = g;
          img.data[k + 2] = b;
          img.data[k + 3] = Math.round(255 * shade);
        } else {
          img.data[k + 3] = 0;
        }
      }
    const off = document.createElement("canvas");
    off.width = nx;
    off.height = ny;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // axes & grid
    ctx.strokeStyle = "rgba(160,180,255,0.1)";
    ctx.lineWidth = 1;
    const span = view.x1 - view.x0;
    const tick = span > 60 ? 10 : span > 24 ? 5 : span > 10 ? 2 : 1;
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
    ctx.strokeStyle = "rgba(220,230,255,0.45)";
    const [ox, oy] = toPx([0, 0]);
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, height);
    ctx.stroke();
    ctx.fillStyle = "rgba(220,230,255,0.6)";
    ctx.font = "11px var(--font-mono), monospace";
    ctx.fillText("Re(hλ)", w - 52, oy - 6);
    ctx.fillText("Im(hλ)", ox + 6, 14);
    for (let x = Math.ceil(view.x0 / tick) * tick; x <= view.x1; x += tick) if (x !== 0) ctx.fillText(String(x), toPx([x, 0])[0] - 4, oy + 14);

    for (const p of extraPoints ?? []) {
      const [px, py] = toPx(p.z);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      if (p.label) ctx.fillText(p.label, px + 7, py - 7);
    }

    // point
    const [px, py] = toPx(z);
    const stable = amp(active, z) <= 1;
    ctx.fillStyle = stable ? "#3ee6a8" : "#ff5d73";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, w, height, view, z, extraPoints]);

  const drag = useRef(false);
  const onPtr = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    setZ(fromPx(e.clientX - r.left, e.clientY - r.top));
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {methods.map((m) => (
            <button
              key={m}
              onClick={() => setActive(m)}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition-all ${active === m ? "text-white" : "border-white/10 text-white/55 hover:text-white"}`}
              style={active === m ? { borderColor: STAB_INFO[m].color, background: `${STAB_INFO[m].color}26` } : undefined}
            >
              {STAB_INFO[m].name}
            </button>
          ))}
        </div>
        <div ref={wrap} className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
          <canvas
            ref={ref}
            style={{ width: "100%", height, touchAction: "none" }}
            className="block cursor-pointer"
            onPointerDown={(e) => {
              drag.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              onPtr(e);
            }}
            onPointerMove={(e) => drag.current && onPtr(e)}
            onPointerUp={() => (drag.current = false)}
          />
        </div>
        <div className="mt-2 text-[12px] text-white/45">Тягніть точку z = hλ по площині. Зафарбована область — де |R(z)| ≤ 1, тобто метод стійкий.</div>
      </div>
      <div className="space-y-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 font-mono text-[13px]">
          <div className="text-white/50">z = hλ</div>
          <div className="text-lg text-white">
            {fmt(z[0], 4)} {z[1] >= 0 ? "+" : "−"} {fmt(Math.abs(z[1]), 4)}i
          </div>
        </div>
        {methods.map((m) => {
          const a = amp(m, z);
          const ok = a <= 1 + 1e-12;
          return (
            <div key={m} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAB_INFO[m].color }} />
              <span className="text-white/75">{STAB_INFO[m].name}</span>
              <span className={`ml-auto font-mono ${ok ? "text-[#3ee6a8]" : "text-[#ff5d73]"}`}>|R| = {fmt(a, 4)}</span>
              <span>{ok ? "🛡️" : "💥"}</span>
            </div>
          );
        })}
        <div className="pt-1 text-[12px] leading-relaxed text-white/45">
          Після n кроків похибка множиться на |R|ⁿ. Наприклад, за 100 кроків при |R| = 1.1 вона зросте в {fmt(Math.pow(1.1, 100), 3)} разів.
        </div>
      </div>
    </div>
  );
}
