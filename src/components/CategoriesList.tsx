import { EllipsisVerticalIcon, ListIcon, PencilIcon, PlusIcon, Trash2Icon, TreePalmIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { deleteCategory, reorderCategory } from "@/db/repo"
import { isExcused } from "@/domain/status"
import type { Category } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { cn } from "@/lib/utils"
import { BottomAction } from "./layout"
import { SortableList, useDragHandle } from "./Sortable"
import { TaskIcon } from "./TaskIcon"

export function CategoriesList({ onShowTasks }: { onShowTasks: (categoryId: string) => void }) {
  const { categories } = useAppData()
  const { openCategory } = useEditors()

  return (
    <div className="flex flex-col gap-3">
      {categories.length === 0 ? (
        <p className="mt-10 text-center text-muted-foreground">
          No categories yet. Use them to group tasks, or as priorities.
        </p>
      ) : (
        <div className="flex flex-col divide-y rounded-xl border bg-card">
          <SortableList ids={categories.map((c) => c.id)} onMove={reorderCategory}>
            {categories.map((c) => (
              <CategoryRow key={c.id} category={c} onShowTasks={onShowTasks} />
            ))}
          </SortableList>
        </div>
      )}
      <BottomAction>
        <Button variant="outline" className="w-full" onClick={() => openCategory("new")}>
          <PlusIcon /> New category
        </Button>
      </BottomAction>
    </div>
  )
}

function CategoryRow({ category: c, onShowTasks }: { category: Category; onShowTasks: (id: string) => void }) {
  const { tasks, exceptions, today } = useAppData()
  const { openCategory, openBreak } = useEditors()
  const { setRootNode, rootStyle, setHandleNode, handleProps, dragging } = useDragHandle(c.id)
  const count = tasks.filter((t) => !t.task.retiredAt && t.categories.some((tc) => tc.id === c.id)).length
  const onBreak = isExcused(
    today,
    exceptions.filter((e) => e.categoryIds.includes(c.id)),
  )

  return (
    <div
      ref={setRootNode}
      style={rootStyle}
      className={cn("flex items-center gap-3 bg-card py-1 pr-1 pl-2", dragging && "z-10 rounded-xl shadow-lg")}
    >
      <div
        ref={setHandleNode}
        {...handleProps}
        data-no-swipe
        className="cursor-grab touch-none p-1.5 active:cursor-grabbing"
        aria-label={`Drag to reorder ${c.name}`}
      >
        <span className="block size-5 rounded-full" style={{ backgroundColor: c.color }} />
      </div>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
        onClick={() => openCategory(c.id)}
      >
        {c.icon && <TaskIcon name={c.icon} className="size-4 shrink-0" style={{ color: c.color }} />}
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
}
