import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { db } from "./db"
import {
  copyAndRetire,
  createCategory,
  createTask,
  deleteCategory,
  deleteEvent,
  exportData,
  importData,
  moveCategory,
  recordEvent,
  taskToInput,
  updateTask,
  type TaskInput,
} from "./repo"

const input: TaskInput = {
  name: "Pull-ups",
  description: "",
  type: "accumulate",
  icon: "dumbbell",
  color: "#ef4444",
  incrementAmounts: [1, 5, 10],
  displayMode: "period",
  period: "day",
  amount: 100,
  carryOver: false,
  categoryIds: [],
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe("repo", () => {
  it("creates a task with a target and categories", async () => {
    const cat = await createCategory("Exercise", "#f00")
    const id = await createTask({ ...input, categoryIds: [cat] })
    expect(await db.targets.where("taskId").equals(id).count()).toBe(1)
    expect((await taskToInput(id)).categoryIds).toEqual([cat])
  })

  it("versions the target only when the goal changes", async () => {
    const id = await createTask(input)
    await updateTask(id, { ...input, name: "Renamed" })
    expect(await db.targets.where("taskId").equals(id).count()).toBe(1)

    // Same period start → the old version is replaced, not duplicated.
    await updateTask(id, { ...input, amount: 150 })
    const targets = await db.targets.where("taskId").equals(id).toArray()
    expect(targets.map((t) => t.amount)).toEqual([150])
  })

  it("soft-deletes events", async () => {
    const id = await createTask(input)
    const eventId = await recordEvent(id, 10)
    await deleteEvent(eventId)
    expect((await db.events.get(eventId))?.deletedAt).not.toBeNull()
  })

  it("copies and retires", async () => {
    const id = await createTask(input)
    const copy = await copyAndRetire(id, { ...input, type: "limit", amount: 200 })
    expect((await db.tasks.get(id))?.retiredAt).not.toBeNull()
    expect((await db.tasks.get(copy))?.createdFromId).toBe(id)
    expect((await taskToInput(copy)).amount).toBe(200)
    expect((await db.tasks.get(copy))?.type).toBe("limit")
  })

  it("refuses to copy and retire a retired task", async () => {
    const id = await createTask(input)
    await copyAndRetire(id, input)
    await expect(copyAndRetire(id, input)).rejects.toThrow(/already retired/)
    expect(await db.tasks.count()).toBe(2)
  })

  it("reorders categories", async () => {
    const a = await createCategory("A", "#000")
    const b = await createCategory("B", "#000")
    await moveCategory(b, -1)
    expect((await db.categories.orderBy("sortOrder").toArray()).map((c) => c.id)).toEqual([b, a])
    await moveCategory(b, -1) // already first: no-op
    expect((await db.categories.orderBy("sortOrder").toArray()).map((c) => c.id)).toEqual([b, a])
  })

  it("unlinks a deleted category from tasks", async () => {
    const cat = await createCategory("Exercise", "#f00")
    const id = await createTask({ ...input, categoryIds: [cat] })
    await deleteCategory(cat)
    expect((await taskToInput(id)).categoryIds).toEqual([])
  })

  it("round-trips export and import", async () => {
    const id = await createTask(input)
    await recordEvent(id, 10)
    const data = await exportData()
    await Promise.all(db.tables.map((t) => t.clear()))
    await importData(JSON.parse(JSON.stringify(data)))
    expect(await db.tasks.count()).toBe(1)
    expect(await db.events.count()).toBe(1)
  })
})
