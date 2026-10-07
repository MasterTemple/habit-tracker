import { PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  copyAndRetire,
  createCategory,
  createTask,
  duplicateTask,
  taskToInput,
  updateTask,
  type TaskInput,
} from "@/db/repo"
import type { DisplayMode, Period, TaskType } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { COLORS, nextColor } from "@/lib/icons"
import { SHEET } from "@/lib/viewport"
import { cn } from "@/lib/utils"
import { ButtonAmounts } from "./ButtonAmounts"
import { CategoryChip } from "./CategoryChip"
import { ColorPicker } from "./ColorPicker"
import { IconPicker } from "./IconPicker"
import { NumberInput } from "./NumberInput"

export type EditorTarget =
  | { mode: "new" }
  | { mode: "edit"; taskId: string }
  /** Prefilled from the task; saving creates a new task and leaves the original as it is. */
  | { mode: "duplicate"; taskId: string }
  /** Prefilled from the task; saving creates the copy and retires the original. */
  | { mode: "copy"; taskId: string }

interface Props {
  /** null when closed. */
  target: EditorTarget | null
  onClose: () => void
}

const TITLES = { new: "New task", edit: "Edit task", duplicate: "Duplicate task", copy: "Copy & retire" }
const SAVE_LABELS = { new: "Create task", edit: "Save", duplicate: "Create copy", copy: "Create copy & retire original" }

const TYPES: { value: TaskType; label: string; hint: string }[] = [
  { value: "accumulate", label: "Do", hint: "Reach at least N per period" },
  { value: "limit", label: "Limit", hint: "Stay at or under N per period (0 = never)" },
  { value: "track", label: "Track", hint: "Count how often it happens, with no goal" },
]

function emptyInput(carryOver: boolean): TaskInput {
  return {
    name: "",
    description: "",
    type: "accumulate",
    icon: "circle",
    color: COLORS[5],
    unit: "",
    dueTime: null,
    incrementAmounts: [1],
    displayMode: "period",
    period: "day",
    amount: 1,
    carryOver,
    categoryIds: [],
  }
}

const UNIT_SUGGESTIONS = ["time", "minute", "hour", "page", "chapter", "rep", "set", "step", "glass", "mile", "km"]

const toSlots = (amounts: number[]) => [0, 1, 2].map((i) => amounts[i] ?? null)

function fromSlots(slots: (number | null)[]): number[] {
  const amounts = slots.filter((n): n is number => n !== null && n > 0)
  return amounts.length > 0 ? [...new Set(amounts)] : [1]
}

export function TaskEditor({ target, onClose }: Props) {
  const { settings, categories, tasks } = useAppData()
  const [input, setInput] = useState<TaskInput | null>(null)
  const [slots, setSlots] = useState<(number | null)[]>([1, null, null])
  const [tab, setTab] = useState("goal")
  const [newCategory, setNewCategory] = useState("")
  // New tasks take their icon from their highest-priority category until one is picked by hand.
  const [iconPicked, setIconPicked] = useState(false)
  const mode = target?.mode ?? "new"
  const typeLocked = mode === "edit"
  const source = target && target.mode !== "new" ? tasks.find((t) => t.task.id === target.taskId)?.task : undefined

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setInput(null)
    setTab("goal")
    setIconPicked(target.mode !== "new")
    const load =
      target.mode === "new" ? Promise.resolve(emptyInput(settings.carryOverDefault)) : taskToInput(target.taskId)
    load.then((loaded) => {
      if (cancelled) return
      setInput(target.mode === "duplicate" ? { ...loaded, name: `${loaded.name} (copy)` } : loaded)
      setSlots(toSlots(loaded.incrementAmounts))
    })
    return () => {
      cancelled = true
    }
    // Only reload when the editor is opened for something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const set = (changes: Partial<TaskInput>) => setInput((prev) => (prev ? { ...prev, ...changes } : prev))

  const toggleCategory = (id: string) => {
    if (!input) return
    const categoryIds = input.categoryIds.includes(id)
      ? input.categoryIds.filter((c) => c !== id)
      : [...input.categoryIds, id]
    // categories are already in priority order
    const categoryIcon = categories.find((c) => categoryIds.includes(c.id) && c.icon)?.icon
    set({ categoryIds, ...(iconPicked ? {} : { icon: categoryIcon ?? "circle" }) })
  }

  const addCategory = async () => {
    const name = newCategory.trim()
    if (!name || !input) return
    const id = await createCategory(name, nextColor(categories.map((c) => c.color)))
    set({ categoryIds: [...input.categoryIds, id] })
    setNewCategory("")
  }

  const save = async () => {
    if (!input || !target) return
    if (!input.name.trim()) {
      toast.error("Give the task a name")
      return
    }
    const final = { ...input, name: input.name.trim(), incrementAmounts: fromSlots(slots) }
    switch (target.mode) {
      case "new":
        await createTask(final)
        break
      case "edit":
        await updateTask(target.taskId, final)
        break
      case "duplicate":
        await duplicateTask(target.taskId, final)
        toast.success(`Created “${final.name}”`)
        break
      case "copy":
        await copyAndRetire(target.taskId, final)
        toast.success(`Retired “${source?.name}” and created “${final.name}”`)
        break
    }
    onClose()
  }

  const description = {
    new: null,
    edit: null,
    duplicate: `Creates a new task. “${source?.name}” stays as it is${source?.retiredAt ? " (retired)" : ""}.`,
    copy: `Saving creates this new task and retires “${source?.name}” (its history is kept). Close to cancel.`,
  }[mode]

  // Buttons only matter when the card shows them instead of a checkbox.
  const showButtons = input && (input.type === "track" || input.amount !== 1)

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="top" className={SHEET}>
        <SheetHeader>
          <SheetTitle>{TITLES[mode]}</SheetTitle>
          <SheetDescription className={cn(!description && "sr-only")}>{description ?? "Task settings"}</SheetDescription>
        </SheetHeader>

        {input && (
          <div className="flex flex-col gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="grid gap-1.5">
              <Label htmlFor="task-name">Name</Label>
              <Input
                id="task-name"
                value={input.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Pull-ups"
                autoFocus={mode === "new"}
              />
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="goal">Goal</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>

              <TabsContent value="goal" className="mt-3 flex flex-col gap-5">
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
                      ? "The type can't change. Use “Duplicate” or “Copy & retire” to make a modified version."
                      : TYPES.find((t) => t.value === input.type)?.hint}
                  </p>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor={input.type === "track" ? "task-unit" : "task-amount"}>
                    {{ accumulate: "At least", limit: "At most", track: "Count" }[input.type]}
                  </Label>
                  <div className="flex gap-2">
                    {input.type !== "track" && (
                      <NumberInput
                        id="task-amount"
                        className="w-16 shrink-0 text-center"
                        value={input.amount}
                        onChange={(n) => n !== null && set({ amount: n })}
                      />
                    )}
                    <Input
                      id="task-unit"
                      aria-label="Unit"
                      className="min-w-0 flex-1"
                      list="unit-suggestions"
                      autoCapitalize="none"
                      value={input.unit}
                      onChange={(e) => set({ unit: e.target.value })}
                      placeholder={input.type !== "track" && input.amount === 1 ? "time" : "times"}
                    />
                    <span className="self-center text-sm text-muted-foreground">per</span>
                    <Select value={input.period} onValueChange={(v) => set({ period: v as Period })}>
                      <SelectTrigger className="w-28 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="week">Week</SelectItem>
                        <SelectItem value="month">Month</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <datalist id="unit-suggestions">
                    {UNIT_SUGGESTIONS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    The unit is optional (e.g. minute, page, rep).
                    {mode === "edit" &&
                      input.type !== "track" &&
                      " Goal changes apply from the start of the current period; earlier history keeps the old goal."}
                  </p>
                </div>

                {input.type === "accumulate" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="task-due">Due by</Label>
                    <div className="flex gap-2">
                      <Input
                        id="task-due"
                        type="time"
                        className="block w-36 min-w-0 appearance-none"
                        value={input.dueTime ?? ""}
                        onChange={(e) => set({ dueTime: e.target.value || null })}
                      />
                      {input.dueTime && (
                        <Button variant="ghost" onClick={() => set({ dueTime: null })}>
                          No due time
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Optional. Local time wherever you are, like an alarm
                      {input.period !== "day" && `, on the ${input.period}'s last day`}. Finishing late still counts, but
                      shows as late.
                    </p>
                  </div>
                )}

                {input.type !== "track" && (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <Label htmlFor="task-carry">Carry over</Label>
                        <p className="text-xs text-muted-foreground">
                          {input.type === "limit"
                            ? "Going over lowers next period's allowance"
                            : "Extra this period lowers next period's goal"}
                        </p>
                      </div>
                      <Switch
                        id="task-carry"
                        checked={input.carryOver}
                        onCheckedChange={(v) => set({ carryOver: v })}
                      />
                    </div>
                  </>
                )}

                {showButtons && (
                  <div className="grid gap-1.5">
                    <Label>Buttons</Label>
                    <ButtonAmounts type={input.type} value={slots} onChange={setSlots} />
                    <p className="text-xs text-muted-foreground">
                      As they appear on the card. Leave a box empty to hide it.
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
              </TabsContent>

              <TabsContent value="details" className="mt-3 flex flex-col gap-5">
                <div className="grid gap-1.5">
                  <Label>Categories</Label>
                  {categories.length > 0 && (
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
                  )}
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
                  <IconPicker
                    value={input.icon}
                    color={input.color}
                    onChange={(icon) => {
                      setIconPicked(true)
                      set({ icon })
                    }}
                  />
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
              </TabsContent>
            </Tabs>

            <Button size="lg" className="h-11" onClick={save}>
              {SAVE_LABELS[mode]}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
