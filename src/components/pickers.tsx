import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { Scope } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { cn } from "@/lib/utils"
import { CategoryChip } from "./CategoryChip"
import { TaskIcon } from "./TaskIcon"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const isEmptyScope = (s: Scope) => !s.appliesToAll && s.taskIds.length === 0 && s.categoryIds.length === 0

/** "All tasks", or any mix of categories and tasks. */
export function ScopePicker({ id, value, onChange }: { id: string; value: Scope; onChange: (scope: Scope) => void }) {
  const { categories, tasks } = useAppData()
  const toggle = (key: "taskIds" | "categoryIds", itemId: string) =>
    onChange({
      ...value,
      [key]: value[key].includes(itemId) ? value[key].filter((x) => x !== itemId) : [...value[key], itemId],
    })
  // Keep tasks already chosen visible even if they've since been retired.
  const pickableTasks = tasks.filter((t) => !t.task.retiredAt || value.taskIds.includes(t.task.id))

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${id}-all`}>All tasks</Label>
        <Switch id={`${id}-all`} checked={value.appliesToAll} onCheckedChange={(v) => onChange({ ...value, appliesToAll: v })} />
      </div>
      {!value.appliesToAll && (
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
                    selected={value.categoryIds.includes(c.id)}
                    onClick={() => toggle("categoryIds", c.id)}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Tasks</Label>
            <div className="flex flex-wrap gap-1.5">
              {pickableTasks.map(({ task }) => (
                <Chip key={task.id} selected={value.taskIds.includes(task.id)} onClick={() => toggle("taskIds", task.id)}>
                  <TaskIcon name={task.icon} className="size-3.5" style={{ color: task.color }} />
                  {task.name}
                </Chip>
              ))}
            </div>
          </div>
          {/* Always shown (not just when empty) so the layout doesn't shift on the first pick. */}
          <p className={cn("text-xs", isEmptyScope(value) ? "text-muted-foreground" : "text-foreground")}>
            {plural(value.categoryIds.length, "category", "categories")} and{" "}
            {plural(value.taskIds.length, "task", "tasks")} selected
          </p>
        </>
      )}
    </div>
  )
}

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium pointer-coarse:px-3 pointer-coarse:py-1.5 pointer-coarse:text-sm",
        selected ? "border-foreground bg-muted text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  )
}

/** Pick any number of options, shown as chips. */
export function MultiChips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T[]
  onChange: (value: T[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          selected={value.includes(o.value)}
          onClick={() => onChange(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value])}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  )
}

/** Pick friends from the Social tab. */
export function ContactPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { contacts } = useAppData()
  if (contacts.length === 0) {
    return <p className="text-xs text-muted-foreground">No friends yet. Add them in Social → Friends.</p>
  }
  return <MultiChips options={contacts.map((c) => ({ value: c.id, label: c.name }))} value={value} onChange={onChange} />
}
