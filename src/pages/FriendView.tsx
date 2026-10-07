import { ArrowLeftIcon, EyeIcon, LoaderCircleIcon, TreePalmIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { DailyOverview } from "@/components/DailyOverview"
import { ListRow } from "@/components/layout"
import { TaskCard } from "@/components/TaskCard"
import { TaskDetail } from "@/components/TaskDetail"
import { Button } from "@/components/ui/button"
import { addDays } from "@/domain/dates"
import { DEFAULT_SETTINGS, type TaskException } from "@/domain/types"
import type { Viewing } from "@/hooks/useNav"
import { breakDates } from "@/lib/breaks"
import { clockIn, deriveTaskViews } from "@/lib/taskViews"
import { sharedWithMe, viewFriend, viewLink, type SharedView } from "@/sync/social"

function load(viewing: Viewing): Promise<SharedView[]> {
  if (viewing.kind === "friend") return viewFriend(viewing.username).then((d) => [d])
  if (viewing.kind === "link") return viewLink(viewing.serverUrl, viewing.token).then((d) => [d])
  return sharedWithMe().then((people) => Promise.all(people.map((p) => viewFriend(p.username))))
}

const ownerName = (d: SharedView) => d.owner.displayName.trim() || `@${d.owner.username}`

/**
 * Someone else's shared tasks (or every friend's, together), read-only, using the same
 * views as your own. Progress is computed on each owner's wall clock and time zone, so
 * "today" matches what they see.
 */
export function FriendView({ viewing, onExit }: { viewing: Viewing; onExit: () => void }) {
  const [data, setData] = useState<SharedView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    load(viewing).then(
      (d) => !cancelled && setData(d),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [viewing])

  const single = viewing.kind !== "everyone" && data?.length === 1 ? data[0] : null
  const shared = useShared(single)

  const name =
    viewing.kind === "everyone"
      ? "Everyone"
      : single
        ? ownerName(single)
        : viewing.kind === "friend"
          ? `@${viewing.username}`
          : "Shared tasks"
  const detail =
    viewing.kind === "everyone"
      ? `${data ? `${data.length} ${data.length === 1 ? "friend" : "friends"} · ` : ""}Shared with you`
      : `${single?.owner.displayName.trim() ? `@${single.owner.username} · ` : ""}${viewing.kind === "link" ? "Shared link" : "Shared with you"}`

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
              {detail} · read-only
            </div>
          </div>
        </div>
        {shared && shared.views.length > 0 && (
          <DailyOverview tasks={shared.views} filter={[]} readOnly={{ today: shared.clock.today, categories: shared.categories }} />
        )}
      </div>

      {!data && !error && (
        <div className="mt-10 flex justify-center text-muted-foreground">
          <LoaderCircleIcon className="size-6 animate-spin" />
        </div>
      )}
      {error && <p className="mt-10 text-center text-sm text-muted-foreground">{error}</p>}
      {data && data.every((d) => d.tasks.length === 0) && (
        <p className="mt-10 text-center text-sm text-muted-foreground">Nothing is shared right now.</p>
      )}

      {single && shared ? (
        <SharedTasks shared={shared} />
      ) : (
        data
          ?.filter((d) => d.tasks.length > 0)
          .map((d) => <OwnerSection key={d.owner.username} data={d} />)
      )}
    </div>
  )
}

type Shared = NonNullable<ReturnType<typeof useShared>>

/** One owner's tasks as views, on their clock (kept current while open). */
function useShared(data: SharedView | null) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  return useMemo(() => {
    if (!data) return null
    const settings = { ...DEFAULT_SETTINGS, ...data.settings }
    const clock = clockIn(data.owner.timeZone, settings.dayStartHour)
    const tasks = [...data.tasks].sort((a, b) => a.sortOrder - b.sortOrder)
    const views = deriveTaskViews({ ...data, tasks, settings }, clock.today, clock.now)
    const categories = [...data.categories].sort((a, b) => a.sortOrder - b.sortOrder)
    return { data, clock, views, categories }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tick])
}

/** A friend's part of the "Everyone" view. */
function OwnerSection({ data }: { data: SharedView }) {
  const shared = useShared(data)
  if (!shared) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="mt-2 text-sm font-semibold text-muted-foreground">{ownerName(data)}</h2>
      {shared.views.length > 0 && (
        <DailyOverview tasks={shared.views} filter={[]} readOnly={{ today: shared.clock.today, categories: shared.categories }} />
      )}
      <SharedTasks shared={shared} />
    </section>
  )
}

function SharedTasks({ shared }: { shared: Shared }) {
  const { views, clock } = shared
  const [detailId, setDetailId] = useState<string | null>(null)
  return (
    <>
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
      <SharedBreaks shared={shared} />
      <TaskDetail view={views.find((v) => v.task.id === detailId) ?? null} today={clock.today} onClose={() => setDetailId(null)} />
    </>
  )
}

/** Their breaks (now, upcoming, and the last two weeks) that excuse shared tasks. Reasons stay private. */
function SharedBreaks({ shared }: { shared: Shared }) {
  const { data, clock } = shared
  const today = clock.today
  const covered = (e: TaskException) =>
    data.tasks.filter(
      (t) => e.appliesToAll || e.taskIds.includes(t.id) || t.categoryIds.some((c) => e.categoryIds.includes(c)),
    )
  const recent = addDays(today, -14)
  const breaks = data.exceptions
    .filter((e) => !e.deletedAt && e.endDate >= recent && covered(e).length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  if (breaks.length === 0) return null

  const when = (e: TaskException) => (e.endDate < today ? "Ended" : e.startDate > today ? "Upcoming" : "On break now")
  return (
    <div className="mt-2 grid gap-2">
      <h3 className="text-sm font-semibold text-muted-foreground">Breaks</h3>
      {breaks.map((e) => {
        const tasks = covered(e)
        return (
          <ListRow
            key={e.id}
            icon={<TreePalmIcon className="size-4" />}
            title={`${breakDates(e)} · ${when(e)}`}
            subtitle={tasks.length === data.tasks.length ? "All shared tasks" : tasks.map((t) => t.name).join(", ")}
            muted={e.endDate < today}
            onClick={() => {}}
          />
        )
      })}
    </div>
  )
}

