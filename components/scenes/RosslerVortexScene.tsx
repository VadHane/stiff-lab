"use client";

import { indexAt } from "@/lib/ode";

interface Props {
  t: number[];
  ys: number[][];
  time: number;
  fixedPoint: [number, number, number];
  spikes: number[];
  cumTurns: number[];
  regime: string;
}

const W = 560;
const H = 360;
const CX = 280;
const CY = 250;
const KX = 15;
const KY = 6.2;
const KZ = 9.5;

const P = (x: number, y: number, z: number): [number, number] => [CX + KX * x - 4 * y, CY + KY * y - KZ * z];

export default function RosslerVortexScene({ t, ys, time, fixedPoint, spikes, cumTurns, regime }: Props) {
  const i = indexAt(t, time);
  const cur = ys[i] ?? [0, 0, 0];
  const tailWindow = 18;
  const start = indexAt(t, Math.max(t[0], time - tailWindow));
  const stride = Math.max(1, Math.floor((i - start) / 500));
  const segs: { d: string; o: number }[] = [];
  const chunks = 14;
  const span = Math.max(1, i - start);
  for (let c = 0; c < chunks; c++) {
    const a = start + Math.floor((c * span) / chunks);
    const b = start + Math.floor(((c + 1) * span) / chunks);
    let d = "";
    for (let k = a; k <= b; k += stride) {
      const [px, py] = P(ys[k][0], ys[k][1], ys[k][2]);
      d += `${d ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
    }
    const [px, py] = P(ys[b][0], ys[b][1], ys[b][2]);
    d += `L${px.toFixed(1)},${py.toFixed(1)}`;
    segs.push({ d, o: 0.1 + (0.9 * (c + 1)) / chunks });
  }
  const shadow: string[] = [];
  for (let k = start; k <= i; k += stride * 2) {
    const [px, py] = P(ys[k][0], ys[k][1], 0);
    shadow.push(`${shadow.length ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`);
  }
  const [hx, hy] = P(cur[0], cur[1], cur[2]);
  const [sx, sy] = P(cur[0], cur[1], 0);
  const turns = Math.floor(cumTurns[i] ?? 0);
  const nSpikes = spikes.filter((s) => s <= time).length;
  const recentSpike = spikes.some((s) => s <= time && time - s < 1.2);
  const [fx, fy] = P(fixedPoint[0], fixedPoint[1], 0);
  const heat = Math.min(1, cur[2] / 12);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 400 }}>
      <defs>
        <radialGradient id="rv-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#b18cff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#b18cff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="rv-ball">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="60%" stopColor={recentSpike ? "#ff7ad9" : "#b18cff"} />
          <stop offset="100%" stopColor={recentSpike ? "#ff7ad9" : "#b18cff"} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="rv-beam" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ff7ad9" stopOpacity="0" />
          <stop offset="100%" stopColor="#ff7ad9" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <ellipse cx={CX} cy={CY} rx={KX * 14} ry={KY * 14} fill="url(#rv-floor)" />
      {[3, 6, 9, 12].map((r) => (
        <ellipse key={r} cx={CX} cy={CY} rx={KX * r} ry={KY * r} fill="none" stroke="#b18cff" strokeOpacity={0.12 + (0.03 * (12 - r)) / 3} strokeDasharray="3 5" />
      ))}
      <circle cx={fx} cy={fy} r={4} fill="none" stroke="#ffe66d" strokeOpacity={0.8} />
      <text x={fx + 7} y={fy + 16} fontSize={10} fill="#ffe66d" opacity={0.7}>
        нестійкий фокус
      </text>
      <path d={shadow.join("")} fill="none" stroke="#8b7bd8" strokeOpacity={0.25} strokeWidth={1} />
      {segs.map((s, k) => (
        <path key={k} d={s.d} fill="none" stroke={k > chunks - 3 ? "#e9dcff" : "#b18cff"} strokeOpacity={s.o} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {cur[2] > 0.4 && <rect x={sx - 3} y={hy} width={6} height={Math.max(0, sy - hy)} fill="url(#rv-beam)" />}
      <ellipse cx={sx} cy={sy} rx={7} ry={2.6} fill="#000" opacity={0.45} />
      <circle cx={hx} cy={hy} r={14 + 8 * heat} fill="url(#rv-ball)" opacity={0.55} />
      <circle cx={hx} cy={hy} r={4.5} fill="#fff" />

      <g fontFamily="var(--font-mono), monospace" fontSize={11}>
        <rect x={10} y={10} width={168} height={80} rx={10} fill="#0b0d22" fillOpacity={0.75} stroke="#b18cff" strokeOpacity={0.3} />
        <text x={22} y={30} fill="#cfd6ff">
          t = {time.toFixed(1)}
        </text>
        <text x={22} y={47} fill="#cfd6ff">
          z = {cur[2].toFixed(2)}
        </text>
        <text x={22} y={64} fill="#cfd6ff">
          обертів ≈ {turns}
        </text>
        <text x={22} y={81} fill={recentSpike ? "#ff7ad9" : "#cfd6ff"}>
          викидів z: {nSpikes}
        </text>
        <rect x={W - 178} y={10} width={168} height={40} rx={10} fill="#0b0d22" fillOpacity={0.75} stroke="#b18cff" strokeOpacity={0.3} />
        <text x={W - 166} y={34} fill="#e9dcff">
          режим: {regime}
        </text>
      </g>
      {recentSpike && (
        <text x={hx + 12} y={hy - 10} fontSize={12} fill="#ff7ad9">
          ↑ викид!
        </text>
      )}
    </svg>
  );
}
