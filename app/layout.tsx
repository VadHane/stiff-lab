import type { Metadata } from 'next';
import { JetBrains_Mono, Manrope, Unbounded } from 'next/font/google';
import Link from 'next/link';
import { ModeProvider, ModeToggle } from '@/components/mode/Mode';
import ScoreBadge from '@/components/quiz/ScoreBadge';
import 'katex/dist/katex.min.css';
import './globals.css';

const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin', 'cyrillic'] });
const unbounded = Unbounded({ variable: '--font-unbounded', subsets: ['latin', 'cyrillic'] });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'Лаб — чисельні методи для жорстких систем',
  description:
    "Інтерактивні демонстрації лабораторних робіт: числові методи розв'язування жорстких систем ЗДР.",
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang='uk'
      className={`${manrope.variable} ${unbounded.variable} ${jetbrains.variable} antialiased`}
    >
      <body className='min-h-screen'>
        <ModeProvider>
        <header className='sticky top-0 z-40 border-b border-white/[0.06] bg-[#070815]/70 backdrop-blur-xl'>
          <div className='mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6'>
            <Link href='/' className='font-display flex items-center gap-2 text-[15px] text-white'>
              <span className='grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#7c9cff] to-[#ff7ad9] text-[13px] text-black'>
                ∂
              </span>
              Лаб
            </Link>
            <nav className='ml-auto flex items-center gap-1.5 text-[13px] text-white/60'>
              <ScoreBadge />
              <ModeToggle />
              <Link
                href='/#theory'
                className='hidden rounded-full px-3 py-1.5 hover:bg-white/5 hover:text-white md:block'
              >
                Теорія
              </Link>
              <Link
                href='/#tasks'
                className='hidden rounded-full px-3 py-1.5 hover:bg-white/5 hover:text-white md:block'
              >
                Задачі
              </Link>
            </nav>
          </div>
        </header>
        <main className='relative z-10'>{children}</main>
        <footer className='relative z-10 mx-auto max-w-7xl px-6 py-12 text-center text-xs text-white/35'>
          Лабораторні роботи · Розділ 12 «Числові методи розв&apos;язування жорстких систем» · усі
          обчислення виконуються прямо у вашому браузері
        </footer>
        </ModeProvider>
      </body>
    </html>
  );
}
