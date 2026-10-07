/// <reference types="node" />
// Generate and check in UTC so the fixture doesn't depend on this machine's time zone
// (the server evaluates with an explicit zone; UTC is its default). Node re-reads TZ on assignment.
process.env.TZ = "UTC"

// Shared conformance cases: the server's Rust port (server/core) must produce exactly
// these outputs. This test checks the TypeScript implementation against
// fixtures/core.json; run with UPDATE_FIXTURES=1 to regenerate it after an
// intentional rule change (then make the Rust tests pass again).
import { format } from "date-fns"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"
import { endOfDuration, minutesIntoDay, periodRange, toLocalDate, type DurationUnit } from "./dates"
import { progressReadyToAlert } from "./notify"
import { describeSchedule, nextRun } from "./schedule"
import { exceptionsForTask, overview, periodHistory, periodStatus, summarize, type TaskContext } from "./status"
import {
  DEFAULT_SETTINGS,
  type Period,
  type Schedule,
  type Settings,
  type Task,
  type TaskEvent,
  type TaskException,
  type TaskTarget,
  type TaskType,
  type WeekStart,
} from "./types"

const FIXTURE = join(import.meta.dirname, "../../fixtures/core.json")
const TODAY = "2026-10-07" // a Wednesday

// ---------- builders (deterministic ids so the fixture is stable) ----------

function task(type: TaskType, extra: Partial<Task> = {}): Task {
  return {
    id: "t1",
    name: "Task",
    description: "",
    type,
    icon: "circle",
    color: "#000000",
    unit: "",
    dueTime: null,
    sortOrder: 0,
    incrementAmounts: [1],
    displayMode: "period",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    retiredAt: null,
    createdFromId: null,
    categoryIds: [],
    ...extra,
  }
}

function target(period: Period, amount: number, extra: Partial<TaskTarget> = {}): TaskTarget {
  return {
    id: `target-${period}-${amount}-${extra.effectiveFrom ?? "2026-01-01"}`,
    taskId: "t1",
    period,
    amount,
    carryOver: false,
    effectiveFrom: "2026-01-01",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  }
}

let n = 0
function ev(localDate: string, amount = 1, extra: Partial<TaskEvent> = {}): TaskEvent {
  n++
  return {
    id: `e${n}`,
    taskId: "t1",
    amount,
    occurredAt: `${localDate}T12:00:00.000Z`,
    localDate,
    localTime: "12:00",
    timeZone: "",
    note: "",
    createdAt: `${localDate}T12:00:00.000Z`,
    updatedAt: `${localDate}T12:00:00.000Z`,
    deletedAt: null,
    ...extra,
  }
}

function brk(startDate: string, endDate: string, extra: Partial<TaskException> = {}): TaskException {
  return {
    id: `x-${startDate}-${endDate}`,
    appliesToAll: false,
    taskIds: ["t1"],
    categoryIds: [],
    startDate,
    endDate,
    description: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...extra,
  }
}

interface StatusCase {
  name: string
  ctx: TaskContext
  /** Dates to compute periodStatus for, besides today. */
  dates: string[]
}

function c(name: string, partial: Partial<TaskContext> & Pick<TaskContext, "task">, dates: string[] = []): StatusCase {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...partial.settings }
  return { name, ctx: { targets: [], events: [], exceptions: [], ...partial, settings }, dates }
}

const statusCases: StatusCase[] = [
  c("accumulate daily, partial", { task: task("accumulate"), targets: [target("day", 100)], events: [ev(TODAY, 10), ev(TODAY, 50), ev(TODAY, 40, { deletedAt: "x" })] }),
  c("accumulate daily, met and history", { task: task("accumulate"), targets: [target("day", 1)], events: [ev("2026-10-04"), ev("2026-10-05"), ev("2026-10-06"), ev(TODAY)] }, ["2026-10-03", "2026-10-05"]),
  c("accumulate negative correction outlives entry", { task: task("accumulate"), targets: [target("day", 100)], events: [ev(TODAY, 10, { deletedAt: "x" }), ev(TODAY, -10)] }),
  c("accumulate weekly, past failure", { task: task("accumulate"), targets: [target("week", 3)], events: [ev("2026-09-28", 2), ev(TODAY)] }, ["2026-09-28"]),
  c("accumulate monthly", { task: task("accumulate", { unit: "page" }), targets: [target("month", 30)], events: [ev("2026-10-01", 12), ev("2026-09-30", 40)] }, ["2026-09-15"]),
  c("week starts Monday", { task: task("accumulate"), targets: [target("week", 2)], events: [ev("2026-10-04"), ev("2026-10-05")], settings: { ...DEFAULT_SETTINGS, weekStartsOn: 1 } }),
  c("limit over", { task: task("limit"), targets: [target("week", 3)], events: [ev("2026-10-04"), ev("2026-10-05", 3)] }),
  c("limit never, streak from creation", { task: task("limit", { createdAt: "2026-10-03T08:00:00.000Z" }), targets: [target("day", 0)] }, ["2026-10-06"]),
  c("limit never, broken", { task: task("limit", { createdAt: "2026-10-01T08:00:00.000Z" }), targets: [target("day", 0)], events: [ev("2026-10-05")] }),
  c("track daily", { task: task("track"), events: [ev(TODAY, 2)] }, ["2026-10-06"]),
  c("track weekly", { task: task("track"), targets: [target("week", 0)], events: [ev("2026-10-04", 2), ev(TODAY, 3)] }),
  c("break prorates weekly goal", { task: task("accumulate"), targets: [target("week", 3)], exceptions: [brk("2026-10-04", "2026-10-06")] }),
  c("break excuses whole day", { task: task("accumulate"), targets: [target("day", 100)], exceptions: [brk(TODAY, TODAY)] }),
  c("break ignores limit entries", { task: task("limit"), targets: [target("week", 3)], events: [ev("2026-10-04", 5), ev(TODAY)], exceptions: [brk("2026-10-04", "2026-10-04")] }),
  c("break keeps streak", { task: task("accumulate"), targets: [target("day", 1)], events: [ev("2026-10-06"), ev("2026-10-04")], exceptions: [brk("2026-10-05", "2026-10-05")] }),
  c("carry accumulate surplus", { task: task("accumulate"), targets: [target("week", 3, { carryOver: true })], events: [ev("2026-09-28", 5)] }),
  c("carry limit overage", { task: task("limit"), targets: [target("week", 3, { carryOver: true })], events: [ev("2026-09-28", 5)] }),
  c("carry only one period back", { task: task("accumulate"), targets: [target("week", 3, { carryOver: true })], events: [ev("2026-09-21", 10)] }),
  c("carry off by default", { task: task("accumulate"), targets: [target("week", 3)], events: [ev("2026-09-28", 5)] }),
  c("target versions", {
    task: task("accumulate"),
    targets: [target("week", 3), target("week", 5, { effectiveFrom: "2026-10-04" })],
    events: [ev("2026-09-29", 3), ev(TODAY, 2)],
  }, ["2026-09-29"]),
  c("task created mid-period", { task: task("accumulate", { createdAt: "2026-10-06T08:00:00.000Z" }), targets: [target("week", 3, { effectiveFrom: "2026-10-06" })], events: [ev(TODAY)] }),
  c("period type change stops streak", {
    task: task("accumulate"),
    targets: [target("day", 1), target("week", 1, { effectiveFrom: "2026-10-04" })],
    events: [ev("2026-10-01"), ev("2026-10-02"), ev("2026-10-03"), ev("2026-10-05")],
  }),
  c("deadline pending", { task: task("accumulate", { dueTime: "09:00" }), targets: [target("day", 1)], now: "08:30" }),
  c("deadline missed", { task: task("accumulate", { dueTime: "09:00" }), targets: [target("day", 1)], now: "09:30" }, ["2026-10-05"]),
  c("deadline unknown now", { task: task("accumulate", { dueTime: "09:00" }), targets: [target("day", 1)] }),
  c("deadline on time", { task: task("accumulate", { dueTime: "09:00" }), targets: [target("day", 1)], now: "10:00", events: [ev(TODAY, 1, { localTime: "08:45" })] }),
  c("deadline late", { task: task("accumulate", { dueTime: "09:00" }), targets: [target("day", 1)], now: "10:00", events: [ev(TODAY, 1, { localTime: "09:15" }), ev("2026-10-05", 1, { localTime: "21:00" })] }, ["2026-10-05"]),
  c("deadline late night with 3am day start", {
    task: task("accumulate", { dueTime: "23:00" }),
    targets: [target("day", 1)],
    now: "02:00",
    events: [ev(TODAY, 1, { localTime: "01:00" })],
    settings: { ...DEFAULT_SETTINGS, dayStartHour: 3 },
  }),
  c("deadline after midnight with 3am day start", { task: task("accumulate", { dueTime: "02:00" }), targets: [target("day", 1)], now: "23:00", settings: { ...DEFAULT_SETTINGS, dayStartHour: 3 } }),
  c("deadline weekly", { task: task("accumulate", { dueTime: "18:00" }), targets: [target("week", 3)], now: "19:00", events: [ev("2026-10-04", 1, { localTime: "07:00" })] }),
  c("deadline ignored on limits", { task: task("limit", { dueTime: "09:00" }), targets: [target("day", 1)], now: "10:00" }),
  c("deadline ignored when excused", { task: task("accumulate", { dueTime: "09:00" }), targets: [target("day", 1)], now: "10:00", exceptions: [brk(TODAY, TODAY)] }),
]

const exceptionScopes = [
  brk("2026-10-01", "2026-10-02", { id: "all", appliesToAll: true, taskIds: [] }),
  brk("2026-10-01", "2026-10-02", { id: "cat", taskIds: [], categoryIds: ["cat0", "cat1"] }),
  brk("2026-10-01", "2026-10-02", { id: "task", taskIds: ["other", "t1"] }),
  brk("2026-10-01", "2026-10-02", { id: "none", taskIds: ["other"], categoryIds: ["cat2"] }),
  brk("2026-10-01", "2026-10-02", { id: "deleted", appliesToAll: true, deletedAt: "x" }),
]

const schedules: { schedule: Schedule; from: string }[] = [
  { schedule: { repeat: "daily", time: "18:00", weekdays: [], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "daily", time: "08:00", weekdays: [], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "daily", time: "12:00", weekdays: [], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "weekly", time: "18:00", weekdays: [6], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "weekly", time: "08:00", weekdays: [2], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "weekly", time: "18:00", weekdays: [5, 1, 2, 3, 4], monthDay: 1 }, from: "2026-10-09T19:00" },
  { schedule: { repeat: "weekly", time: "18:00", weekdays: [0, 6], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "weekly", time: "18:00", weekdays: [0, 1, 2, 3, 4, 5, 6], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "weekly", time: "18:00", weekdays: [], monthDay: 1 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "monthly", time: "18:00", weekdays: [], monthDay: 31 }, from: "2026-10-06T12:00" },
  { schedule: { repeat: "monthly", time: "18:00", weekdays: [], monthDay: 31 }, from: "2026-11-01T00:00" },
  { schedule: { repeat: "monthly", time: "09:05", weekdays: [], monthDay: 22 }, from: "2026-10-22T09:05" },
  { schedule: { repeat: "monthly", time: "00:00", weekdays: [], monthDay: 11 }, from: "2026-12-31T23:59" },
  { schedule: { repeat: "monthly", time: "18:00", weekdays: [], monthDay: 1 }, from: "2026-10-06T12:00" },
]

// ---------- outputs ----------

const naive = (s: string) => {
  const [d, t] = s.split("T")
  const [y, mo, da] = d.split("-").map(Number)
  const [h, mi] = t.split(":").map(Number)
  return new Date(y, mo - 1, da, h, mi)
}
const fmtNaive = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")

function compute() {
  return {
    today: TODAY,
    status: statusCases.map(({ name, ctx, dates }) => ({
      name,
      ctx,
      statuses: Object.fromEntries([TODAY, ...dates].map((d) => [d, periodStatus(ctx, d, TODAY)])),
      summary: summarize(ctx, TODAY),
      history: periodHistory(ctx, TODAY, 10),
    })),
    overview: {
      cases: statusCases.map((s) => s.name),
      result: overview(statusCases.map(({ ctx }) => ({ task: ctx.task, current: periodStatus(ctx, TODAY, TODAY) }))),
    },
    exceptionsForTask: {
      exceptions: exceptionScopes,
      taskId: "t1",
      categoryIds: ["cat1"],
      result: exceptionsForTask("t1", ["cat1"], exceptionScopes).map((e) => e.id),
    },
    periodRange: (["day", "week", "month"] as Period[]).flatMap((period) =>
      ["2026-10-07", "2026-10-04", "2026-10-03", "2026-02-28", "2028-02-29", "2026-12-31"].flatMap((date) =>
        ([0, 1, 6] as WeekStart[]).map((weekStartsOn) => ({
          period,
          date,
          weekStartsOn,
          result: periodRange(period, date, weekStartsOn),
        })),
      ),
    ),
    toLocalDate: ["2026-10-07T01:30", "2026-10-07T03:00", "2026-10-07T23:59", "2026-01-01T00:30"].flatMap((moment) =>
      [0, 3].map((dayStartHour) => ({ moment, dayStartHour, result: toLocalDate(naive(moment), dayStartHour) })),
    ),
    minutesIntoDay: ["00:00", "01:00", "03:00", "09:00", "23:59"].flatMap((time) =>
      [0, 3].map((dayStartHour) => ({ time, dayStartHour, result: minutesIntoDay(time, dayStartHour) })),
    ),
    endOfDuration: [
      ["2026-10-06", 3, "day"],
      ["2026-10-06", 1, "day"],
      ["2026-10-06", 0, "day"],
      ["2026-10-06", 1, "week"],
      ["2026-10-06", 2, "week"],
      ["2026-10-06", 1, "month"],
      ["2026-01-31", 1, "month"],
      ["2026-12-15", 3, "month"],
    ].map(([start, count, unit]) => ({
      start,
      count,
      unit,
      result: endOfDuration(start as string, count as number, unit as DurationUnit),
    })),
    schedules: schedules.map(({ schedule, from }) => {
      const next = nextRun(schedule, naive(from))
      return { schedule, from, describe: describeSchedule(schedule), next: next ? fmtNaive(next) : null }
    }),
    progressReadyToAlert: (() => {
      const events = [
        ev("2026-10-06", 1, { id: "sent", createdAt: "2026-10-06T11:58:30.000Z" }),
        ev("2026-10-06", 1, { id: "young", createdAt: "2026-10-06T11:59:30.000Z" }),
        ev("2026-10-06", 1, { id: "undone", createdAt: "2026-10-06T11:58:40.000Z", deletedAt: "2026-10-06T11:58:50.000Z" }),
        ev("2026-10-06", 1, { id: "old", createdAt: "2026-10-06T11:50:00.000Z" }),
      ]
      return [
        ["2026-10-06T11:59:00.000Z", "2026-10-06T12:00:00.000Z"],
        ["2026-10-06T12:00:00.000Z", "2026-10-06T12:01:00.000Z"],
      ].map(([since, now]) => ({
        events,
        since,
        now,
        result: progressReadyToAlert(events, new Date(since), new Date(now)).map((e) => e.id),
      }))
    })(),
  }
}

it("matches the shared conformance fixture", () => {
  const actual = JSON.parse(JSON.stringify(compute()))
  if (process.env.UPDATE_FIXTURES || !existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 1)}\n`)
  }
  expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")))
})
