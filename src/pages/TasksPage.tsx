import { PlusIcon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { AmountDialog } from "@/components/AmountDialog"
import { CategoriesList } from "@/components/CategoriesList"
import { CategoryChip } from "@/components/CategoryChip"
import { DailyOverview } from "@/components/DailyOverview"
import { PinnedTabs } from "@/components/layout"
import { ScrollRow } from "@/components/ScrollRow"
import { SortableList, useDragHandle } from "@/components/Sortable"
import { TaskCard } from "@/components/TaskCard"
import { TaskDetail } from "@/components/TaskDetail"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { reorderTask } from "@/db/repo"
import { seedExamples } from "@/db/seed"
import { useAppData, type TaskView } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { useNav, useViewTab } from "@/hooks/useNav"
import { ON_BREAK, RETIRED, UNCATEGORIZED, visibleTasks, type Visibility } from "@/lib/filters"
import { cn } from "@/lib/utils"

const SHOW_KEY = "task-list-show"

// Which hidden kinds to show is a per-device preference, so browser storage is fine (and may be unavailable).
function loadShow(): Visibility {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOW_KEY) ?? "{}")
    return { retired: saved.retired === true, breaks: saved.breaks === true }
  } catch {
    return { retired: false, breaks: false }
  }
}

export function TasksPage() {
  const { tasks, today } = useAppData()
  const [tab, setTab] = useViewTab("tasks")
  // Selected category ids or pseudo-categories; a task shows if it matches any. Empty = all.
  const [filter, setFilter] = useState<string[]>([])
  const [show, setShowState] = useState(loadShow)

  const setShow = (changes: Partial<Visibility>) => {
    const next = { ...show, ...changes }
    setShowState(next)
    // Hiding a kind also drops its chip from the filter.
    setFilter((f) => f.filter((v) => (v !== RETIRED || next.retired) && (v !== ON_BREAK || next.breaks)))
    try {
      localStorage.setItem(SHOW_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const visible = visibleTasks(tasks, filter, show, today)
  const active = visible.filter((t) => !t.task.retiredAt)
  const retired = visible.filter((t) => t.task.retiredAt)
  // Progress always counts tasks on break (as "on break"), even when they're hidden from the list.
  const overviewTasks = visibleTasks(tasks, filter, { retired: false, breaks: true }, today)

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <PinnedTabs tabs={TABS}>{tab === "tasks" && <DailyOverview tasks={overviewTasks} filter={filter} />}</PinnedTabs>
      <TabsContent value="tasks">
        <TaskList
          active={active}
          retired={retired}
          filter={filter}
          setFilter={setFilter}
          show={show}
          setShow={setShow}
        />
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

const TABS = [
  { value: "tasks", label: "Tasks" },
  { value: "categories", label: "Categories" },
]

interface TaskListProps {
  active: TaskView[]
  retired: TaskView[]
  filter: string[]
  setFilter: (filter: string[]) => void
  show: Visibility
  setShow: (changes: Partial<Visibility>) => void
}

function TaskList({ active, retired, filter, setFilter, show, setShow }: TaskListProps) {
  const { tasks, categories, today, settings } = useAppData()
  const { openTask, openBreak } = useEditors()
  const { setPage, setTab } = useNav()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [amountId, setAmountId] = useState<string | null>(null)
  const find = (id: string | null) => tasks.find((t) => t.task.id === id) ?? null
  const toggle = (id: string) => setFilter(filter.includes(id) ? filter.filter((f) => f !== id) : [...filter, id])
  const hasUncategorized = tasks.some((t) => !t.task.retiredAt && t.categories.length === 0)

  // Pseudo-categories, shown after the real ones when there's something to filter.
  const pseudo = [
    { value: UNCATEGORIZED, label: settings.uncategorizedName || "Other", visible: hasUncategorized },
    { value: RETIRED, label: "Retired", visible: show.retired },
    { value: ON_BREAK, label: "On break", visible: show.breaks },
  ].filter((p) => p.visible || filter.includes(p.value))

  const cardProps = (view: TaskView) => ({
    view,
    today,
    onOpen: () => setDetailId(view.task.id),
    onCustomAmount: () => setAmountId(view.task.id),
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-6">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={show.retired} onCheckedChange={(v) => setShow({ retired: v === true })} />
          Show retired
        </Label>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={show.breaks} onCheckedChange={(v) => setShow({ breaks: v === true })} />
          Show breaks
        </Label>
      </div>

      {(categories.length > 0 || pseudo.length > 0) && (
        <ScrollRow className="gap-1.5 py-0.5">
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
          {pseudo.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => toggle(p.value)}
              aria-pressed={filter.includes(p.value)}
              className={cn(
                "rounded-full border border-dashed px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                filter.includes(p.value) ? "border-foreground bg-muted text-foreground" : "text-muted-foreground",
                filter.length > 0 && !filter.includes(p.value) && "opacity-50",
              )}
            >
              {p.label}
            </button>
          ))}
        </ScrollRow>
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

      {/* Retired tasks (when shown) come last and keep their own order. */}
      {retired.map((view) => (
        <TaskCard key={view.task.id} {...cardProps(view)} />
      ))}

      {tasks.length > 0 && active.length + retired.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">No tasks match.</p>
      )}

      <TaskDetail
        view={find(detailId)}
        today={today}
        onClose={() => setDetailId(null)}
        actions={{
          onEdit: (taskId) => {
            setDetailId(null)
            openTask({ mode: "edit", taskId })
          },
          onViewBreaks: () => {
            setDetailId(null)
            setTab("schedule", "breaks")
            setPage("schedule")
          },
          onTakeBreak: (taskId) => {
            setDetailId(null)
            openBreak({ preset: { taskIds: [taskId] } })
          },
          onEditBreak: (id) => {
            setDetailId(null)
            openBreak({ id })
          },
        }}
      />
      <AmountDialog view={find(amountId)} onClose={() => setAmountId(null)} />
    </div>
  )
}

function SortableTaskCard(props: Omit<React.ComponentProps<typeof TaskCard>, "drag">) {
  return <TaskCard {...props} drag={useDragHandle(props.view.task.id)} />
}
