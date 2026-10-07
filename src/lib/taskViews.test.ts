import { expect, it } from "vitest"
import { clockIn } from "./taskViews"

it("reads another zone's wall clock, honoring the day-start hour", () => {
  const at = new Date("2026-10-07T07:30:00Z")
  expect(clockIn("America/Denver", 0, at)).toEqual({ today: "2026-10-07", now: "01:30" })
  expect(clockIn("America/Denver", 3, at)).toEqual({ today: "2026-10-06", now: "01:30" })
  expect(clockIn("Asia/Tokyo", 0, at)).toEqual({ today: "2026-10-07", now: "16:30" })
  expect(clockIn("", 0, at)).toEqual({ today: "2026-10-07", now: "07:30" })
  expect(clockIn("Not/AZone", 0, at)).toEqual({ today: "2026-10-07", now: "07:30" })
})
