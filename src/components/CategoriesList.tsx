import { ArrowDownIcon, ArrowUpIcon, EllipsisVerticalIcon, ListIcon, PencilIcon, Trash2Icon, TreePalmIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { deleteCategory, moveCategory } from "@/db/repo"
import { isExcused } from "@/domain/status"
import { useAppData } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"

export function CategoriesList({ onShowTasks }: { onShowTasks: (categoryId: string) => void }) {
  const { categories, tasks, exceptions, today } = useAppData()
  const { openCategory, openBreak } = useEditors()

  if (categories.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
        <p>No categories yet. Use them to group tasks, or as priorities.</p>
        <Button onClick={() => openCategory("new")}>New category</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col divide-y rounded-xl border bg-card">
      {categories.map((c, i) => {
        const count = tasks.filter((t) => !t.task.retiredAt && t.categories.some((tc) => tc.id === c.id)).length
        const onBreak = isExcused(
          today,
          exceptions.filter((e) => e.categoryIds.includes(c.id)),
        )
        return (
          <div key={c.id} className="flex items-center gap-3 py-1 pr-1 pl-3">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
              onClick={() => openCategory(c.id)}
            >
              <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
              <span className="truncate font-medium">{c.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {onBreak && <TreePalmIcon className="size-3.5" aria-label="On break" />}
                {count} {count === 1 ? "task" : "tasks"}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-lg" aria-label={`Options for ${c.name}`}>
                  <EllipsisVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openCategory(c.id)}>
                  <PencilIcon /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onShowTasks(c.id)}>
                  <ListIcon /> Show tasks
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openBreak({ preset: { categoryIds: [c.id] } })}>
                  <TreePalmIcon /> Take a break…
                </DropdownMenuItem>
                <DropdownMenuItem disabled={i === 0} onSelect={() => moveCategory(c.id, -1)}>
                  <ArrowUpIcon /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={i === categories.length - 1} onSelect={() => moveCategory(c.id, 1)}>
                  <ArrowDownIcon /> Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    if (!confirm(`Delete category “${c.name}”? Tasks keep their data.`)) return
                    await deleteCategory(c.id)
                    toast(`Deleted “${c.name}”`)
                  }}
                >
                  <Trash2Icon /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}
