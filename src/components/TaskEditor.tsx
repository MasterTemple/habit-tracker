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
import { copyAndRetire, createCategory, createTask, taskToInput, updateTask, type TaskInput } from "@/db/repo"
import type { DisplayMode, Period, TaskType } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { COLORS } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { CategoryChip } from "./CategoryChip"
import { ColorPicker } from "./ColorPicker"
import { IconPicker } from "./IconPicker"

export type EditorTarget =
  | { mode: "new" }
  | { mode: "edit"; taskId: string }
  /** Prefilled from the task; nothing changes until saved, which creates the copy and retires the original. */
  | { mode: "copy"; taskId: string }

interface Props {
  /** null when closed. */
  target: EditorTarget | null
  onClose: () => void
}

const TITLES = { new: "New task", edit: "Edit task", copy: "Copy & retire" }

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

export function TaskEditor({ target, onClose }: Props) {
  const { settings, categories } = useAppData()
  const [input, setInput] = useState<TaskInput | null>(null)
  const [amountsText, setAmountsText] = useState("1")
  const [newCategory, setNewCategory] = useState("")
  const mode = target?.mode ?? "new"
  const isNew = mode === "new"
  const typeLocked = mode === "edit"
  const [originalName, setOriginalName] = useState("")

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setInput(null)
    const load = target.mode === "new" ? Promise.resolve(emptyInput(settings.carryOverDefault)) : taskToInput(target.taskId)
    load.then((loaded) => {
      if (cancelled) return
      setInput(loaded)
      setOriginalName(loaded.name)
      setAmountsText(loaded.incrementAmounts.join(", "))
    })
    return () => {
      cancelled = true
    }
    // Only reload when the editor is opened for something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

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
    if (!input || !target) return
    if (!input.name.trim()) {
      toast.error("Give the task a name")
      return
    }
    const final = { ...input, name: input.name.trim(), incrementAmounts: parseAmounts(amountsText) }
    if (target.mode === "new") await createTask(final)
    else if (target.mode === "edit") await updateTask(target.taskId, final)
    else {
      await copyAndRetire(target.taskId, final)
      toast.success(`Retired “${originalName}” and created “${final.name}”`)
    }
    onClose()
  }

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{TITLES[mode]}</SheetTitle>
          {mode === "copy" ? (
            <SheetDescription>
              Saving creates this new task and retires “{originalName}” (its history is kept). Close to cancel.
            </SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Task settings</SheetDescription>
          )}
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
                    disabled={typeLocked}
                    onClick={() => set({ type: t.value })}
                    className={cn(
                      "rounded-md py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
                      input.type === t.value ? "bg-background shadow-sm" : "text-muted-foreground",
                      typeLocked && input.type !== t.value && "opacity-40",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {typeLocked
                  ? "The type can't change. Use “Copy & retire” to make a modified version."
                  : TYPES.find((t) => t.value === input.type)?.hint}
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
                  {mode === "edit" && (
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
              <Label>Color</Label>
              <ColorPicker value={input.color} onChange={(color) => set({ color })} />
            </div>

            <div className="grid gap-1.5">
              <Label>Icon</Label>
              <IconPicker value={input.icon} color={input.color} onChange={(icon) => set({ icon })} />
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
              {{ new: "Create task", edit: "Save", copy: "Create copy & retire original" }[mode]}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
