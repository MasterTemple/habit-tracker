import type { Category, Scope } from "@/domain/types"
import type { TaskView } from "@/hooks/useAppData"

/** "All tasks", "Exercise", or "Exercise, Health + 2 tasks". */
export function scopeSummary(scope: Scope, categories: Category[], tasks: TaskView[]): string {
  if (scope.appliesToAll) return "All tasks"
  const names = scope.categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean)
  const taskNames = scope.taskIds.map((id) => tasks.find((t) => t.task.id === id)?.task.name).filter(Boolean)
  if (names.length === 0 && taskNames.length <= 2) return taskNames.join(", ") || "Nothing selected"
  if (taskNames.length === 0) return names.join(", ")
  return `${names.join(", ")} + ${taskNames.length} ${taskNames.length === 1 ? "task" : "tasks"}`
}
