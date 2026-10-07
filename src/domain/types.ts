// Core domain types. Everything else (progress, streaks, totals) is derived
// from these records — see status.ts.

/** Calendar date in the user's local time, e.g. "2026-10-06". Sorts lexicographically. */
export type LocalDate = string

/** Wall-clock time of day, 24-hour "HH:MM", in whatever time zone the user was in. */
export type LocalTime = string

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
  /** What's being counted, singular ("time", "minute", "page"); "" for none. */
  unit: string
  /**
   * "Do" tasks only: reach the goal by this wall-clock time (on the period's last day
   * for weekly/monthly goals). Wall-clock, so 9:00 means 9:00 wherever the user is.
   */
  dueTime: LocalTime | null
  sortOrder: number
  incrementAmounts: number[]
  displayMode: DisplayMode
  createdAt: Timestamp
  updatedAt: Timestamp
  retiredAt: Timestamp | null
  createdFromId: string | null
  /** Categories the task is in (stored on the task so it syncs as one row). */
  categoryIds: string[]
}

/**
 * A versioned goal. Track tasks have one too, for its period; their amount is unused. The version in effect for a period is the latest one whose
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
  /** Wall-clock time when recorded, fixed then, so later time-zone changes don't move it. */
  localTime: LocalTime
  /** IANA time zone when recorded (e.g. "America/Denver"); "" if unknown. */
  timeZone: string
  note: string
  createdAt: Timestamp
  updatedAt: Timestamp
  deletedAt: Timestamp | null
}

export interface Category {
  id: string
  name: string
  color: string
  /** Default icon for new tasks in this category; "" for none. */
  icon: string
  sortOrder: number
  updatedAt: Timestamp
  deletedAt: Timestamp | null
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
  /** How limit tasks read: "3 / 4" + "1 left", or "1 / 4 remaining" + "3 used". */
  limitDisplay: "used" | "remaining"
  /** Name of the filter for tasks without a category. */
  uncategorizedName: string
  /** Shown to friends once accounts exist. */
  displayName: string
  username: string
}

export const DEFAULT_SETTINGS: Settings = {
  weekStartsOn: 0,
  dayStartHour: 0,
  carryOverDefault: false,
  limitDisplay: "used",
  uncategorizedName: "Other",
  displayName: "",
  username: "",
}

// ---------- automations, friends, sharing ----------
// Configured and stored locally now; delivery (notifications, emails, links) needs the sync server.

/** Which tasks something applies to: everything, or any mix of tasks and categories. */
export interface Scope {
  appliesToAll: boolean
  taskIds: string[]
  categoryIds: string[]
}

export interface Schedule {
  repeat: "daily" | "weekly" | "monthly"
  /** "HH:MM", 24-hour, local time. */
  time: string
  /** For weekly: 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  /** For monthly: 1–31 (clamped to the month's last day). */
  monthDay: number
}

export type Channel = "push" | "email" | "sms"

interface Row {
  id: string
  name: string
  enabled: boolean
  updatedAt: Timestamp
  deletedAt: Timestamp | null
}

export interface Reminder extends Row {
  kind: "reminder"
  scope: Scope
  schedule: Schedule
  message: string
  /** Skip the reminder when every task in scope is already done for its period. */
  onlyIfIncomplete: boolean
  channels: Channel[]
}

export interface ScheduledAction extends Row {
  kind: "report" | "export"
  scope: Scope
  schedule: Schedule
  /** For reports: the period the report covers. */
  period: Period
  contactIds: string[]
  emails: string[]
}

/** Records progress when opened (works now, via a link) or called (needs the server). */
export interface IncomingWebhook extends Row {
  kind: "webhook_in"
  taskId: string
  amount: number
  /** Random, unguessable part of the server URL. */
  token: string
}

/** "entry" = progress was recorded (any entry on the task). */
export type TaskEventKind = "entry" | "completed" | "failed" | "deadline_missed" | "streak_broken"

/** Posts to a URL when something happens. */
export interface OutgoingWebhook extends Row {
  kind: "webhook_out"
  scope: Scope
  url: string
  events: TaskEventKind[]
}

export type Automation = Reminder | ScheduledAction | IncomingWebhook | OutgoingWebhook

export type Relationship = "friend" | "family" | "partner" | "coach" | "other"

export interface Contact {
  id: string
  name: string
  relationship: Relationship
  /** Their username here, once accounts exist. */
  username: string
  phone: string
  email: string
  telegram: string
  /** Signal phone number or username. */
  signal: string
  /** Discord user ID (numeric), needed to open a DM. */
  discordId: string
  notes: string
  updatedAt: Timestamp
  deletedAt: Timestamp | null
}

/** Lets people see progress on the tasks in scope. */
export interface ShareRule extends Row {
  kind: "view"
  scope: Scope
  contactIds: string[]
  /** Unlisted: anyone with the link can view. */
  anyoneWithLink: boolean
  /** Random part of the share link. */
  token: string
  webhookUrl: string
}

/** Tells people when things happen to the tasks in scope. */
export interface NotifyRule extends Row {
  kind: "notify"
  scope: Scope
  contactIds: string[]
  events: TaskEventKind[]
  channels: Channel[]
  webhookUrl: string
}

export type Share = ShareRule | NotifyRule
