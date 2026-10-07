import type { Channel, Relationship, TaskEventKind } from "@/domain/types"

export const EVENT_OPTIONS: { value: TaskEventKind; label: string }[] = [
  { value: "entry", label: "Progress is made" },
  { value: "completed", label: "Goal completed" },
  { value: "failed", label: "Goal missed / over limit" },
  { value: "deadline_missed", label: "Deadline missed" },
  { value: "streak_broken", label: "Streak broken" },
]

export const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: "push", label: "Notification" },
  { value: "email", label: "Email" },
  { value: "sms", label: "Text" },
]

export const RELATIONSHIPS: { value: Relationship; label: string }[] = [
  { value: "friend", label: "Friend" },
  { value: "family", label: "Family" },
  { value: "partner", label: "Accountability partner" },
  { value: "coach", label: "Coach / mentor" },
  { value: "other", label: "Other" },
]

export const WEEKDAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, value) => ({ value, label }))
