import "fake-indexeddb/auto"
import { Dexie } from "dexie"
import { expect, it } from "vitest"
import { HabitDB } from "./db"

it("upgrades v1 single-scope breaks to multi-scope", async () => {
  const old = new Dexie("upgrade-test")
  old.version(1).stores({ exceptions: "id, scopeType, scopeId, updatedAt" })
  await old.table("exceptions").bulkAdd([
    { id: "a", scopeType: "all", scopeId: null, startDate: "2026-10-01", endDate: "2026-10-02", description: "", updatedAt: "", deletedAt: null },
    { id: "c", scopeType: "category", scopeId: "cat1", startDate: "2026-10-01", endDate: "2026-10-02", description: "", updatedAt: "", deletedAt: null },
  ])
  old.close()

  const db = new HabitDB("upgrade-test")
  expect(await db.exceptions.get("a")).toMatchObject({ appliesToAll: true, taskIds: [], categoryIds: [] })
  const c = await db.exceptions.get("c")
  expect(c).toMatchObject({ appliesToAll: false, taskIds: [], categoryIds: ["cat1"] })
  expect(c).not.toHaveProperty("scopeType")
  expect(await db.exceptions.where("categoryIds").equals("cat1").count()).toBe(1)
  db.close()
})
