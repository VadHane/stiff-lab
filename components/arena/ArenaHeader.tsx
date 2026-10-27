import Link from "next/link";
import { ModeToggle } from "@/components/mode/Mode";
import ShareButton from "@/components/share/ShareButton";

/** Шапка «Арени методів» (у стилі шапки сторінок задач). */
export default function ArenaHeader() {
  return (
    <div className="fade-up pt-10 sm:pt-14">
      <Link href="/" className="text-[13px] text-white/45 hover:text-white">
        ← на головну
      </Link>
      <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-3xl border border-white/10 bg-white/[0.04] text-5xl shadow-[0_0_60px_-20px_var(--accent)]">
          <span className="animate-float">🏟️</span>
          <span className="font-display absolute -right-2 -top-2 whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[13px] text-black">11 × 19</span>
        </div>
        <div className="min-w-0">
          <h1 className="font-display glow-text text-3xl leading-tight text-white sm:text-[44px]">Арена методів</h1>
          <p className="mt-2 max-w-3xl text-[16px] text-white/65">
            Усі 11 методів платформи змагаються на задачах курсу: хто найдешевше досягає заданої точності, де явні методи програють через стійкість, а де
            неявні — через ціну Ньютона.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ModeToggle />
            <ShareButton />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["похибка — вартість", "work-precision", "рейтинг", "жорсткість"].map((t) => (
              <span key={t} className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2.5 py-0.5 text-[12px] text-white/80">
                #{t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
