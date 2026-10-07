import { describe, expect, it } from "vitest"
import type { InboxItem } from "@/sync/notifications"
import { groupInbox } from "./inbox"

const item = (id: string, createdAt: string, extra: Partial<InboxItem> = {}): InboxItem => ({
  id,
  kind: "alert",
  title: "Sam",
  body: "Sam finished Pull-ups",
  data: {},
  createdAt,
  readAt: null,
  ...extra,
})

describe("groupInbox", () => {
  it("stacks identical notifications under the latest", () => {
    const groups = groupInbox([
      item("a", "2026-10-01T10:00:00Z", { readAt: "2026-10-01T11:00:00Z" }),
      item("b", "2026-10-03T10:00:00Z"),
      item("c", "2026-10-02T10:00:00Z", { body: "Sam missed Reading" }),
      item("d", "2026-10-02T09:00:00Z", { kind: "friend-request", body: "Sam missed Reading" }),
    ])
    expect(groups.map((g) => [g.latest.id, g.items.map((i) => i.id), g.unread, g.section])).toEqual([
      ["b", ["b", "a"], 1, "alerts"],
      ["c", ["c"], 1, "alerts"],
      ["d", ["d"], 1, "general"],
    ])
  })
})
