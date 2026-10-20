"use client";

import { useEffect, useRef } from "react";

/** Animated background: a swarm of Van der Pol trajectories converging to the limit cycle. */
export default function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    const N = 70;
    const mu = 1.6;
    const pts = Array.from({ length: N }, () => ({
      x: (Math.random() - 0.5) * 8,
      y: (Math.random() - 0.5) * 9,
      hue: 200 + Math.random() * 140,
      age: Math.random() * 400,
    }));
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const step = () => {
      const W = cv.clientWidth,
        H = cv.clientHeight;
      ctx.fillStyle = "rgba(7,8,21,0.045)";
      ctx.fillRect(0, 0, W, H);
      const s = Math.min(W / 9, H / 6.5);
      const cx = W * 0.72,
        cy = H * 0.5;
      for (const p of pts) {
        for (let k = 0; k < 3; k++) {
          const dt = 0.008;
          const x0 = p.x,
            y0 = p.y;
          // RK2 on Van der Pol
          const f = (x: number, y: number) => [y, mu * (1 - x * x) * y - x];
          const [a1, b1] = f(x0, y0);
          const [a2, b2] = f(x0 + dt * a1, y0 + dt * b1);
          p.x += (dt / 2) * (a1 + a2);
          p.y += (dt / 2) * (b1 + b2);
          ctx.strokeStyle = `hsla(${p.hue},95%,68%,0.85)`;
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          ctx.moveTo(cx + x0 * s, cy - y0 * s * 0.42);
          ctx.lineTo(cx + p.x * s, cy - p.y * s * 0.42);
          ctx.stroke();
        }
        p.age++;
        if (p.age > 900) {
          p.x = (Math.random() - 0.5) * 8;
          p.y = (Math.random() - 0.5) * 9;
          p.age = 0;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full opacity-70" />;
}
