"use client";

import { fmt } from "@/lib/format";

export type Zone = "rest" | "excited" | "refractory";

export const ZONES: Record<Zone, { label: string; color: string }> = {
  rest: { label: "спокій", color: "#5cc8ff" },
  excited: { label: "збудження", color: "#ff7ad9" },
  refractory: { label: "рефрактерність", color: "#ffb547" },
};

const DENDRITES = [
  "M150,130 C120,110 95,90 60,70 M95,92 C85,75 80,60 82,40 M60,70 C45,62 35,64 20,58",
  "M150,140 C115,150 85,170 50,185 M85,168 C70,175 58,192 55,210 M50,185 C38,190 30,198 18,205",
  "M160,118 C155,90 150,60 140,30 M152,75 C165,62 175,50 190,42",
  "M160,152 C158,180 150,205 135,230 M152,195 C168,205 175,215 178,235",
];

/** Нейрон: сома світиться за V(t), по аксону біжать імпульси, внизу — осцилограф мембранного потенціалу. */
export default function NeuronScene({
  t,
  V,
  W,
  zone,
  spikes,
  trace,
  span: win,
}: {
  t: number;
  V: number;
  W: number;
  zone: Zone;
  spikes: number[];
  trace: { t: number[]; v: number[] };
  span: number;
}) {
  const glow = Math.min(1, Math.max(0, (V + 2.2) / 4.2));
  const hot = Math.max(0, Math.min(1, (V - 0.3) / 1.5));
  const z = ZONES[zone];
  const AX0 = 205,
    AX1 = 540,
    TRAVEL = 9;
  const pulses = spikes.filter((s) => t >= s && t - s <= TRAVEL).map((s) => (t - s) / TRAVEL);
  const soma = `rgb(${Math.round(90 + 165 * hot)}, ${Math.round(110 + 40 * glow - 60 * hot)}, ${Math.round(255 - 40 * hot)})`;

  const ox = 30,
    oy = 280,
    ow = 520,
    oh = 110;
  const X = (tt: number) => ox + ((tt - (t - win)) / win) * ow;
  const Y = (v: number) => oy + oh / 2 - (v / 2.6) * (oh / 2);
  let d = "";
  for (let i = 0; i < trace.t.length; i++) {
    if (trace.t[i] < t - win || trace.t[i] > t) continue;
    d += `${d ? "L" : "M"}${X(trace.t[i]).toFixed(1)},${Y(trace.v[i]).toFixed(1)}`;
  }

  return (
    <svg viewBox="0 0 580 410" className="w-full">
      <defs>
        <radialGradient id="nr-glow">
          <stop offset="0%" stopColor={soma} stopOpacity={0.25 + 0.6 * hot} />
          <stop offset="100%" stopColor={soma} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="nr-axon" x1="0" x2="1">
          <stop offset="0%" stopColor={soma} />
          <stop offset="100%" stopColor="#8aa0ff" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <circle cx="160" cy="135" r={70 + 30 * hot} fill="url(#nr-glow)" />
      {DENDRITES.map((p, i) => (
        <path key={i} d={p} stroke={soma} strokeOpacity={0.45 + 0.4 * glow} strokeWidth="3" fill="none" strokeLinecap="round" />
      ))}
      <path d={`M190,135 L${AX1},135`} stroke="url(#nr-axon)" strokeWidth="6" strokeLinecap="round" />
      {Array.from({ length: 6 }, (_, k) => (
        <rect key={k} x={AX0 + 20 + k * 52} y="127" width="38" height="16" rx="8" fill="rgba(230,235,255,0.14)" stroke="rgba(230,235,255,0.35)" />
      ))}
      {[0, 1, 2].map((k) => (
        <path key={k} d={`M${AX1},135 C${AX1 + 12},${120 + k * 15} ${AX1 + 22},${115 + k * 15} ${AX1 + 34},${110 + k * 15}`} stroke="#8aa0ff" strokeOpacity="0.6" strokeWidth="2.5" fill="none" />
      ))}
      {pulses.map((f, i) => {
        const x = AX0 + f * (AX1 - AX0);
        return (
          <g key={i}>
            <circle cx={x} cy="135" r="16" fill="#ff7ad9" opacity="0.25" />
            <circle cx={x} cy="135" r="7" fill="#fff" />
            <text x={x} y="112" textAnchor="middle" fontSize="16">
              ⚡
            </text>
          </g>
        );
      })}
      <ellipse cx="160" cy="135" rx="40" ry="36" fill={soma} stroke="white" strokeOpacity="0.6" strokeWidth="2" />
      <circle cx="152" cy="130" r="11" fill="rgba(20,20,50,0.45)" />
      <text x="160" y="196" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.65)">
        сома
      </text>
      <text x="380" y="166" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.5)">
        аксон (мієлін)
      </text>

      <g transform="translate(400,20)">
        <rect width="160" height="64" rx="12" fill={`${z.color}22`} stroke={z.color} />
        <text x="80" y="26" textAnchor="middle" fontSize="15" fontWeight="600" fill={z.color}>
          {z.label}
        </text>
        <text x="80" y="48" textAnchor="middle" fontSize="11.5" fill="rgba(255,255,255,0.7)" fontFamily="var(--font-jetbrains)">
          V={fmt(V, 3)} W={fmt(W, 3)}
        </text>
      </g>

      <rect x={ox} y={oy} width={ow} height={oh} rx="10" fill="rgba(10,30,20,0.55)" stroke="rgba(120,255,180,0.25)" />
      {[-2, -1, 0, 1, 2].map((v) => (
        <line key={v} x1={ox} x2={ox + ow} y1={Y(v)} y2={Y(v)} stroke="rgba(120,255,180,0.08)" />
      ))}
      <line x1={ox} x2={ox + ow} y1={Y(1)} y2={Y(1)} stroke="rgba(255,122,217,0.35)" strokeDasharray="4 4" />
      <path d={d} stroke="#7cf29c" strokeWidth="2.2" fill="none" style={{ filter: "drop-shadow(0 0 4px #7cf29c)" }} />
      <circle cx={X(t)} cy={Y(V)} r="4" fill="#fff" />
      <text x={ox + 8} y={oy + 16} fontSize="11" fill="rgba(160,255,200,0.7)">
        осцилограф V(t), вікно {fmt(win, 3)}
      </text>
      <text x={ox + ow - 6} y={Y(1) - 4} textAnchor="end" fontSize="10" fill="rgba(255,122,217,0.7)">
        V = 1 (спайк)
      </text>
    </svg>
  );
}
