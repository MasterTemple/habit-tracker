import { currentTarget, exceptionsForTask, summarize, type TaskContext } from "@/domain/status"
import type { Category, LocalDate, LocalTime, Settings, Task, TaskEvent, TaskException, TaskTarget } from "@/domain/types"
import type { TaskView } from "@/hooks/useAppData"

export interface TaskData {
  settings: Settings
  tasks: Task[]
  targets: TaskTarget[]
  events: TaskEvent[]
  categories: Category[]
  exceptions: TaskException[]
}

/** Each task with its goal, categories, and what to show for it at `today` / `now`. */
export function deriveTaskViews(data: TaskData, today: LocalDate, now: LocalTime): TaskView[] {
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]))
  return data.tasks.map((task) => {
    const categoryIds = task.categoryIds ?? []
    const ctx: TaskContext = {
      task,
      targets: data.targets.filter((t) => t.taskId === task.id),
      events: data.events.filter((e) => e.taskId === task.id),
      exceptions: exceptionsForTask(task.id, categoryIds, data.exceptions),
      settings: data.settings,
      now,
    }
    return {
      task,
      target: currentTarget(ctx.targets, today),
      categories: categoryIds.map((id) => categoriesById.get(id)).filter((c): c is Category => !!c),
      ctx,
      summary: summarize(ctx, today),
    }
  })
}

/**
 * The wall clock in another time zone (e.g. a friend's), as the local date the day
 * counts toward and "HH:MM", so their progress reads the way they see it.
 */
export function clockIn(timeZone: string, dayStartHour: number, at = new Date()): { today: LocalDate; now: LocalTime } {
  let parts: Record<string, string>
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timeZone || "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    )
  } catch {
    return clockIn("UTC", dayStartHour, at)
  }
  const now = `${parts.hour}:${parts.minute}`
  // Shift back by the day-start hour, like toLocalDate does on this device's clock.
  const local = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute))
  local.setUTCHours(local.getUTCHours() - dayStartHour)
  return { today: local.toISOString().slice(0, 10), now }
}
