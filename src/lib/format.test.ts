import { describe, expect, it } from "vitest"
import type { PeriodStatus, TaskSummary } from "@/domain/status"
import type { Task } from "@/domain/types"
import { displayValue, progressPercent, statusText } from "./format"

const task = { type: "limit", displayMode: "period" } as Task
const status = (actual: number, goal: number, state: PeriodStatus["state"] = "open") =>
  ({ period: "month", range: { start: "", end: "" }, target: null, goal, carried: 0, actual, excusedDays: 0, state }) as PeriodStatus
const summary = (current: PeriodStatus) => ({ current, today: 0, total: 0, streak: 0 }) as TaskSummary

describe("limit display", () => {
  it("shows used by default", () => {
    expect(displayValue(task, summary(status(3, 4)))).toBe("3 / 4 this month")
    expect(statusText(task, status(3, 4))).toBe("1 left")
    expect(progressPercent(task, status(3, 4))).toBe(75)
  })

  it("can count down the remaining allowance", () => {
    expect(displayValue(task, summary(status(3, 4)), "remaining")).toBe("1 / 4 remaining this month")
    expect(statusText(task, status(3, 4), "remaining")).toBe("3 used")
    expect(progressPercent(task, status(3, 4), "remaining")).toBe(25)
  })

  it("still reports going over", () => {
    expect(displayValue(task, summary(status(5, 4, "failure")), "remaining")).toBe("0 / 4 remaining this month")
    expect(statusText(task, status(5, 4, "failure"), "remaining")).toBe("Over by 1")
    expect(progressPercent(task, status(5, 4, "failure"), "remaining")).toBe(100)
  })

  it("keeps 'never' limits in used form", () => {
    expect(displayValue(task, summary(status(0, 0)), "remaining")).toBe("0 / 0 this month")
  })
})
