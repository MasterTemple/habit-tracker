import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS, type Task, type TaskEvent, type TaskTarget, type TaskType } from "@/domain/types"
import { entriesByHour, progressSeries, taskRates, weeklyOutcomes } from "./insights"
import { deriveTaskViews } from "./taskViews"

// 2026-10-07 is a Wednesday; with weekStartsOn 0 the week is Oct 4 – Oct 10.
const TODAY = "2026-10-07"
const settings = { ...DEFAULT_SETTINGS, weekStartsOn: 0 as const, dayStartHour: 0 }

function task(id: string, type: TaskType, opts: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    description: "",
    type,
    icon: "circle",
    color: "#000",
    unit: "",
    dueTime: null,
    sortOrder: 0,
    incrementAmounts: [1],
    displayMode: "period",
    createdAt: "2026-09-20T12:00:00",
    updatedAt: "",
    retiredAt: null,
    createdFromId: null,
    categoryIds: [],
    ...opts,
  }
}

const target = (taskId: string, amount: number, period: TaskTarget["period"] = "day"): TaskTarget => ({
  id: `target-${taskId}`,
  taskId,
  period,
  amount,
  carryOver: false,
  effectiveFrom: "2026-01-01",
  updatedAt: "",
})

let n = 0
const ev = (taskId: string, localDate: string, amount = 1, localTime = "08:15"): TaskEvent => ({
  id: `e${n++}`,
  taskId,
  amount,
  occurredAt: `${localDate}T12:00:00Z`,
  localDate,
  localTime,
  timeZone: "",
  note: "",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
})

const views = (tasks: Task[], targets: TaskTarget[], events: TaskEvent[]) =>
  deriveTaskViews({ settings, tasks, targets, events, categories: [], exceptions: [] }, TODAY, "12:00")

describe("progressSeries", () => {
  it("lists periods oldest first, marking the current one", () => {
    const [v] = views([task("a", "accumulate")], [target("a", 2)], [ev("a", "2026-10-05", 2), ev("a", "2026-10-07")])
    const series = progressSeries(v, TODAY, 3)
    expect(series.map((p) => [p.label, p.actual, p.goal, p.state, p.current])).toEqual([
      ["10/5", 2, 2, "success", false],
      ["10/6", 0, 2, "failure", false],
      ["10/7", 1, 2, "open", true],
    ])
  })

  it("stops at the task's creation", () => {
    const [v] = views([task("a", "accumulate", { createdAt: "2026-10-06T12:00:00" })], [target("a", 1)], [])
    expect(progressSeries(v, TODAY, 14)).toHaveLength(2)
  })
})

it("counts entries by the hour they were made, ignoring corrections", () => {
  const [v] = views(
    [task("a", "accumulate")],
    [target("a", 1)],
    [
      ev("a", "2026-10-05", 1, "08:15"),
      ev("a", "2026-10-06", 1, "08:59"),
      ev("a", "2026-10-06", -1, "21:00"),
      ev("a", "2026-10-07", 3, "21:30"),
    ],
  )
  const hours = entriesByHour(v)
  expect(hours[8]).toBe(2)
  expect(hours[21]).toBe(1)
  expect(hours.reduce((a, b) => a + b)).toBe(3)
})

describe("weekly outcomes and rates", () => {
  const all = views(
    [
      task("daily", "accumulate"),
      task("limit", "limit"),
      task("counter", "track"),
      task("old", "accumulate", { retiredAt: "2026-09-30T12:00:00" }),
    ],
    [target("daily", 1), target("limit", 1), target("counter", 1), target("old", 1)],
    [
      // daily: met Sep 27, 28; missed the rest of that week; met Oct 4, 5; missed Oct 6; today is still open.
      ev("daily", "2026-09-27"),
      ev("daily", "2026-09-28"),
      ev("daily", "2026-10-04"),
      ev("daily", "2026-10-05"),
      // limit: over on Oct 5 only.
      ev("limit", "2026-10-05", 2),
      ev("counter", "2026-10-05", 5),
    ],
  )

  it("buckets finished periods by the week they ended in, leaving out open, track, and post-retirement periods", () => {
    const weeks = weeklyOutcomes(all, TODAY, 2, 0)
    expect(weeks.map((w) => [w.label, w.met, w.missed])).toEqual([
      // Sep 27 – Oct 3: daily 2 met + 5 missed; limit 7 met; old: Sep 27–30 missed (4), nothing after retiring.
      ["9/27", 9, 9],
      // Oct 4 – 6 (7th is open): daily 2 met + 1 missed; limit 2 met + 1 missed.
      ["10/4", 4, 2],
    ])
  })

  it("ranks tasks by their share of goals met", () => {
    const rates = taskRates(all, TODAY, "2026-10-01")
    expect(rates.map((r) => [r.task.id, r.met, r.total, r.rate])).toEqual([
      ["limit", 5, 6, 83],
      ["daily", 2, 6, 33],
    ])
  })
})
