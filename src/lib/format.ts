import { format } from "date-fns"
import { parseLocalDate } from "@/domain/dates"
import { formatTime } from "@/domain/schedule"
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

/**
 * A unit for a count: "1 minute", "5 minutes". Units ending in "s" are left as typed
 * (so "minutes" or "reps" work too); "" stays "".
 */
export function units(unit: string, count: number): string {
  if (!unit || Math.abs(count) === 1) return unit
  if (/(ss|x|z|ch|sh)$/i.test(unit)) return `${unit}es`
  if (/s$/i.test(unit)) return unit
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`
  return `${unit}s`
}

/** "5", "5 minutes", or "1,200 reps". */
function count(n: number, unit: string): string {
  const u = units(unit, n)
  return u ? `${n.toLocaleString()} ${u}` : n.toLocaleString()
}

export function goalText(task: Task, status: PeriodStatus): string {
  const per = PERIOD_ADJECTIVE[status.period]
  if (task.type === "track" || !status.target) return task.unit ? `Counting ${units(task.unit, 2)} per ${per}` : `Counting per ${per}`
  const { amount } = status.target
  if (task.type === "limit") return amount === 0 ? `Never (per ${per})` : `At most ${count(amount, task.unit)} per ${per}`
  const by = !task.dueTime
    ? ""
    : status.period === "day"
      ? `, by ${formatTime(task.dueTime)}`
      : `, by ${formatTime(task.dueTime)} on the ${per}'s last day`
  return `At least ${count(amount, task.unit)} per ${per}${by}`
}

/** When a deadline falls: "9:00 AM" for daily goals, "Sat 6:00 PM" or "Oct 31, 6:00 PM" otherwise. */
function deadlineWhen(status: PeriodStatus): string {
  const { date, time } = status.deadline!
  const day = parseLocalDate(date)
  if (status.period === "day") return formatTime(time)
  return `${format(day, status.period === "week" ? "EEE" : "MMM d,")} ${formatTime(time)}`
}

/** Short deadline note for the card, or null when there's nothing worth saying. */
export function deadlineText(status: PeriodStatus): string | null {
  switch (status.deadline?.state) {
    case "pending":
      return `Due ${deadlineWhen(status)}`
    case "missed":
      return `Was due ${deadlineWhen(status)}`
    case "late":
      return "Done late"
    default:
      return null
  }
}

/** Number shown on the card, according to the task's display mode. */
export function displayValue(task: Task, summary: TaskSummary, limitDisplay: LimitDisplay = "used"): string {
  const { current } = summary
  switch (task.displayMode) {
    case "today":
      return `${count(summary.today, task.unit)} today`
    case "total":
      return `${count(summary.total, task.unit)} total`
    case "period": {
      const when = PERIOD_LABEL[current.period]
      if (current.goal === null || current.state === "excused") return `${count(current.actual, task.unit)} ${when}`
      if (showsRemaining(task, current, limitDisplay)) {
        const left = Math.max(0, current.goal - current.actual)
        return `${left} / ${count(current.goal, task.unit)} remaining ${when}`
      }
      return `${current.actual} / ${count(current.goal, task.unit)} ${when}`
    }
  }
}

export function statusText(task: Task, status: PeriodStatus, limitDisplay: LimitDisplay = "used"): string {
  if (status.state === "excused") return "Excused"
  if (status.actual < 0) return "Negative — check history"
  if (task.type === "track") return ""
  if (status.goal === null) return ""
  if (task.type === "accumulate") {
    if (status.deadline?.state === "missed") return `Overdue · ${status.goal - status.actual} left`
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
