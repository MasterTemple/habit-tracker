import {
  BellIcon,
  ChevronDownIcon,
  DatabaseBackupIcon,
  FileTextIcon,
  PlusIcon,
  TreePalmIcon,
  WebhookIcon,
} from "lucide-react"
import { useState } from "react"
import { AutomationEditor, type AutomationKind, type AutomationTarget } from "@/components/AutomationEditor"
import { BottomAction, ListRow, PinnedTabs, ServerNote } from "@/components/layout"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { saveAutomation } from "@/db/repo"
import { describeSchedule } from "@/domain/schedule"
import type { Automation, TaskException } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { useViewTab } from "@/hooks/useNav"
import { breakDates, breakScopeNames } from "@/lib/breaks"
import { scopeSummary } from "@/lib/scope"
import { cn } from "@/lib/utils"

const TABS = [
  { value: "breaks", label: "Breaks" },
  { value: "reminders", label: "Reminders" },
  { value: "actions", label: "Actions" },
  { value: "webhooks", label: "Webhooks" },
]

export function SchedulePage() {
  const [tab, setTab] = useViewTab("schedule")
  const [editing, setEditing] = useState<AutomationTarget | null>(null)

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <PinnedTabs tabs={TABS} />
      <TabsContent value="breaks">
        <BreaksList />
      </TabsContent>
      <TabsContent value="reminders">
        <AutomationList
          kinds={["reminder"]}
          note="Reminders are sent by your sync server, so sign in (Settings → Account & sync) and turn on notifications for this device. They also land in Social → Inbox."
          empty="No reminders. Add one to get nudged at a set time, for one task or a whole category."
          onEdit={setEditing}
        />
      </TabsContent>
      <TabsContent value="actions">
        <AutomationList
          kinds={["report", "export"]}
          note="Reports and backups are emailed by your sync server while you're signed in (it needs email set up, and your address in Settings → Account & sync)."
          empty="No scheduled actions. Send a weekly report to a friend, or email yourself a backup."
          onEdit={setEditing}
        />
      </TabsContent>
      <TabsContent value="webhooks">
        <AutomationList
          kinds={["webhook_in", "webhook_out"]}
          note="Incoming webhooks record progress from other apps (a shortcut link, or a web address once you're signed in). Outgoing webhooks are sent by your sync server, so they need you to be signed in."
          empty="No webhooks. Record progress from other apps (e.g. an iOS Shortcut when you open YouTube), or notify another service."
          onEdit={setEditing}
        />
      </TabsContent>
      <AutomationEditor target={editing} onClose={() => setEditing(null)} />
    </Tabs>
  )
}

const KIND_INFO: Record<AutomationKind, { label: string; icon: typeof BellIcon }> = {
  reminder: { label: "Reminder", icon: BellIcon },
  report: { label: "Report", icon: FileTextIcon },
  export: { label: "Backup", icon: DatabaseBackupIcon },
  webhook_in: { label: "Incoming webhook", icon: WebhookIcon },
  webhook_out: { label: "Outgoing webhook", icon: WebhookIcon },
}

function AutomationList({
  kinds,
  note,
  empty,
  onEdit,
}: {
  kinds: AutomationKind[]
  note: string
  empty: string
  onEdit: (target: AutomationTarget) => void
}) {
  const { automations, tasks, categories } = useAppData()
  const items = automations.filter((a) => kinds.includes(a.kind))

  const subtitle = (a: Automation) => {
    switch (a.kind) {
      case "reminder":
      case "report":
        return `${describeSchedule(a.schedule)} · ${scopeSummary(a.scope, categories, tasks)}`
      case "export":
        return describeSchedule(a.schedule)
      case "webhook_in": {
        const task = tasks.find((t) => t.task.id === a.taskId)?.task.name ?? "Deleted task"
        return `Records ${a.amount > 0 ? "+" : ""}${a.amount} on ${task}`
      }
      case "webhook_out":
        return a.url
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ServerNote>{note}</ServerNote>
      {items.length === 0 && <p className="mt-6 text-center text-sm text-muted-foreground">{empty}</p>}
      {items.map((a) => {
        const { icon: Icon, label } = KIND_INFO[a.kind]
        return (
          <ListRow
            key={a.id}
            icon={<Icon className="size-4" />}
            title={a.name || label}
            subtitle={subtitle(a)}
            muted={!a.enabled}
            onClick={() => onEdit({ id: a.id })}
            trailing={
              <Switch
                checked={a.enabled}
                onCheckedChange={(enabled) => saveAutomation({ ...a, enabled })}
                aria-label={`Turn ${a.name || label} ${a.enabled ? "off" : "on"}`}
              />
            }
          />
        )
      })}
      <BottomAction>
        {kinds.length === 1 ? (
          <Button variant="outline" className="w-full" onClick={() => onEdit({ kind: kinds[0] })}>
            <PlusIcon /> New {KIND_INFO[kinds[0]].label.toLowerCase()}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full">
                <PlusIcon /> New…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top">
              {kinds.map((kind) => {
                const { icon: Icon, label } = KIND_INFO[kind]
                return (
                  <DropdownMenuItem key={kind} onSelect={() => onEdit({ kind })}>
                    <Icon /> {label}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </BottomAction>
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

  return (
    <div className="flex flex-col gap-4">
      {exceptions.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No breaks. Add one for vacations or sick days: goals are reduced or excused, and you can still log
          progress.
        </p>
      )}
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
      <BottomAction>
        <Button variant="outline" className="w-full" onClick={() => openBreak({})}>
          <PlusIcon /> New break
        </Button>
      </BottomAction>
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
        <ListRow
          key={e.id}
          icon={<TreePalmIcon className="size-4" />}
          title={
            <>
              {breakDates(e)}
              {e.description && <span className="font-normal text-muted-foreground"> · {e.description}</span>}
            </>
          }
          subtitle={breakScopeNames(
            e,
            categories,
            tasks.map((t) => t.task),
          ).join(", ")}
          onClick={() => openBreak({ id: e.id })}
        />
      ))}
    </div>
  )
}
