"use client";

import { CONSTANTS, FUNCTIONS, type FnName } from "@/lib/expr";

const ARGS: Partial<Record<FnName, string>> = { atan2: "y, x", min: "a, b, …", max: "a, b, …", pow: "a, b" };
const NOTE: Partial<Record<FnName, string>> = {
  log: "натуральний",
  ln: "= log",
  log10: "десятковий",
  sign: "−1, 0, 1",
  atan2: "кут точки (x, y)",
  pow: "= a^b",
};

/** Шпаргалка: оператори, функції ({@link FUNCTIONS}), константи ({@link CONSTANTS}) і правила запису. */
export default function Cheatsheet() {
  const fns = Object.keys(FUNCTIONS) as FnName[];
  const consts = Object.entries(CONSTANTS);
  return (
    <details className="group rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[13px] text-white/75">
      <summary className="cursor-pointer select-none text-white/85 marker:text-[var(--accent)]">
        📘 Шпаргалка: як записувати рівняння
      </summary>
      <div className="mt-3 space-y-3">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Множення — <b className="text-white">лише через</b> <code className="font-mono text-[var(--accent)]">*</code>:{" "}
            <code className="font-mono">2*x</code>, <code className="font-mono">k*(x - y)</code>. Запис <code className="font-mono">2x</code> чи{" "}
            <code className="font-mono">x y</code> — помилка.
          </li>
          <li>
            Оператори: <code className="font-mono">+ − * / ^</code> (степінь; також <code className="font-mono">**</code>). <code className="font-mono">-x^2</code> = −(x²),{" "}
            <code className="font-mono">2^3^2</code> = 2⁹.
          </li>
          <li>
            Імена: літери (латиниця, грецькі), цифри, <code className="font-mono">_</code>; першою — літера: <code className="font-mono">u1, k_2, σ, ω0</code>. Великі й малі літери
            різні.
          </li>
          <li>У рівняннях доступні: час (типово t), змінні, параметри і допоміжні величини, оголошені вище.</li>
          <li>Числа: 0.5, .5, 1e-3, 3E7. У числових полях (y₀, T, параметри) можна писати й сталі вирази: 2*pi, sqrt(2)/2.</li>
        </ul>
        <div>
          <div className="mb-1.5 text-[12px] uppercase tracking-wider text-white/45">Функції</div>
          <div className="flex flex-wrap gap-1.5">
            {fns.map((f) => (
              <span key={f} className="rounded-md border border-white/10 bg-black/25 px-1.5 py-0.5 font-mono text-[12px] text-white/85" title={NOTE[f]}>
                {f}({ARGS[f] ?? "x"})
                {NOTE[f] && <span className="ml-1 font-sans text-[11px] text-white/45">{NOTE[f]}</span>}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] uppercase tracking-wider text-white/45">Константи</div>
          <div className="flex flex-wrap gap-1.5">
            {consts.map(([name, v]) => (
              <span key={name} className="rounded-md border border-white/10 bg-black/25 px-1.5 py-0.5 font-mono text-[12px] text-white/85">
                {name} = {v.toPrecision(10)}
              </span>
            ))}
          </div>
          <div className="mt-1 text-[12px] text-white/45">Параметр чи змінна з іменем e або pi перекриває константу.</div>
        </div>
      </div>
    </details>
  );
}
