// All writes go through here so components never touch tables directly.
import { v7 as uuid } from "uuid"
import { periodRange, toLocalDate, type DateRange } from "@/domain/dates"
import { currentTarget } from "@/domain/status"
import {
  DEFAULT_SETTINGS,
  type Category,
  type DisplayMode,
  type Period,
  type Settings,
  type TaskEvent,
  type TaskException,
  type TaskTarget,
  type TaskType,
} from "@/domain/types"
import { db } from "./db"
import { isExceptionV1, migrateExceptionV1 } from "./migrations"

const now = () => new Date().toISOString()

function today(settings: Settings) {
  return toLocalDate(new Date(), settings.dayStartHour)
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get("settings")
  return { ...DEFAULT_SETTINGS, ...row }
}

export async function updateSettings(changes: Partial<Settings>) {
  const current = await getSettings()
  await db.settings.put({ ...current, ...changes, key: "settings" })
}

// ---------- tasks ----------

export interface TaskInput {
  name: string
  description: string
  type: TaskType
  icon: string
  color: string
  incrementAmounts: number[]
  displayMode: DisplayMode
  /** Ignored for track tasks. */
  period: Period
  amount: number
  carryOver: boolean
  categoryIds: string[]
}

async function nextSortOrder() {
  const last = await db.tasks.orderBy("sortOrder").last()
  return (last?.sortOrder ?? -1) + 1
}

function newTarget(taskId: string, input: TaskInput, settings: Settings): TaskTarget {
  return {
    id: uuid(),
    taskId,
    period: input.period,
    amount: input.amount,
    carryOver: input.carryOver,
    // Takes effect for the whole current period.
    effectiveFrom: periodRange(input.period, today(settings), settings.weekStartsOn).start,
    updatedAt: now(),
  }
}

export async function createTask(input: TaskInput, createdFromId: string | null = null): Promise<string> {
  const settings = await getSettings()
  const id = uuid()
  const timestamp = now()
  await db.transaction("rw", [db.tasks, db.targets, db.taskCategories], async () => {
    await db.tasks.add({
      id,
      name: input.name,
      description: input.description,
      type: input.type,
      icon: input.icon,
      color: input.color,
      incrementAmounts: input.incrementAmounts,
      displayMode: input.displayMode,
      sortOrder: await nextSortOrder(),
      createdAt: timestamp,
      updatedAt: timestamp,
      retiredAt: null,
      createdFromId,
    })
    if (input.type !== "track") await db.targets.add(newTarget(id, input, settings))
    await db.taskCategories.bulkAdd(input.categoryIds.map((categoryId) => ({ taskId: id, categoryId })))
  })
  return id
}

/**
 * Updates a task. A changed goal becomes a new target version effective from the
 * start of the current period, replacing any versions that started on or after it,
 * so history before this period keeps its old goal. The task type is immutable —
 * use copyAndRetire to change it.
 */
export async function updateTask(id: string, input: TaskInput) {
  const settings = await getSettings()
  await db.transaction("rw", [db.tasks, db.targets, db.taskCategories], async () => {
    const task = await db.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)

    await db.tasks.update(id, {
      name: input.name,
      description: input.description,
      icon: input.icon,
      color: input.color,
      incrementAmounts: input.incrementAmounts,
      displayMode: input.displayMode,
      updatedAt: now(),
    })

    if (task.type !== "track") {
      const targets = await db.targets.where("taskId").equals(id).toArray()
      const current = currentTarget(targets, today(settings))
      const changed =
        !current ||
        current.period !== input.period ||
        current.amount !== input.amount ||
        current.carryOver !== input.carryOver
      if (changed) {
        const target = newTarget(id, input, settings)
        await db.targets.bulkDelete(targets.filter((t) => t.effectiveFrom >= target.effectiveFrom).map((t) => t.id))
        await db.targets.add(target)
      }
    }

    await db.taskCategories.where("taskId").equals(id).delete()
    await db.taskCategories.bulkAdd(input.categoryIds.map((categoryId) => ({ taskId: id, categoryId })))
  })
}

export async function retireTask(id: string) {
  await db.tasks.update(id, { retiredAt: now(), updatedAt: now() })
}

export async function unretireTask(id: string) {
  await db.tasks.update(id, { retiredAt: null, updatedAt: now() })
}

/** Builds a TaskInput from an existing task, e.g. to prefill the editor. */
export async function taskToInput(id: string): Promise<TaskInput> {
  const settings = await getSettings()
  const task = await db.tasks.get(id)
  if (!task) throw new Error(`Task ${id} not found`)
  const targets = await db.targets.where("taskId").equals(id).toArray()
  const target = currentTarget(targets, today(settings))
  const links = await db.taskCategories.where("taskId").equals(id).toArray()
  return {
    name: task.name,
    description: task.description,
    type: task.type,
    icon: task.icon,
    color: task.color,
    incrementAmounts: task.incrementAmounts,
    displayMode: task.displayMode,
    period: target?.period ?? "day",
    amount: target?.amount ?? 1,
    carryOver: target?.carryOver ?? settings.carryOverDefault,
    categoryIds: links.map((l) => l.categoryId),
  }
}

/**
 * Creates a modified copy of a task (linked by createdFromId) and retires the
 * original in one step, returning the copy's id. Unlike edits, the copy may change type.
 */
export async function copyAndRetire(id: string, input: TaskInput): Promise<string> {
  const original = await db.tasks.get(id)
  if (!original) throw new Error(`Task ${id} not found`)
  if (original.retiredAt) throw new Error("Can't copy and retire a task that is already retired")
  return db.transaction("rw", [db.tasks, db.targets, db.taskCategories, db.settings], async () => {
    const newId = await createTask(input, id)
    await retireTask(id)
    return newId
  })
}

/** Creates a copy of a task (linked by createdFromId), leaving the original as it is, retired or not. */
export async function duplicateTask(id: string, input: TaskInput): Promise<string> {
  if (!(await db.tasks.get(id))) throw new Error(`Task ${id} not found`)
  return createTask(input, id)
}

/** Moves a task to where `overId` is, renumbering every task's sortOrder. */
export async function reorderTask(activeId: string, overId: string) {
  await db.transaction("rw", db.tasks, async () => {
    const tasks = await db.tasks.orderBy("sortOrder").toArray()
    const ids = moveId(tasks.map((t) => t.id), activeId, overId)
    await Promise.all(ids.map((id, sortOrder) => db.tasks.update(id, { sortOrder, updatedAt: now() })))
  })
}

function moveId(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from < 0 || to < 0) return ids
  const next = [...ids]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

// ---------- events ----------

export async function recordEvent(taskId: string, amount: number, note = ""): Promise<string> {
  const settings = await getSettings()
  const moment = new Date()
  const id = uuid()
  await db.events.add({
    id,
    taskId,
    amount,
    occurredAt: moment.toISOString(),
    localDate: toLocalDate(moment, settings.dayStartHour),
    note,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  })
  return id
}

/**
 * The card's undo button: deletes the newest entry recorded within `range`
 * (the current period), whichever button made it. Returns it for "Redo", or null.
 */
export async function undoLast(taskId: string, range: DateRange): Promise<TaskEvent | null> {
  const events = await db.events
    .where("[taskId+localDate]")
    .between([taskId, range.start], [taskId, range.end], true, true)
    .filter((e) => !e.deletedAt)
    .toArray()
  const latest = events.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!latest) return null
  await deleteEvent(latest.id)
  return latest
}

export async function deleteEvent(id: string) {
  await db.events.update(id, { deletedAt: now(), updatedAt: now() })
}

export async function restoreEvent(id: string) {
  await db.events.update(id, { deletedAt: null, updatedAt: now() })
}

// ---------- categories ----------

export async function createCategory(name: string, color: string): Promise<string> {
  const last = await db.categories.orderBy("sortOrder").last()
  const id = uuid()
  await db.categories.add({
    id,
    name,
    color,
    sortOrder: (last?.sortOrder ?? -1) + 1,
    updatedAt: now(),
    deletedAt: null,
  })
  return id
}

export async function updateCategory(id: string, changes: Partial<Pick<Category, "name" | "color">>) {
  await db.categories.update(id, { ...changes, updatedAt: now() })
}

export async function reorderCategory(activeId: string, overId: string) {
  await db.transaction("rw", db.categories, async () => {
    const categories = await db.categories.orderBy("sortOrder").toArray()
    const ids = moveId(categories.map((c) => c.id), activeId, overId)
    await Promise.all(ids.map((id, sortOrder) => db.categories.update(id, { sortOrder, updatedAt: now() })))
  })
}

export async function deleteCategory(id: string) {
  await db.transaction("rw", [db.categories, db.taskCategories, db.exceptions], async () => {
    await db.categories.update(id, { deletedAt: now(), updatedAt: now() })
    await db.taskCategories.where("categoryId").equals(id).delete()
    await db.exceptions
      .where("categoryIds")
      .equals(id)
      .modify((e) => {
        e.categoryIds = e.categoryIds.filter((c) => c !== id)
        e.updatedAt = now()
      })
  })
}

// ---------- exceptions ----------

export type ExceptionInput = Pick<
  TaskException,
  "appliesToAll" | "taskIds" | "categoryIds" | "startDate" | "endDate" | "description"
>

function normalizeException(input: ExceptionInput): ExceptionInput {
  const endDate = input.endDate < input.startDate ? input.startDate : input.endDate
  return input.appliesToAll
    ? { ...input, endDate, taskIds: [], categoryIds: [] }
    : { ...input, endDate, taskIds: [...new Set(input.taskIds)], categoryIds: [...new Set(input.categoryIds)] }
}

export async function createException(input: ExceptionInput): Promise<string> {
  const id = uuid()
  await db.exceptions.add({ id, ...normalizeException(input), updatedAt: now(), deletedAt: null })
  return id
}

export async function updateException(id: string, input: ExceptionInput) {
  await db.exceptions.update(id, { ...normalizeException(input), updatedAt: now() })
}

export async function deleteException(id: string) {
  await db.exceptions.update(id, { deletedAt: now(), updatedAt: now() })
}

// ---------- export / import ----------

export const EXPORT_VERSION = 2

export async function exportData() {
  return {
    app: "habit-tracker",
    version: EXPORT_VERSION,
    exportedAt: now(),
    settings: await getSettings(),
    tasks: await db.tasks.toArray(),
    targets: await db.targets.toArray(),
    events: await db.events.toArray(),
    categories: await db.categories.toArray(),
    taskCategories: await db.taskCategories.toArray(),
    exceptions: await db.exceptions.toArray(),
  }
}

export type ExportData = Awaited<ReturnType<typeof exportData>>

/** Replaces all local data with an export. */
export async function importData(data: ExportData) {
  if (data?.app !== "habit-tracker" || ![1, EXPORT_VERSION].includes(data.version)) {
    throw new Error("Not a habit-tracker export, or from an unsupported version")
  }
  const exceptions = data.exceptions.map((e) => (isExceptionV1(e) ? migrateExceptionV1(e) : e))
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.settings.put({ ...DEFAULT_SETTINGS, ...data.settings, key: "settings" })
    await db.tasks.bulkAdd(data.tasks)
    await db.targets.bulkAdd(data.targets)
    await db.events.bulkAdd(data.events)
    await db.categories.bulkAdd(data.categories)
    await db.taskCategories.bulkAdd(data.taskCategories)
    await db.exceptions.bulkAdd(exceptions)
  })
}
