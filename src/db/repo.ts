// All writes go through here so components never touch tables directly.
import { v7 as uuid } from "uuid"
import { periodRange, toLocalDate, type DateRange } from "@/domain/dates"
import { currentTarget } from "@/domain/status"
import {
  DEFAULT_SETTINGS,
  type Automation,
  type Category,
  type Contact,
  type DisplayMode,
  type Period,
  type Settings,
  type Share,
  type TaskEvent,
  type TaskException,
  type TaskTarget,
  type TaskType,
} from "@/domain/types"
import type { EntityTable } from "dexie"
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
  unit: string
  incrementAmounts: number[]
  displayMode: DisplayMode
  /** For track tasks, only the period is used. */
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
    amount: input.type === "track" ? 0 : input.amount,
    carryOver: input.type === "track" ? false : input.carryOver,
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
      unit: input.unit.trim(),
      incrementAmounts: input.incrementAmounts,
      displayMode: input.displayMode,
      sortOrder: await nextSortOrder(),
      createdAt: timestamp,
      updatedAt: timestamp,
      retiredAt: null,
      createdFromId,
    })
    await db.targets.add(newTarget(id, input, settings))
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
      unit: input.unit.trim(),
      incrementAmounts: input.incrementAmounts,
      displayMode: input.displayMode,
      updatedAt: now(),
    })

    const target = newTarget(id, { ...input, type: task.type }, settings)
    const targets = await db.targets.where("taskId").equals(id).toArray()
    const current = currentTarget(targets, today(settings))
    const changed =
      !current ||
      current.period !== target.period ||
      current.amount !== target.amount ||
      current.carryOver !== target.carryOver
    if (changed) {
      await db.targets.bulkDelete(targets.filter((t) => t.effectiveFrom >= target.effectiveFrom).map((t) => t.id))
      await db.targets.add(target)
    }

    await db.taskCategories.where("taskId").equals(id).delete()
    await db.taskCategories.bulkAdd(input.categoryIds.map((categoryId) => ({ taskId: id, categoryId })))
  })
}

/**
 * Permanently deletes a task with its goals and entries, and removes it from breaks,
 * automations, and shares. (A hard delete: once sync exists this will need a tombstone.)
 */
export async function deleteTask(id: string) {
  const tables = [db.tasks, db.targets, db.events, db.taskCategories, db.exceptions, db.automations, db.shares]
  await db.transaction("rw", tables, async () => {
    await db.targets.where("taskId").equals(id).delete()
    await db.events.where("taskId").equals(id).delete()
    await db.taskCategories.where("taskId").equals(id).delete()
    await db.tasks.delete(id)
    await pruneReferences("taskIds", id)
    // Webhooks that record progress for this task have nothing left to do.
    await db.automations
      .filter((a) => a.kind === "webhook_in" && a.taskId === id)
      .modify((a) => {
        a.deletedAt = now()
        a.updatedAt = now()
      })
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
    unit: task.unit ?? "",
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

export async function createCategory(name: string, color: string, icon = ""): Promise<string> {
  const last = await db.categories.orderBy("sortOrder").last()
  const id = uuid()
  await db.categories.add({
    id,
    name,
    color,
    icon,
    sortOrder: (last?.sortOrder ?? -1) + 1,
    updatedAt: now(),
    deletedAt: null,
  })
  return id
}

export async function updateCategory(id: string, changes: Partial<Pick<Category, "name" | "color" | "icon">>) {
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
  await db.transaction("rw", [db.categories, db.taskCategories, db.exceptions, db.automations, db.shares], async () => {
    await db.categories.update(id, { deletedAt: now(), updatedAt: now() })
    await db.taskCategories.where("categoryId").equals(id).delete()
    await pruneReferences("categoryIds", id)
  })
}

/** Removes a task or category from every break, automation, and share that names it. */
async function pruneReferences(key: "taskIds" | "categoryIds", id: string) {
  const stamp = now()
  await db.exceptions
    .where(key)
    .equals(id)
    .modify((e) => {
      e[key] = e[key].filter((x) => x !== id)
      e.updatedAt = stamp
    })
  const prune = (row: Automation | Share) => {
    if (!("scope" in row) || !row.scope[key].includes(id)) return
    row.scope = { ...row.scope, [key]: row.scope[key].filter((x) => x !== id) }
    row.updatedAt = stamp
  }
  await db.automations.toCollection().modify(prune)
  await db.shares.toCollection().modify(prune)
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

// ---------- automations, contacts, shares ----------

/** A row as an editor produces it: no bookkeeping fields, and no id yet when new. */
export type Draft<T> = T extends unknown ? Omit<T, "id" | "updatedAt" | "deletedAt"> & { id?: string } : never

type Stored = { id: string; updatedAt: string; deletedAt: string | null }

async function save<T extends Stored>(table: EntityTable<T, "id">, draft: Draft<T>): Promise<string> {
  const id = draft.id ?? uuid()
  await table.put({ ...draft, id, updatedAt: now(), deletedAt: null } as unknown as T)
  return id
}

async function softDelete<T extends Stored>(table: EntityTable<T, "id">, id: string) {
  await table
    .filter((r) => r.id === id)
    .modify((r) => {
      r.deletedAt = now()
      r.updatedAt = now()
    })
}

export const saveAutomation = (draft: Draft<Automation>) => save(db.automations, draft)
export const deleteAutomation = (id: string) => softDelete(db.automations, id)
export const saveContact = (draft: Draft<Contact>) => save(db.contacts, draft)
export const saveShare = (draft: Draft<Share>) => save(db.shares, draft)
export const deleteShare = (id: string) => softDelete(db.shares, id)

/** Deletes a contact and removes them from every share, alert, and report. */
export async function deleteContact(id: string) {
  await db.transaction("rw", [db.contacts, db.shares, db.automations], async () => {
    await softDelete(db.contacts, id)
    const prune = (row: Automation | Share) => {
      if (!("contactIds" in row) || !row.contactIds.includes(id)) return
      row.contactIds = row.contactIds.filter((c) => c !== id)
      row.updatedAt = now()
    }
    await db.shares.toCollection().modify(prune)
    await db.automations.toCollection().modify(prune)
  })
}

/** A random, URL-safe token for links and webhook URLs. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** Erases everything on this device, settings included. */
export async function resetAll() {
  await db.transaction("rw", db.tables, () => Promise.all(db.tables.map((t) => t.clear())))
}

// ---------- export / import ----------

export const EXPORT_VERSION = 4

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
    automations: await db.automations.toArray(),
    contacts: await db.contacts.toArray(),
    shares: await db.shares.toArray(),
  }
}

export type ExportData = Awaited<ReturnType<typeof exportData>>

/** Brings rows from older exports up to the current shape. */
function normalizeExport(data: ExportData): ExportData {
  if (data?.app !== "habit-tracker" || ![1, 2, 3, EXPORT_VERSION].includes(data.version)) {
    throw new Error("Not a habit-tracker export, or from an unsupported version")
  }
  return {
    ...data,
    tasks: data.tasks.map((t) => ({ ...t, unit: t.unit ?? "" })),
    categories: data.categories.map((c) => ({ ...c, icon: c.icon ?? "" })),
    exceptions: data.exceptions.map((e) => (isExceptionV1(e) ? migrateExceptionV1(e) : e)),
    // Added in v4.
    automations: data.automations ?? [],
    contacts: data.contacts ?? [],
    shares: data.shares ?? [],
  }
}

/**
 * "replace" wipes local data first. "merge" keeps local data and adds the file's:
 * when a row exists in both, the more recently updated one wins (events and task
 * links are combined), and local settings are kept.
 */
export async function importData(raw: ExportData, mode: "replace" | "merge" = "replace") {
  const data = normalizeExport(raw)
  await db.transaction("rw", db.tables, async () => {
    if (mode === "replace") {
      await Promise.all(db.tables.map((t) => t.clear()))
      await db.settings.put({ ...DEFAULT_SETTINGS, ...data.settings, key: "settings" })
      await db.tasks.bulkAdd(data.tasks)
      await db.targets.bulkAdd(data.targets)
      await db.events.bulkAdd(data.events)
      await db.categories.bulkAdd(data.categories)
      await db.taskCategories.bulkAdd(data.taskCategories)
      await db.exceptions.bulkAdd(data.exceptions)
      await db.automations.bulkAdd(data.automations)
      await db.contacts.bulkAdd(data.contacts)
      await db.shares.bulkAdd(data.shares)
      return
    }
    await mergeNewest(db.tasks, data.tasks)
    await mergeNewest(db.targets, data.targets)
    await mergeNewest(db.events, data.events)
    await mergeNewest(db.categories, data.categories)
    await mergeNewest(db.exceptions, data.exceptions)
    await mergeNewest(db.automations, data.automations)
    await mergeNewest(db.contacts, data.contacts)
    await mergeNewest(db.shares, data.shares)
    await db.taskCategories.bulkPut(data.taskCategories)
  })
}

async function mergeNewest<T extends { id: string; updatedAt: string }>(table: EntityTable<T, "id">, incoming: T[]) {
  // Tables are small (a few thousand rows), so reading them whole is simplest.
  const local = new Map((await table.toArray()).map((r) => [r.id, r]))
  await table.bulkPut(incoming.filter((r) => !local.has(r.id) || r.updatedAt > local.get(r.id)!.updatedAt))
}

// ---------- templates (sharing task definitions without history) ----------

export interface Template {
  app: "habit-tracker"
  kind: "template"
  version: 1
  categories: { key: string; name: string; color: string; icon: string }[]
  tasks: (Omit<TaskInput, "categoryIds"> & { categoryKeys: string[] })[]
}

/**
 * Task definitions (with their current goal) and categories, without any entries,
 * so someone else can import them and do the tasks too. Categories of the chosen
 * tasks are always included.
 */
export async function exportTemplate(taskIds: string[], categoryIds: string[]): Promise<Template> {
  const tasks = await Promise.all(taskIds.map((id) => taskToInput(id)))
  const allCategoryIds = [...new Set([...categoryIds, ...tasks.flatMap((t) => t.categoryIds)])]
  const categories = (await db.categories.bulkGet(allCategoryIds)).filter((c): c is Category => !!c && !c.deletedAt)
  return {
    app: "habit-tracker",
    kind: "template",
    version: 1,
    categories: categories.map((c) => ({ key: c.id, name: c.name, color: c.color, icon: c.icon })),
    tasks: tasks.map(({ categoryIds: ids, ...task }) => ({ ...task, categoryKeys: ids })),
  }
}

export function isTemplate(data: unknown): data is Template {
  return (data as Template)?.app === "habit-tracker" && (data as Template)?.kind === "template"
}

/** Adds a template's tasks as new tasks. Categories are matched by name (case-insensitive) or created. */
export async function importTemplate(template: Template): Promise<{ tasks: number; categories: number }> {
  const existing = (await db.categories.toArray()).filter((c) => !c.deletedAt)
  const idByKey = new Map<string, string>()
  let createdCategories = 0
  for (const c of template.categories) {
    const match = existing.find((e) => e.name.toLowerCase() === c.name.toLowerCase())
    if (match) idByKey.set(c.key, match.id)
    else {
      idByKey.set(c.key, await createCategory(c.name, c.color, c.icon ?? ""))
      createdCategories++
    }
  }
  for (const { categoryKeys, ...task } of template.tasks) {
    const categoryIds = categoryKeys.map((k) => idByKey.get(k)).filter((id): id is string => !!id)
    await createTask({ ...task, unit: task.unit ?? "", categoryIds })
  }
  return { tasks: template.tasks.length, categories: createdCategories }
}
