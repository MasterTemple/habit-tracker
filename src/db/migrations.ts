import { toLocalTime } from "@/domain/dates"
import type { TaskException } from "@/domain/types"

/** Break shape before v2, when a break had a single task/category/all scope. */
interface ExceptionV1 extends Omit<TaskException, "appliesToAll" | "taskIds" | "categoryIds"> {
  scopeType: "task" | "category" | "all"
  scopeId: string | null
}

export function migrateExceptionV1(old: ExceptionV1): TaskException {
  const { scopeType, scopeId, ...rest } = old
  return {
    ...rest,
    appliesToAll: scopeType === "all",
    taskIds: scopeType === "task" && scopeId ? [scopeId] : [],
    categoryIds: scopeType === "category" && scopeId ? [scopeId] : [],
  }
}

export function isExceptionV1(e: object): e is ExceptionV1 {
  return "scopeType" in e
}

/**
 * Entries from before local times were recorded: derive the time from the UTC
 * timestamp in the current zone (usually where it was recorded); zone unknown.
 */
export function legacyEventTime(e: { occurredAt: string; localTime?: string; timeZone?: string }) {
  return { localTime: e.localTime ?? toLocalTime(new Date(e.occurredAt)), timeZone: e.timeZone ?? "" }
}
