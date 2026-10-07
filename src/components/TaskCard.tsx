import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ClockIcon,
  CopyIcon,
  CopyPlusIcon,
  EllipsisVerticalIcon,
  FlameIcon,
  HistoryIcon,
  PencilIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  TreePalmIcon,
  Undo2Icon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { deleteTask, recordEvent, restoreEvent, retireTask, undoLast, unretireTask } from "@/db/repo"
import { inRange } from "@/domain/dates"
import { isCheckbox, isExcused } from "@/domain/status"
import { useAppData, type TaskView } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { deadlineText, displayValue, progressPercent, statusText } from "@/lib/format"
import { cn } from "@/lib/utils"
import { TaskIcon } from "./TaskIcon"
import { CategoryChip } from "./CategoryChip"
import type { DragProps } from "./Sortable"

interface Props {
  view: TaskView
  onOpen: () => void
  onCustomAmount: () => void
  today: string
  /** From useDragHandle: the icon becomes the drag handle. */
  drag?: DragProps
}

export function TaskCard({ view, onOpen, onCustomAmount, today, drag }: Props) {
  const { openTask } = useEditors()
  const { settings } = useAppData()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { task, target, categories, summary, ctx } = view
  const { current } = summary
  const retired = !!task.retiredAt
  const checkbox = isCheckbox(task, target)
  const failed = current.state === "failure" || current.deadline?.state === "missed"
  const negative = current.actual < 0
  const onBreak = isExcused(today, ctx.exceptions)
  const due = retired ? null : deadlineText(current)

  // A limit counts down your allowance, so its buttons read −N (use some).
  const isLimit = task.type === "limit"
  const signed = (amount: number) => {
    const shown = isLimit ? -amount : amount
    return shown > 0 ? `+${shown}` : `−${-shown}`
  }
  const canUndo = ctx.events.some((e) => inRange(e.localDate, current.range))

  const undo = async () => {
    const undone = await undoLast(task.id, current.range)
    if (!undone) return false
    toast(`Undid ${signed(undone.amount)} on “${task.name}”`, {
      action: { label: "Redo", onClick: () => restoreEvent(undone.id) },
    })
    return true
  }

  return (
    <div
      ref={drag?.setRootNode}
      style={drag?.rootStyle}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card pl-4 pr-2 pt-2.5 pb-3 shadow-xs",
        retired && "opacity-60",
        drag?.dragging && "z-10 shadow-lg",
      )}
    >
      {/* The color tab is also a drag handle; its touch area is wider than the stripe. */}
      <div
        {...drag?.extraHandleProps}
        data-no-swipe
        className={cn("absolute inset-y-0 left-0 w-3.5", drag && "cursor-grab touch-none active:cursor-grabbing")}
      >
        <div className="h-full w-1.5" style={{ backgroundColor: task.color }} />
      </div>

      <div className="flex items-center gap-3">
        <div
          ref={drag?.setHandleNode}
          {...drag?.handleProps}
          data-no-swipe
          className={cn("-my-2 -ml-1 shrink-0 py-2 pl-1", drag && "cursor-grab touch-none active:cursor-grabbing")}
          aria-label={drag ? `Drag to reorder ${task.name}` : undefined}
        >
          <TaskIcon name={task.icon} className="size-6" style={{ color: task.color }} />
        </div>
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="min-w-0 flex-1">
            {categories.length > 0 && (
              <div className="mb-0.5 flex flex-wrap gap-1">
                {categories.map((c) => (
                  <CategoryChip key={c.id} category={c} />
                ))}
              </div>
            )}
            <div className="truncate font-medium">{task.name}</div>
            {(summary.streak > 1 || onBreak || due) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {summary.streak > 1 && (
                  <span className="flex items-center gap-0.5">
                    <FlameIcon className="size-3 text-orange-500" />
                    {summary.streak}
                  </span>
                )}
                {onBreak && (
                  <span className="flex items-center gap-0.5">
                    <TreePalmIcon className="size-3" />
                    On break
                  </span>
                )}
                {due && (
                  <span
                    className={cn(
                      "flex items-center gap-0.5 whitespace-nowrap",
                      current.deadline?.state === "missed" && "font-medium text-destructive",
                    )}
                  >
                    <ClockIcon className="size-3" />
                    {due}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {!retired &&
            (checkbox ? (
              <Checkbox
                className="size-7 rounded-md"
                checked={current.actual > 0}
                onCheckedChange={async (checked) => {
                  if (checked) await recordEvent(task.id, 1)
                  else if (!(await undo())) await recordEvent(task.id, -1)
                }}
                aria-label={`Mark ${task.name}`}
              />
            ) : (
              <>
                <Button
                  variant="outline"
                  size="icon-lg"
                  disabled={!canUndo}
                  onClick={undo}
                  aria-label="Undo last entry"
                >
                  <Undo2Icon />
                </Button>
                {task.incrementAmounts.slice(0, 3).map((amount) => (
                  <Button
                    key={amount}
                    variant="secondary"
                    size="lg"
                    className="min-w-9 px-2"
                    onClick={() => recordEvent(task.id, amount)}
                    aria-label={isLimit ? `Use ${amount}` : `Add ${amount}`}
                  >
                    {signed(amount)}
                  </Button>
                ))}
              </>
            ))}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label="Options">
                <EllipsisVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!retired && (
                <DropdownMenuItem onSelect={onCustomAmount}>
                  <SlidersHorizontalIcon /> Custom amount…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onOpen}>
                <HistoryIcon /> History
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openTask({ mode: "edit", taskId: task.id })}>
                <PencilIcon /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openTask({ mode: "duplicate", taskId: task.id })}>
                <CopyPlusIcon /> Duplicate…
              </DropdownMenuItem>
              {!retired && (
                <DropdownMenuItem onSelect={() => openTask({ mode: "copy", taskId: task.id })}>
                  <CopyIcon /> Copy &amp; retire…
                </DropdownMenuItem>
              )}
              {retired ? (
                <DropdownMenuItem onSelect={() => unretireTask(task.id)}>
                  <ArchiveRestoreIcon /> Unretire
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={async () => {
                    await retireTask(task.id)
                    toast(`Retired “${task.name}”`, { action: { label: "Undo", onClick: () => unretireTask(task.id) } })
                  }}
                >
                  <ArchiveIcon /> Retire
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2Icon /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DeleteTaskDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            name={task.name}
            entries={ctx.events.length}
            retired={retired}
            onRetire={() => retireTask(task.id)}
            onDelete={async () => {
              await deleteTask(task.id)
              toast(`Deleted “${task.name}”`)
            }}
          />
        </div>
      </div>

      <div className="mt-2 pr-2">
        <Progress
          value={progressPercent(task, current, settings.limitDisplay)}
          className={cn(
            "h-1.5 *:data-[slot=progress-indicator]:bg-(--bar)",
            current.state === "excused" && "opacity-40",
          )}
          style={{ "--bar": failed ? "var(--destructive)" : task.color } as React.CSSProperties}
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span className={cn(negative && "font-medium text-destructive")}>{displayValue(task, summary, settings.limitDisplay)}</span>
          <span className={cn((failed || negative) && "font-medium text-destructive")}>{statusText(task, current, settings.limitDisplay)}</span>
        </div>
      </div>
    </div>
  )
}

function DeleteTaskDialog({
  open,
  onOpenChange,
  name,
  entries,
  retired,
  onRetire,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  entries: number
  retired: boolean
  onRetire: () => void
  onDelete: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            This permanently deletes the task and {entries === 1 ? "its 1 entry" : `all ${entries} of its entries`}, and
            removes it from breaks, reminders, and sharing. It can't be undone.
            {!retired && " To hide it but keep its history, retire it instead."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {!retired && (
            <Button
              variant="outline"
              onClick={() => {
                onRetire()
                onOpenChange(false)
              }}
            >
              Retire instead
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => {
              onDelete()
              onOpenChange(false)
            }}
          >
            Delete permanently
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
