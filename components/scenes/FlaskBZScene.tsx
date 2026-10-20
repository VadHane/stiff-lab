"use client";

import { useMemo } from "react";
import Plot from "@/components/plot/Plot";
import { PlaybackBar, usePlayback } from "@/components/ui/Playback";
import { fmt } from "@/lib/format";
import { sampleAt, type Solution } from "@/lib/ode";

function mix(a: [number, number, number], b: [number, number, number], c: number) {
  const k = Math.max(0, Math.min(1, c));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
}
const RED: [number, number, number] = [214, 40, 72];
const BLUE: [number, number, number] = [58, 108, 255];

/** Flask with the BZ reaction: colour follows Ce(IV) (u₃); time is warped so that fast bursts play in slow motion. */
export default function FlaskBZScene({ sol, peaks }: { sol: Solution; peaks: number[] }) {
  const pb = usePlayback(16);
  const warp = useMemo(() => {
    const n = sol.t.length;
    const lg = sol.y.map((v) => v.map((x) => Math.log10(Math.max(x, 1e-12))));
    let total = 0;
    for (let k = 1; k < n; k++) total += Math.hypot(lg[k][0] - lg[k - 1][0], lg[k][1] - lg[k - 1][1], lg[k][2] - lg[k - 1][2]);
    const T = sol.t[n - 1];
    const kt = total / T;
    const s = [0];
    for (let k = 1; k < n; k++) {
      const d = Math.hypot(lg[k][0] - lg[k - 1][0], lg[k][1] - lg[k - 1][1], lg[k][2] - lg[k - 1][2], kt * (sol.t[k] - sol.t[k - 1]));
      s.push(s[k - 1] + d);
    }
    const S = s[n - 1];
    return { s: s.map((v) => v / S), T, cols: [0, 1, 2].map((i) => lg.map((v) => v[i])) };
  }, [sol]);

  const t = sampleAt(warp.s, sol.t, pb.progress);
  const t2 = sampleAt(warp.s, sol.t, Math.min(1, pb.progress + 0.002));
  const slow = (warp.T * 0.002) / Math.max(t2 - t, 1e-9);
  const u = warp.cols.map((col) => sampleAt(sol.t, col, t));
  const c = u[2] / 4.5;
  const color = mix(RED, BLUE, c);
  const last = peaks.filter((p) => p <= t).pop();
  const since = last === undefined ? NaN : t - last;
  const flash = Number.isFinite(since) && since < 3;
  const bubbles = Array.from({ length: 14 }, (_, i) => {
    const sp = 0.6 + ((i * 37) % 10) / 10;
    const y = 1 - ((pb.progress * 30 * sp + i * 0.13) % 1);
    const x = 0.25 + (((i * 53) % 50) / 100) + 0.03 * Math.sin(pb.progress * 60 + i);
    return { x, y, r: 2 + (i % 3) };
  });
  const u3Series = useMemo(() => [{ x: sol.t, y: sol.y.map((v) => v[2]), color: "#5cc8ff", width: 2, label: "u₃ = Ce(IV)" }], [sol]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="relative grid place-items-center rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent p-3">
          <svg viewBox="0 0 200 240" className="h-[250px] w-[220px]">
            <defs>
              <clipPath id="bz-clip">
                <path d="M80 20 L80 90 L26 196 Q20 214 40 214 L160 214 Q180 214 174 196 L120 90 L120 20 Z" />
              </clipPath>
              <radialGradient id="bz-shine" cx="35%" cy="30%" r="70%">
                <stop offset="0%" stopColor="white" stopOpacity="0.25" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx={100} cy={222} rx={80} ry={8} fill={color} opacity={0.25} />
            <g clipPath="url(#bz-clip)">
              <rect x={0} y={100} width={200} height={140} fill={color} style={{ transition: "fill 120ms linear" }} />
              {flash && <rect x={0} y={100} width={200} height={140} fill="white" opacity={Math.max(0, 0.35 - since * 0.12)} />}
              {bubbles.map((b, i) => (
                <circle key={i} cx={30 + b.x * 140} cy={110 + b.y * 100} r={b.r} fill="white" opacity={0.35} />
              ))}
              <rect x={0} y={0} width={200} height={240} fill="url(#bz-shine)" />
            </g>
            <path d="M80 20 L80 90 L26 196 Q20 214 40 214 L160 214 Q180 214 174 196 L120 90 L120 20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={3} />
            <rect x={74} y={12} width={52} height={10} rx={4} fill="rgba(255,255,255,0.25)" />
          </svg>
          <div className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 text-[11px] text-white/80">{c > 0.5 ? "🔵 окиснена форма" : "🔴 відновлена форма"}</div>
          {slow > 3 && <div className="absolute right-3 top-3 rounded-full bg-[var(--accent)]/25 px-2.5 py-1 font-mono text-[11px] text-white">сповільнено ×{fmt(slow, 2)}</div>}
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
            {["HBrO₂ (u₁)", "Br⁻ (u₂)", "Ce(IV) (u₃)"].map((n, i) => (
              <div key={n} className="rounded-xl bg-white/[0.04] p-2">
                <div className="text-white/45">{n}</div>
                <div className="font-mono text-white">{fmt(Math.pow(10, u[i]), 3)}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-[12px]">
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-white/45">час t</div>
              <div className="font-mono text-white">{fmt(t, 4)}</div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              <div className="text-white/45">⏱ від останнього спалаху</div>
              <div className="font-mono text-[var(--accent)]">{Number.isFinite(since) ? fmt(since, 4) : "—"}</div>
            </div>
          </div>
          <Plot height={170} logY xLabel="t" legend={false} series={u3Series} cursorX={t} markers={[{ x: t, y: Math.pow(10, u[2]), color: color, r: 6 }]} />
        </div>
      </div>
      <PlaybackBar pb={pb} label={`t = ${t.toFixed(2)}`} />
    </div>
  );
}
