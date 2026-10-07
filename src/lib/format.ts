import type { PeriodStatus, TaskSummary } from "@/domain/status"
import type { Period, Task } from "@/domain/types"

export const PERIOD_LABEL: Record<Period, string> = {
  day: "today",
  week: "this week",
  month: "this month",
}

export const PERIOD_ADJECTIVE: Record<Period, string> = {
  day: "day",
  week: "week",
  month: "month",
}

export function goalText(task: Task, status: PeriodStatus): string {
  if (task.type === "track" || !status.target) return "Track only"
  const per = PERIOD_ADJECTIVE[status.target.period]
  if (task.type === "limit") return status.target.amount === 0 ? `Never (per ${per})` : `≤ ${status.target.amount} / ${per}`
  return `${status.target.amount} / ${per}`
}

/** Number shown on the card, according to the task's display mode. */
export function displayValue(task: Task, summary: TaskSummary): string {
  const { current } = summary
  switch (task.displayMode) {
    case "today":
      return `${summary.today} today`
    case "total":
      return `${summary.total.toLocaleString()} total`
    case "period":
      if (current.goal === null) return `${current.actual} ${PERIOD_LABEL[current.period]}`
      return `${current.actual} / ${current.goal} ${PERIOD_LABEL[current.period]}`
  }
}

export function statusText(task: Task, status: PeriodStatus): string {
  if (status.state === "excused") return "Excused"
  if (task.type === "track") return status.actual > 0 ? "Done" : ""
  if (status.goal === null) return ""
  if (task.type === "accumulate") {
    if (status.actual > status.goal) return `Done +${status.actual - status.goal}`
    if (status.state === "success") return "Done"
    return `${status.goal - status.actual} left`
  }
  if (status.actual > status.goal) return `Over by ${status.actual - status.goal}`
  return status.goal - status.actual === 0 ? "At limit" : `${status.goal - status.actual} left`
}

export function progressPercent(status: PeriodStatus): number {
  if (status.state === "excused") return 100
  if (status.goal === null) return status.actual > 0 ? 100 : 0
  if (status.goal === 0) return status.actual > 0 ? 100 : 0
  return Math.min(100, (status.actual / status.goal) * 100)
}
