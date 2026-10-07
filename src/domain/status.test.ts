import { describe, expect, it } from "vitest"
import { endOfDuration, minutesIntoDay, periodRange, toLocalDate } from "./dates"
import { exceptionsForTask, overview, periodHistory, periodStatus, streak, summarize, targetFor, type TaskContext } from "./status"
import {
  DEFAULT_SETTINGS,
  type Period,
  type Task,
  type TaskEvent,
  type TaskException,
  type TaskTarget,
  type TaskType,
} from "./types"

// 2026-10-07 is a Wednesday; with weekStartsOn 0 the week is Oct 4 – Oct 10.
const TODAY = "2026-10-07"

function task(type: TaskType, createdAt = "2026-01-01T12:00:00"): Task {
  return {
    id: "t1",
    name: "Test",
    description: "",
    type,
    icon: "circle",
    color: "#000",
    unit: "",
    dueTime: null,
    sortOrder: 0,
    incrementAmounts: [1],
    displayMode: "period",
    createdAt,
    updatedAt: createdAt,
    retiredAt: null,
    createdFromId: null,
  }
}

function target(period: Period, amount: number, opts: Partial<TaskTarget> = {}): TaskTarget {
  return {
    id: `target-${period}-${amount}`,
    taskId: "t1",
    period,
    amount,
    carryOver: false,
    effectiveFrom: "2026-01-01",
    updatedAt: "",
    ...opts,
  }
}

let eventId = 0
function ev(localDate: string, amount = 1, deleted = false, localTime = "12:00"): TaskEvent {
  return {
    id: `e${eventId++}`,
    taskId: "t1",
    amount,
    occurredAt: `${localDate}T12:00:00Z`,
    localDate,
    localTime,
    timeZone: "",
    note: "",
    createdAt: "",
    updatedAt: "",
    deletedAt: deleted ? "x" : null,
  }
}

function exception(startDate: string, endDate: string, opts: Partial<TaskException> = {}): TaskException {
  return {
    id: `x-${startDate}`,
    appliesToAll: false,
    taskIds: ["t1"],
    categoryIds: [],
    startDate,
    endDate,
    description: "",
    updatedAt: "",
    deletedAt: null,
    ...opts,
  }
}

function ctx(partial: Partial<TaskContext> & Pick<TaskContext, "task">): TaskContext {
  return { targets: [], events: [], exceptions: [], settings: DEFAULT_SETTINGS, ...partial }
}

describe("dates", () => {
  it("shifts early-morning moments to the previous day with dayStartHour", () => {
    const lateNight = new Date(2026, 9, 7, 1, 30)
    expect(toLocalDate(lateNight, 0)).toBe("2026-10-07")
    expect(toLocalDate(lateNight, 3)).toBe("2026-10-06")
  })

  it("counts minutes from the configured start of day", () => {
    expect(minutesIntoDay("09:00")).toBe(540)
    expect(minutesIntoDay("01:00", 3)).toBe(22 * 60)
    expect(minutesIntoDay("03:00", 3)).toBe(0)
  })

  it("computes inclusive end dates for durations", () => {
    expect(endOfDuration("2026-10-06", 3, "day")).toBe("2026-10-08")
    expect(endOfDuration("2026-10-06", 1, "day")).toBe("2026-10-06")
    expect(endOfDuration("2026-10-06", 1, "week")).toBe("2026-10-12")
    expect(endOfDuration("2026-10-06", 1, "month")).toBe("2026-11-05")
    expect(endOfDuration("2026-01-31", 1, "month")).toBe("2026-02-27")
  })

  it("computes week ranges respecting weekStartsOn", () => {
    expect(periodRange("week", TODAY, 0)).toEqual({ start: "2026-10-04", end: "2026-10-10" })
    expect(periodRange("week", TODAY, 1)).toEqual({ start: "2026-10-05", end: "2026-10-11" })
    expect(periodRange("month", TODAY, 0)).toEqual({ start: "2026-10-01", end: "2026-10-31" })
  })
})

describe("targetFor", () => {
  it("uses the version in effect at the period start", () => {
    const old = target("week", 3, { id: "old", effectiveFrom: "2026-01-01" })
    const next = target("week", 5, { id: "new", effectiveFrom: "2026-10-04" })
    expect(targetFor([next, old], { start: "2026-09-27", end: "2026-10-03" })?.id).toBe("old")
    expect(targetFor([next, old], { start: "2026-10-04", end: "2026-10-10" })?.id).toBe("new")
  })

  it("falls back to a version starting mid-period for new tasks", () => {
    const t = target("week", 3, { effectiveFrom: "2026-10-06" })
    expect(targetFor([t], { start: "2026-10-04", end: "2026-10-10" })).toBe(t)
  })
})

describe("periodStatus", () => {
  it("sums accumulate events and ignores deleted ones", () => {
    const c = ctx({
      task: task("accumulate"),
      targets: [target("day", 100)],
      events: [ev(TODAY, 10), ev(TODAY, 50), ev(TODAY, 40, true), ev("2026-10-06", 100)],
    })
    const s = periodStatus(c, TODAY, TODAY)
    expect(s.actual).toBe(60)
    expect(s.goal).toBe(100)
    expect(s.state).toBe("open")
  })

  it("applies negative correction events", () => {
    const c = ctx({ task: task("accumulate"), targets: [target("day", 10)], events: [ev(TODAY, 10), ev(TODAY, -5)] })
    expect(periodStatus(c, TODAY, TODAY).actual).toBe(5)
  })

  it("shows a negative total when a correction outlives the entry it corrected", () => {
    // +10, then −10, then the +10 is deleted.
    const c = ctx({ task: task("accumulate"), targets: [target("day", 100)], events: [ev(TODAY, 10, true), ev(TODAY, -10)] })
    expect(periodStatus(c, TODAY, TODAY).actual).toBe(-10)
    expect(summarize(c, TODAY).today).toBe(-10)
  })

  it("marks past accumulate periods below goal as failed", () => {
    const c = ctx({ task: task("accumulate"), targets: [target("week", 3)], events: [ev("2026-09-28", 2)] })
    expect(periodStatus(c, "2026-09-28", TODAY).state).toBe("failure")
  })

  it("fails a limit as soon as it is exceeded", () => {
    const c = ctx({ task: task("limit"), targets: [target("week", 3)], events: [ev("2026-10-04"), ev("2026-10-05", 3)] })
    const s = periodStatus(c, TODAY, TODAY)
    expect(s.actual).toBe(4)
    expect(s.state).toBe("failure")
  })

  it("treats a past limit period within the allowance as success", () => {
    const c = ctx({ task: task("limit"), targets: [target("day", 0)] })
    expect(periodStatus(c, "2026-10-06", TODAY).state).toBe("success")
    expect(periodStatus(c, TODAY, TODAY).state).toBe("open")
  })

  it("counts track tasks over their target's period", () => {
    const c = ctx({ task: task("track"), targets: [target("week", 0)], events: [ev("2026-10-04", 2), ev(TODAY, 3)] })
    const s = periodStatus(c, TODAY, TODAY)
    expect(s.period).toBe("week")
    expect(s.actual).toBe(5)
    expect(s.goal).toBeNull()
  })

  it("treats track tasks as done when any event exists", () => {
    const c = ctx({ task: task("track"), events: [ev(TODAY)] })
    expect(periodStatus(c, TODAY, TODAY).state).toBe("success")
    expect(periodStatus(c, "2026-10-06", TODAY).state).toBe("open")
  })
})

describe("exceptions", () => {
  it("prorates accumulate goals by non-excused days, rounding up", () => {
    // 3/week with 3 of 7 days excused → ceil(3 * 4/7) = 2
    const c = ctx({
      task: task("accumulate"),
      targets: [target("week", 3)],
      exceptions: [exception("2026-10-04", "2026-10-06")],
    })
    const s = periodStatus(c, TODAY, TODAY)
    expect(s.excusedDays).toBe(3)
    expect(s.goal).toBe(2)
  })

  it("excuses fully covered periods", () => {
    const c = ctx({ task: task("accumulate"), targets: [target("day", 100)], exceptions: [exception(TODAY, TODAY)] })
    expect(periodStatus(c, TODAY, TODAY).state).toBe("excused")
  })

  it("does not count limit events on excused days", () => {
    const c = ctx({
      task: task("limit"),
      targets: [target("week", 3)],
      events: [ev("2026-10-04", 5), ev(TODAY, 1)],
      exceptions: [exception("2026-10-04", "2026-10-04")],
    })
    const s = periodStatus(c, TODAY, TODAY)
    expect(s.actual).toBe(1)
    expect(s.state).toBe("open")
  })

  it("matches exceptions by task, category, or all", () => {
    const list = [
      exception("2026-10-01", "2026-10-02", { id: "a", appliesToAll: true, taskIds: [] }),
      exception("2026-10-01", "2026-10-02", { id: "c", taskIds: [], categoryIds: ["cat0", "cat1"] }),
      exception("2026-10-01", "2026-10-02", { id: "t", taskIds: ["other", "t1"] }),
      exception("2026-10-01", "2026-10-02", { id: "x", taskIds: ["other"], categoryIds: ["cat2"] }),
      exception("2026-10-01", "2026-10-02", { id: "d", appliesToAll: true, deletedAt: "x" }),
    ]
    expect(exceptionsForTask("t1", ["cat1"], list).map((e) => e.id)).toEqual(["a", "c", "t"])
  })
})

describe("carry-over", () => {
  it("lets accumulate surplus reduce the next goal", () => {
    const c = ctx({
      task: task("accumulate"),
      targets: [target("week", 3, { carryOver: true })],
      events: [ev("2026-09-28", 5)],
    })
    const s = periodStatus(c, TODAY, TODAY)
    expect(s.carried).toBe(2)
    expect(s.goal).toBe(1)
  })

  it("lets limit overage reduce the next allowance", () => {
    const c = ctx({
      task: task("limit"),
      targets: [target("week", 3, { carryOver: true })],
      events: [ev("2026-09-28", 5)],
    })
    expect(periodStatus(c, TODAY, TODAY).goal).toBe(1)
  })

  it("does not roll unused limit allowance forward", () => {
    const c = ctx({ task: task("limit"), targets: [target("week", 3, { carryOver: true })] })
    expect(periodStatus(c, TODAY, TODAY).goal).toBe(3)
  })

  it("only reaches back one period", () => {
    const c = ctx({
      task: task("accumulate"),
      targets: [target("week", 3, { carryOver: true })],
      events: [ev("2026-09-21", 10)], // two weeks ago
    })
    expect(periodStatus(c, TODAY, TODAY).goal).toBe(3)
  })

  it("is off unless the target enables it", () => {
    const c = ctx({ task: task("accumulate"), targets: [target("week", 3)], events: [ev("2026-09-28", 5)] })
    expect(periodStatus(c, TODAY, TODAY).goal).toBe(3)
  })
})

describe("streak", () => {
  it("counts consecutive successes and ignores an open current period", () => {
    const c = ctx({
      task: task("accumulate"),
      targets: [target("day", 1)],
      events: [ev("2026-10-04"), ev("2026-10-05"), ev("2026-10-06")],
    })
    expect(streak(c, TODAY)).toBe(3)
    expect(streak({ ...c, events: [...c.events, ev(TODAY)] }, TODAY)).toBe(4)
  })

  it("stops at a failure", () => {
    const c = ctx({ task: task("accumulate"), targets: [target("day", 1)], events: [ev("2026-10-06"), ev("2026-10-04")] })
    expect(streak(c, TODAY)).toBe(1)
  })

  it("skips excused periods without breaking", () => {
    const c = ctx({
      task: task("accumulate"),
      targets: [target("day", 1)],
      events: [ev("2026-10-06"), ev("2026-10-04")],
      exceptions: [exception("2026-10-05", "2026-10-05")],
    })
    expect(streak(c, TODAY)).toBe(2)
  })

  it("counts days under a never-limit back to task creation", () => {
    const c = ctx({ task: task("limit", "2026-10-03T08:00:00"), targets: [target("day", 0)] })
    expect(streak(c, TODAY)).toBe(4) // Oct 3–6; today is still open
    expect(streak({ ...c, events: [ev("2026-10-05")] }, TODAY)).toBe(1)
  })
})

describe("summarize / history", () => {
  it("reports today, period, and total amounts", () => {
    const c = ctx({
      task: task("accumulate"),
      targets: [target("week", 10)],
      events: [ev(TODAY, 2), ev("2026-10-05", 3), ev("2026-09-01", 4)],
    })
    const s = summarize(c, TODAY)
    expect(s.today).toBe(2)
    expect(s.current.actual).toBe(5)
    expect(s.total).toBe(9)
  })

  it("lists periods back to creation", () => {
    const c = ctx({ task: task("accumulate", "2026-10-05T08:00:00"), targets: [target("day", 1)] })
    expect(periodHistory(c, TODAY, 30).map((p) => p.range.start)).toEqual(["2026-10-07", "2026-10-06", "2026-10-05"])
  })
})

describe("overview", () => {
  const status = (type: TaskType, goal: number | null, actual: number, state: "open" | "success" | "failure" | "excused") => ({
    task: task(type),
    current: { period: "day" as const, range: { start: TODAY, end: TODAY }, target: null, goal, carried: 0, actual, excusedDays: 0, state, deadline: null },
  })

  it("averages accumulate fractions and counts limits within their allowance as done", () => {
    const o = overview([
      status("accumulate", 100, 50, "open"),
      status("accumulate", 1, 1, "success"),
      status("limit", 3, 1, "open"),
      status("limit", 0, 1, "failure"),
      status("track", null, 1, "success"),
      status("accumulate", 0, 0, "excused"),
    ])
    expect(o).toEqual({ progress: (0.5 + 1 + 1 + 0) / 4, done: 2, remaining: 1, over: 1, counted: 4, excused: 1, overdue: 0 })
  })

  it("does not let negative totals subtract from overall progress", () => {
    expect(overview([status("accumulate", 10, -5, "open")]).progress).toBe(0)
  })
})

describe("due times", () => {
  const due = (time: string, extra: Partial<TaskContext> = {}) =>
    ctx({ task: { ...task("accumulate"), dueTime: time }, targets: [target("day", 1)], ...extra })

  it("is pending before the deadline and missed after it", () => {
    expect(periodStatus(due("09:00", { now: "08:30" }), TODAY, TODAY).deadline?.state).toBe("pending")
    expect(periodStatus(due("09:00", { now: "09:30" }), TODAY, TODAY).deadline?.state).toBe("missed")
    // Without a known current time, today's deadline isn't treated as passed.
    expect(periodStatus(due("09:00"), TODAY, TODAY).deadline?.state).toBe("pending")
  })

  it("is on time when entries before the due time meet the goal", () => {
    const c = due("09:00", { now: "10:00", events: [ev(TODAY, 1, false, "08:45")] })
    expect(periodStatus(c, TODAY, TODAY).deadline?.state).toBe("on_time")
  })

  it("is late when the goal is only met after the due time, without failing the goal", () => {
    const c = due("09:00", { now: "10:00", events: [ev(TODAY, 1, false, "09:15")] })
    const s = periodStatus(c, TODAY, TODAY)
    expect(s.deadline?.state).toBe("late")
    expect(s.state).toBe("success")
  })

  it("marks past periods missed or late regardless of the current time", () => {
    expect(periodStatus(due("09:00", { now: "00:01" }), "2026-10-05", TODAY).deadline?.state).toBe("missed")
    const c = due("09:00", { now: "00:01", events: [ev("2026-10-05", 1, false, "21:00")] })
    expect(periodStatus(c, "2026-10-05", TODAY).deadline?.state).toBe("late")
  })

  it("uses wall-clock times as recorded, so changing time zones doesn't re-time entries", () => {
    // Logged at 08:30 local (e.g. in New York); the stored localTime stays 08:30 after flying to LA.
    const c = due("09:00", { now: "07:00", events: [{ ...ev(TODAY, 1, false, "08:30"), occurredAt: `${TODAY}T12:30:00Z`, timeZone: "America/New_York" }] })
    expect(periodStatus(c, TODAY, TODAY).deadline?.state).toBe("on_time")
  })

  it("treats late-night entries as the end of the day when the day starts later", () => {
    const settings = { ...DEFAULT_SETTINGS, dayStartHour: 3 }
    // Due 23:00; an entry at 01:00 (still "today" until 3 AM) is after the deadline, not before.
    const late = due("23:00", { settings, now: "02:00", events: [ev(TODAY, 1, false, "01:00")] })
    expect(periodStatus(late, TODAY, TODAY).deadline?.state).toBe("late")
    // Due 02:00 (late night); 01:30 is before it, and at 23:00 the deadline hasn't passed yet.
    expect(periodStatus(due("02:00", { settings, now: "01:30" }), TODAY, TODAY).deadline?.state).toBe("pending")
    expect(periodStatus(due("02:00", { settings, now: "23:00" }), TODAY, TODAY).deadline?.state).toBe("pending")
  })

  it("puts weekly deadlines on the last day of the week", () => {
    const c = ctx({ task: { ...task("accumulate"), dueTime: "18:00" }, targets: [target("week", 3)], now: "19:00" })
    expect(periodStatus(c, TODAY, TODAY).deadline).toEqual({ date: "2026-10-10", time: "18:00", state: "pending" })
  })

  it("ignores due times on limits and excused periods", () => {
    const limit = ctx({ task: { ...task("limit"), dueTime: "09:00" }, targets: [target("day", 1)], now: "10:00" })
    expect(periodStatus(limit, TODAY, TODAY).deadline).toBeNull()
    expect(periodStatus(due("09:00", { now: "10:00", exceptions: [exception(TODAY, TODAY)] }), TODAY, TODAY).deadline).toBeNull()
  })

  it("counts overdue tasks in the overview", () => {
    const c = due("09:00", { now: "10:00" })
    expect(overview([{ task: c.task, current: periodStatus(c, TODAY, TODAY) }]).overdue).toBe(1)
  })
})
