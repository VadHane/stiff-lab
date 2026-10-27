import Link from "next/link";
import type { ReactNode } from "react";
import { TASKS, type TaskMeta } from "@/lib/tasks";
import { ModeToggle } from "@/components/mode/Mode";
import ReportButton from "@/components/report/ReportButton";
import { TaskActionsProvider, TaskHeaderActions } from "@/components/share/TaskActions";

/** badge text: «№18» for the numbered tasks, the custom label («Дод. №14») otherwise */
const badgeOf = (t: TaskMeta) => t.label ?? `№${t.num}`;

export default function TaskShell({ task, children }: { task: TaskMeta; children: ReactNode }) {
  const idx = TASKS.findIndex((t) => t.id === task.id);
  const prev = TASKS[idx - 1];
  const next = TASKS[idx + 1];
  // report heading: «Задача №18» / «Додаткова задача №14»
  const reportHeading = task.label ? `Додаткова задача ${task.label.replace(/^Дод\.\s*/u, "")}` : `Задача №${task.num}`;
  return (
    <TaskActionsProvider>
      <div style={{ ["--accent" as string]: task.accent }} className="mx-auto max-w-7xl px-4 pb-10 sm:px-6" data-task-root="">
        <div className="fade-up pt-10 sm:pt-14">
          <Link href="/#tasks" className="text-[13px] text-white/45 hover:text-white">
            ← всі задачі
          </Link>
          <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-3xl border border-white/10 bg-white/[0.04] text-5xl shadow-[0_0_60px_-20px_var(--accent)]">
              <span className="animate-float">{task.emoji}</span>
              <span className="font-display absolute -right-2 -top-2 whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[13px] text-black">
                {badgeOf(task)}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="font-display glow-text text-3xl leading-tight text-white sm:text-[44px]">{task.title}</h1>
              <p className="mt-2 max-w-3xl text-[16px] text-white/65">{task.tagline}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <ModeToggle />
                <ReportButton num={task.num} title={task.title} heading={reportHeading} fileId={task.id} />
                <TaskHeaderActions />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {task.tags.map((t) => (
                  <span key={t} className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2.5 py-0.5 text-[12px] text-white/80">
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        {children}
        <div className="mt-16 grid grid-cols-2 gap-3">
          {prev ? (
            <Link href={`/task/${prev.id}`} className="glass group rounded-2xl p-4 hover:border-white/20">
              <div className="text-[12px] text-white/40">← попередня</div>
              <div className="mt-1 text-white/85 group-hover:text-white">
                {prev.emoji} {badgeOf(prev)}. {prev.title}
              </div>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/task/${next.id}`} className="glass group rounded-2xl p-4 text-right hover:border-white/20">
              <div className="text-[12px] text-white/40">наступна →</div>
              <div className="mt-1 text-white/85 group-hover:text-white">
                {next.emoji} {badgeOf(next)}. {next.title}
              </div>
            </Link>
          )}
        </div>
      </div>
    </TaskActionsProvider>
  );
}
