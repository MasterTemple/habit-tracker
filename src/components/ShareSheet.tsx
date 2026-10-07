import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { exportTemplate } from "@/db/repo"
import { useAppData } from "@/hooks/useAppData"
import { saveJson } from "@/lib/files"
import { BOTTOM_SHEET } from "@/lib/viewport"
import { TaskIcon } from "./TaskIcon"

/** Pick tasks and/or categories to share as a file, without any entries. */
export function ShareSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className={BOTTOM_SHEET}>
        <SheetHeader>
          <SheetTitle>Share tasks</SheetTitle>
          <SheetDescription>
            Creates a file with the chosen tasks' settings and categories, but none of your progress. Someone else can
            import it in Settings to do the same tasks.
          </SheetDescription>
        </SheetHeader>
        {/* Content unmounts when the sheet closes, so each opening starts with nothing selected. */}
        <ShareForm onDone={onClose} />
      </SheetContent>
    </Sheet>
  )
}

function ShareForm({ onDone }: { onDone: () => void }) {
  const { tasks, categories, today } = useAppData()
  const active = tasks.filter((t) => !t.task.retiredAt)
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [categoryIds, setCategoryIds] = useState<string[]>([])

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  // Categories of chosen tasks always go along, so show them as included.
  const implied = new Set(
    active.filter((t) => taskIds.includes(t.task.id)).flatMap((t) => t.categories.map((c) => c.id)),
  )

  const share = async () => {
    await saveJson(`habit-tracker-tasks-${today}.json`, await exportTemplate(taskIds, categoryIds))
    onDone()
  }

  const categoryCount = new Set([...categoryIds, ...implied]).size

  return (
    <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <PickList
        title="Tasks"
        items={active.map((t) => ({ id: t.task.id, name: t.task.name, icon: t.task.icon, color: t.task.color }))}
        selected={taskIds}
        onToggle={(id) => toggle(taskIds, setTaskIds, id)}
        onAll={(all) => setTaskIds(all ? active.map((t) => t.task.id) : [])}
      />
      <PickList
        title="Categories"
        items={categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color }))}
        selected={[...new Set([...categoryIds, ...implied])]}
        locked={implied}
        onToggle={(id) => toggle(categoryIds, setCategoryIds, id)}
        onAll={(all) => setCategoryIds(all ? categories.map((c) => c.id) : [])}
      />
      <Button size="lg" className="h-11" onClick={share} disabled={taskIds.length + categoryIds.length === 0}>
        Share {taskIds.length} {taskIds.length === 1 ? "task" : "tasks"}
        {categoryCount > 0 && ` and ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}`}
      </Button>
    </div>
  )
}

interface PickListProps {
  title: string
  items: { id: string; name: string; icon: string; color: string }[]
  selected: string[]
  /** Shown as selected and can't be unticked. */
  locked?: Set<string>
  onToggle: (id: string) => void
  onAll: (all: boolean) => void
}

function PickList({ title, items, selected, locked, onToggle, onAll }: PickListProps) {
  if (items.length === 0) return null
  const allSelected = items.every((i) => selected.includes(i.id))
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button variant="ghost" size="xs" onClick={() => onAll(!allSelected)}>
          {allSelected ? "None" : "All"}
        </Button>
      </div>
      <div className="flex flex-col divide-y rounded-lg border">
        {items.map((item) => {
          const isLocked = locked?.has(item.id) ?? false
          return (
            <Label key={item.id} className="flex items-center gap-3 px-3 py-2.5 font-normal">
              <Checkbox
                checked={selected.includes(item.id)}
                disabled={isLocked}
                onCheckedChange={() => onToggle(item.id)}
              />
              {item.icon ? (
                <TaskIcon name={item.icon} className="size-4" style={{ color: item.color }} />
              ) : (
                <span className="size-3 rounded-full" style={{ backgroundColor: item.color }} />
              )}
              <span className="flex-1 truncate">{item.name}</span>
              {isLocked && <span className="text-xs text-muted-foreground">with tasks</span>}
            </Label>
          )
        })}
      </div>
    </div>
  )
}
