import {
  addDays as addDaysToDate,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subHours,
} from "date-fns"
import type { LocalDate, Period, WeekStart } from "./types"

export interface DateRange {
  start: LocalDate
  /** Inclusive. */
  end: LocalDate
}

export function formatLocalDate(date: Date): LocalDate {
  return format(date, "yyyy-MM-dd")
}

/** Local midnight of the given date. */
export function parseLocalDate(date: LocalDate): Date {
  return parseISO(date)
}

/** The day a moment counts toward, shifting early-morning hours back when dayStartHour > 0. */
export function toLocalDate(moment: Date, dayStartHour = 0): LocalDate {
  return formatLocalDate(subHours(moment, dayStartHour))
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return formatLocalDate(addDaysToDate(parseLocalDate(date), days))
}

/** Number of days in the range, counting both ends. */
export function rangeLength(range: DateRange): number {
  return differenceInCalendarDays(parseLocalDate(range.end), parseLocalDate(range.start)) + 1
}

export function periodRange(period: Period, date: LocalDate, weekStartsOn: WeekStart): DateRange {
  const d = parseLocalDate(date)
  switch (period) {
    case "day":
      return { start: date, end: date }
    case "week":
      return {
        start: formatLocalDate(startOfWeek(d, { weekStartsOn })),
        end: formatLocalDate(endOfWeek(d, { weekStartsOn })),
      }
    case "month":
      return {
        start: formatLocalDate(startOfMonth(d)),
        end: formatLocalDate(endOfMonth(d)),
      }
  }
}

export function previousPeriodRange(period: Period, range: DateRange, weekStartsOn: WeekStart): DateRange {
  return periodRange(period, addDays(range.start, -1), weekStartsOn)
}

export type DurationUnit = "day" | "week" | "month"

/** Inclusive end date of a span starting on `start`: 3 days from Oct 6 ends Oct 8; 1 month ends Nov 5. */
export function endOfDuration(start: LocalDate, count: number, unit: DurationUnit): LocalDate {
  const n = Math.max(1, Math.floor(count))
  switch (unit) {
    case "day":
      return addDays(start, n - 1)
    case "week":
      return addDays(start, 7 * n - 1)
    case "month":
      return formatLocalDate(addDaysToDate(addMonths(parseLocalDate(start), n), -1))
  }
}

export function inRange(date: LocalDate, range: DateRange): boolean {
  return date >= range.start && date <= range.end
}

export function formatRange(period: Period, range: DateRange): string {
  const start = parseLocalDate(range.start)
  switch (period) {
    case "day":
      return format(start, "EEE, MMM d")
    case "week":
      return `${format(start, "MMM d")} – ${format(parseLocalDate(range.end), "MMM d")}`
    case "month":
      return format(start, "MMMM yyyy")
  }
}
