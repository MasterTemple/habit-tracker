import { format } from "date-fns"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { describeSchedule, nextRun } from "@/domain/schedule"
import type { Schedule } from "@/domain/types"
import { WEEKDAY_OPTIONS } from "@/lib/labels"
import { NumberInput } from "./NumberInput"
import { MultiChips } from "./pickers"

/** Repeat (daily / weekly on chosen days / monthly on a day) at a time, with a plain-English summary. */
export function ScheduleFields({ id, value, onChange }: { id: string; value: Schedule; onChange: (s: Schedule) => void }) {
  const set = (changes: Partial<Schedule>) => onChange({ ...value, ...changes })
  // "Now" as of opening the editor; precise enough for a preview.
  const [now] = useState(() => new Date())
  const next = nextRun(value, now)
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor={`${id}-repeat`}>Repeat</Label>
          <Select value={value.repeat} onValueChange={(v) => set({ repeat: v as Schedule["repeat"] })}>
            <SelectTrigger id={`${id}-repeat`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Every day</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid w-32 gap-1.5">
          <Label htmlFor={`${id}-time`}>At</Label>
          <Input
            id={`${id}-time`}
            type="time"
            className="block w-full min-w-0 appearance-none"
            value={value.time}
            onChange={(e) => e.target.value && set({ time: e.target.value })}
          />
        </div>
      </div>
      {value.repeat === "weekly" && (
        <div className="grid gap-1.5">
          <Label>On</Label>
          <MultiChips options={WEEKDAY_OPTIONS} value={value.weekdays} onChange={(weekdays) => set({ weekdays })} />
        </div>
      )}
      {value.repeat === "monthly" && (
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-day`}>On day</Label>
          <NumberInput
            id={`${id}-day`}
            className="w-16 text-center"
            value={value.monthDay}
            onChange={(n) => n && set({ monthDay: Math.min(31, Math.max(1, n)) })}
          />
          <span className="text-xs text-muted-foreground">of the month</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {describeSchedule(value)}
        {next && ` · next ${format(next, "EEE, MMM d 'at' h:mm a")}`}
      </p>
    </div>
  )
}
