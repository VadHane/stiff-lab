import { fmt } from "@/lib/format";

/** Needle gauge for an amplification factor |R|: green ≤ 1, red > 1. */
export default function Gauge({ value, label, max = 3 }: { value: number; label: string; max?: number }) {
  const v = Number.isFinite(value) ? Math.min(value, max) : max;
  const ang = -120 + (v / max) * 240;
  const one = -120 + (1 / max) * 240;
  const arc = (a0: number, a1: number, r: number) => {
    const p = (a: number) => [60 + r * Math.sin((a * Math.PI) / 180), 64 - r * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(a0),
      [x1, y1] = p(a1);
    return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
  };
  const ok = value <= 1 + 1e-12;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 92" className="w-full max-w-[150px]">
        <path d={arc(-120, one, 46)} stroke="#3ee6a8" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.8" />
        <path d={arc(one, 120, 46)} stroke="#ff5d73" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.8" />
        <g style={{ transform: `rotate(${ang}deg)`, transformOrigin: "60px 64px", transition: "transform 0.4s cubic-bezier(.3,1.6,.5,1)" }}>
          <line x1="60" y1="64" x2="60" y2="24" stroke="white" strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx="60" cy="64" r="5" fill="white" />
        <text x="60" y="88" textAnchor="middle" fontSize="12" fill={ok ? "#3ee6a8" : "#ff5d73"} fontFamily="var(--font-jetbrains)">
          |R| = {fmt(value, 4)}
        </text>
      </svg>
      <div className="mt-0.5 text-center text-[11.5px] text-white/60">{label}</div>
    </div>
  );
}
