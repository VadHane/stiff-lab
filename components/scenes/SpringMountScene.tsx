"use client";

interface Unit {
  label: string;
  color: string;
  u: number;
  v: number;
  failed?: boolean;
}

interface Props {
  units: Unit[];
  time: number;
  k: number;
  d: number;
  u0: number;
}

const H = 330;
const BASE = 292;
const REST = 150;

function coil(x: number, y0: number, y1: number, turns: number, r: number) {
  const n = turns * 2;
  let d = `M${x},${y0} L${x},${y0 - 8}`;
  const top = y1 + 8;
  const span = y0 - 8 - top;
  for (let i = 1; i <= n; i++) {
    const y = y0 - 8 - (span * i) / (n + 1);
    d += ` L${x + (i % 2 ? r : -r)},${y.toFixed(1)}`;
  }
  d += ` L${x},${top} L${x},${y1}`;
  return d;
}

export default function SpringMountScene({ units, time, k, d, u0 }: Props) {
  const width = 190 * units.length + 30;
  const scale = 70 / Math.max(1, u0);
  return (
    <svg viewBox={`0 0 ${width} ${H}`} className="w-full" style={{ maxHeight: 360 }}>
      <defs>
        <pattern id="sms-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#8ef0c5" strokeOpacity="0.25" strokeWidth="2" />
        </pattern>
      </defs>
      <rect x={0} y={BASE} width={width} height={H - BASE} fill="url(#sms-hatch)" />
      <line x1={0} x2={width} y1={BASE} y2={BASE} stroke="#8ef0c5" strokeOpacity={0.5} />
      {units.map((un, idx) => {
        const cx = 30 + idx * 190 + 80;
        const uu = un.failed || !Number.isFinite(un.u) ? 0 : Math.max(-u0 * 1.6, Math.min(u0 * 1.6, un.u));
        const boxBottom = BASE - REST + uu * scale;
        const boxTop = boxBottom - 62;
        const kEff = k + 3 * d * uu * uu;
        const hard = Math.min(1, Math.log10(kEff / k) / Math.log10(1 + 3 * (d / k) * u0 * u0));
        const springColor = `rgb(${Math.round(142 + 113 * hard)},${Math.round(240 - 150 * hard)},${Math.round(197 - 120 * hard)})`;
        const F = k * uu + d * uu * uu * uu;
        const fLen = Math.sign(F) * Math.min(70, 10 * Math.log10(1 + Math.abs(F)));
        const vLen = Math.sign(un.v) * Math.min(55, 9 * Math.log10(1 + Math.abs(un.v)));
        const pistonY = boxBottom + 28;
        return (
          <g key={un.label}>
            <line x1={cx - 70} x2={cx + 70} y1={BASE - REST} y2={BASE - REST} stroke="#ffffff" strokeOpacity={0.15} strokeDasharray="4 4" />
            <path d={coil(cx - 30, BASE, boxBottom, 7, 14)} fill="none" stroke={springColor} strokeWidth={3} strokeLinejoin="round" />
            <rect x={cx + 14} y={BASE - 70} width={34} height={70} rx={4} fill="#1b1f38" stroke="#9aa3d8" strokeOpacity={0.5} />
            <rect x={cx + 17} y={Math.min(BASE - 6, Math.max(BASE - 66, pistonY))} width={28} height={6} fill="#9aa3d8" />
            <line x1={cx + 31} x2={cx + 31} y1={boxBottom} y2={Math.min(BASE - 6, Math.max(BASE - 66, pistonY))} stroke="#9aa3d8" strokeWidth={3} />
            <rect x={cx - 62} y={boxTop} width={124} height={62} rx={10} fill="#16192f" stroke={un.color} strokeWidth={2} />
            <rect x={cx - 50} y={boxTop + 10} width={60} height={24} rx={4} fill="#0b0d22" stroke={un.color} strokeOpacity={0.4} />
            <text x={cx - 20} y={boxTop + 27} textAnchor="middle" fontSize={11} fill={un.color} fontFamily="var(--font-mono), monospace">
              {un.failed ? "💥" : uu.toFixed(2)}
            </text>
            <circle cx={cx + 30} cy={boxTop + 22} r={8} fill="none" stroke={un.color} strokeOpacity={0.6} />
            <line x1={cx + 30} y1={boxTop + 22} x2={cx + 30 + 7 * Math.cos(time * 40)} y2={boxTop + 22 + 7 * Math.sin(time * 40)} stroke={un.color} />
            <text x={cx} y={boxTop + 52} textAnchor="middle" fontSize={10.5} fill="#cfd6ff" opacity={0.75}>
              {un.label}
            </text>
            {Math.abs(fLen) > 1 && (
              <g>
                <line x1={cx - 30} x2={cx - 30} y1={boxBottom - 4} y2={boxBottom - 4 + fLen} stroke="#ffb547" strokeWidth={2.5} />
                <circle cx={cx - 30} cy={boxBottom - 4 + fLen} r={3} fill="#ffb547" />
              </g>
            )}
            {Math.abs(vLen) > 1 && <line x1={cx + 70} x2={cx + 70} y1={boxTop + 31} y2={boxTop + 31 - vLen} stroke="#7cf29c" strokeWidth={2} />}
            <text x={cx} y={BASE + 22} textAnchor="middle" fontSize={10} fill="#cfd6ff" opacity={0.65} fontFamily="var(--font-mono), monospace">
              k_eff = {kEff < 1000 ? kEff.toFixed(1) : kEff.toFixed(0)}
            </text>
          </g>
        );
      })}
      <text x={10} y={18} fontSize={11} fill="#cfd6ff" fontFamily="var(--font-mono), monospace">
        t = {(time * 1000).toFixed(0)} мс
      </text>
      <text x={width - 10} y={18} textAnchor="end" fontSize={10.5} fill="#cfd6ff" opacity={0.6}>
        помаранчева — сила пружини (лог.), зелена — швидкість
      </text>
    </svg>
  );
}
