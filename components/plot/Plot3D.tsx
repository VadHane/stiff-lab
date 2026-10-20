"use client";

import { useEffect, useRef } from "react";

export interface Curve3D {
  pts: [number, number, number][];
  /** two colors for a gradient along the curve */
  colors: [string, string];
  width?: number;
}

interface Props {
  curves: Curve3D[];
  height?: number;
  labels?: [string, string, string];
  /** progress 0..1 — draw only that fraction (playback) */
  progress?: number;
  autoRotate?: boolean;
  logAxes?: [boolean, boolean, boolean];
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lightweight rotating 3D line plot on a 2D canvas (orthographic + slight perspective). */
export default function Plot3D({ curves, height = 420, labels = ["x", "y", "z"], progress = 1, autoRotate = true, logAxes }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ yaw: 0.7, pitch: 0.35, dragging: false, lx: 0, ly: 0, auto: autoRotate });
  const dataRef = useRef({ curves, progress, labels, logAxes });
  dataRef.current = { curves, progress, labels, logAxes };

  useEffect(() => {
    state.current.auto = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const cv = ref.current!;
    let raf = 0;
    const render = () => {
      const { curves, progress, labels, logAxes } = dataRef.current;
      const s = state.current;
      if (s.auto && !s.dragging) s.yaw += 0.0035;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth,
        H = cv.clientHeight;
      if (cv.width !== W * dpr || cv.height !== H * dpr) {
        cv.width = W * dpr;
        cv.height = H * dpr;
      }
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const tf = (v: number, i: number) => (logAxes?.[i] ? Math.log10(Math.max(v, 1e-30)) : v);
      // bounds
      const lo = [Infinity, Infinity, Infinity],
        hi = [-Infinity, -Infinity, -Infinity];
      for (const c of curves)
        for (const p of c.pts)
          for (let i = 0; i < 3; i++) {
            const v = tf(p[i], i);
            if (!Number.isFinite(v)) continue;
            if (v < lo[i]) lo[i] = v;
            if (v > hi[i]) hi[i] = v;
          }
      const norm = (p: number[]) =>
        p.map((v, i) => {
          const span = hi[i] - lo[i] || 1;
          return ((tf(v, i) - lo[i]) / span - 0.5) * 2;
        });
      const cy = Math.cos(s.yaw),
        sy = Math.sin(s.yaw),
        cp = Math.cos(s.pitch),
        sp = Math.sin(s.pitch);
      const scale = Math.min(W, H) * 0.3;
      const proj = (q: number[]) => {
        // world: x → right, y → depth, z → up
        const x = q[0],
          y = q[1],
          z = q[2];
        const x1 = x * cy - y * sy;
        const y1 = x * sy + y * cy;
        const z1 = z * cp - y1 * sp;
        const d = y1 * cp + z * sp;
        const persp = 1 / (1 + d * 0.12);
        return [W / 2 + x1 * scale * persp, H / 2 - z1 * scale * persp, d];
      };
      // box
      ctx.strokeStyle = "rgba(150,170,255,0.14)";
      ctx.lineWidth = 1;
      const corners = [-1, 1];
      for (const a of corners)
        for (const b of corners) {
          const segs = [
            [[-1, a, b], [1, a, b]],
            [[a, -1, b], [a, 1, b]],
            [[a, b, -1], [a, b, 1]],
          ];
          for (const [p0, p1] of segs) {
            const A = proj(p0),
              B = proj(p1);
            ctx.beginPath();
            ctx.moveTo(A[0], A[1]);
            ctx.lineTo(B[0], B[1]);
            ctx.stroke();
          }
        }
      // axis labels
      ctx.fillStyle = "rgba(200,210,255,0.75)";
      ctx.font = "12px var(--font-mono), monospace";
      const axisEnds: [number, number, number][] = [
        [1.15, -1, -1],
        [-1, 1.15, -1],
        [-1, -1, 1.15],
      ];
      axisEnds.forEach((p, i) => {
        const P = proj(p);
        ctx.fillText(labels[i], P[0], P[1]);
      });

      for (const c of curves) {
        const n = Math.max(2, Math.floor(c.pts.length * progress));
        const stride = Math.max(1, Math.floor(n / 6000));
        const [r0, g0, b0] = hexToRgb(c.colors[0]);
        const [r1, g1, b1] = hexToRgb(c.colors[1]);
        ctx.lineWidth = c.width ?? 1.4;
        let prev: number[] | null = null;
        const chunk = 60;
        for (let start = 0; start < n - 1; start += chunk * stride) {
          const f = start / n;
          ctx.strokeStyle = `rgba(${Math.round(r0 + (r1 - r0) * f)},${Math.round(g0 + (g1 - g0) * f)},${Math.round(b0 + (b1 - b0) * f)},0.9)`;
          ctx.beginPath();
          for (let i = start; i <= Math.min(n - 1, start + chunk * stride); i += stride) {
            const P = proj(norm(c.pts[i]));
            if (!Number.isFinite(P[0]) || !Number.isFinite(P[1])) {
              prev = null;
              continue;
            }
            if (!prev) ctx.moveTo(P[0], P[1]);
            else ctx.lineTo(P[0], P[1]);
            prev = P;
          }
          ctx.stroke();
          prev = null;
        }
        // head
        const head = c.pts[n - 1];
        if (head) {
          const P = proj(norm(head));
          ctx.fillStyle = c.colors[1];
          ctx.shadowColor = c.colors[1];
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(P[0], P[1], 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ width: "100%", height, touchAction: "none" }}
      className="block cursor-grab rounded-xl active:cursor-grabbing"
      onPointerDown={(e) => {
        const s = state.current;
        s.dragging = true;
        s.lx = e.clientX;
        s.ly = e.clientY;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = state.current;
        if (!s.dragging) return;
        s.yaw += (e.clientX - s.lx) * 0.01;
        s.pitch = Math.max(-1.4, Math.min(1.4, s.pitch + (e.clientY - s.ly) * 0.01));
        s.lx = e.clientX;
        s.ly = e.clientY;
      }}
      onPointerUp={() => {
        state.current.dragging = false;
      }}
    />
  );
}
