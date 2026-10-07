import { format } from "date-fns"
import { ChevronDownIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { AmountDialog } from "@/components/AmountDialog"
import { CategoriesList } from "@/components/CategoriesList"
import { CategoryChip } from "@/components/CategoryChip"
import { DailyOverview } from "@/components/DailyOverview"
import { PageHeader } from "@/components/PageHeader"
import { TaskCard } from "@/components/TaskCard"
import { TaskDetail } from "@/components/TaskDetail"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { seedExamples } from "@/db/seed"
import { parseLocalDate } from "@/domain/dates"
import { useAppData } from "@/hooks/useAppData"
import { useEditors } from "@/hooks/useEditors"
import { cn } from "@/lib/utils"

export function TasksPage() {
  const { today } = useAppData()
  const [tab, setTab] = useState("tasks")
  const [filter, setFilter] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Tasks" subtitle={format(parseLocalDate(today), "EEEE, MMMM d")} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="mt-2">
          <TaskList filter={filter} setFilter={setFilter} />
        </TabsContent>
        <TabsContent value="categories" className="mt-2">
          <CategoriesList
            onShowTasks={(id) => {
              setFilter(id)
              setTab("tasks")
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TaskList({ filter, setFilter }: { filter: string | null; setFilter: (id: string | null) => void }) {
  const { tasks, categories, today } = useAppData()
  const { openTask, openBreak } = useEditors()
  const [showRetired, setShowRetired] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [amountId, setAmountId] = useState<string | null>(null)

  const visible = tasks.filter((t) => !filter || t.categories.some((c) => c.id === filter))
  const active = visible.filter((t) => !t.task.retiredAt)
  const retired = visible.filter((t) => t.task.retiredAt)
  const find = (id: string | null) => tasks.find((t) => t.task.id === id) ?? null

  const card = (view: (typeof tasks)[number]) => (
    <TaskCard
      key={view.task.id}
      view={view}
      onOpen={() => setDetailId(view.task.id)}
      onCustomAmount={() => setAmountId(view.task.id)}
      today={today}
    />
  )

  return (
    <div className="flex flex-col gap-3">
      <DailyOverview tasks={active} />

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
            <Button onClick={() => openTask({ mode: "new" })}>
              <PlusIcon /> New task
            </Button>
            <Button variant="outline" onClick={seedExamples}>
              <SparklesIcon /> Add examples
            </Button>
          </div>
        </div>
      )}

      {active.map(card)}

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
          {showRetired && retired.map(card)}
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
