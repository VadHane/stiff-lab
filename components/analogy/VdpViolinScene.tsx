"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/controls";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { comp, sampleAt, solve } from "@/lib/ode";

const W = 0.64;
const P0 = (2 * Math.PI) / W;
const N = 256;
const K = 40;
const F0 = 440;
const SPEED = 6;

/** One period of the Van der Pol limit cycle (u'' + ω²u = μ(1−u²)u', ω = 0.64) and its Fourier harmonics. */
function limitCycle(mu: number) {
  const guess = Math.hypot(2 * Math.PI, (3 - 2 * Math.log(2)) * (mu / W)) / W;
  const s = solve(
    "dopri",
    { f: (_t, y) => [y[1], mu * (1 - y[0] * y[0]) * y[1] - W * W * y[0]], y0: [2, 0], T: 30 + 4 * guess },
    { rtol: 1e-8, atol: 1e-10, maxSteps: 200000 },
  );
  const ups: number[] = [];
  for (let i = 1; i < s.t.length; i++) {
    const a = s.y[i - 1][0],
      b = s.y[i][0];
    if (a < 0 && b >= 0) ups.push(s.t[i - 1] + ((s.t[i] - s.t[i - 1]) * -a) / (b - a));
  }
  const t0 = ups[ups.length - 2];
  const P = ups[ups.length - 1] - t0;
  const u = comp(s, 0);
  const wave = Array.from({ length: N }, (_, j) => sampleAt(s.t, u, t0 + (P * j) / N));
  const real = new Float32Array(K + 1);
  const imag = new Float32Array(K + 1);
  let a1 = 0,
    rich = 0;
  for (let k = 1; k <= K; k++) {
    let a = 0,
      b = 0;
    for (let j = 0; j < N; j++) {
      const th = (2 * Math.PI * k * j) / N;
      a += wave[j] * Math.cos(th);
      b += wave[j] * Math.sin(th);
    }
    real[k] = (2 * a) / N;
    imag[k] = (2 * b) / N;
    const m = Math.hypot(real[k], imag[k]);
    if (k === 1) a1 = m;
    else if (m > 0.05 * a1) rich++;
  }
  return { P, wave, real, imag, rich };
}

type Audio = { ctx: AudioContext; osc: OscillatorNode; gain: GainNode };

function stopAudio(ref: { current: Audio | null }) {
  const a = ref.current;
  ref.current = null;
  if (!a) return;
  try {
    a.osc.stop();
  } catch {}
  a.ctx.close().catch(() => {});
}

/** A bowed string = a self-sustained Van der Pol oscillator; optional sound whose pitch ∝ 1/period and timbre = the real waveform. */
export default function VdpViolinScene() {
  const [mu, setMu] = useState(1);
  const dMu = useDeferredValue(mu);
  const cyc = useMemo(() => limitCycle(dMu), [dMu]);
  const pb = usePlayback(cyc.P / SPEED);
  const freq = (F0 * P0) / cyc.P;
  const j = Math.min(N - 1, Math.floor(pb.progress * N));
  const u = cyc.wave[j];
  const pumping = Math.abs(u) < 1;

  const audio = useRef<Audio | null>(null);
  const [sound, setSound] = useState(false);
  useEffect(() => () => stopAudio(audio), []);
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.osc.setPeriodicWave(a.ctx.createPeriodicWave(cyc.real, cyc.imag));
    a.osc.frequency.setTargetAtTime(freq, a.ctx.currentTime, 0.03);
  }, [cyc, freq]);
  const toggle = () => {
    if (audio.current) {
      stopAudio(audio);
      setSound(false);
      return;
    }
    if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
    const ctx = new window.AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(ctx.createPeriodicWave(cyc.real, cyc.imag));
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start();
    gain.gain.setTargetAtTime(0.08, ctx.currentTime, 0.05);
    audio.current = { ctx, osc, gain };
    setSound(true);
  };

  const Wd = 560;
  const str = Array.from({ length: 41 }, (_, k) => {
    const x = 30 + (k / 40) * (Wd - 60);
    return `${k ? "L" : "M"}${x.toFixed(1)},${(62 - u * 17 * Math.sin((Math.PI * k) / 40)).toFixed(1)}`;
  }).join("");
  const bowX = 30 + 0.72 * (Wd - 60);
  const bowY = 62 - u * 17 * Math.sin(0.72 * Math.PI);
  const scope = cyc.wave
    .concat(cyc.wave)
    .map((v, k) => `${k ? "L" : "M"}${(30 + (k / (2 * N)) * (Wd - 60)).toFixed(1)},${(45 - v * 17).toFixed(1)}`)
    .join("");
  const shape = dMu < 0.5 ? "майже синусоїда" : dMu < 3 ? "сплюснута хвиля" : "повільне повзання + ривок";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
        <Slider label="Натиск смичка μ (нелінійне тертя)" value={mu} onChange={setMu} min={0.1} max={10} log />
        <button
          onClick={toggle}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${sound ? "bg-[var(--accent)] text-black" : "border border-white/15 text-white/80 hover:bg-white/10"}`}
        >
          {sound ? "🔇 Вимкнути звук" : "🔊 Послухати"}
        </button>
      </div>
      <svg viewBox={`0 0 ${Wd} 200`} className="w-full rounded-xl border border-white/8 bg-black/20">
        <rect x={18} y={40} width={10} height={44} rx={3} fill="#8a5a33" />
        <rect x={Wd - 28} y={40} width={10} height={44} rx={3} fill="#8a5a33" />
        <path d={str} fill="none" stroke="#ffe9a3" strokeWidth={2} />
        <g transform={`translate(${bowX},${bowY}) rotate(-8)`}>
          <rect x={-90} y={-3} width={180} height={6} rx={3} fill={pumping ? "#3ee6a8" : "#ffb547"} opacity={0.85} />
        </g>
        <text x={bowX} y={22} fontSize={11.5} textAnchor="middle" fill={pumping ? "#3ee6a8" : "#ffb547"}>
          {pumping ? "|u| < 1: смичок підкачує енергію" : "|u| > 1: тертя гальмує струну"}
        </text>
        <g transform="translate(0,110)">
          <line x1={30} x2={Wd - 30} y1={45} y2={45} stroke="#ffffff22" />
          <path d={scope} fill="none" stroke="#7cf29c" strokeWidth={1.6} />
          <line x1={30 + (j / (2 * N)) * (Wd - 60)} x2={30 + (j / (2 * N)) * (Wd - 60)} y1={2} y2={88} stroke="#ffffff66" />
          <text x={30} y={86} fontSize={10} fill="#ffffff66">
            осцилограф u(t): два періоди граничного циклу
          </text>
        </g>
      </svg>
      <PlaybackBar pb={pb} label={`u = ${fmt(u, 3)}`} />
      <div className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          період <span className="font-mono text-white">{fmt(cyc.P, 4)}</span>
        </div>
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          тон <span className="font-mono text-white">{fmt(freq, 3)} Гц</span>
        </div>
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          обертонів <span className="font-mono text-white">{cyc.rich}</span>
        </div>
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">{shape}</div>
      </div>
      <div className="text-[12.5px] leading-snug text-white/55">
        Струна рухається рівно за розв&apos;язком рівняння з ω = 0.64. Звук: висота ∝ 1/період (μ → 0 звучить як 440 Гц), а тембр — справжня форма u(t):
        «обертони» — гармоніки з гучністю понад 5 % від основної. Більший μ — нижче й «скрипучіше».
      </div>
    </div>
  );
}
