import { ChevronDownIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { AmountDialog } from "@/components/AmountDialog"
import { CategoriesList } from "@/components/CategoriesList"
import { CategoryChip } from "@/components/CategoryChip"
import { DailyOverview } from "@/components/DailyOverview"
import { SortableList, useDragHandle } from "@/components/Sortable"
import { TaskCard } from "@/components/TaskCard"
import { TaskDetail } from "@/components/TaskDetail"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { reorderTask } from "@/db/repo"
import { seedExamples } from "@/db/seed"
import { useAppData, type TaskView } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { useViewTab } from "@/hooks/useNav"
import { UNCATEGORIZED } from "@/lib/filters"
import { cn } from "@/lib/utils"

export function TasksPage() {
  const { tasks } = useAppData()
  const [tab, setTab] = useViewTab("tasks")
  // Selected category ids (or UNCATEGORIZED); a task shows if it matches any. Empty = all.
  const [filter, setFilter] = useState<string[]>([])

  const visible = tasks.filter(
    (t) =>
      filter.length === 0 ||
      filter.some((f) => (f === UNCATEGORIZED ? t.categories.length === 0 : t.categories.some((c) => c.id === f))),
  )
  const active = visible.filter((t) => !t.task.retiredAt)
  const retired = visible.filter((t) => t.task.retiredAt)

  return (
    <Tabs value={tab} onValueChange={setTab}>
      {/* Pinned while the list scrolls. The negative margin cancels the page's top inset so that,
          once stuck, the header's own padding keeps it clear of the status bar. */}
      <div className="sticky top-0 z-30 -mx-4 -mt-[calc(0.5rem+env(safe-area-inset-top))] flex flex-col gap-3 bg-background px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-3">
        <TabsList className="w-full">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        {tab === "tasks" && <DailyOverview tasks={active} filter={filter} />}
      </div>
      <TabsContent value="tasks">
        <TaskList active={active} retired={retired} filter={filter} setFilter={setFilter} />
      </TabsContent>
      <TabsContent value="categories">
        <CategoriesList
          onShowTasks={(id) => {
            setFilter([id])
            setTab("tasks")
          }}
        />
      </TabsContent>
    </Tabs>
  )
}

interface TaskListProps {
  active: TaskView[]
  retired: TaskView[]
  filter: string[]
  setFilter: (filter: string[]) => void
}

function TaskList({ active, retired, filter, setFilter }: TaskListProps) {
  const { tasks, categories, today, settings } = useAppData()
  const { openTask, openBreak } = useEditors()
  const [showRetired, setShowRetired] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [amountId, setAmountId] = useState<string | null>(null)
  const find = (id: string | null) => tasks.find((t) => t.task.id === id) ?? null
  const toggle = (id: string) => setFilter(filter.includes(id) ? filter.filter((f) => f !== id) : [...filter, id])
  const hasUncategorized = tasks.some((t) => !t.task.retiredAt && t.categories.length === 0)

  const cardProps = (view: TaskView) => ({
    view,
    today,
    onOpen: () => setDetailId(view.task.id),
    onCustomAmount: () => setAmountId(view.task.id),
  })

  return (
    <div className="flex flex-col gap-3">
      {categories.length > 0 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            onClick={() => setFilter([])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
              filter.length === 0 ? "bg-foreground text-background" : "text-muted-foreground",
            )}
          >
            All
          </button>
          {categories.map((c) => (
            <CategoryChip
              key={c.id}
              category={c}
              size="md"
              selected={filter.length === 0 ? undefined : filter.includes(c.id)}
              onClick={() => toggle(c.id)}
            />
          ))}
          {(hasUncategorized || filter.includes(UNCATEGORIZED)) && (
            <button
              type="button"
              onClick={() => toggle(UNCATEGORIZED)}
              aria-pressed={filter.includes(UNCATEGORIZED)}
              className={cn(
                "rounded-full border border-dashed px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                filter.includes(UNCATEGORIZED) ? "border-foreground bg-muted text-foreground" : "text-muted-foreground",
                filter.length > 0 && !filter.includes(UNCATEGORIZED) && "opacity-50",
              )}
            >
              {settings.uncategorizedName || "Other"}
            </button>
          )}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="mt-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <p>No tasks yet.</p>
          <div className="flex gap-2">
            <Button onClick={() => openTask({ mode: "new" })}>
              <PlusIcon /> New task
            </Button>
            <Button variant="outline" onClick={seedExamples}>
              <SparklesIcon /> Add examples
            </Button>
          </div>
        </div>
      )}

      <SortableList ids={active.map((t) => t.task.id)} onMove={reorderTask}>
        {active.map((view) => (
          <SortableTaskCard key={view.task.id} {...cardProps(view)} />
        ))}
      </SortableList>

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
          {showRetired && retired.map((view) => <TaskCard key={view.task.id} {...cardProps(view)} />)}
        </>
      )}

      <TaskDetail
        view={find(detailId)}
        today={today}
        onClose={() => setDetailId(null)}
        onEdit={(taskId) => {
          setDetailId(null)
          openTask({ mode: "edit", taskId })
        }}
        onTakeBreak={(taskId) => {
          setDetailId(null)
          openBreak({ preset: { taskIds: [taskId] } })
        }}
        onEditBreak={(id) => {
          setDetailId(null)
          openBreak({ id })
        }}
      />
      <AmountDialog view={find(amountId)} onClose={() => setAmountId(null)} />
    </div>
  )
}

function SortableTaskCard(props: Omit<React.ComponentProps<typeof TaskCard>, "drag">) {
  return <TaskCard {...props} drag={useDragHandle(props.view.task.id)} />
}
