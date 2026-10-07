import { ArrowLeftIcon, EyeIcon, LoaderCircleIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { DailyOverview } from "@/components/DailyOverview"
import { TaskCard } from "@/components/TaskCard"
import { TaskDetail } from "@/components/TaskDetail"
import { Button } from "@/components/ui/button"
import { DEFAULT_SETTINGS } from "@/domain/types"
import type { Viewing } from "@/hooks/useNav"
import { clockIn, deriveTaskViews } from "@/lib/taskViews"
import { viewFriend, viewLink, type SharedView } from "@/sync/social"

/**
 * Someone else's shared tasks, read-only, using the same views as your own. Progress is
 * computed on their wall clock and time zone, so "today" matches what they see.
 */
export function FriendView({ viewing, onExit }: { viewing: Viewing; onExit: () => void }) {
  const [data, setData] = useState<SharedView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = viewing.kind === "friend" ? viewFriend(viewing.username) : viewLink(viewing.serverUrl, viewing.token)
    load.then(
      (d) => !cancelled && setData(d),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [viewing])

  // Keep their clock current while open.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...data?.settings }), [data])
  const clock = useMemo(
    () => clockIn(data?.owner.timeZone ?? "", settings.dayStartHour),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, settings.dayStartHour, tick],
  )
  const views = useMemo(() => {
    if (!data) return []
    const tasks = [...data.tasks].sort((a, b) => a.sortOrder - b.sortOrder)
    return deriveTaskViews({ ...data, tasks, settings }, clock.today, clock.now)
  }, [data, settings, clock])
  const categories = useMemo(() => [...(data?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [data])

  const name = data ? data.owner.displayName.trim() || `@${data.owner.username}` : viewing.kind === "friend" ? `@${viewing.username}` : "Shared tasks"

  return (
    <div className="flex flex-col gap-3">
      {/* Pinned banner: whose tasks these are, and the way back. */}
      <div className="sticky top-0 z-30 -mx-4 -mt-[calc(0.5rem+env(safe-area-inset-top))] flex flex-col gap-3 bg-background px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-2 rounded-xl border bg-muted/60 p-2">
          <Button variant="ghost" size="icon-lg" onClick={onExit} aria-label="Back to my tasks">
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{name}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <EyeIcon className="size-3" />
              {data && data.owner.displayName.trim() ? `@${data.owner.username} · ` : ""}
              {viewing.kind === "link" ? "Shared link" : "Shared with you"} · read-only
            </div>
          </div>
        </div>
        {data && views.length > 0 && (
          <DailyOverview tasks={views} filter={[]} readOnly={{ today: clock.today, categories }} />
        )}
      </div>

      {!data && !error && (
        <div className="mt-10 flex justify-center text-muted-foreground">
          <LoaderCircleIcon className="size-6 animate-spin" />
        </div>
      )}
      {error && <p className="mt-10 text-center text-sm text-muted-foreground">{error}</p>}
      {data && views.length === 0 && (
        <p className="mt-10 text-center text-sm text-muted-foreground">Nothing is shared right now.</p>
      )}

      {views.map((view) => (
        <TaskCard
          key={view.task.id}
          view={view}
          today={clock.today}
          onOpen={() => setDetailId(view.task.id)}
          onCustomAmount={() => {}}
          readOnly
        />
      ))}

      <TaskDetail view={views.find((v) => v.task.id === detailId) ?? null} today={clock.today} onClose={() => setDetailId(null)} />
    </div>
  )
}
