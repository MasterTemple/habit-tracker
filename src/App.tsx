import { ListChecksIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { AppDataProvider } from "@/hooks/useAppData"
import { cn } from "@/lib/utils"
import { SettingsPage } from "@/pages/SettingsPage"
import { SocialPage } from "@/pages/SocialPage"
import { TasksPage } from "@/pages/TasksPage"

const PAGES = [
  { id: "tasks", label: "Tasks", icon: ListChecksIcon, component: TasksPage },
  { id: "social", label: "Social", icon: UsersIcon, component: SocialPage },
  { id: "settings", label: "Settings", icon: SettingsIcon, component: SettingsPage },
] as const

type PageId = (typeof PAGES)[number]["id"]

export default function App() {
  const [page, setPage] = useState<PageId>("tasks")
  const Page = PAGES.find((p) => p.id === page)!.component

  return (
    <AppDataProvider>
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-background">
        <main className="flex-1 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-24">
          <Page />
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto grid max-w-lg grid-cols-3">
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
      <Toaster position="top-center" />
    </AppDataProvider>
  )
}
