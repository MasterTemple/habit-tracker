import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { db } from "./db"
import {
  copyAndRetire,
  createCategory,
  createTask,
  deleteCategory,
  createException,
  deleteContact,
  deleteEvent,
  deleteTask,
  getSettings,
  resetAll,
  saveAutomation,
  saveContact,
  saveShare,
  updateSettings,
  duplicateTask,
  exportData,
  exportTemplate,
  importData,
  importTemplate,
  reorderCategory,
  reorderTask,
  recordEvent,
  retireTask,
  undoLast,
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
  unit: "",
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

  it("reorders categories by drag target", async () => {
    const a = await createCategory("A", "#000")
    const b = await createCategory("B", "#000")
    await reorderCategory(b, a)
    expect((await db.categories.orderBy("sortOrder").toArray()).map((c) => c.id)).toEqual([b, a])
  })

  it("duplicates without retiring, including a retired original", async () => {
    const id = await createTask(input)
    await retireTask(id)
    const copy = await duplicateTask(id, { ...input, name: "Pull-ups 2" })
    expect((await db.tasks.get(id))?.retiredAt).not.toBeNull()
    expect((await db.tasks.get(copy))?.retiredAt).toBeNull()
    expect((await db.tasks.get(copy))?.createdFromId).toBe(id)
  })

  it("undoes the newest entry in the period, whichever button made it", async () => {
    const id = await createTask(input)
    const range = { start: "2000-01-01", end: "2999-12-31" }
    await recordEvent(id, 5)
    await new Promise((r) => setTimeout(r, 5))
    await recordEvent(id, 10)
    expect((await undoLast(id, range))?.amount).toBe(10)
    expect((await undoLast(id, range))?.amount).toBe(5)
    expect(await undoLast(id, range)).toBeNull()
  })

  it("does not undo entries outside the period", async () => {
    const id = await createTask(input)
    await recordEvent(id, 5)
    expect(await undoLast(id, { start: "2000-01-01", end: "2000-01-31" })).toBeNull()
  })

  it("reorders tasks by drag target", async () => {
    const a = await createTask({ ...input, name: "A" })
    const b = await createTask({ ...input, name: "B" })
    const c = await createTask({ ...input, name: "C" })
    await reorderTask(c, a)
    expect((await db.tasks.orderBy("sortOrder").toArray()).map((t) => t.id)).toEqual([c, a, b])
    await reorderTask(c, b)
    expect((await db.tasks.orderBy("sortOrder").toArray()).map((t) => t.id)).toEqual([a, b, c])
  })

  it("removes a deleted category from breaks", async () => {
    const cat = await createCategory("Exercise", "#f00")
    const other = await createCategory("Health", "#0f0")
    const id = await createException({
      appliesToAll: false,
      taskIds: [],
      categoryIds: [cat, other],
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      description: "",
    })
    await deleteCategory(cat)
    expect((await db.exceptions.get(id))?.categoryIds).toEqual([other])
  })

  it("imports v1 exports with single-scope breaks", async () => {
    const id = await createTask(input)
    const data = await exportData()
    const v1 = {
      ...data,
      version: 1,
      exceptions: [
        { id: "x", scopeType: "task", scopeId: id, startDate: "2026-10-01", endDate: "2026-10-01", description: "", updatedAt: "", deletedAt: null },
      ],
    }
    await importData(JSON.parse(JSON.stringify(v1)))
    expect(await db.exceptions.get("x")).toMatchObject({ appliesToAll: false, taskIds: [id], categoryIds: [] })
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

  it("gives track tasks a period target with no goal", async () => {
    const id = await createTask({ ...input, type: "track", period: "week", amount: 50, carryOver: true })
    const [target] = await db.targets.where("taskId").equals(id).toArray()
    expect(target).toMatchObject({ period: "week", amount: 0, carryOver: false })
    await updateTask(id, { ...input, type: "track", period: "month" })
    expect((await taskToInput(id)).period).toBe("month")
  })

  it("merges an import, keeping the newer copy of each row", async () => {
    const id = await createTask(input)
    await recordEvent(id, 10)
    const backup = JSON.parse(JSON.stringify(await exportData()))

    // Locally: rename (newer than the backup) and add another task and entry.
    await new Promise((r) => setTimeout(r, 5))
    await updateTask(id, { ...input, name: "Renamed" })
    const other = await createTask({ ...input, name: "Other" })
    await recordEvent(other, 1)

    // The backup has an entry the phone doesn't (e.g. from another device).
    backup.events.push({ ...backup.events[0], id: "from-backup", amount: 3 })
    await importData(backup, "merge")

    expect((await db.tasks.get(id))?.name).toBe("Renamed")
    expect(await db.tasks.count()).toBe(2)
    expect(await db.events.count()).toBe(3)
  })

  it("replaces everything on a replace import", async () => {
    await createTask(input)
    const backup = JSON.parse(JSON.stringify(await exportData()))
    await createTask({ ...input, name: "Other" })
    await importData(backup, "replace")
    expect(await db.tasks.count()).toBe(1)
  })

  it("shares task definitions without entries and reuses categories by name", async () => {
    const cat = await createCategory("Exercise", "#f00", "dumbbell")
    const id = await createTask({ ...input, unit: "rep", categoryIds: [cat] })
    await recordEvent(id, 10)
    const template = JSON.parse(JSON.stringify(await exportTemplate([id], [])))
    expect(template.categories).toHaveLength(1)
    expect(JSON.stringify(template)).not.toContain('"events"')

    // Importing on the same device: "Exercise" already exists, so it's reused.
    const result = await importTemplate(template)
    expect(result).toEqual({ tasks: 1, categories: 0 })
    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(2)
    const copy = tasks.find((t) => t.id !== id)!
    expect(copy.unit).toBe("rep")
    expect((await taskToInput(copy.id)).categoryIds).toEqual([cat])
    expect(await db.events.where("taskId").equals(copy.id).count()).toBe(0)
  })

  it("deletes a task with its entries and removes it from breaks and shares", async () => {
    const id = await createTask(input)
    const keep = await createTask({ ...input, name: "Keep" })
    await recordEvent(id, 5)
    await recordEvent(keep, 5)
    const breakId = await createException({
      appliesToAll: false, taskIds: [id, keep], categoryIds: [], startDate: "2026-10-01", endDate: "2026-10-02", description: "",
    })
    const scope = { appliesToAll: false, taskIds: [id], categoryIds: [] }
    const shareId = await saveShare({ kind: "view", name: "", enabled: true, scope, contactIds: [], anyoneWithLink: true, token: "x", webhookUrl: "" })
    const hookId = await saveAutomation({ kind: "webhook_in", name: "", enabled: true, taskId: id, amount: 1, token: "y" })

    await deleteTask(id)
    expect(await db.tasks.get(id)).toBeUndefined()
    expect(await db.events.count()).toBe(1)
    expect(await db.targets.where("taskId").equals(id).count()).toBe(0)
    expect((await db.exceptions.get(breakId))?.taskIds).toEqual([keep])
    expect(((await db.shares.get(shareId)) as { scope: { taskIds: string[] } }).scope.taskIds).toEqual([])
    expect((await db.automations.get(hookId))?.deletedAt).not.toBeNull()
  })

  it("removes a deleted contact from shares", async () => {
    const a = await saveContact({ name: "A", relationship: "friend", username: "", phone: "", email: "", telegram: "", signal: "", discordId: "", notes: "" })
    const shareId = await saveShare({
      kind: "notify", name: "", enabled: true, scope: { appliesToAll: true, taskIds: [], categoryIds: [] },
      contactIds: [a], events: ["entry"], channels: ["push"], webhookUrl: "",
    })
    await deleteContact(a)
    expect((await db.contacts.get(a))?.deletedAt).not.toBeNull()
    expect(((await db.shares.get(shareId)) as { contactIds: string[] }).contactIds).toEqual([])
  })

  it("erases everything", async () => {
    await createTask(input)
    await updateSettings({ weekStartsOn: 1 })
    await resetAll()
    expect(await db.tasks.count()).toBe(0)
    expect((await getSettings()).weekStartsOn).toBe(0)
  })

  it("exports and imports automations, contacts, and shares", async () => {
    await saveContact({ name: "A", relationship: "friend", username: "", phone: "", email: "", telegram: "", signal: "", discordId: "", notes: "" })
    const data = JSON.parse(JSON.stringify(await exportData()))
    await resetAll()
    await importData(data)
    expect(await db.contacts.count()).toBe(1)
    // A v3 file without the new tables still imports.
    await importData({ ...data, version: 3, automations: undefined, contacts: undefined, shares: undefined })
    expect(await db.contacts.count()).toBe(0)
  })
})
