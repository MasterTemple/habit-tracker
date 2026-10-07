import { format } from "date-fns"
import { ChevronDownIcon, TreePalmIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { deleteEvent, restoreEvent } from "@/db/repo"
import { formatRange, inRange } from "@/domain/dates"
import { periodHistory, type PeriodStatus } from "@/domain/status"
import { useAppData, type TaskView } from "@/hooks/useAppData"
import { breakDates, breakScopeNames } from "@/lib/breaks"
import { goalText, progressPercent, statusText } from "@/lib/format"
import { BOTTOM_SHEET } from "@/lib/viewport"
import { cn } from "@/lib/utils"
import { TaskIcon } from "./TaskIcon"

interface Props {
  view: TaskView | null
  today: string
  onClose: () => void
  onEdit: (taskId: string) => void
  onTakeBreak: (taskId: string) => void
  /** Shows all breaks (when several cover this task today). */
  onViewBreaks: () => void
  onEditBreak: (breakId: string) => void
}

export function TaskDetail({ view, today, onClose, ...actions }: Props) {
  return (
    <Sheet open={!!view} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className={BOTTOM_SHEET}>
        {view && <Detail view={view} today={today} {...actions} />}
      </SheetContent>
    </Sheet>
  )
}

const STATE_STYLE: Record<PeriodStatus["state"], string> = {
  open: "",
  success: "text-green-600 dark:text-green-400",
  failure: "text-destructive",
  excused: "text-muted-foreground italic",
}

function Detail({
  view,
  today,
  onEdit,
  onTakeBreak,
  onViewBreaks,
  onEditBreak,
}: { view: TaskView; today: string } & Omit<Props, "view" | "today" | "onClose">) {
  const { categories, tasks, settings } = useAppData()
  const { task, summary, ctx } = view
  const history = useMemo(() => periodHistory(ctx, today, 90), [ctx, today])
  const [expanded, setExpanded] = useState<string | null>(history[0]?.range.start ?? null)

  const removeEvent = async (id: string) => {
    await deleteEvent(id)
    toast("Entry deleted", { action: { label: "Undo", onClick: () => restoreEvent(id) } })
  }

  const taskExceptions = ctx.exceptions.filter((e) => e.endDate >= today)
  // Already on break today: offer to view the break(s) instead of starting another.
  const currentBreaks = taskExceptions.filter((e) => e.startDate <= today)

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 pr-8">
          <TaskIcon name={task.icon} className="size-5" style={{ color: task.color }} />
          {task.name}
        </SheetTitle>
        <SheetDescription>
          {goalText(task, summary.current)}
          {task.description && ` · ${task.description}`}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Today" value={summary.today} />
          <Stat label="Period" value={summary.current.actual} />
          <Stat label="Total" value={summary.total} />
          <Stat label="Streak" value={summary.streak} />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onEdit(task.id)}>
            <PencilIcon /> Edit
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() =>
              currentBreaks.length === 0
                ? onTakeBreak(task.id)
                : currentBreaks.length === 1
                  ? onEditBreak(currentBreaks[0].id)
                  : onViewBreaks()
            }
          >
            <TreePalmIcon />{" "}
            {currentBreaks.length === 0 ? "Take a break" : currentBreaks.length === 1 ? "View break" : "View breaks"}
          </Button>
        </div>

        {taskExceptions.length > 0 && (
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Breaks</h3>
            {taskExceptions.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onEditBreak(e.id)}
                className="rounded-md bg-muted px-3 py-1.5 text-left text-sm"
              >
                {breakDates(e)}
                {e.description && <span className="text-muted-foreground"> · {e.description}</span>}
                <span className="block text-xs text-muted-foreground">
                  {breakScopeNames(
                    e,
                    categories,
                    tasks.map((t) => t.task),
                  ).join(", ")}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-1">
          <h3 className="text-sm font-medium">History</h3>
          {history.map((status) => {
            const events = ctx.events
              .filter((e) => inRange(e.localDate, status.range))
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            const open = expanded === status.range.start
            return (
              <div key={status.range.start} className="rounded-md border">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
                  onClick={() => setExpanded(open ? null : status.range.start)}
                >
                  <span className="w-28 shrink-0">{formatRange(status.period, status.range)}</span>
                  <Progress
                    value={progressPercent(task, status, settings.limitDisplay)}
                    className="h-1.5 flex-1 *:data-[slot=progress-indicator]:bg-(--bar)"
                    style={
                      {
                        "--bar": status.state === "failure" ? "var(--destructive)" : task.color,
                      } as React.CSSProperties
                    }
                  />
                  <span className={cn("w-20 shrink-0 text-right tabular-nums", STATE_STYLE[status.state])}>
                    {status.state === "excused"
                      ? "excused"
                      : status.goal === null
                        ? status.actual
                        : `${status.actual} / ${status.goal}`}
                  </span>
                  <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
                </button>
                {open && (
                  <div className="border-t px-3 py-1.5 text-sm">
                    {status.carried > 0 && (
                      <p className="py-1 text-xs text-muted-foreground">Goal adjusted by {status.carried} carried over.</p>
                    )}
                    {statusText(task, status, settings.limitDisplay) && (
                      <p className="py-1 text-xs text-muted-foreground">{statusText(task, status, settings.limitDisplay)}</p>
                    )}
                    {events.length === 0 && <p className="py-1 text-muted-foreground">No entries</p>}
                    {events.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 py-0.5">
                        <span className="w-24 text-muted-foreground tabular-nums">
                          {format(new Date(e.occurredAt), status.period === "day" ? "h:mm a" : "EEE h:mm a")}
                        </span>
                        <span className={cn("w-12 tabular-nums", e.amount < 0 && "text-destructive")}>
                          {e.amount > 0 ? `+${e.amount}` : e.amount}
                        </span>
                        <span className="flex-1 truncate text-muted-foreground">{e.note}</span>
                        <Button variant="ghost" size="icon-sm" onClick={() => removeEvent(e.id)} aria-label="Delete entry">
                          <Trash2Icon />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted py-2">
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
