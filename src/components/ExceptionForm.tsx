import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createException } from "@/db/repo"
import type { ScopeType } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"

interface Props {
  /** Pin the break to one task (from the task's detail sheet). */
  fixedScope?: { scopeType: ScopeType; scopeId: string | null }
  onDone: () => void
}

/** Creates a break: targets are suspended or prorated for these days, but progress can still be recorded. */
export function ExceptionForm({ fixedScope, onDone }: Props) {
  const { today, categories, tasks } = useAppData()
  const [scope, setScope] = useState(fixedScope ? `${fixedScope.scopeType}:${fixedScope.scopeId}` : "all:")
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
      {!fixedScope && (
        <div className="grid gap-1.5">
          <Label>Applies to</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all:">All tasks</SelectItem>
              {categories.map((c) => (
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
      )}
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
