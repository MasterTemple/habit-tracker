import type { PeriodStatus, TaskSummary } from "@/domain/status"
import type { Period, Settings, Task } from "@/domain/types"

type LimitDisplay = Settings["limitDisplay"]

/** Limits with an allowance can count down ("1 / 4 remaining"); "never" limits can't. */
function showsRemaining(task: Task, status: PeriodStatus, limitDisplay: LimitDisplay) {
  return task.type === "limit" && limitDisplay === "remaining" && !!status.goal
}

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
export function displayValue(task: Task, summary: TaskSummary, limitDisplay: LimitDisplay = "used"): string {
  const { current } = summary
  switch (task.displayMode) {
    case "today":
      return `${summary.today} today`
    case "total":
      return `${summary.total.toLocaleString()} total`
    case "period":
      if (current.goal === null || current.state === "excused") return `${current.actual} ${PERIOD_LABEL[current.period]}`
      if (showsRemaining(task, current, limitDisplay)) {
        return `${Math.max(0, current.goal - current.actual)} / ${current.goal} remaining ${PERIOD_LABEL[current.period]}`
      }
      return `${current.actual} / ${current.goal} ${PERIOD_LABEL[current.period]}`
  }
}

export function statusText(task: Task, status: PeriodStatus, limitDisplay: LimitDisplay = "used"): string {
  if (status.state === "excused") return "Excused"
  if (status.actual < 0) return "Negative — check history"
  if (task.type === "track") return status.actual > 0 ? "Done" : ""
  if (status.goal === null) return ""
  if (task.type === "accumulate") {
    if (status.actual > status.goal) return `Done +${status.actual - status.goal}`
    if (status.state === "success") return "Done"
    return `${status.goal - status.actual} left`
  }
  if (status.actual > status.goal) return `Over by ${status.actual - status.goal}`
  if (showsRemaining(task, status, limitDisplay)) return `${status.actual} used`
  if (status.goal - status.actual > 0) return `${status.goal - status.actual} left`
  return status.goal === 0 ? "On track" : "At limit"
}

export function progressPercent(task: Task, status: PeriodStatus, limitDisplay: LimitDisplay = "used"): number {
  if (status.state === "excused") return 100
  if (status.goal === null) return status.actual > 0 ? 100 : 0
  if (status.goal === 0) return status.actual > 0 ? 100 : 0
  const used = Math.min(100, Math.max(0, (status.actual / status.goal) * 100))
  // Counting down: the bar shrinks as the allowance is used, and fills (red) once over.
  if (showsRemaining(task, status, limitDisplay) && status.state !== "failure") return 100 - used
  return used
}
