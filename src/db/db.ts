import { Dexie, type EntityTable, type Table, type Transaction } from "dexie"
import { isExceptionV1, legacyEventTime, migrateExceptionV1 } from "./migrations"
import type {
  Automation,
  Category,
  Contact,
  Settings,
  Share,
  Task,
  TaskEvent,
  TaskException,
  TaskTarget,
  Timestamp,
} from "@/domain/types"

export interface SettingsRow extends Settings {
  key: "settings"
  updatedAt: Timestamp
}

/** A permanently deleted row, waiting to be sent to the sync server. */
export interface Tombstone {
  table: SyncedTable
  id: string
  deletedAt: Timestamp
}

/** This device's sign-in and sync position. Never synced. */
export interface Account {
  key: "account"
  serverUrl: string
  token: string
  username: string
  /** The server's sync cursor last received. */
  cursor: number
  lastSyncAt: Timestamp | null
  lastError: string | null
}

/** Tables that sync. Every row carries `dirty: 1` until the server has it. */
export const SYNCED_TABLES = [
  "tasks",
  "targets",
  "events",
  "categories",
  "exceptions",
  "automations",
  "contacts",
  "shares",
  "settings",
] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

export class HabitDB extends Dexie {
  tasks!: EntityTable<Task, "id">
  targets!: EntityTable<TaskTarget, "id">
  events!: EntityTable<TaskEvent, "id">
  categories!: EntityTable<Category, "id">
  exceptions!: EntityTable<TaskException, "id">
  settings!: EntityTable<SettingsRow, "key">
  automations!: EntityTable<Automation, "id">
  contacts!: EntityTable<Contact, "id">
  shares!: EntityTable<Share, "id">
  tombstones!: Table<Tombstone, [string, string]>
  account!: EntityTable<Account, "key">

  constructor(name = "habit-tracker") {
    super(name)
    this.version(1).stores({
      tasks: "id, sortOrder, updatedAt",
      targets: "id, taskId, updatedAt",
      events: "id, taskId, localDate, [taskId+localDate], updatedAt",
      categories: "id, sortOrder, updatedAt",
      taskCategories: "[taskId+categoryId], taskId, categoryId",
      exceptions: "id, scopeType, scopeId, updatedAt",
      settings: "key",
    })
    // v2: breaks can cover several tasks and categories.
    this.version(2)
      .stores({ exceptions: "id, *taskIds, *categoryIds, updatedAt" })
      .upgrade((tx) =>
        tx
          .table("exceptions")
          .toCollection()
          .modify((e, ref) => {
            if (isExceptionV1(e)) ref.value = migrateExceptionV1(e)
          }),
      )
    // v3: task units and category default icons.
    this.version(3).upgrade(async (tx) => {
      await tx.table("tasks").toCollection().modify((t) => {
        t.unit ??= ""
      })
      await tx.table("categories").toCollection().modify((c) => {
        c.icon ??= ""
      })
    })
    // v4: reminders/actions/webhooks, friends, and sharing rules.
    this.version(4).stores({
      automations: "id, kind, updatedAt",
      contacts: "id, updatedAt",
      shares: "id, kind, updatedAt",
    })
    // v5: due times on tasks; wall-clock time and zone on entries.
    this.version(5).upgrade(async (tx) => {
      await tx.table("tasks").toCollection().modify((t) => {
        t.dueTime ??= null
      })
      await tx.table("events").toCollection().modify((e) => {
        Object.assign(e, legacyEventTime(e))
      })
    })
    // v6: sync. Task categories move onto the task (so a task syncs as one row), every
    // synced row gets a `dirty` flag (all existing data starts unsynced), and permanent
    // deletes leave tombstones.
    this.version(6)
      .stores({
        tasks: "id, sortOrder, updatedAt, *categoryIds, dirty",
        targets: "id, taskId, updatedAt, dirty",
        events: "id, taskId, localDate, [taskId+localDate], updatedAt, dirty",
        categories: "id, sortOrder, updatedAt, dirty",
        exceptions: "id, *taskIds, *categoryIds, updatedAt, dirty",
        settings: "key, dirty",
        automations: "id, kind, updatedAt, dirty",
        contacts: "id, updatedAt, dirty",
        shares: "id, kind, updatedAt, dirty",
        tombstones: "[table+id]",
        account: "key",
      })
      .upgrade(async (tx) => {
        // (Very old test databases may never have had the link table.)
        const hasLinks = tx.idbtrans.db.objectStoreNames.contains("taskCategories")
        const links: { taskId: string; categoryId: string }[] = hasLinks ? await tx.table("taskCategories").toArray() : []
        await tx.table("tasks").toCollection().modify((t) => {
          t.categoryIds = links.filter((l) => l.taskId === t.id).map((l) => l.categoryId)
        })
        await tx.table("settings").toCollection().modify((s) => {
          s.updatedAt ??= new Date().toISOString()
        })
        for (const name of SYNCED_TABLES) {
          await tx.table(name).toCollection().modify((row) => {
            row.dirty = 1
          })
        }
      })
    // v7: the old task–category link table is no longer used (moved onto tasks in v6).
    this.version(7).stores({ taskCategories: null })

    this.trackChanges()
  }

  /**
   * Marks rows dirty whenever the app changes them, so sync finds them without every
   * feature having to remember. Writes from sync itself run in a transaction marked
   * with markRemote() and are left alone.
   */
  private trackChanges() {
    for (const name of SYNCED_TABLES) {
      const table = this.table(name)
      table.hook("creating", (_key, obj, tx) => {
        if (isRemote(tx)) return
        obj.dirty = 1
        notifyLocalChange()
      })
      table.hook("updating", (_mods, _key, _obj, tx) => {
        if (isRemote(tx)) return
        notifyLocalChange()
        return { dirty: 1 }
      })
    }
  }
}

const REMOTE = Symbol("remote")

/** Marks the current transaction as applying server data (not a local change). */
export function markRemote() {
  const tx = Dexie.currentTransaction as (Transaction & { [REMOTE]?: true }) | null
  if (tx) tx[REMOTE] = true
}

function isRemote(tx: Transaction): boolean {
  // Hooks may get a child transaction; check up the chain.
  for (let t: (Transaction & { [REMOTE]?: true; parent?: Transaction }) | undefined = tx; t; t = t.parent) {
    if (t[REMOTE]) return true
  }
  return false
}

const listeners = new Set<() => void>()

/** Called (outside the transaction) after the app changes synced data. */
export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyLocalChange() {
  setTimeout(() => listeners.forEach((l) => l()), 0)
}

export const db = new HabitDB()
