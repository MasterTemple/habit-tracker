import { format } from "date-fns"
import { parseLocalDate } from "@/domain/dates"
import type { Category, Task, TaskException } from "@/domain/types"

/** "All tasks", or the category and task names a break covers. */
export function breakScopeNames(e: TaskException, categories: Category[], tasks: Task[]): string[] {
  if (e.appliesToAll) return ["All tasks"]
  return [
    ...e.categoryIds.map((id) => categories.find((c) => c.id === id)?.name ?? "Deleted category"),
    ...e.taskIds.map((id) => tasks.find((t) => t.id === id)?.name ?? "Deleted task"),
  ]
}

export function breakDates(e: TaskException): string {
  const start = format(parseLocalDate(e.startDate), "MMM d")
  return e.startDate === e.endDate ? start : `${start} – ${format(parseLocalDate(e.endDate), "MMM d")}`
}
