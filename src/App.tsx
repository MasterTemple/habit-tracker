import { CalendarDaysIcon, ListChecksIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { Toaster } from "@/components/ui/sonner"
import { AppDataProvider } from "@/hooks/useAppData"
import { EditorsProvider } from "@/hooks/useEditors"
import { NavProvider, useNav, type PageId } from "@/hooks/useNav"
import { useShortcutLinks } from "@/hooks/useShortcutLinks"
import { useSwipe } from "@/hooks/useSwipe"
import { cn } from "@/lib/utils"
import { startAutoSync } from "@/sync/engine"
import { SchedulePage } from "@/pages/SchedulePage"
import { SettingsPage } from "@/pages/SettingsPage"
import { SocialPage } from "@/pages/SocialPage"
import { TasksPage } from "@/pages/TasksPage"

const PAGES: { id: PageId; label: string; icon: typeof ListChecksIcon; component: () => React.ReactNode }[] = [
  { id: "tasks", label: "Tasks", icon: ListChecksIcon, component: TasksPage },
  { id: "schedule", label: "Schedule", icon: CalendarDaysIcon, component: SchedulePage },
  { id: "social", label: "Social", icon: UsersIcon, component: SocialPage },
  { id: "settings", label: "Settings", icon: SettingsIcon, component: SettingsPage },
]

export default function App() {
  return (
    <AppDataProvider>
      <EditorsProvider>
        <NavProvider>
          <Shell />
        </NavProvider>
      </EditorsProvider>
      <Toaster position="top-center" />
    </AppDataProvider>
  )
}

function Shell() {
  const { page, direction, setPage, step } = useNav()
  const Page = PAGES.find((p) => p.id === page)!.component
  const main = useRef<HTMLElement>(null)
  useSwipe(main, step)
  useShortcutLinks()
  useEffect(() => startAutoSync(), [])

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-background">
      <main ref={main} className="flex-1 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-24">
        <div
          key={page}
          className={cn(
            "animate-in duration-200 fade-in",
            direction === 1 ? "slide-in-from-right-6" : "slide-in-from-left-6",
          )}
        >
          <Page />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {PAGES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-xs",
                page === id ? "text-foreground" : "text-muted-foreground",
              )}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
