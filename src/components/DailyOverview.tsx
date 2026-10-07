import { format } from "date-fns"
import { parseLocalDate } from "@/domain/dates"
import { overview, taskFraction } from "@/domain/status"
import { useAppData, type TaskView } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { CreateButton } from "./PageHeader"

const RADIUS = 26
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = 1.5

interface Props {
  /** The visible, active tasks. */
  tasks: TaskView[]
  /** Category ids the list is filtered to (empty = all). */
  filter: string[]
}

/**
 * Header for the task list: date, progress across every visible task's current
 * period, and "new task". The ring is split into one segment per task, colored by
 * the task's highest-priority visible category, so its colors match the filter.
 */
export function DailyOverview({ tasks, filter }: Props) {
  const { today, categories } = useAppData()
  const { openTask } = useEditors()
  const o = overview(tasks.map((t) => ({ task: t.task, current: t.summary.current })))
  const percent = Math.round(o.progress * 100)

  // categories are in priority order; uncategorized tasks sort last
  const colorOf = (view: TaskView) => {
    const index = categories.findIndex(
      (c) => view.categories.some((tc) => tc.id === c.id) && (filter.length === 0 || filter.includes(c.id)),
    )
    return index < 0 ? { rank: Infinity, color: "var(--primary)" } : { rank: index, color: categories[index].color }
  }
  const segments = tasks
    .map((view) => ({ fraction: taskFraction(view.task, view.summary.current), ...colorOf(view) }))
    .filter((s): s is typeof s & { fraction: number } => s.fraction !== null)
    .sort((a, b) => a.rank - b.rank)

  const lengths = segments.map((s) => (s.fraction * CIRCUMFERENCE) / segments.length)
  const arcs = segments.map((s, i) => ({
    key: i,
    color: s.color,
    offset: lengths.slice(0, i).reduce((a, b) => a + b, 0),
    // A small gap separates neighbouring segments.
    length: segments.length > 1 && lengths[i] > GAP * 2 ? lengths[i] - GAP : lengths[i],
  }))

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="relative size-16 shrink-0">
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
          <circle cx="32" cy="32" r={RADIUS} fill="none" strokeWidth="7" className="stroke-muted" />
          {arcs.map((arc) =>
            arc.length > 0 ? (
              <circle
                key={arc.key}
                cx="32"
                cy="32"
                r={RADIUS}
                fill="none"
                strokeWidth="7"
                stroke={arc.color}
                strokeDasharray={`${arc.length} ${CIRCUMFERENCE}`}
                strokeDashoffset={-arc.offset}
                style={{ transition: "stroke-dasharray 300ms, stroke-dashoffset 300ms" }}
              />
            ) : null,
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
            {o.overdue > 0 && <span className="font-medium text-destructive">{o.overdue} overdue</span>}
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
