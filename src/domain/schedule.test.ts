import { describe, expect, it } from "vitest"
import { describeSchedule, nextRun } from "./schedule"
import type { Schedule } from "./types"

const s = (partial: Partial<Schedule>): Schedule => ({ repeat: "daily", time: "18:00", weekdays: [], monthDay: 1, ...partial })
// Tuesday, Oct 6 2026, 12:00 local
const NOON = new Date(2026, 9, 6, 12, 0)

describe("describeSchedule", () => {
  it("reads naturally", () => {
    expect(describeSchedule(s({}))).toBe("Every day at 6:00 PM")
    expect(describeSchedule(s({ repeat: "weekly", weekdays: [6] }))).toBe("Sat at 6:00 PM")
    expect(describeSchedule(s({ repeat: "weekly", weekdays: [5, 1, 2, 3, 4] }))).toBe("Weekdays at 6:00 PM")
    expect(describeSchedule(s({ repeat: "monthly", monthDay: 22, time: "09:05" }))).toBe("Monthly on the 22nd at 9:05 AM")
    expect(describeSchedule(s({ repeat: "monthly", monthDay: 11, time: "00:00" }))).toBe("Monthly on the 11th at 12:00 AM")
  })
})

describe("nextRun", () => {
  it("finds today's time if still ahead, else tomorrow's", () => {
    expect(nextRun(s({}), NOON)).toEqual(new Date(2026, 9, 6, 18, 0))
    expect(nextRun(s({ time: "08:00" }), NOON)).toEqual(new Date(2026, 9, 7, 8, 0))
  })

  it("finds the next chosen weekday", () => {
    expect(nextRun(s({ repeat: "weekly", weekdays: [6] }), NOON)).toEqual(new Date(2026, 9, 10, 18, 0))
    expect(nextRun(s({ repeat: "weekly", weekdays: [2], time: "08:00" }), NOON)).toEqual(new Date(2026, 9, 13, 8, 0))
    expect(nextRun(s({ repeat: "weekly", weekdays: [] }), NOON)).toBeNull()
  })

  it("clamps monthly days to the month's length", () => {
    expect(nextRun(s({ repeat: "monthly", monthDay: 31 }), NOON)).toEqual(new Date(2026, 9, 31, 18, 0))
    expect(nextRun(s({ repeat: "monthly", monthDay: 31 }), new Date(2026, 10, 1))).toEqual(new Date(2026, 10, 30, 18, 0))
    expect(nextRun(s({ repeat: "monthly", monthDay: 1 }), NOON)).toEqual(new Date(2026, 10, 1, 18, 0))
  })
})
