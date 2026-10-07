import { Dexie, type EntityTable, type Table } from "dexie"
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
  }
}

export const db = new HabitDB()
