import { expect, it } from "vitest"
import { progressReadyToAlert } from "./notify"
import type { TaskEvent } from "./types"

const at = (iso: string, deleted = false) =>
  ({ id: iso, taskId: "t", amount: 1, occurredAt: iso, localDate: "", note: "", createdAt: iso, updatedAt: iso, deletedAt: deleted ? iso : null }) as TaskEvent

it("waits a minute and skips entries that were undone", () => {
  const now = new Date("2026-10-06T12:00:00Z")
  const lastCheck = new Date("2026-10-06T11:59:00Z")
  const events = [
    at("2026-10-06T11:58:30Z"), // 90s old, recorded since the last check's window → send
    at("2026-10-06T11:59:30Z"), // 30s old → wait for the next check
    at("2026-10-06T11:58:40Z", true), // undone → never send
    at("2026-10-06T11:50:00Z"), // already handled by an earlier check
  ]
  expect(progressReadyToAlert(events, lastCheck, now).map((e) => e.id)).toEqual(["2026-10-06T11:58:30Z"])
  // The 30s-old entry goes out on the next check, a minute later.
  expect(progressReadyToAlert(events, now, new Date("2026-10-06T12:01:00Z")).map((e) => e.id)).toEqual([
    "2026-10-06T11:59:30Z",
  ])
})
