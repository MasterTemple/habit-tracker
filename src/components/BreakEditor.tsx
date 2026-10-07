import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { endOfDuration, type DurationUnit } from "@/domain/dates"
import { createException, deleteException, updateException, type ExceptionInput } from "@/db/repo"
import { useAppData } from "@/hooks/useAppData"
import { BOTTOM_SHEET } from "@/lib/viewport"
import { NumberInput } from "./NumberInput"
import { isEmptyScope, ScopePicker } from "./pickers"

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
  const { today, exceptions } = useAppData()
  const [input, setInput] = useState<ExceptionInput | null>(null)
  const [length, setLengthState] = useState<{ count: number | null; unit: DurationUnit }>({ count: null, unit: "day" })

  const setLength = (next: { count: number | null; unit: DurationUnit }) => {
    setLengthState(next)
    if (next.count && input) set({ endDate: endOfDuration(input.startDate, next.count, next.unit) })
  }
  const editingId = target && "id" in target ? target.id : null

  useEffect(() => {
    if (!target) return
    setLengthState({ count: null, unit: "day" })
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
  const empty = input && isEmptyScope(input)

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

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className={BOTTOM_SHEET}
        // Focusing the first field would pop open iOS's date picker.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>{editingId ? "Edit break" : "New break"}</SheetTitle>
          <SheetDescription>
            Goals are reduced (or excused) for these days and limits ignore entries. You can still record progress.
          </SheetDescription>
        </SheetHeader>

        {input && (
          <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="grid gap-1.5">
              <Label htmlFor="break-start">From</Label>
              <Input
                id="break-start"
                type="date"
                className="block w-full min-w-0 appearance-none"
                value={input.startDate}
                onChange={(e) => {
                  const startDate = e.target.value
                  if (!startDate) return
                  set({ startDate, ...(length.count ? { endDate: endOfDuration(startDate, length.count, length.unit) } : {}) })
                }}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="break-length">For</Label>
              <div className="flex gap-2">
                <NumberInput
                  id="break-length"
                  className="w-20"
                  placeholder="–"
                  allowEmpty
                  value={length.count}
                  onChange={(count) => setLength({ ...length, count: count && count > 0 ? count : null })}
                />
                <Select value={length.unit} onValueChange={(unit) => setLength({ ...length, unit: unit as DurationUnit })}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">{length.count === 1 ? "Day" : "Days"}</SelectItem>
                    <SelectItem value="week">{length.count === 1 ? "Week" : "Weeks"}</SelectItem>
                    <SelectItem value="month">{length.count === 1 ? "Month" : "Months"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Optional: sets the end date for you.</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="break-end">To</Label>
              <Input
                id="break-end"
                type="date"
                className="block w-full min-w-0 appearance-none"
                value={input.endDate}
                min={input.startDate}
                onChange={(e) => {
                  if (!e.target.value) return
                  set({ endDate: e.target.value })
                  // A hand-picked end date replaces the length.
                  setLength({ ...length, count: null })
                }}
              />
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

            <ScopePicker
              id="break"
              value={input}
              onChange={(scope) => set({ appliesToAll: scope.appliesToAll, taskIds: scope.taskIds, categoryIds: scope.categoryIds })}
            />

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
