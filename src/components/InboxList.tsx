import { format, formatDistanceToNow } from "date-fns"
import { BellIcon, BellRingIcon, CheckCheckIcon, InboxIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { readItems, refreshInbox, useInbox } from "@/hooks/useInbox"
import { useSync } from "@/hooks/useSync"
import { groupInbox, inboxSection, type InboxGroup, type InboxSection } from "@/lib/inbox"
import { cn } from "@/lib/utils"
import type { InboxItem } from "@/sync/notifications"
import { ListRow, SubTabs } from "./layout"

const KIND_LABEL: Record<string, string> = {
  reminder: "Reminder",
  alert: "Alert",
  "alert-status": "Alert",
  test: "Test",
  report: "Report",
  share: "Shared with you",
  "friend-request": "Friend request",
  "friend-accepted": "Friends",
}

const SECTIONS: { value: InboxSection; label: string; empty: string }[] = [
  { value: "general", label: "General", empty: "Nothing yet. Friend requests, shared tasks, and reminders show up here." },
  { value: "alerts", label: "Alerts", empty: "No alerts yet. When friends add you to their accountability alerts, they show up here." },
]

const when = (at: string) => format(new Date(at), "EEE, MMM d 'at' h:mm a")

/** Every notification the server sent this account, newest first; repeats stack into one row. */
export function InboxList({ openId, onOpened }: { openId: string | null; onOpened: () => void }) {
  const signedIn = !!useSync()?.account?.token
  const inbox = useInbox()
  const [chosenSection, setSection] = useState<InboxSection>("general")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const groups = useMemo(() => groupInbox(inbox.items), [inbox.items])
  // A tapped notification (openId) shows its stack once the inbox has it.
  const shownId = selectedId ?? openId
  const open: InboxGroup | null = groups.find((g) => g.items.some((i) => i.id === shownId)) ?? null

  useEffect(() => {
    if (openId && inbox.loaded && !inbox.items.some((i) => i.id === openId)) void refreshInbox()
  }, [openId, inbox.loaded, inbox.items])

  // A tapped notification shows its section too (and stays there once closed).
  const openSection = open && inboxSection(open.latest.kind)
  const section = (openId && openSection) || chosenSection

  const unreadIds = open?.items.filter((i) => !i.readAt).map((i) => i.id).join(",")
  useEffect(() => {
    if (unreadIds) void readItems(unreadIds.split(","))
  }, [unreadIds])

  const close = () => {
    setSelectedId(null)
    setSection(section)
    if (openId) onOpened()
  }

  if (!signedIn) {
    return (
      <p className="mt-10 text-center text-sm text-muted-foreground">
        Sign in (Settings → Account & sync) to get reminders and alerts here.
      </p>
    )
  }

  const unreadIn = (s: InboxSection) => groups.filter((g) => g.section === s && g.unread > 0).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={unreadOnly} onCheckedChange={(v) => setUnreadOnly(v === true)} />
          Show unread
        </Label>
        {inbox.unread > 0 && (
          <Button variant="ghost" size="sm" onClick={() => readItems()}>
            <CheckCheckIcon /> Mark all read
          </Button>
        )}
      </div>
      {inbox.error && <p className="text-xs text-destructive">{inbox.error}</p>}

      <Tabs value={section} onValueChange={(v) => setSection(v as InboxSection)}>
        <SubTabs
          tabs={SECTIONS.map((s) => ({
            value: s.value,
            label: unreadIn(s.value) ? `${s.label} (${unreadIn(s.value)})` : s.label,
          }))}
        />
        {SECTIONS.map((s) => {
          const shown = groups.filter((g) => g.section === s.value && (!unreadOnly || g.unread > 0))
          return (
            <TabsContent key={s.value} value={s.value} className="flex flex-col gap-3">
              {inbox.loaded && shown.length === 0 && (
                <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                  <InboxIcon className="size-8" />
                  {unreadOnly && groups.some((g) => g.section === s.value) ? "All caught up." : s.empty}
                </div>
              )}
              {shown.map((g) => (
                <InboxRow key={g.latest.id} group={g} onOpen={() => setSelectedId(g.latest.id)} />
              ))}
            </TabsContent>
          )
        })}
      </Tabs>

      <Dialog open={!!open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.latest.title}</DialogTitle>
                <DialogDescription>
                  {KIND_LABEL[open.latest.kind] ?? "Notification"} · {when(open.latest.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm whitespace-pre-wrap">{open.latest.body}</p>
              <InboxDetails item={open.latest} />
              {open.items.length > 1 && (
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-muted-foreground">Sent {open.items.length} times</div>
                  <ul className="max-h-48 overflow-y-auto text-sm">
                    {open.items.map((i) => (
                      <li key={i.id} className="py-0.5">
                        {format(new Date(i.createdAt), "EEE, MMM d 'at' h:mm:ss a")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InboxRow({ group, onOpen }: { group: InboxGroup; onOpen: () => void }) {
  const { latest, items, unread } = group
  return (
    <ListRow
      icon={unread ? <BellRingIcon className="size-4 text-primary" /> : <BellIcon className="size-4" />}
      title={
        <span className={cn(unread > 0 && "font-semibold")}>
          {latest.title}
          {items.length > 1 && <span className="font-normal text-muted-foreground"> · ×{items.length}</span>}
        </span>
      }
      subtitle={
        <>
          <span className="line-clamp-2">{latest.body}</span>
          <span>{formatDistanceToNow(new Date(latest.createdAt), { addSuffix: true })}</span>
        </>
      }
      onClick={onOpen}
      trailing={unread > 0 && <span className="mr-1 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    />
  )
}

/** Extra details the server attached (e.g. the tasks a reminder was about). */
function InboxDetails({ item }: { item: InboxItem }) {
  const tasks = Array.isArray(item.data.tasks) ? (item.data.tasks as string[]) : []
  if (tasks.length === 0) return null
  return (
    <div className="grid gap-1">
      <div className="text-xs font-medium text-muted-foreground">Still to do at the time</div>
      <ul className="list-disc pl-5 text-sm">
        {tasks.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
}
