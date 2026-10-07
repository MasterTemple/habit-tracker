// All writes go through here so components never touch tables directly.
import { v7 as uuid } from "uuid"
import { periodRange, toLocalDate } from "@/domain/dates"
import { currentTarget } from "@/domain/status"
import {
  DEFAULT_SETTINGS,
  type Category,
  type DisplayMode,
  type Period,
  type ScopeType,
  type Settings,
  type TaskException,
  type TaskTarget,
  type TaskType,
} from "@/domain/types"
import { db } from "./db"

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

/** Retires a task and creates a copy (linked by createdFromId), returning the copy's id. */
export async function copyAndRetire(id: string, changes: Partial<TaskInput> = {}): Promise<string> {
  const input = { ...(await taskToInput(id)), ...changes }
  const newId = await createTask(input, id)
  await retireTask(id)
  return newId
}

export async function moveTask(id: string, direction: -1 | 1) {
  const tasks = (await db.tasks.orderBy("sortOrder").toArray()).filter((t) => !t.retiredAt)
  const index = tasks.findIndex((t) => t.id === id)
  const other = tasks[index + direction]
  if (index < 0 || !other) return
  await db.transaction("rw", db.tasks, async () => {
    await db.tasks.update(id, { sortOrder: other.sortOrder, updatedAt: now() })
    await db.tasks.update(other.id, { sortOrder: tasks[index].sortOrder, updatedAt: now() })
  })
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

export async function deleteCategory(id: string) {
  await db.transaction("rw", [db.categories, db.taskCategories], async () => {
    await db.categories.update(id, { deletedAt: now(), updatedAt: now() })
    await db.taskCategories.where("categoryId").equals(id).delete()
  })
}

// ---------- exceptions ----------

export interface ExceptionInput {
  scopeType: ScopeType
  scopeId: string | null
  startDate: string
  endDate: string
  description: string
}

export async function createException(input: ExceptionInput): Promise<string> {
  const id = uuid()
  const exception: TaskException = {
    id,
    ...input,
    scopeId: input.scopeType === "all" ? null : input.scopeId,
    updatedAt: now(),
    deletedAt: null,
  }
  await db.exceptions.add(exception)
  return id
}

export async function deleteException(id: string) {
  await db.exceptions.update(id, { deletedAt: now(), updatedAt: now() })
}

// ---------- export / import ----------

export const EXPORT_VERSION = 1

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
  if (data?.app !== "habit-tracker" || data.version !== EXPORT_VERSION) {
    throw new Error("Not a habit-tracker export, or from an unsupported version")
  }
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.settings.put({ ...DEFAULT_SETTINGS, ...data.settings, key: "settings" })
    await db.tasks.bulkAdd(data.tasks)
    await db.targets.bulkAdd(data.targets)
    await db.events.bulkAdd(data.events)
    await db.categories.bulkAdd(data.categories)
    await db.taskCategories.bulkAdd(data.taskCategories)
    await db.exceptions.bulkAdd(data.exceptions)
  })
}
