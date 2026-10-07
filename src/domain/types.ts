// Core domain types. Everything else (progress, streaks, totals) is derived
// from these records — see status.ts.

/** Calendar date in the user's local time, e.g. "2026-10-06". Sorts lexicographically. */
export type LocalDate = string

/** UTC timestamp in ISO-8601 format. */
export type Timestamp = string

export type TaskType =
  | "accumulate" // reach at least N per period
  | "limit" // stay at or under N per period
  | "track" // just record that it happened; no goal

export type Period = "day" | "week" | "month"

export type DisplayMode = "today" | "period" | "total"

export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface Task {
  id: string
  name: string
  description: string
  type: TaskType
  icon: string
  color: string
  sortOrder: number
  incrementAmounts: number[]
  displayMode: DisplayMode
  createdAt: Timestamp
  updatedAt: Timestamp
  retiredAt: Timestamp | null
  createdFromId: string | null
}

/**
 * A versioned goal. The version in effect for a period is the latest one whose
 * effectiveFrom is on or before the period start; there is no end date.
 */
export interface TaskTarget {
  id: string
  taskId: string
  period: Period
  amount: number
  carryOver: boolean
  effectiveFrom: LocalDate
  updatedAt: Timestamp
}

export interface TaskEvent {
  id: string
  taskId: string
  /** Positive to add, negative to correct. */
  amount: number
  occurredAt: Timestamp
  /** The day this counts toward, fixed when recorded (respects day start hour and time zone at that moment). */
  localDate: LocalDate
  note: string
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt: Timestamp | null
}

export interface Category {
  id: string
  name: string
  color: string
  sortOrder: number
  updatedAt: Timestamp
  deletedAt: Timestamp | null
}

export interface TaskCategory {
  taskId: string
  categoryId: string
}

/**
 * A break from the normal schedule (vacation, sickness). Progress can still be
 * recorded; see status.ts for how targets are adjusted.
 */
export interface TaskException {
  id: string
  /** When true, taskIds and categoryIds are ignored. */
  appliesToAll: boolean
  taskIds: string[]
  /** Applies to every task in these categories. */
  categoryIds: string[]
  startDate: LocalDate
  /** Inclusive. */
  endDate: LocalDate
  description: string
  updatedAt: Timestamp
  deletedAt: Timestamp | null
}

export interface Settings {
  weekStartsOn: WeekStart
  /** Hour (0–23) when a new day begins; events before it count toward the previous day. */
  dayStartHour: number
  carryOverDefault: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  weekStartsOn: 0,
  dayStartHour: 0,
  carryOverDefault: false,
}
