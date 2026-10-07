import { addDays, periodRange, toLocalDate } from "@/domain/dates"
import { periodHistory, type PeriodStatus } from "@/domain/status"
import type { LocalDate, Period, Task, WeekStart } from "@/domain/types"
import type { TaskView } from "@/hooks/useAppData"

/** How far back each chart range reaches, by the task's period. */
export const CHART_RANGES = {
  day: [14, 30, 90],
  week: [8, 26, 52],
  month: [6, 12, 24],
} satisfies Record<Period, number[]>

export interface ProgressPoint {
  label: string
  /** Amount counted toward the goal (track: the count). */
  actual: number
  /** The goal for that period, or null (track, or no target). */
  goal: number | null
  state: PeriodStatus["state"]
  current: boolean
}

/** A task's periods oldest first, for the bar chart in its detail sheet. */
export function progressSeries(view: TaskView, today: LocalDate, periods: number): ProgressPoint[] {
  return periodHistory(view.ctx, today, periods)
    .reverse()
    .map((s) => ({
      label: shortLabel(s.period, s.range.start),
      actual: s.actual,
      goal: s.goal,
      state: s.state,
      current: s.range.start <= today && today <= s.range.end,
    }))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function shortLabel(period: Period, start: LocalDate): string {
  const [, m, d] = start.split("-").map(Number)
  return period === "month" ? MONTHS[m - 1] : `${m}/${d}`
}

/** Entries by the hour they were made (wall clock where they were made), 0–23. */
export function entriesByHour(view: TaskView): number[] {
  const hours = Array<number>(24).fill(0)
  for (const e of view.ctx.events) {
    if (e.deletedAt || e.amount <= 0) continue
    const h = Number(e.localTime.slice(0, 2))
    if (h >= 0 && h < 24) hours[h]++
  }
  return hours
}

interface Outcome {
  task: Task
  end: LocalDate
  met: boolean
}

/**
 * Finished periods with a goal (met or missed) that ended on or after `since`.
 * Excused and still-open periods don't count, and neither do periods after a task was retired.
 */
function outcomes(views: TaskView[], today: LocalDate, since: LocalDate): Outcome[] {
  const result: Outcome[] = []
  for (const view of views) {
    if (view.task.type === "track") continue
    const retired = view.task.retiredAt
      ? toLocalDate(new Date(view.task.retiredAt), view.ctx.settings.dayStartHour)
      : null
    // A day task needs one period per day; longer periods need fewer.
    const days = Math.max(1, Math.round((parseDay(today) - parseDay(since)) / 86_400_000) + 1)
    for (const s of periodHistory(view.ctx, today, days)) {
      if (s.range.end < since) break
      if (s.goal === null || (s.state !== "success" && s.state !== "failure")) continue
      if (retired && s.range.end > retired) continue
      result.push({ task: view.task, end: s.range.end, met: s.state === "success" })
    }
  }
  return result
}

const parseDay = (d: LocalDate) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))

export interface WeekOutcome {
  label: string
  start: LocalDate
  met: number
  missed: number
}

/** Goals met and missed in each of the last `weeks` weeks (by the day each period ended), oldest first. */
export function weeklyOutcomes(
  views: TaskView[],
  today: LocalDate,
  weeks: number,
  weekStartsOn: WeekStart,
): WeekOutcome[] {
  const thisWeek = periodRange("week", today, weekStartsOn).start
  const buckets: WeekOutcome[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i)
    buckets.push({ label: shortLabel("week", start), start, met: 0, missed: 0 })
  }
  for (const o of outcomes(views, today, buckets[0].start)) {
    const bucket = buckets.findLast((b) => b.start <= o.end)
    if (!bucket) continue
    if (o.met) bucket.met++
    else bucket.missed++
  }
  return buckets
}

export interface TaskRate {
  task: Task
  met: number
  total: number
  /** 0–100 */
  rate: number
}

/** Each task's share of finished periods met since `since`, best first. Tasks with none are left out. */
export function taskRates(views: TaskView[], today: LocalDate, since: LocalDate): TaskRate[] {
  const byTask = new Map<string, TaskRate>()
  for (const o of outcomes(views, today, since)) {
    const r = byTask.get(o.task.id) ?? { task: o.task, met: 0, total: 0, rate: 0 }
    r.total++
    if (o.met) r.met++
    byTask.set(o.task.id, r)
  }
  return [...byTask.values()]
    .map((r) => ({ ...r, rate: Math.round((r.met / r.total) * 100) }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total || a.task.name.localeCompare(b.task.name))
}
