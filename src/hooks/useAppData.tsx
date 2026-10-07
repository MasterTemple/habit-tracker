import { useLiveQuery } from "dexie-react-hooks"
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { db } from "@/db/db"
import { getSettings } from "@/db/repo"
import { toLocalDate, toLocalTime } from "@/domain/dates"
import { currentTarget, exceptionsForTask, summarize, type TaskContext, type TaskSummary } from "@/domain/status"
import type {
  Automation,
  Category,
  Contact,
  LocalDate,
  LocalTime,
  Settings,
  Share,
  Task,
  TaskException,
  TaskTarget,
} from "@/domain/types"

export interface TaskView {
  task: Task
  target: TaskTarget | null
  categories: Category[]
  ctx: TaskContext
  summary: TaskSummary
}

export interface AppData {
  settings: Settings
  today: LocalDate
  tasks: TaskView[]
  categories: Category[]
  exceptions: TaskException[]
  automations: Automation[]
  contacts: Contact[]
  shares: Share[]
}

/**
 * The current local date and wall-clock time, rechecked often and whenever the app
 * comes back to the foreground, so day rollovers, deadlines, and time-zone changes
 * (e.g. after a flight) show up without a reload. Both are primitives, so unchanged
 * values don't re-render.
 */
function useClock(dayStartHour: number): { today: LocalDate; now: LocalTime } {
  const [today, setToday] = useState(() => toLocalDate(new Date(), dayStartHour))
  const [now, setNow] = useState(() => toLocalTime(new Date()))
  useEffect(() => {
    const update = () => {
      const moment = new Date()
      setToday(toLocalDate(moment, dayStartHour))
      setNow(toLocalTime(moment))
    }
    update()
    const interval = setInterval(update, 15_000)
    document.addEventListener("visibilitychange", update)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", update)
    }
  }, [dayStartHour])
  return { today, now }
}

const AppDataContext = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  // The whole dataset is small (a few thousand events a year), so load it all and derive in memory.
  const raw = useLiveQuery(async () => ({
    settings: await getSettings(),
    tasks: await db.tasks.orderBy("sortOrder").toArray(),
    targets: await db.targets.toArray(),
    events: await db.events.filter((e) => !e.deletedAt).toArray(),
    categories: (await db.categories.orderBy("sortOrder").toArray()).filter((c) => !c.deletedAt),
    links: await db.taskCategories.toArray(),
    exceptions: (await db.exceptions.toArray()).filter((e) => !e.deletedAt),
    automations: (await db.automations.toArray()).filter((a) => !a.deletedAt),
    contacts: (await db.contacts.toArray()).filter((c) => !c.deletedAt).sort((a, b) => a.name.localeCompare(b.name)),
    shares: (await db.shares.toArray()).filter((s) => !s.deletedAt),
  }))

  const { today, now } = useClock(raw?.settings.dayStartHour ?? 0)

  const value = useMemo<AppData | null>(() => {
    if (!raw) return null
    const categoriesById = new Map(raw.categories.map((c) => [c.id, c]))
    const tasks = raw.tasks.map((task) => {
      const categoryIds = raw.links.filter((l) => l.taskId === task.id).map((l) => l.categoryId)
      const ctx: TaskContext = {
        task,
        targets: raw.targets.filter((t) => t.taskId === task.id),
        events: raw.events.filter((e) => e.taskId === task.id),
        exceptions: exceptionsForTask(task.id, categoryIds, raw.exceptions),
        settings: raw.settings,
        now,
      }
      return {
        task,
        target: currentTarget(ctx.targets, today),
        categories: categoryIds.map((id) => categoriesById.get(id)).filter((c): c is Category => !!c),
        ctx,
        summary: summarize(ctx, today),
      }
    })
    return {
      settings: raw.settings,
      today,
      tasks,
      categories: raw.categories,
      exceptions: raw.exceptions,
      automations: raw.automations,
      contacts: raw.contacts,
      shares: raw.shares,
    }
  }, [raw, today, now])

  if (!value) return null
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppData {
  const value = useContext(AppDataContext)
  if (!value) throw new Error("useAppData must be used inside AppDataProvider")
  return value
}
