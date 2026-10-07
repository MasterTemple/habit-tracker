import { format } from "date-fns"
import { ChevronDownIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { AmountDialog } from "@/components/AmountDialog"
import { CategoryChip } from "@/components/CategoryChip"
import { TaskCard } from "@/components/TaskCard"
import { TaskDetail } from "@/components/TaskDetail"
import { TaskEditor } from "@/components/TaskEditor"
import { Button } from "@/components/ui/button"
import { seedExamples } from "@/db/seed"
import { parseLocalDate } from "@/domain/dates"
import { useAppData } from "@/hooks/useAppData"
import { cn } from "@/lib/utils"

export function TasksPage() {
  const { tasks, categories, today } = useAppData()
  const [filter, setFilter] = useState<string | null>(null)
  const [showRetired, setShowRetired] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [amountId, setAmountId] = useState<string | null>(null)
  const [editorId, setEditorId] = useState<string | null>(null)

  const visible = tasks.filter((t) => !filter || t.categories.some((c) => c.id === filter))
  const active = visible.filter((t) => !t.task.retiredAt)
  const retired = visible.filter((t) => t.task.retiredAt)
  const find = (id: string | null) => tasks.find((t) => t.task.id === id) ?? null

  const openEditor = (id: string) => {
    setDetailId(null)
    setEditorId(id)
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{format(parseLocalDate(today), "EEEE, MMMM d")}</p>
          <h1 className="text-2xl font-semibold">Tasks</h1>
        </div>
        <Button size="icon-lg" className="size-10 rounded-full" onClick={() => setEditorId("new")} aria-label="New task">
          <PlusIcon className="size-5" />
        </Button>
      </header>

      {categories.length > 0 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
              filter === null ? "bg-foreground text-background" : "text-muted-foreground",
            )}
          >
            All
          </button>
          {categories.map((c) => (
            <CategoryChip
              key={c.id}
              category={c}
              size="md"
              selected={filter === null ? undefined : filter === c.id}
              onClick={() => setFilter(filter === c.id ? null : c.id)}
            />
          ))}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="mt-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <p>No tasks yet.</p>
          <div className="flex gap-2">
            <Button onClick={() => setEditorId("new")}>
              <PlusIcon /> New task
            </Button>
            <Button variant="outline" onClick={seedExamples}>
              <SparklesIcon /> Add examples
            </Button>
          </div>
        </div>
      )}

      {active.map((view) => (
        <TaskCard
          key={view.task.id}
          view={view}
          onOpen={() => setDetailId(view.task.id)}
          onEdit={openEditor}
          onCustomAmount={() => setAmountId(view.task.id)}
        />
      ))}

      {retired.length > 0 && (
        <>
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-sm text-muted-foreground"
            onClick={() => setShowRetired((v) => !v)}
          >
            <ChevronDownIcon className={cn("size-4 transition-transform", showRetired && "rotate-180")} />
            Retired ({retired.length})
          </button>
          {showRetired &&
            retired.map((view) => (
              <TaskCard
                key={view.task.id}
                view={view}
                onOpen={() => setDetailId(view.task.id)}
                onEdit={openEditor}
                onCustomAmount={() => setAmountId(view.task.id)}
              />
            ))}
        </>
      )}

      <TaskDetail view={find(detailId)} today={today} onClose={() => setDetailId(null)} onEdit={openEditor} />
      <AmountDialog view={find(amountId)} onClose={() => setAmountId(null)} />
      <TaskEditor taskId={editorId} onClose={() => setEditorId(null)} />
    </div>
  )
}
