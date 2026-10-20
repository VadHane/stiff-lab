"use client";

import { useMemo, useState } from "react";
import { Chips } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { plural } from "@/lib/relatable";

const A = 0.15;
const B = 0.4;
const C = 8.5;
const H = 0.01;
const EVERY = 10;
const T_END = 320;
const DELTAS = [1e-2, 1e-4, 1e-6];
const LABELS = ["0.01", "0.0001", "0.000001"];
const N = Math.round(T_END / H / EVERY);

type Run = { x: Float64Array; y: Float64Array; z: Float64Array };

/** RK4, h = 0.01, for the Rössler system of the assignment; x(0) = dx, y(0) = 0.5, z(0) = 0. */
function run(dx: number): Run {
  const out = { x: new Float64Array(N + 1), y: new Float64Array(N + 1), z: new Float64Array(N + 1) };
  let x = dx,
    y = 0.5,
    z = 0;
  const f = (x: number, y: number, z: number) => [-y - z, x + A * y, B + z * (x - C)];
  out.x[0] = x;
  out.y[0] = y;
  for (let i = 1; i <= N; i++) {
    for (let k = 0; k < EVERY; k++) {
      const k1 = f(x, y, z);
      const k2 = f(x + (H / 2) * k1[0], y + (H / 2) * k1[1], z + (H / 2) * k1[2]);
      const k3 = f(x + (H / 2) * k2[0], y + (H / 2) * k2[1], z + (H / 2) * k2[2]);
      const k4 = f(x + H * k3[0], y + H * k3[1], z + H * k3[2]);
      x += (H / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      y += (H / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      z += (H / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    }
    out.x[i] = x;
    out.y[i] = y;
    out.z[i] = z;
  }
  return out;
}

function weather(x: number, z: number) {
  if (z > 1) return { icon: "⛈️", text: "гроза" };
  if (x > 5) return { icon: "☀️", text: "спека" };
  if (x < -5) return { icon: "🌧️", text: "холодний дощ" };
  return { icon: "⛅", text: "мінлива хмарність" };
}

function Forecaster({ name, x, z, color, off }: { name: string; x: number; z: number; color: string; off?: boolean }) {
  const w = weather(x, z);
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${off ? "border-[#ff5d73]/40 bg-[#ff5d73]/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
      <span className="text-3xl leading-none">{w.icon}</span>
      <div className="min-w-0">
        <div className="text-[12px]" style={{ color }}>
          {name}
        </div>
        <div className="font-mono text-[15px] text-white">{fmt(15 + x, 3)} °C</div>
        <div className="text-[11.5px] text-white/50">{w.text}</div>
      </div>
    </div>
  );
}

/** Two weather forecasters whose starting temperatures differ by δ: the Rössler system of the assignment, one «day» = one turn of the vortex. */
export default function RosslerForecastScene() {
  const [delta, setDelta] = useState(1e-2);
  const pb = usePlayback(28);
  const data = useMemo(() => {
    const base = run(0);
    const turns = new Float64Array(N + 1);
    let ang = 0;
    for (let i = 1; i <= N; i++) {
      let d = Math.atan2(base.y[i], base.x[i]) - Math.atan2(base.y[i - 1], base.x[i - 1]);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      ang += d;
      turns[i] = Math.abs(ang) / (2 * Math.PI);
    }
    const twins = DELTAS.map((dl) => {
      const tw = run(dl);
      let hit = -1;
      for (let i = 0; i <= N; i++)
        if (Math.hypot(tw.x[i] - base.x[i], tw.y[i] - base.y[i], tw.z[i] - base.z[i]) > 1) {
          hit = i;
          break;
        }
      return { tw, hit, day: hit >= 0 ? turns[hit] : Infinity };
    });
    return { base, turns, twins };
  }, []);

  const k = DELTAS.indexOf(delta);
  const { tw, hit, day } = data.twins[k];
  const i = Math.min(N, Math.round(pb.progress * N));
  const today = data.turns[i];
  const parted = hit >= 0 && i >= hit;
  const days = data.turns[N];

  const W = 560,
    Hh = 130;
  const X = (d: number) => 30 + (d / days) * (W - 40);
  const Y = (v: number) => 10 + ((14 - v) / 26) * (Hh - 20);
  const path = (xs: Float64Array) => {
    let s = "";
    for (let j = 0; j <= i; j += 2) s += `${s ? "L" : "M"}${X(data.turns[j]).toFixed(1)},${Y(xs[j]).toFixed(1)}`;
    return s;
  };

  return (
    <div className="space-y-3">
      <Chips
        label="На скільки розходяться ранкові заміри"
        value={delta}
        onChange={(v) => {
          setDelta(v);
          pb.setProgress(0);
          pb.setPlaying(true);
        }}
        options={DELTAS.map((d, j) => ({ value: d, label: `${LABELS[j]} °C` }))}
      />
      <div className="grid grid-cols-2 gap-2">
        <Forecaster name="Синоптик А" x={data.base.x[i]} z={data.base.z[i]} color="#b18cff" />
        <Forecaster name={`Синоптик Б (+${LABELS[k]}°)`} x={tw.x[i]} z={tw.z[i]} color="#ffe66d" off={parted} />
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full rounded-xl border border-white/8 bg-black/20">
        {hit >= 0 && (
          <g>
            <line x1={X(day)} x2={X(day)} y1={6} y2={Hh - 8} stroke="#ff5d73" strokeDasharray="4 4" opacity={0.7} />
            <text x={X(day) + 4} y={16} fontSize={10} fill="#ff8597">
              розійшлися: день {Math.floor(day)}
            </text>
          </g>
        )}
        <path d={path(data.base.x)} fill="none" stroke="#b18cff" strokeWidth={1.6} />
        <path d={path(tw.x)} fill="none" stroke="#ffe66d" strokeWidth={1.2} opacity={0.85} />
        <line x1={X(today)} x2={X(today)} y1={6} y2={Hh - 8} stroke="#ffffff55" />
        <text x={30} y={Hh - 2} fontSize={10} fill="#ffffff66">
          день 0
        </text>
        <text x={W - 10} y={Hh - 2} fontSize={10} fill="#ffffff66" textAnchor="end">
          день {Math.floor(days)}
        </text>
      </svg>
      <PlaybackBar pb={pb} label={`день ${Math.floor(today)}`} />
      <div className="flex flex-wrap gap-2 text-[12.5px]">
        {data.twins.map((t, j) => (
          <span key={j} className={`rounded-full px-2.5 py-1 font-mono ${j === k ? "bg-[var(--accent)]/20 text-white" : "bg-white/[0.05] text-white/60"}`}>
            {LABELS[j]}° → {Number.isFinite(t.day) ? `${Math.floor(t.day)} ${plural(Math.floor(t.day), ["день", "дні", "днів"])}` : "не розійшлися"}
          </span>
        ))}
      </div>
      <div className="text-[12.5px] leading-snug text-white/55">
        «День» тут — один оберт вихору Реслера (≈ 6 од. часу), «температура» — 15 + x. Обидва синоптики рахують однаково точно (RK4, h = 0.01), різниця лише в
        ранковому замірі. Зменшення розбіжності в 100 разів купує лише кілька додаткових днів прогнозу.
      </div>
    </div>
  );
}
