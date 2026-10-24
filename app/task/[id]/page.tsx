import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import TaskShell from '@/components/tasks/TaskShell';
import TaskBody from '@/components/tasks/TaskBody';
import { TASKS, taskById } from '@/lib/tasks';

export function generateStaticParams() {
  return TASKS.map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: PageProps<'/task/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const t = taskById(id);
  return { title: t ? `${t.label ?? `№${t.num}`}. ${t.title} — Лаб` : 'Лаб' };
}

async function TaskPage({ params }: { params: PageProps<'/task/[id]'>['params'] }) {
  const { id } = await params;
  const task = taskById(id);
  if (!task) notFound();
  return (
    <TaskShell task={task}>
      <TaskBody id={task.id} />
    </TaskShell>
  );
}

export default function Page({ params }: PageProps<'/task/[id]'>) {
  return (
    <Suspense
      fallback={<div className='mx-auto max-w-7xl px-6 py-24 text-white/40'>Завантаження…</div>}
    >
      <TaskPage params={params} />
    </Suspense>
  );
}
