import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  CopyPlusIcon,
  EllipsisVerticalIcon,
  FlameIcon,
  HistoryIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TreePalmIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { moveTask, recordOrUndo, retireTask, unretireTask } from "@/db/repo"
import { isCheckbox, isExcused } from "@/domain/status"
import type { TaskView } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { displayValue, progressPercent, statusText } from "@/lib/format"
import { cn } from "@/lib/utils"
import { TaskIcon } from "./TaskIcon"
import { CategoryChip } from "./CategoryChip"

interface Props {
  view: TaskView
  onOpen: () => void
  onCustomAmount: () => void
  today: string
}

export function TaskCard({ view, onOpen, onCustomAmount, today }: Props) {
  const { openTask } = useEditors()
  const { task, target, categories, summary, ctx } = view
  const { current } = summary
  const retired = !!task.retiredAt
  const checkbox = isCheckbox(task, target)
  const step = task.incrementAmounts[0] ?? 1
  const failed = current.state === "failure"
  const negative = current.actual < 0
  const onBreak = isExcused(today, ctx.exceptions)

  const record = (amount: number) => recordOrUndo(task.id, amount)
  // Every card has one "take back" button and up to three "do it" buttons. A limit
  // counts down your allowance, so its buttons read −N (use some) and + (give back).
  const isLimit = task.type === "limit"

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card pl-4 pr-2 pt-2.5 pb-3 shadow-xs",
        retired && "opacity-60",
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: task.color }} />

      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <TaskIcon name={task.icon} className="size-6 shrink-0" style={{ color: task.color }} />
          <div className="min-w-0 flex-1">
            {categories.length > 0 && (
              <div className="mb-0.5 flex flex-wrap gap-1">
                {categories.map((c) => (
                  <CategoryChip key={c.id} category={c} />
                ))}
              </div>
            )}
            <div className="truncate font-medium">{task.name}</div>
            {(summary.streak > 1 || onBreak) && (
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
                onCheckedChange={(checked) => record(checked ? 1 : -1)}
                aria-label={`Mark ${task.name}`}
              />
            ) : (
              <>
                <Button
                  variant="outline"
                  size="icon-lg"
                  disabled={current.actual <= 0}
                  onClick={() => record(-Math.min(step, current.actual))}
                  aria-label={isLimit ? `Give back ${step}` : `Subtract ${step}`}
                >
                  {isLimit ? <PlusIcon /> : <MinusIcon />}
                </Button>
                {task.incrementAmounts.slice(0, 3).map((amount) => (
                  <Button
                    key={amount}
                    variant="secondary"
                    size="lg"
                    className="min-w-9 px-2"
                    onClick={() => record(amount)}
                    aria-label={isLimit ? `Use ${amount}` : `Add ${amount}`}
                  >
                    {isLimit ? `−${amount}` : `+${amount}`}
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
              {!retired && (
                <>
                  <DropdownMenuItem onSelect={() => moveTask(task.id, -1)}>
                    <ArrowUpIcon /> Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => moveTask(task.id, 1)}>
                    <ArrowDownIcon /> Move down
                  </DropdownMenuItem>
                </>
              )}
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 pr-2">
        <Progress
          value={progressPercent(current)}
          className={cn(
            "h-1.5 *:data-[slot=progress-indicator]:bg-(--bar)",
            current.state === "excused" && "opacity-40",
          )}
          style={{ "--bar": failed ? "var(--destructive)" : task.color } as React.CSSProperties}
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span className={cn(negative && "font-medium text-destructive")}>{displayValue(task, summary)}</span>
          <span className={cn((failed || negative) && "font-medium text-destructive")}>{statusText(task, current)}</span>
        </div>
      </div>
    </div>
  )
}
