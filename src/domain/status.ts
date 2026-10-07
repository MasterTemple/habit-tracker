import {
  addDays,
  inRange,
  minutesIntoDay,
  periodRange,
  previousPeriodRange,
  rangeLength,
  toLocalDate,
  type DateRange,
} from "./dates"
import type { LocalDate, LocalTime, Period, Settings, Task, TaskEvent, TaskException, TaskTarget } from "./types"

/** Everything needed to derive a task's progress. Events and exceptions must already be filtered to this task. */
export interface TaskContext {
  task: Task
  targets: TaskTarget[]
  events: TaskEvent[]
  exceptions: TaskException[]
  settings: Settings
  /** Current wall-clock time, for deciding whether today's deadline has passed. Omitted = not yet. */
  now?: LocalTime
}

export type DeadlineState =
  | "pending" // deadline still ahead and goal not met yet
  | "on_time" // goal met by the deadline
  | "late" // goal met, but only after the deadline
  | "missed" // deadline passed and goal still not met

export interface Deadline {
  date: LocalDate
  time: LocalTime
  state: DeadlineState
}

export type PeriodState =
  | "open" // period still running, outcome not decided yet
  | "success"
  | "failure"
  | "excused" // every day of the period was covered by an exception

export interface PeriodStatus {
  period: Period
  range: DateRange
  target: TaskTarget | null
  /** Effective goal after exceptions and carry-over: minimum for accumulate, maximum for limit. Null for track. */
  goal: number | null
  /** How much carry-over from the previous period reduced the goal. */
  carried: number
  /** Amount counted toward the goal. */
  actual: number
  excusedDays: number
  state: PeriodState
  /** Only for "Do" tasks with a due time, in periods that aren't excused. */
  deadline: Deadline | null
}

export interface TaskSummary {
  current: PeriodStatus
  today: number
  total: number
  streak: number
}

/** Exceptions that apply to a task directly, through one of its categories, or globally. */
export function exceptionsForTask(
  taskId: string,
  categoryIds: string[],
  exceptions: TaskException[],
): TaskException[] {
  return exceptions.filter((e) => {
    if (e.deletedAt) return false
    return e.appliesToAll || e.taskIds.includes(taskId) || e.categoryIds.some((id) => categoryIds.includes(id))
  })
}

export function isExcused(date: LocalDate, exceptions: TaskException[]): boolean {
  return exceptions.some((e) => date >= e.startDate && date <= e.endDate)
}

/**
 * The target version governing a period: the latest one in effect at the period
 * start, or, for a task created mid-period, the first one that starts inside it.
 */
export function targetFor(targets: TaskTarget[], range: DateRange): TaskTarget | null {
  const sorted = [...targets].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  let current: TaskTarget | null = null
  for (const t of sorted) {
    if (t.effectiveFrom <= range.start) current = t
  }
  return current ?? sorted.find((t) => t.effectiveFrom <= range.end) ?? null
}

export function currentTarget(targets: TaskTarget[], today: LocalDate): TaskTarget | null {
  return targetFor(targets, { start: today, end: today })
}

function sumEvents(events: TaskEvent[], include: (date: LocalDate) => boolean): number {
  let sum = 0
  for (const e of events) {
    if (!e.deletedAt && include(e.localDate)) sum += e.amount
  }
  return sum
}

function countExcusedDays(range: DateRange, exceptions: TaskException[]): number {
  if (exceptions.length === 0) return 0
  let count = 0
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    if (isExcused(d, exceptions)) count++
  }
  return count
}

function periodFor(ctx: TaskContext, date: LocalDate): Period {
  const target = currentTarget(ctx.targets, date)
  return target?.period ?? "day"
}

/**
 * Status of the period containing `date`.
 *
 * Rules:
 * - Exceptions: accumulate goals are prorated by the non-excused days (rounded up);
 *   limit goals stay the same but events on excused days don't count against them.
 * - Carry-over (only when the target enables it, and only one period back):
 *   accumulate surplus lowers the next goal; limit overage lowers the next allowance.
 */
export function periodStatus(
  ctx: TaskContext,
  date: LocalDate,
  today: LocalDate,
  withCarry = true,
): PeriodStatus {
  const { task, settings } = ctx
  const period = periodFor(ctx, date)
  const range = periodRange(period, date, settings.weekStartsOn)
  const ended = range.end < today

  if (task.type === "track") {
    // A counter with no goal: the target only sets the period it resets on.
    const actual = sumEvents(ctx.events, (d) => inRange(d, range))
    return {
      period,
      range,
      target: targetFor(ctx.targets, range),
      goal: null,
      carried: 0,
      actual,
      excusedDays: 0,
      state: actual > 0 ? "success" : "open",
      deadline: null,
    }
  }

  const target = targetFor(ctx.targets, range)
  const excusedDays = countExcusedDays(range, ctx.exceptions)
  const fullyExcused = excusedDays === rangeLength(range)

  // Not clamped at 0: a negative total means a correction outlived the entry it
  // corrected, and hiding that would make later entries look like they vanished.
  const actual =
    task.type === "limit"
      ? sumEvents(ctx.events, (d) => inRange(d, range) && !isExcused(d, ctx.exceptions))
      : sumEvents(ctx.events, (d) => inRange(d, range))

  const base = { period, range, target, actual, excusedDays }

  if (!target) return { ...base, goal: null, carried: 0, state: "open", deadline: null }
  if (fullyExcused) return { ...base, goal: 0, carried: 0, state: "excused", deadline: null }

  let goal =
    task.type === "accumulate"
      ? Math.ceil((target.amount * (rangeLength(range) - excusedDays)) / rangeLength(range))
      : target.amount

  let carried = 0
  if (withCarry && target.carryOver) {
    const prevRange = previousPeriodRange(period, range, settings.weekStartsOn)
    const prev = periodStatus(ctx, prevRange.start, today, false)
    if (prev.period === period && prev.goal !== null && prev.state !== "excused") {
      // Surplus for accumulate, overage for limit — both reduce this period's goal.
      carried = Math.max(0, prev.actual - prev.goal)
      goal = Math.max(0, goal - carried)
    }
  }

  let state: PeriodState
  if (task.type === "accumulate") {
    state = actual >= goal ? "success" : ended ? "failure" : "open"
  } else {
    state = actual > goal ? "failure" : ended ? "success" : "open"
  }

  const deadline = task.type === "accumulate" && task.dueTime ? deadlineFor(ctx, range, goal, actual, today) : null

  return { ...base, goal, carried, state, deadline }
}

/**
 * Compares wall-clock values only: each entry's localDate/localTime as recorded, the
 * due time, and the current wall clock. So a deadline means the same local time
 * wherever the user is, and traveling never re-times past entries.
 */
function deadlineFor(ctx: TaskContext, range: DateRange, goal: number, actual: number, today: LocalDate): Deadline {
  const { dayStartHour } = ctx.settings
  const time = ctx.task.dueTime!
  const date = range.end
  const due = minutesIntoDay(time, dayStartHour)
  const byDeadline = sumEvents(
    ctx.events.filter((e) => e.localDate < date || minutesIntoDay(e.localTime, dayStartHour) <= due),
    (d) => inRange(d, range),
  )
  const passed = date < today || (date === today && ctx.now !== undefined && minutesIntoDay(ctx.now, dayStartHour) > due)
  const state: DeadlineState =
    byDeadline >= goal ? "on_time" : !passed ? "pending" : actual >= goal ? "late" : "missed"
  return { date, time, state }
}

function createdDate(ctx: TaskContext): LocalDate {
  return toLocalDate(new Date(ctx.task.createdAt), ctx.settings.dayStartHour)
}

/** Periods from the current one backwards, stopping at the task's creation. */
export function periodHistory(ctx: TaskContext, today: LocalDate, maxPeriods: number): PeriodStatus[] {
  const created = createdDate(ctx)
  const history: PeriodStatus[] = []
  let date = today
  for (let i = 0; i < maxPeriods; i++) {
    const status = periodStatus(ctx, date, today)
    if (status.range.end < created) break
    history.push(status)
    date = addDays(status.range.start, -1)
  }
  return history
}

/**
 * Consecutive successful periods ending now. An open current period doesn't break
 * the streak, and excused periods are skipped. Stops at a change of period type.
 */
export function streak(ctx: TaskContext, today: LocalDate): number {
  const created = createdDate(ctx)
  const period = periodFor(ctx, today)
  let count = 0
  let date = today
  for (let i = 0; i < 5000; i++) {
    const status = periodStatus(ctx, date, today)
    if (status.range.end < created || status.period !== period) break
    if (ctx.task.type !== "track" && !status.target) break

    const isCurrent = i === 0
    if (status.state === "success") count++
    else if (status.state === "excused" || (isCurrent && status.state === "open")) {
      // neutral
    } else break

    date = addDays(status.range.start, -1)
  }
  return count
}

export function summarize(ctx: TaskContext, today: LocalDate): TaskSummary {
  return {
    current: periodStatus(ctx, today, today),
    today: sumEvents(ctx.events, (d) => d === today),
    total: sumEvents(ctx.events, () => true),
    streak: streak(ctx, today),
  }
}

export interface Overview {
  /** Tasks whose deadline has passed with the goal not met. */
  overdue: number
  /** Average completion (0–1) across tasks with a goal that aren't excused. */
  progress: number
  done: number
  remaining: number
  over: number
  /** Tasks counted in the totals above. */
  counted: number
  excused: number
}

/**
 * Progress across all tasks right now. Each task contributes its current period:
 * accumulate counts by fraction of its goal; a limit counts fully while within it.
 * Track tasks have no goal and are left out.
 */
export function overview(statuses: { task: Task; current: PeriodStatus }[]): Overview {
  const result: Overview = { progress: 0, done: 0, remaining: 0, over: 0, counted: 0, excused: 0, overdue: 0 }
  let sum = 0
  for (const { task, current } of statuses) {
    if (task.type === "track" || current.goal === null) continue
    if (current.state === "excused") {
      result.excused++
      continue
    }
    result.counted++
    sum += taskFraction(task, current) ?? 0
    if (current.deadline?.state === "missed") result.overdue++
    if (task.type === "accumulate") {
      if (current.state === "success") result.done++
      else result.remaining++
    } else if (current.state === "failure") {
      result.over++
    } else {
      result.done++
    }
  }
  result.progress = result.counted === 0 ? 0 : sum / result.counted
  return result
}

/**
 * How much of its goal a task has met (0–1): accumulate by fraction of the goal,
 * a limit fully while within it. Null when it has no goal or is excused.
 */
export function taskFraction(task: Task, current: PeriodStatus): number | null {
  if (task.type === "track" || current.goal === null || current.state === "excused") return null
  if (task.type === "limit") return current.state === "failure" ? 0 : 1
  return current.goal === 0 ? 1 : Math.min(1, Math.max(0, current.actual / current.goal))
}

/** True when a goal is "once per period", so the card shows a checkbox. Track tasks always count. */
export function isCheckbox(task: Task, target: TaskTarget | null): boolean {
  return task.type !== "track" && target?.amount === 1
}
