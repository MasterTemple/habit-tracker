import { PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { createCategory, createTask, taskToInput, updateTask, type TaskInput } from "@/db/repo"
import type { DisplayMode, Period, TaskType } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { COLORS, TASK_ICONS } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { CategoryChip } from "./CategoryChip"

interface Props {
  /** "new" to create, a task id to edit, or null when closed. */
  taskId: string | null
  onClose: () => void
}

const TYPES: { value: TaskType; label: string; hint: string }[] = [
  { value: "accumulate", label: "Do", hint: "Reach at least N per period" },
  { value: "limit", label: "Limit", hint: "Stay at or under N per period (0 = never)" },
  { value: "track", label: "Track", hint: "Just mark when it happens" },
]

function emptyInput(carryOver: boolean): TaskInput {
  return {
    name: "",
    description: "",
    type: "accumulate",
    icon: "circle",
    color: COLORS[5],
    incrementAmounts: [1],
    displayMode: "period",
    period: "day",
    amount: 1,
    carryOver,
    categoryIds: [],
  }
}

function parseAmounts(text: string): number[] {
  const amounts = text
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
  return amounts.length > 0 ? [...new Set(amounts)] : [1]
}

export function TaskEditor({ taskId, onClose }: Props) {
  const { settings, categories } = useAppData()
  const [input, setInput] = useState<TaskInput | null>(null)
  const [amountsText, setAmountsText] = useState("1")
  const [newCategory, setNewCategory] = useState("")
  const isNew = taskId === "new"

  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    const load = isNew ? Promise.resolve(emptyInput(settings.carryOverDefault)) : taskToInput(taskId)
    load.then((loaded) => {
      if (cancelled) return
      setInput(loaded)
      setAmountsText(loaded.incrementAmounts.join(", "))
    })
    return () => {
      cancelled = true
    }
    // Only reload when a different task is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const set = (changes: Partial<TaskInput>) => setInput((prev) => (prev ? { ...prev, ...changes } : prev))

  const toggleCategory = (id: string) =>
    input &&
    set({
      categoryIds: input.categoryIds.includes(id)
        ? input.categoryIds.filter((c) => c !== id)
        : [...input.categoryIds, id],
    })

  const addCategory = async () => {
    const name = newCategory.trim()
    if (!name || !input) return
    const id = await createCategory(name, COLORS[categories.length % COLORS.length])
    set({ categoryIds: [...input.categoryIds, id] })
    setNewCategory("")
  }

  const save = async () => {
    if (!input || !taskId) return
    if (!input.name.trim()) {
      toast.error("Give the task a name")
      return
    }
    const final = { ...input, name: input.name.trim(), incrementAmounts: parseAmounts(amountsText) }
    if (isNew) await createTask(final)
    else await updateTask(taskId, final)
    onClose()
  }

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{isNew ? "New task" : "Edit task"}</SheetTitle>
          <SheetDescription className="sr-only">Task settings</SheetDescription>
        </SheetHeader>

        {input && (
          <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="grid gap-1.5">
              <Label htmlFor="task-name">Name</Label>
              <Input
                id="task-name"
                value={input.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Pull-ups"
                autoFocus={isNew}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Type</Label>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    disabled={!isNew}
                    onClick={() => set({ type: t.value })}
                    className={cn(
                      "rounded-md py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
                      input.type === t.value ? "bg-background shadow-sm" : "text-muted-foreground",
                      !isNew && input.type !== t.value && "opacity-40",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {isNew
                  ? TYPES.find((t) => t.value === input.type)?.hint
                  : "The type can't change. Use “Copy & retire” to make a modified version."}
              </p>
            </div>

            {input.type !== "track" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="task-amount">{input.type === "limit" ? "At most" : "At least"}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="task-amount"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="w-28"
                      value={input.amount}
                      onChange={(e) => set({ amount: Math.max(0, Number(e.target.value)) })}
                    />
                    <span className="self-center text-sm text-muted-foreground">per</span>
                    <Select value={input.period} onValueChange={(v) => set({ period: v as Period })}>
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="week">Week</SelectItem>
                        <SelectItem value="month">Month</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {!isNew && (
                    <p className="text-xs text-muted-foreground">
                      Goal changes apply from the start of the current period; earlier history keeps the old goal.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="task-carry">Carry over</Label>
                    <p className="text-xs text-muted-foreground">
                      {input.type === "limit"
                        ? "Going over lowers next period's allowance"
                        : "Extra this period lowers next period's goal"}
                    </p>
                  </div>
                  <Switch id="task-carry" checked={input.carryOver} onCheckedChange={(v) => set({ carryOver: v })} />
                </div>
              </>
            )}

            {input.type === "accumulate" && input.amount !== 1 && (
              <div className="grid gap-1.5">
                <Label htmlFor="task-increments">Buttons</Label>
                <Input
                  id="task-increments"
                  value={amountsText}
                  onChange={(e) => setAmountsText(e.target.value)}
                  onBlur={() => setAmountsText(parseAmounts(amountsText).join(", "))}
                  placeholder="1, 5, 10"
                />
                <p className="text-xs text-muted-foreground">
                  Up to 3 shown on the card. The first is also the “−” step.
                </p>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label>Show on card</Label>
              <Select value={input.displayMode} onValueChange={(v) => set({ displayMode: v as DisplayMode })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="period">Progress this period</SelectItem>
                  <SelectItem value="today">Amount today</SelectItem>
                  <SelectItem value="total">All-time total</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Categories</Label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <CategoryChip
                    key={c.id}
                    category={c}
                    size="md"
                    selected={input.categoryIds.includes(c.id)}
                    onClick={() => toggleCategory(c.id)}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCategory())}
                  placeholder="New category (e.g. Exercise, High)"
                />
                <Button variant="outline" size="icon-lg" onClick={addCategory} aria-label="Add category">
                  <PlusIcon />
                </Button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Icon</Label>
              <div className="grid grid-cols-8 gap-1">
                {Object.entries(TASK_ICONS).map(([name, Icon]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => set({ icon: name })}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md border",
                      input.icon === name ? "border-foreground bg-muted" : "border-transparent",
                    )}
                    aria-label={name}
                  >
                    <Icon className="size-5" style={{ color: input.color }} />
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => set({ color })}
                    className={cn(
                      "size-8 rounded-full ring-offset-2 ring-offset-background",
                      input.color === color && "ring-2 ring-foreground",
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={color}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                value={input.description}
                onChange={(e) => set({ description: e.target.value })}
                rows={2}
              />
            </div>

            <Button size="lg" className="h-11" onClick={save}>
              {isNew ? "Create task" : "Save"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
