import { Dexie, type EntityTable, type Table } from "dexie"
import { isExceptionV1, migrateExceptionV1 } from "./migrations"
import type { Category, Settings, Task, TaskCategory, TaskEvent, TaskException, TaskTarget } from "@/domain/types"

export interface SettingsRow extends Settings {
  key: "settings"
}

export class HabitDB extends Dexie {
  tasks!: EntityTable<Task, "id">
  targets!: EntityTable<TaskTarget, "id">
  events!: EntityTable<TaskEvent, "id">
  categories!: EntityTable<Category, "id">
  taskCategories!: Table<TaskCategory, [string, string]>
  exceptions!: EntityTable<TaskException, "id">
  settings!: EntityTable<SettingsRow, "key">

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
  }
}

export const db = new HabitDB()
