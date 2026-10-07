import { addDays, addMonths, getDaysInMonth, setDate } from "date-fns"
import type { Schedule } from "./types"

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const DEFAULT_SCHEDULE: Schedule = { repeat: "daily", time: "18:00", weekdays: [6], monthDay: 1 }

export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"
  return `${n}${suffix}`
}

/** "Every day at 6:00 PM", "Sat, Sun at 9:00 AM", "Monthly on the 1st at 9:00 AM". */
export function describeSchedule(s: Schedule): string {
  const at = `at ${formatTime(s.time)}`
  switch (s.repeat) {
    case "daily":
      return `Every day ${at}`
    case "weekly": {
      const days = [...s.weekdays].sort()
      if (days.length === 0) return "Never (no days picked)"
      if (days.length === 7) return `Every day ${at}`
      if (days.join() === "1,2,3,4,5") return `Weekdays ${at}`
      if (days.join() === "0,6") return `Weekends ${at}`
      return `${days.map((d) => WEEKDAY_NAMES[d]).join(", ")} ${at}`
    }
    case "monthly":
      return `Monthly on the ${ordinal(s.monthDay)} ${at}`
  }
}

function atTime(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number)
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d
}

/** The next time the schedule fires strictly after `from`, or null if it never does. */
export function nextRun(s: Schedule, from: Date): Date | null {
  if (s.repeat === "monthly") {
    for (let i = 0; i < 3; i++) {
      const month = addMonths(new Date(from.getFullYear(), from.getMonth(), 1), i)
      const day = setDate(month, Math.min(s.monthDay, getDaysInMonth(month)))
      const run = atTime(day, s.time)
      if (run > from) return run
    }
    return null
  }
  const days = s.repeat === "daily" ? [0, 1, 2, 3, 4, 5, 6] : s.weekdays
  if (days.length === 0) return null
  for (let i = 0; i < 8; i++) {
    const day = addDays(from, i)
    const run = atTime(day, s.time)
    if (days.includes(day.getDay()) && run > from) return run
  }
  return null
}
