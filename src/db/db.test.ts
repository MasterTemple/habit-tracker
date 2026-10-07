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

it("upgrades v2 rows with defaults for units and category icons", async () => {
  const old = new Dexie("upgrade-v3")
  old.version(2).stores({
    tasks: "id, sortOrder, updatedAt",
    categories: "id, sortOrder, updatedAt",
    exceptions: "id, *taskIds, *categoryIds, updatedAt",
  })
  await old.table("tasks").add({ id: "t", name: "Run", sortOrder: 0, updatedAt: "" })
  await old.table("categories").add({ id: "c", name: "Exercise", sortOrder: 0, updatedAt: "" })
  old.close()

  const db = new HabitDB("upgrade-v3")
  expect((await db.tasks.get("t"))?.unit).toBe("")
  expect((await db.categories.get("c"))?.icon).toBe("")
  db.close()
})
