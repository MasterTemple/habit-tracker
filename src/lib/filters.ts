import { isExcused } from "@/domain/status"
import type { LocalDate } from "@/domain/types"
import type { TaskView } from "@/hooks/useAppData"

/** Pseudo-categories for the task filter, alongside real category ids. */
export const UNCATEGORIZED = "uncategorized"
export const RETIRED = "retired"
export const ON_BREAK = "on-break"

export const isOnBreak = (view: TaskView, today: LocalDate) =>
  !view.task.retiredAt && isExcused(today, view.ctx.exceptions)

/** Whether a task matches one filter value (a category id or a pseudo-category). */
export function matchesFilter(view: TaskView, value: string, today: LocalDate): boolean {
  switch (value) {
    case UNCATEGORIZED:
      return view.categories.length === 0
    case RETIRED:
      return !!view.task.retiredAt
    case ON_BREAK:
      return isOnBreak(view, today)
    default:
      return view.categories.some((c) => c.id === value)
  }
}

export interface Visibility {
  retired: boolean
  breaks: boolean
}

/**
 * Tasks to list: hidden kinds removed, then the filter applied (a task shows if it
 * matches any selected value; none selected = all).
 */
export function visibleTasks(tasks: TaskView[], filter: string[], show: Visibility, today: LocalDate): TaskView[] {
  return tasks.filter(
    (t) =>
      (show.retired || !t.task.retiredAt) &&
      (show.breaks || !isOnBreak(t, today)) &&
      (filter.length === 0 || filter.some((f) => matchesFilter(t, f, today))),
  )
}
