import { format } from "date-fns"
import { parseLocalDate } from "@/domain/dates"
import { overview } from "@/domain/status"
import { useAppData, type TaskView } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { CreateButton } from "./PageHeader"

/** Header for the task list: date, progress across every active task's current period, and "new task". */
export function DailyOverview({ tasks }: { tasks: TaskView[] }) {
  const { today } = useAppData()
  const { openTask } = useEditors()
  const o = overview(tasks.map((t) => ({ task: t.task, current: t.summary.current })))

  const percent = Math.round(o.progress * 100)
  const radius = 26
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="relative size-16 shrink-0">
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
          <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
          {o.counted > 0 && (
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              className={percent === 100 ? "stroke-green-500" : "stroke-primary"}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - o.progress)}
              style={{ transition: "stroke-dashoffset 300ms" }}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
          {o.counted > 0 ? `${percent}%` : "–"}
        </span>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="text-xs text-muted-foreground">{format(parseLocalDate(today), "EEEE, MMMM d")}</div>
        <div className="font-medium">{o.counted > 0 ? `${o.done} of ${o.counted} on track` : "No goals yet"}</div>
        {o.counted > 0 && (
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {o.remaining > 0 && <span>{o.remaining} to go</span>}
            {o.over > 0 && <span className="font-medium text-destructive">{o.over} over limit</span>}
            {o.excused > 0 && <span>{o.excused} on break</span>}
            {o.remaining === 0 && o.over === 0 && <span>All done 🎉</span>}
          </div>
        )}
      </div>
      <CreateButton onClick={() => openTask({ mode: "new" })} label="New task" />
    </div>
  )
}
