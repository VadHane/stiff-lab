import Link from 'next/link';
import HeroCanvas from '@/components/HeroCanvas';
import HomeTheory from '@/components/HomeTheory';
import { Tex } from '@/components/ui/Tex';
import { TASKS } from '@/lib/tasks';
import TaskProgress from '@/components/quiz/TaskProgress';
import StiffnessAnalogy from '@/components/analogy/StiffnessAnalogy';

export default function Home() {
  return (
    <>
      <section className='relative overflow-hidden border-b border-white/[0.06]'>
        <HeroCanvas />
        <div className='absolute inset-0 bg-gradient-to-r from-[#070815] via-[#070815]/60 to-transparent' />
        <div className='relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28'>
          <div className='fade-up max-w-2xl'>
            <div className='mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[12px] text-white/70'>
              <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#3ee6a8]' />
              Розділ 12 · 18 інтерактивних лабораторних
            </div>
            <h1 className='font-display text-4xl leading-[1.05] text-white sm:text-6xl'>
              Жорсткі системи
              <br />
            </h1>
            <p className='mt-6 text-[17px] leading-relaxed text-white/70'>
              Коли в одній системі живуть процеси зі швидкостями, що відрізняються в тисячі разів,
              явні методи починають «вибухати». Тут можна крутити крок, перемикати методи й бачити
              наживо, як неявний Ейлер, θ-метод, метод Гіра та Розенброк приборкують хімію,
              серцебиття, нейрони й хаос.
            </p>
            <div className='mt-8 flex flex-wrap gap-3'>
              <Link
                href='#tasks'
                className='rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black shadow-[0_0_40px_-10px_#7c9cff] transition-transform hover:scale-[1.03]'
              >
                До задач →
              </Link>
              <Link
                href='#theory'
                className='rounded-full border border-white/15 px-5 py-2.5 text-[14px] text-white/80 hover:bg-white/5'
              >
                Що таке жорсткість?
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className='mx-auto max-w-7xl px-4 sm:px-6' style={{ ['--accent' as string]: '#7c9cff' }}>
        <section id='theory' className='scroll-mt-20 pt-16'>
          <div className='mb-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--accent)]'>
            Теорія за 2 хвилини
          </div>
          <h2 className='font-display mb-6 text-3xl text-white'>Що таке жорсткість?</h2>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
            {[
              {
                e: '🐢🐇',
                t: 'Два темпи',
                d: (
                  <>
                    Власні числа якобіана <Tex>{'\\lambda_i'}</Tex> всі мають{' '}
                    <Tex>{'\\operatorname{Re}\\lambda_i<0'}</Tex>, але{' '}
                    <Tex>
                      {
                        '\\max|\\operatorname{Re}\\lambda| / \\min|\\operatorname{Re}\\lambda| \\gg 1'
                      }
                    </Tex>
                    . Швидка мода згасає миттєво, повільна — визначає розв&apos;язок.
                  </>
                ),
              },
              {
                e: '💥',
                t: 'Явні методи вибухають',
                d: (
                  <>
                    Для явного Ейлера на <Tex>{"u'=\\lambda u"}</Tex>:{' '}
                    <Tex>{'y_{n+1} = (1+h\\lambda)y_n'}</Tex>. Стійкість лише при{' '}
                    <Tex>{'|1+h\\lambda|\\le 1'}</Tex>, тобто <Tex>{'h \\le 2/|\\lambda|'}</Tex> —
                    навіть коли швидка мода давно зникла.
                  </>
                ),
              },
              {
                e: '🛡️',
                t: 'Неявні методи рятують',
                d: (
                  <>
                    Неявний Ейлер: <Tex>{'y_{n+1} = y_n/(1-h\\lambda)'}</Tex> — стійкий при
                    будь-якому <Tex>{'h>0'}</Tex>. Ціна — на кожному кроці розв&apos;язувати
                    (нелінійну) систему методом Ньютона.
                  </>
                ),
              },
            ].map((c) => (
              <div key={c.t} className='glass rounded-2xl p-5'>
                <div className='text-3xl'>{c.e}</div>
                <div className='font-display mt-3 text-[16px] text-white'>{c.t}</div>
                <div className='mt-2 text-[14px] leading-relaxed text-white/70'>{c.d}</div>
              </div>
            ))}
          </div>
          <StiffnessAnalogy />
          <HomeTheory />
        </section>

        <section id='tasks' className='scroll-mt-20 pt-20'>
          <div className='mb-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--accent)]'>
            Лабораторні роботи
          </div>
          <h2 className='font-display mb-6 text-3xl text-white'>Оберіть задачу</h2>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {TASKS.map((t, i) => (
              <Link
                key={t.id}
                href={`/task/${t.id}`}
                className='glass fade-up group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-white/20'
                style={{ animationDelay: `${i * 40}ms`, ['--accent' as string]: t.accent }}
              >
                <div
                  className='pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40'
                  style={{ background: t.accent }}
                />
                <div className='flex items-start gap-3'>
                  <div className='text-4xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6'>
                    {t.emoji}
                  </div>
                  <div className='ml-auto flex items-center gap-2'>
                    <TaskProgress id={t.id} />
                    <span className='font-display whitespace-nowrap text-[13px] text-[var(--accent)]'>{t.label ?? `№${t.num}`}</span>
                  </div>
                </div>
                <div className='font-display mt-4 text-[17px] leading-snug text-white'>
                  {t.title}
                </div>
                <div className='mt-2 text-[13.5px] leading-relaxed text-white/60'>{t.tagline}</div>
                <div className='mt-4 flex flex-wrap gap-1.5'>
                  {t.tags.map((tag) => (
                    <span
                      key={tag}
                      className='rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/55'
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
