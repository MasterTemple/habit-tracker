import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { createException, deleteException, updateException, type ExceptionInput } from "@/db/repo"
import { useAppData } from "@/hooks/useAppData"
import { cn } from "@/lib/utils"
import { CategoryChip } from "./CategoryChip"
import { TaskIcon } from "./TaskIcon"

export type BreakTarget = { id: string } | { preset?: Partial<ExceptionInput> }

interface Props {
  target: BreakTarget | null
  onClose: () => void
}

/**
 * Create or edit a break. During a break, goals are reduced (or excused for fully
 * covered periods) and limits ignore entries, but progress can still be recorded.
 */
export function BreakEditor({ target, onClose }: Props) {
  const { today, categories, tasks, exceptions } = useAppData()
  const [input, setInput] = useState<ExceptionInput | null>(null)
  const editingId = target && "id" in target ? target.id : null

  useEffect(() => {
    if (!target) return
    if ("id" in target) {
      const existing = exceptions.find((e) => e.id === target.id)
      setInput(existing ?? null)
    } else {
      setInput({
        appliesToAll: false,
        taskIds: [],
        categoryIds: [],
        startDate: today,
        endDate: today,
        description: "",
        ...target.preset,
      })
    }
    // Only reset when opened for something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const set = (changes: Partial<ExceptionInput>) => setInput((prev) => (prev ? { ...prev, ...changes } : prev))
  const toggle = (key: "taskIds" | "categoryIds", id: string) =>
    input && set({ [key]: input[key].includes(id) ? input[key].filter((x) => x !== id) : [...input[key], id] })

  const empty = input && !input.appliesToAll && input.taskIds.length === 0 && input.categoryIds.length === 0

  const save = async () => {
    if (!input || empty) return
    const final = { ...input, description: input.description.trim() }
    if (editingId) await updateException(editingId, final)
    else await createException(final)
    onClose()
  }

  const remove = async () => {
    if (!editingId) return
    await deleteException(editingId)
    toast("Break deleted")
    onClose()
  }

  // Keep tasks already on this break visible even if they've since been retired.
  const pickableTasks = tasks.filter((t) => !t.task.retiredAt || input?.taskIds.includes(t.task.id))

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{editingId ? "Edit break" : "New break"}</SheetTitle>
          <SheetDescription>
            Goals are reduced (or excused) for these days and limits ignore entries. You can still record progress.
          </SheetDescription>
        </SheetHeader>

        {input && (
          <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="break-start">From</Label>
                <Input
                  id="break-start"
                  type="date"
                  value={input.startDate}
                  onChange={(e) => e.target.value && set({ startDate: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="break-end">To</Label>
                <Input
                  id="break-end"
                  type="date"
                  value={input.endDate}
                  min={input.startDate}
                  onChange={(e) => e.target.value && set({ endDate: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="break-description">Reason</Label>
              <Input
                id="break-description"
                value={input.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Vacation, sick, …"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="break-all">All tasks</Label>
              <Switch id="break-all" checked={input.appliesToAll} onCheckedChange={(v) => set({ appliesToAll: v })} />
            </div>

            {!input.appliesToAll && (
              <>
                {categories.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label>Categories</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map((c) => (
                        <CategoryChip
                          key={c.id}
                          category={c}
                          size="md"
                          selected={input.categoryIds.includes(c.id)}
                          onClick={() => toggle("categoryIds", c.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label>Tasks</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {pickableTasks.map(({ task }) => {
                      const selected = input.taskIds.includes(task.id)
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => toggle("taskIds", task.id)}
                          aria-pressed={selected}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                            selected ? "border-foreground bg-muted" : "text-muted-foreground",
                          )}
                        >
                          <TaskIcon name={task.icon} className="size-3.5" style={{ color: task.color }} />
                          {task.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {empty && <p className="text-xs text-muted-foreground">Pick at least one category or task.</p>}
              </>
            )}

            <Button size="lg" className="h-11" onClick={save} disabled={!!empty}>
              {editingId ? "Save" : "Add break"}
            </Button>
            {editingId && (
              <Button variant="destructive" onClick={remove}>
                Delete break
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
