"use client";

import { useEffect, useRef, useState } from "react";
import { Chips } from "@/components/ui/controls";
import { fmt } from "@/lib/format";

const SIG = 10;
const B = 8 / 3;
const Y0 = [3.051522, 1.582542, 15.62388];
/** model time units per real second */
const RATE = 0.7;
/** wheel angular velocity (rad per model time unit) per unit of x */
const K_OMEGA = 0.45;
const H = 0.004;
const N_CUPS = 12;

const PRESETS = [
  { r: 0.5, label: "тонкий струмінь · r = 0.5", regime: "колесо зупиняється: O стійка (r < 1)" },
  { r: 1.5, label: "трохи більше · r = 1.5", regime: "ледь-ледь крутиться в один бік: C± стійкі" },
  { r: 10, label: "середній · r = 10", regime: "рівномірне обертання в один бік: C± стійкі" },
  { r: 28.5, label: "сильний · r = 28.5", regime: "хаотичні реверси: C± нестійкі, дивний атрактор" },
];

type Sim = { x: number; y: number; z: number; theta: number; t: number; reversals: number; sign: number; lastRev: number; clock: number; splash: number };

/**
 * Malkus waterwheel driven by the Lorenz system (σ = 10, b = 8/3): the wheel turns with θ′ ∝ x, the water in the cup at
 * angle φ (from the top) is base + c·(y·sin φ + (r − z)·cos φ) — exactly the sine/cosine Fourier modes of the water
 * distribution that Lorenz's y and z stand for in the Malkus model.
 */
export default function MalkusWheelScene() {
  const [r, setR] = useState(28.5);
  const rRef = useRef(r);
  rRef.current = r;
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(true);
  const sim = useRef<Sim>({ x: Y0[0], y: Y0[1], z: Y0[2], theta: 0, t: 0, reversals: 0, sign: Math.sign(Y0[0]), lastRev: -10, clock: 0, splash: 0 });
  const [, setTick] = useState(0);

  useEffect(() => {
    const el = box.current;
    const io = el ? new IntersectionObserver(([e]) => (visible.current = e.isIntersecting)) : null;
    if (el && io) io.observe(el);
    let raf = 0;
    let last = 0;
    let uiAcc = 0;
    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const s = sim.current;
      if (dt > 0 && visible.current) {
        const rr = rRef.current;
        let remain = dt * RATE;
        while (remain > 1e-9) {
          const h = Math.min(H, remain);
          remain -= h;
          const { x, y, z } = s;
          const f = (x: number, y: number, z: number) => [SIG * (y - x), rr * x - y - x * z, x * y - B * z];
          const k1 = f(x, y, z);
          const k2 = f(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], z + 0.5 * h * k1[2]);
          const k3 = f(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], z + 0.5 * h * k2[2]);
          const k4 = f(x + h * k3[0], y + h * k3[1], z + h * k3[2]);
          s.x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
          s.y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
          s.z += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
          s.theta += h * K_OMEGA * s.x;
          s.t += h;
          // a reversal = x changes sign with hysteresis (|x| > 0.5), so a wheel that merely stops is not counted
          if (s.sign > 0 && s.x < -0.5) {
            s.sign = -1;
            s.reversals++;
            s.lastRev = s.clock;
          } else if (s.sign < 0 && s.x > 0.5) {
            s.sign = 1;
            s.reversals++;
            s.lastRev = s.clock;
          }
        }
        s.clock += dt;
        s.splash += dt;
        draw(canvas.current, s, rr);
        uiAcc += dt;
        if (uiAcc > 0.12) {
          uiAcc = 0;
          setTick((k) => (k + 1) % 1e6);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);

  const s = sim.current;
  const preset = PRESETS.find((p) => p.r === r);
  const speed = Math.abs(s.x);
  const dir = s.x > 0.3 ? "за годинниковою" : s.x < -0.3 ? "проти годинникової" : "майже стоїть";
  const justReversed = s.clock - s.lastRev < 0.6;

  return (
    <div ref={box} className="space-y-3">
      <Chips label="Скільки води ллється зверху" value={r} onChange={setR} options={PRESETS.map((p) => ({ value: p.r, label: p.label }))} />
      <canvas ref={canvas} style={{ width: "100%", height: 250, touchAction: "none" }} className="block rounded-xl border border-white/8 bg-black/25" />
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/[0.04] px-2 py-1.5">
          <div className="text-[10.5px] uppercase tracking-wider text-white/45">швидкість ∝ x</div>
          <div className={`font-mono text-[15px] ${justReversed ? "text-[#ffb547]" : "text-white"}`}>{fmt(s.x, 3)}</div>
          <div className="text-[11px] text-white/45">{dir}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-2 py-1.5">
          <div className="text-[10.5px] uppercase tracking-wider text-white/45">реверсів</div>
          <div className="font-mono text-[15px] text-white">{s.reversals}</div>
          <div className="text-[11px] text-white/45">за {fmt(s.t, 3)} од. часу</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-2 py-1.5">
          <div className="text-[10.5px] uppercase tracking-wider text-white/45">перекіс води</div>
          <div className="font-mono text-[15px] text-white">
            y = {fmt(s.y, 3)}
          </div>
          <div className="text-[11px] text-white/45">z = {fmt(s.z, 3)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            sim.current.x += 6;
          }}
          className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-black shadow-[0_0_18px_-6px_var(--accent)]"
        >
          👋 Крутнути колесо (x += 6)
        </button>
        <button
          onClick={() => {
            const q = sim.current;
            q.x = Y0[0];
            q.y = Y0[1];
            q.z = Y0[2];
            q.t = 0;
            q.reversals = 0;
            q.sign = 1;
          }}
          className="rounded-full border border-white/15 px-3 py-1.5 text-[12.5px] text-white/70 hover:bg-white/10"
        >
          ↺ Старт з точки умови
        </button>
        <span className="text-[12.5px] text-white/55">{preset?.regime}</span>
      </div>
      <div className="text-[12.5px] leading-snug text-white/55">
        Колесо з дірявими ковшиками, на яке зверху ллється вода (Малкус, 1972). Це не мультик «за мотивами»: тут наживо інтегрується система Лоренца
        (RK4, h = 0.004), швидкість обертання — це x, а вода в ковшику під кутом φ від верху — це y·sin φ + (r − z)·cos φ (ті самі гармоніки, що їх
        означають y і z у моделі). Малий потік — колесо стає; більший — крутиться рівномірно; великий — непередбачувано міняє напрямок, бо ковшики,
        що піднімаються, не встигають спорожніти. Одна одиниця часу моделі тут ≈ {fmt(1 / RATE, 2)} с.
      </div>
    </div>
  );
}

function draw(cv: HTMLCanvasElement | null, s: Sim, r: number) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth,
    Hh = cv.clientHeight;
  if (!W || !Hh) return;
  if (cv.width !== W * dpr || cv.height !== Hh * dpr) {
    cv.width = W * dpr;
    cv.height = Hh * dpr;
  }
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, Hh);
  const cx = W / 2,
    cy = Hh * 0.56;
  const R = Math.min(W * 0.3, Hh * 0.36);
  const cupW = Math.max(14, R * 0.24),
    cupH = cupW * 1.15;
  // water amounts: base grows with the inflow, the amplitude is scaled so the fill stays in [0, 1] on the attractor
  const base = 0.15 + 0.4 * Math.min(1, r / 10);
  const c = 0.5 / Math.max(r, 4);
  const flow = Math.min(1, r / 10);

  // spout + stream
  const spoutY = cy - R - cupH - 22;
  ctx.fillStyle = "rgba(200,210,255,0.5)";
  ctx.fillRect(cx - 16, spoutY - 10, 32, 8);
  ctx.fillRect(cx - 5, spoutY - 2, 10, 4);
  const streamW = 1.5 + 6 * flow;
  const grad = ctx.createLinearGradient(0, spoutY, 0, cy - R);
  grad.addColorStop(0, "rgba(92,200,255,0.9)");
  grad.addColorStop(1, "rgba(92,200,255,0.35)");
  ctx.fillStyle = grad;
  const wob = Math.sin(s.clock * 18) * 0.6;
  ctx.beginPath();
  ctx.moveTo(cx - streamW / 2 + wob, spoutY);
  ctx.lineTo(cx + streamW / 2 + wob, spoutY);
  ctx.lineTo(cx + streamW / 2 - wob, cy - R - cupH * 0.9);
  ctx.lineTo(cx - streamW / 2 - wob, cy - R - cupH * 0.9);
  ctx.closePath();
  ctx.fill();

  // wheel rim and spokes
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let k = 0; k < N_CUPS; k++) {
    const phi = s.theta + (2 * Math.PI * k) / N_CUPS;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.sin(phi), cy - R * Math.cos(phi));
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();

  // cups hang upright from pivots on the rim
  const drops: [number, number, number][] = [];
  for (let k = 0; k < N_CUPS; k++) {
    const phi = s.theta + (2 * Math.PI * k) / N_CUPS;
    const px = cx + R * Math.sin(phi),
      py = cy - R * Math.cos(phi);
    const fill = Math.max(0.02, Math.min(1, base + c * (s.y * Math.sin(phi) + (r - s.z) * Math.cos(phi))));
    const x0 = px - cupW / 2,
      y0 = py + 3;
    ctx.fillStyle = "rgba(10,12,30,0.8)";
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(x0, y0, cupW, cupH, [2, 2, 5, 5]);
    ctx.fill();
    ctx.stroke();
    const wh = (cupH - 4) * fill;
    ctx.fillStyle = "rgba(92,200,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(x0 + 2, y0 + cupH - 2 - wh, cupW - 4, wh, [1, 1, 4, 4]);
    ctx.fill();
    // leak: a drop under each cup, faster when fuller
    const ph = (s.clock * (0.8 + 1.6 * fill) + k * 0.37) % 1;
    if (fill > 0.08) drops.push([px, y0 + cupH + 3 + ph * 26, 1 - ph]);
    // splash when the cup is under the stream
    const top = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (Math.min(top, 2 * Math.PI - top) < Math.PI / N_CUPS) {
      ctx.fillStyle = "rgba(92,200,255,0.9)";
      for (let i = 0; i < 3; i++) {
        const a = (s.clock * 9 + i * 2.1) % 1;
        ctx.beginPath();
        ctx.arc(px + (i - 1) * 6 * a, y0 + 4 - 8 * a, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  for (const [x, y, a] of drops) {
    ctx.fillStyle = `rgba(92,200,255,${0.25 + 0.6 * a})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // direction arrow
  const sp = Math.min(1, Math.abs(s.x) / 12);
  if (sp > 0.03) {
    const dirSign = Math.sign(s.x);
    const a0 = -Math.PI / 2 + (dirSign > 0 ? 0.15 : -0.15);
    const a1 = a0 + dirSign * (0.4 + 1.2 * sp);
    const ra = R + cupH + 14;
    ctx.strokeStyle = "rgba(255,181,71,0.85)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, ra, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();
    const ex = cx + ra * Math.cos(a1),
      ey = cy + ra * Math.sin(a1);
    const tang = a1 + (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.fillStyle = "rgba(255,181,71,0.9)";
    ctx.beginPath();
    ctx.moveTo(ex + 8 * Math.cos(tang), ey + 8 * Math.sin(tang));
    ctx.lineTo(ex + 6 * Math.cos(tang + 2.4), ey + 6 * Math.sin(tang + 2.4));
    ctx.lineTo(ex + 6 * Math.cos(tang - 2.4), ey + 6 * Math.sin(tang - 2.4));
    ctx.closePath();
    ctx.fill();
  }
  // puddle
  ctx.fillStyle = "rgba(92,200,255,0.12)";
  ctx.beginPath();
  ctx.ellipse(cx, Hh - 8, R * 1.3, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "11px var(--font-mono), monospace";
  ctx.textAlign = "left";
  ctx.fillText(`t = ${s.t.toFixed(1)}`, 8, 14);
  ctx.textAlign = "right";
  ctx.fillText(`r = ${r}`, W - 8, 14);
}
