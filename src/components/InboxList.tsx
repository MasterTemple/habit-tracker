import { format, formatDistanceToNow } from "date-fns"
import { BellIcon, BellRingIcon, CheckCheckIcon, InboxIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { readItems, refreshInbox, useInbox } from "@/hooks/useInbox"
import { useSync } from "@/hooks/useSync"
import { cn } from "@/lib/utils"
import type { InboxItem } from "@/sync/notifications"
import { ListRow } from "./layout"

const KIND_LABEL: Record<string, string> = { reminder: "Reminder", alert: "Alert", test: "Test" }

/** Every notification the server sent this account, newest first. */
export function InboxList({ openId, onOpened }: { openId: string | null; onOpened: () => void }) {
  const signedIn = !!useSync()?.account?.token
  const inbox = useInbox()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A tapped notification (openId) shows its item once the inbox has it.
  const shownId = selectedId ?? openId
  const open: InboxItem | null = inbox.items.find((i) => i.id === shownId) ?? null

  useEffect(() => {
    if (openId && inbox.loaded && !inbox.items.some((i) => i.id === openId)) void refreshInbox()
  }, [openId, inbox.loaded, inbox.items])

  useEffect(() => {
    if (open && !open.readAt) void readItems([open.id])
  }, [open])

  const close = () => {
    setSelectedId(null)
    if (openId) onOpened()
  }

  if (!signedIn) {
    return (
      <p className="mt-10 text-center text-sm text-muted-foreground">
        Sign in (Settings → Account & sync) to get reminders and alerts here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {inbox.unread > 0 && (
        <Button variant="ghost" size="sm" className="self-end" onClick={() => readItems()}>
          <CheckCheckIcon /> Mark all read
        </Button>
      )}
      {inbox.error && <p className="text-xs text-destructive">{inbox.error}</p>}
      {inbox.loaded && inbox.items.length === 0 && (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <InboxIcon className="size-8" />
          Nothing yet. Reminders and alerts will show up here.
        </div>
      )}
      {inbox.items.map((item) => (
        <ListRow
          key={item.id}
          icon={item.readAt ? <BellIcon className="size-4" /> : <BellRingIcon className="size-4 text-primary" />}
          title={<span className={cn(!item.readAt && "font-semibold")}>{item.title}</span>}
          subtitle={
            <>
              <span className="line-clamp-2">{item.body}</span>
              <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span>
            </>
          }
          onClick={() => setSelectedId(item.id)}
          trailing={!item.readAt && <span className="mr-1 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        />
      ))}

      <Dialog open={!!open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.title}</DialogTitle>
                <DialogDescription>
                  {KIND_LABEL[open.kind] ?? "Notification"} · {format(new Date(open.createdAt), "EEE, MMM d 'at' h:mm a")}
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm whitespace-pre-wrap">{open.body}</p>
              <InboxDetails item={open} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
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
