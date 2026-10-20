"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Slider } from "@/components/ui/controls";
import { fmt } from "@/lib/format";
import type { Vec } from "@/lib/linalg";
import { solve, type RHS } from "@/lib/ode";

export interface Kick {
  label: string;
  emoji: string;
  /** new state after the kick */
  apply: (y: Vec, t: number) => Vec;
  hint?: string;
}

export interface StripSeries {
  comp: number;
  label: string;
  color: string;
}

type Mapper = { X: (x: number) => number; Y: (y: number) => number };

interface Props {
  /** must be referentially stable (module constant or useMemo) */
  f: RHS;
  init: Vec;
  t0?: number;
  axes: [number, number];
  labels: [string, string];
  domain: { x: [number, number]; y: [number, number] };
  /** map a click on the plane to a full state (default: replace the two plotted components) */
  fromClick?: (x: number, y: number, cur: Vec) => Vec;
  kicks?: Kick[];
  /** model time per real second */
  speed?: number;
  speedRange?: [number, number];
  /** length of the visible trail in model time */
  trail?: number;
  field?: boolean;
  /** draw extras (nullclines, equilibria) under the trajectory */
  underlay?: (ctx: CanvasRenderingContext2D, m: Mapper) => void;
  strip?: StripSeries[];
  /** model-time window of the strip chart */
  window?: number;
  /** return a short message to pop up (e.g. "⚡ спайк!") */
  event?: (prev: Vec, cur: Vec, t: number) => string | null;
  hint?: ReactNode;
  height?: number;
  rtol?: number;
  /** set false when f depends on t: the direction field is then redrawn every frame for the current t */
  autonomous?: boolean;
}

function ticks(a: number, b: number, n: number) {
  const span = b - a;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 * step; v += step) out.push(Math.abs(v) < 1e-9 * step ? 0 : v);
  return out;
}

const PAD = { l: 46, r: 12, t: 10, b: 30 };

/** canvas cannot resolve CSS variables — read the accent colour once and turn it into rgba() */
function accentRgba(el: Element, alpha: number) {
  const raw = getComputedStyle(el).getPropertyValue("--accent").trim() || "#7c9cff";
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  if (!m) return raw;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export default function PhasePlayground({
  f,
  init,
  t0 = 0,
  axes,
  labels,
  domain,
  fromClick,
  kicks = [],
  speed = 1,
  speedRange,
  trail = 30,
  field = true,
  underlay,
  strip,
  window: win = 30,
  event,
  hint,
  height = 420,
  rtol = 1e-6,
  autonomous = true,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const sv = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [spd, setSpd] = useState(speed);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ t: number; y: Vec }>({ t: t0, y: init });
  const sim = useRef({
    t: t0,
    y: init.slice(),
    hLast: 0 as number,
    pts: [] as { t: number; y: Vec }[],
    ghosts: [] as { t: number; y: Vec }[][],
    flashes: [] as { x: number; y: number; at: number; text: string }[],
    hover: null as null | { px: number; py: number },
  });
  const cfg = useRef({ f, axes, domain, underlay, field, trail, win, strip, event, playing, spd, rtol, labels, status, autonomous });
  cfg.current = { f, axes, domain, underlay, field, trail, win, strip, event, playing, spd, rtol, labels, status, autonomous };

  const toast = (text: string) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 1800);
  };
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const restart = (y: Vec, keepGhost = true) => {
    const s = sim.current;
    if (keepGhost && s.pts.length > 3) s.ghosts = [...s.ghosts.slice(-4), s.pts];
    s.t = t0;
    s.y = y.slice();
    s.hLast = 0;
    s.pts = [{ t: s.t, y: s.y.slice() }];
    setStatus(null);
  };

  useEffect(() => {
    restart(init, false);
    sim.current.ghosts = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, init]);

  useEffect(() => {
    let raf = 0;
    let lastNow = 0;
    let lastReadout = 0;
    let fieldCache: { key: string; f: RHS; img: HTMLCanvasElement } | null = null;
    const frame = (now: number) => {
      const c = cfg.current;
      const s = sim.current;
      const canvas = cv.current;
      if (!canvas) return;
      const dtReal = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
      lastNow = now;

      // --- advance the model
      if (c.playing && dtReal > 0 && !c.status) {
        const T = s.t + c.spd * dtReal;
        const sol = solve("ros", { f: c.f, y0: s.y, t0: s.t, T }, { rtol: c.rtol, atol: c.rtol * 1e-3, hInit: s.hLast || undefined, maxSteps: 4000 });
        if (sol.failed && sol.t[sol.t.length - 1] < T - 1e-12) {
          setStatus("Розв'язувач не впорався — спробуйте іншу стартову точку.");
        }
        const prev = s.y;
        for (let i = 1; i < sol.t.length; i++) s.pts.push({ t: sol.t[i], y: sol.y[i] });
        s.t = sol.t[sol.t.length - 1];
        s.y = sol.y[sol.y.length - 1];
        if (sol.hs.length) s.hLast = sol.hs[sol.hs.length - 1];
        const keep = Math.max(c.trail, c.win);
        while (s.pts.length > 2 && s.pts[0].t < s.t - keep) s.pts.shift();
        if (s.pts.length > 20000) s.pts.splice(0, s.pts.length - 20000);
        const msg = c.event?.(prev, s.y, s.t);
        if (msg) toastRef.current(msg);
      }

      // --- draw the phase plane
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth,
        H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        fieldCache = null;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const [ix, iy] = c.axes;
      const { x: dx, y: dy } = c.domain;
      const w = W - PAD.l - PAD.r,
        h = H - PAD.t - PAD.b;
      const X = (v: number) => PAD.l + ((v - dx[0]) / (dx[1] - dx[0])) * w;
      const Y = (v: number) => PAD.t + h - ((v - dy[0]) / (dy[1] - dy[0])) * h;

      // grid
      ctx.font = "11px var(--font-mono), monospace";
      ctx.strokeStyle = "rgba(160,180,255,0.08)";
      ctx.fillStyle = "rgba(200,210,255,0.5)";
      ctx.lineWidth = 1;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const v of ticks(dx[0], dx[1], Math.max(3, Math.floor(w / 90)))) {
        ctx.beginPath();
        ctx.moveTo(X(v), PAD.t);
        ctx.lineTo(X(v), PAD.t + h);
        ctx.stroke();
        ctx.fillText(fmt(v, 3), X(v), PAD.t + h + 6);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const v of ticks(dy[0], dy[1], Math.max(3, Math.floor(h / 55)))) {
        ctx.beginPath();
        ctx.moveTo(PAD.l, Y(v));
        ctx.lineTo(PAD.l + w, Y(v));
        ctx.stroke();
        ctx.fillText(fmt(v, 3), PAD.l - 6, Y(v));
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, PAD.t, w, h);
      ctx.clip();

      // vector field (cached; uses the current non-plotted components)
      if (c.field) {
        const key = `${W}x${H}|${dx}|${dy}|${s.y.map((v, i) => (i === ix || i === iy ? "" : v.toFixed(2))).join(",")}|${c.autonomous ? "" : s.t.toFixed(3)}`;
        if (!fieldCache || fieldCache.key !== key || fieldCache.f !== c.f) {
          const off = document.createElement("canvas");
          off.width = Math.round(W * dpr);
          off.height = Math.round(H * dpr);
          const o = off.getContext("2d")!;
          o.setTransform(dpr, 0, 0, dpr, 0, 0);
          const nx = Math.max(10, Math.floor(w / 38)),
            ny = Math.max(7, Math.floor(h / 38));
          for (let i = 0; i <= nx; i++)
            for (let j = 0; j <= ny; j++) {
              const a = dx[0] + ((i + 0.5) / (nx + 1)) * (dx[1] - dx[0]);
              const b = dy[0] + ((j + 0.5) / (ny + 1)) * (dy[1] - dy[0]);
              const st = s.y.slice();
              st[ix] = a;
              st[iy] = b;
              const k = c.f(s.t, st);
              const e = 1e-6;
              const px = X(a + e * k[ix]) - X(a),
                py = Y(b + e * k[iy]) - Y(b);
              const L = Math.hypot(px, py);
              if (!(L > 0) || !Number.isFinite(L)) continue;
              const sc = 8 / L;
              o.strokeStyle = "rgba(170,190,255,0.2)";
              o.lineWidth = 1.2;
              o.beginPath();
              o.moveTo(X(a) - px * sc, Y(b) - py * sc);
              o.lineTo(X(a) + px * sc, Y(b) + py * sc);
              o.stroke();
              o.fillStyle = "rgba(170,190,255,0.32)";
              o.beginPath();
              o.arc(X(a) + px * sc, Y(b) + py * sc, 1.5, 0, Math.PI * 2);
              o.fill();
            }
          fieldCache = { key, f: c.f, img: off };
        }
        ctx.drawImage(fieldCache.img, 0, 0, W, H);
      }
      c.underlay?.(ctx, { X, Y });

      // ghosts
      for (const g of s.ghosts) {
        ctx.strokeStyle = "rgba(255,255,255,0.13)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        g.forEach((p, i) => (i ? ctx.lineTo(X(p.y[ix]), Y(p.y[iy])) : ctx.moveTo(X(p.y[ix]), Y(p.y[iy]))));
        ctx.stroke();
      }
      // trail with fading
      const vis = s.pts.filter((p) => p.t >= s.t - c.trail);
      const n = vis.length;
      const chunks = 24;
      for (let k = 0; k < chunks; k++) {
        const a0 = Math.floor((k * n) / chunks),
          a1 = Math.min(n - 1, Math.floor(((k + 1) * n) / chunks));
        if (a1 <= a0) continue;
        ctx.strokeStyle = accentRgba(canvas, 0.2 + (0.8 * (k + 1)) / chunks);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let i = a0; i <= a1; i++) {
          const px = X(vis[i].y[ix]),
            py = Y(vis[i].y[iy]);
          if (i === a0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      // flashes from kicks
      s.flashes = s.flashes.filter((fl) => now - fl.at < 900);
      for (const fl of s.flashes) {
        const age = (now - fl.at) / 900;
        ctx.strokeStyle = `rgba(255,255,255,${1 - age})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(fl.x, fl.y, 8 + 40 * age, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = "20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.globalAlpha = 1 - age;
        ctx.fillText(fl.text, fl.x, fl.y - 12 - 20 * age);
        ctx.globalAlpha = 1;
      }
      // current point
      const cx = X(s.y[ix]),
        cy = Y(s.y[iy]);
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
      if (cx < PAD.l || cx > PAD.l + w || cy < PAD.t || cy > PAD.t + h) {
        ctx.fillStyle = "rgba(255,93,115,0.9)";
        ctx.font = "12px var(--font-sans), sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("● точка поза кадром", PAD.l + 8, PAD.t + 6);
      }
      // hover crosshair
      if (s.hover) {
        const hx = dx[0] + ((s.hover.px - PAD.l) / w) * (dx[1] - dx[0]);
        const hy = dy[0] + ((PAD.t + h - s.hover.py) / h) * (dy[1] - dy[0]);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "11px var(--font-mono), monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(`клік → старт (${fmt(hx, 3)}, ${fmt(hy, 3)})`, Math.min(s.hover.px + 10, W - 190), s.hover.py - 8);
      }
      ctx.fillStyle = "rgba(200,210,255,0.7)";
      ctx.font = "12px var(--font-sans), sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(c.labels[0], PAD.l + w, H - 2);
      ctx.save();
      ctx.translate(12, PAD.t + h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.labels[1], 0, 0);
      ctx.restore();

      // --- strip chart
      const scv = sv.current;
      if (scv && c.strip?.length) {
        const SW = scv.clientWidth,
          SH = scv.clientHeight;
        if (scv.width !== Math.round(SW * dpr) || scv.height !== Math.round(SH * dpr)) {
          scv.width = Math.round(SW * dpr);
          scv.height = Math.round(SH * dpr);
        }
        const sx = scv.getContext("2d")!;
        sx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sx.clearRect(0, 0, SW, SH);
        const pts = s.pts.filter((p) => p.t >= s.t - c.win);
        let lo = Infinity,
          hi = -Infinity;
        for (const p of pts) for (const sr of c.strip) {
          lo = Math.min(lo, p.y[sr.comp]);
          hi = Math.max(hi, p.y[sr.comp]);
        }
        if (!Number.isFinite(lo)) {
          lo = -1;
          hi = 1;
        }
        const pad = Math.max((hi - lo) * 0.12, 1e-3);
        lo -= pad;
        hi += pad;
        const tx = (t: number) => 40 + ((t - (s.t - c.win)) / c.win) * (SW - 50);
        const ty = (v: number) => 8 + (SH - 22) * (1 - (v - lo) / (hi - lo));
        sx.strokeStyle = "rgba(160,180,255,0.1)";
        sx.beginPath();
        sx.moveTo(40, ty(0));
        sx.lineTo(SW - 10, ty(0));
        sx.stroke();
        sx.fillStyle = "rgba(200,210,255,0.45)";
        sx.font = "10px var(--font-mono), monospace";
        sx.textAlign = "right";
        sx.textBaseline = "middle";
        sx.fillText(fmt(hi - pad, 3), 36, ty(hi - pad));
        sx.fillText(fmt(lo + pad, 3), 36, ty(lo + pad));
        sx.textAlign = "left";
        sx.textBaseline = "bottom";
        sx.fillText(`t = ${fmt(s.t, 4)}`, 44, SH - 1);
        for (const sr of c.strip) {
          sx.strokeStyle = sr.color;
          sx.lineWidth = 1.8;
          sx.beginPath();
          pts.forEach((p, i) => (i ? sx.lineTo(tx(p.t), ty(p.y[sr.comp])) : sx.moveTo(tx(p.t), ty(p.y[sr.comp]))));
          sx.stroke();
        }
      }

      if (now - lastReadout > 150) {
        lastReadout = now;
        setReadout({ t: s.t, y: s.y.slice() });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toData = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left,
      py = e.clientY - r.top;
    const w = r.width - PAD.l - PAD.r,
      h = r.height - PAD.t - PAD.b;
    return {
      px,
      py,
      x: domain.x[0] + ((px - PAD.l) / w) * (domain.x[1] - domain.x[0]),
      y: domain.y[0] + ((PAD.t + h - py) / h) * (domain.y[1] - domain.y[0]),
    };
  };

  return (
    <div className="space-y-3" data-report-skip="">
      {hint && <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-[14px] leading-relaxed text-white/75">{hint}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-black shadow-[0_0_18px_-6px_var(--accent)]"
        >
          {playing ? "❚❚ Пауза" : "▶ Пуск"}
        </button>
        {kicks.map((k) => (
          <button
            key={k.label}
            title={k.hint}
            onClick={() => {
              const s = sim.current;
              s.y = k.apply(s.y.slice(), s.t);
              s.hLast = 0;
              s.pts.push({ t: s.t, y: s.y.slice() });
              const r = cv.current!.getBoundingClientRect();
              const [ix, iy] = axes;
              const w = r.width - PAD.l - PAD.r,
                h = r.height - PAD.t - PAD.b;
              s.flashes.push({
                x: PAD.l + ((s.y[ix] - domain.x[0]) / (domain.x[1] - domain.x[0])) * w,
                y: PAD.t + h - ((s.y[iy] - domain.y[0]) / (domain.y[1] - domain.y[0])) * h,
                at: performance.now(),
                text: k.emoji,
              });
              setStatus(null);
            }}
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/85 transition-all hover:scale-[1.03] hover:border-[var(--accent)] hover:bg-[var(--accent)]/15"
          >
            <span>{k.emoji}</span>
            {k.label}
          </button>
        ))}
        <button onClick={() => restart(init)} className="rounded-full border border-white/15 px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
          ⟲ Початкові умови
        </button>
        <button
          onClick={() => {
            sim.current.ghosts = [];
          }}
          className="rounded-full border border-white/15 px-3 py-1.5 text-[13px] text-white/70 hover:bg-white/10"
        >
          🧽 Стерти сліди
        </button>
      </div>
      <div ref={wrap} className="relative overflow-hidden rounded-xl border border-white/10 bg-black/25">
        <canvas
          ref={cv}
          style={{ width: "100%", height, touchAction: "none" }}
          className="block cursor-crosshair"
          onPointerMove={(e) => {
            const d = toData(e);
            sim.current.hover = { px: d.px, py: d.py };
          }}
          onPointerLeave={() => (sim.current.hover = null)}
          onPointerDown={(e) => {
            const d = toData(e);
            const cur = sim.current.y;
            const y = fromClick ? fromClick(d.x, d.y, cur) : (() => {
              const v = cur.slice();
              v[axes[0]] = d.x;
              v[axes[1]] = d.y;
              return v;
            })();
            restart(y);
            sim.current.flashes.push({ x: d.px, y: d.py, at: performance.now(), text: "📍" });
          }}
        />
        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1.5">
          {toasts.map((t) => (
            <div key={t.id} className="fade-up rounded-full bg-black/70 px-3 py-1 text-[13px] text-white shadow-lg">
              {t.text}
            </div>
          ))}
        </div>
      </div>
      {strip?.length ? (
        <div className="rounded-xl border border-white/10 bg-black/25">
          <div className="flex flex-wrap gap-3 px-3 pt-2 text-[11.5px] text-white/60">
            {strip.map((s) => (
              <span key={s.label} style={{ color: s.color }}>
                ━ {s.label}
              </span>
            ))}
            <span className="ml-auto text-white/40">останні {fmt(win, 3)} од. часу</span>
          </div>
          <canvas ref={sv} style={{ width: "100%", height: 120 }} className="block" />
        </div>
      ) : null}
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
        <Slider label="Швидкість часу (од. моделі за секунду)" value={spd} onChange={setSpd} min={speedRange?.[0] ?? speed / 10} max={speedRange?.[1] ?? speed * 10} log />
        <div className="font-mono text-[12px] text-white/55">
          {labels[0]} = {fmt(readout.y[axes[0]], 4)}, {labels[1]} = {fmt(readout.y[axes[1]], 4)}
        </div>
      </div>
      {status && <div className="rounded-xl border border-[#ff5d73]/40 bg-[#ff5d73]/10 px-4 py-2 text-[13px] text-white/85">{status}</div>}
    </div>
  );
}
