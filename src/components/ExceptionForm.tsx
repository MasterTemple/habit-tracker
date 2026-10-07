import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createException } from "@/db/repo"
import type { ScopeType } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"

interface Props {
  /** Preselected scope, e.g. the task or category the form was opened from. */
  defaultScope?: { scopeType: ScopeType; scopeId: string | null }
  /** Categories to list first, e.g. the categories of the task being viewed. */
  suggestedCategoryIds?: string[]
  onDone: () => void
}

/** Creates a break: targets are suspended or prorated for these days, but progress can still be recorded. */
export function ExceptionForm({ defaultScope, suggestedCategoryIds = [], onDone }: Props) {
  const { today, categories, tasks } = useAppData()
  const [scope, setScope] = useState(defaultScope ? `${defaultScope.scopeType}:${defaultScope.scopeId ?? ""}` : "all:")
  const sortedCategories = [
    ...categories.filter((c) => suggestedCategoryIds.includes(c.id)),
    ...categories.filter((c) => !suggestedCategoryIds.includes(c.id)),
  ]
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [description, setDescription] = useState("")

  const submit = async () => {
    const [scopeType, scopeId] = scope.split(":") as [ScopeType, string]
    await createException({
      scopeType,
      scopeId: scopeId || null,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      description: description.trim(),
    })
    onDone()
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-1.5">
        <Label>Applies to</Label>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all:">All tasks</SelectItem>
            {sortedCategories.map((c) => (
              <SelectItem key={c.id} value={`category:${c.id}`}>
                Category: {c.name}
              </SelectItem>
            ))}
            {tasks
              .filter((t) => !t.task.retiredAt)
              .map((t) => (
                <SelectItem key={t.task.id} value={`task:${t.task.id}`}>
                  Task: {t.task.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="break-start">From</Label>
          <Input id="break-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="break-end">To</Label>
          <Input id="break-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="break-description">Reason</Label>
        <Input
          id="break-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Vacation, sick, …"
        />
      </div>
      <Button onClick={submit} disabled={!startDate || !endDate}>
        Add break
      </Button>
    </div>
  )
}
