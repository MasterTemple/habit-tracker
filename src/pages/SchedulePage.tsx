import { BellIcon, CalendarClockIcon, ChevronDownIcon, TreePalmIcon, WebhookIcon } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { TaskException } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { breakDates, breakScopeNames } from "@/lib/breaks"
import { cn } from "@/lib/utils"

export function SchedulePage() {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Schedule" />
      <Tabs defaultValue="breaks">
        <TabsList className="w-full">
          <TabsTrigger value="breaks">Breaks</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
        </TabsList>
        <TabsContent value="breaks" className="mt-2">
          <BreaksList />
        </TabsContent>
        <TabsContent value="automations" className="mt-2">
          <Automations />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function BreaksList() {
  const { exceptions, today } = useAppData()
  const { openBreak } = useEditors()
  const [showPast, setShowPast] = useState(false)

  const byStart = [...exceptions].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const current = byStart.filter((e) => e.startDate <= today && e.endDate >= today)
  const upcoming = byStart.filter((e) => e.startDate > today)
  const past = byStart.filter((e) => e.endDate < today).reverse()

  if (exceptions.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
        <TreePalmIcon className="size-8" />
        <p>
          No breaks. Add one for vacations or sick days: goals are reduced or excused, and you can still log
          progress.
        </p>
        <Button onClick={() => openBreak({})}>New break</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <BreakGroup title="Now" items={current} />
      <BreakGroup title="Upcoming" items={upcoming} />
      {past.length > 0 && (
        <div className="grid gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground"
            onClick={() => setShowPast((v) => !v)}
          >
            <ChevronDownIcon className={cn("size-4 transition-transform", showPast && "rotate-180")} />
            Past ({past.length})
          </button>
          {showPast && <BreakGroup items={past} />}
        </div>
      )}
    </div>
  )
}

function BreakGroup({ title, items }: { title?: string; items: TaskException[] }) {
  const { categories, tasks } = useAppData()
  const { openBreak } = useEditors()
  if (items.length === 0) return null
  return (
    <div className="grid gap-2">
      {title && <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>}
      {items.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => openBreak({ id: e.id })}
          className="flex items-start gap-3 rounded-xl border bg-card p-3 text-left"
        >
          <TreePalmIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">
              {breakDates(e)}
              {e.description && <span className="font-normal text-muted-foreground"> · {e.description}</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {breakScopeNames(
                e,
                categories,
                tasks.map((t) => t.task),
              ).join(", ")}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

function Automations() {
  const planned = [
    { icon: BellIcon, title: "Reminders", text: "Notify you at set times, per task or for a whole category." },
    { icon: CalendarClockIcon, title: "Scheduled actions", text: "e.g. “6pm Saturday: send a weekly report” or export data." },
    { icon: WebhookIcon, title: "Webhooks", text: "Record progress from other apps, or notify other services." },
  ]
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
      <p>These need the sync server and are coming later.</p>
      {planned.map(({ icon: Icon, title, text }) => (
        <div key={title} className="flex gap-3">
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium text-foreground">{title}</div>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
