import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { PeriodStatus } from "@/domain/status"
import type { LocalDate } from "@/domain/types"
import type { TaskView } from "@/hooks/useAppData"
import { CHART_RANGES, entriesByHour, progressSeries, type ProgressPoint, type TaskRate, type WeekOutcome } from "@/lib/insights"

const GREEN = "var(--color-green-600)"

const STATE_LABEL: Record<PeriodStatus["state"], string> = {
  success: "met",
  failure: "missed",
  open: "",
  excused: "on break",
}

const RANGE_LABEL = { day: "days", week: "weeks", month: "months" } as const

/** Small segmented control for picking how far back a chart goes. */
export function RangePicker<T extends number>({
  options,
  value,
  onChange,
  unit,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  unit: string
}) {
  return (
    <Tabs value={String(value)} onValueChange={(v) => onChange(Number(v) as T)}>
      <TabsList className="h-7">
        {options.map((o) => (
          <TabsTrigger key={o} value={String(o)} className="px-2 text-xs" aria-label={`${o} ${unit}`}>
            {o}
            {o === options[0] ? ` ${unit}` : ""}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

/** Met (or still open) in the task's color; missed or over in gray, so it reads whatever the task's color is. */
function barStyle(state: PeriodStatus["state"], current: boolean, color: string): { fill: string; fillOpacity: number } {
  if (state === "failure") return { fill: "var(--muted-foreground)", fillOpacity: 0.45 }
  if (state === "excused") return { fill: "var(--muted-foreground)", fillOpacity: 0.2 }
  return { fill: color, fillOpacity: current ? 0.5 : 1 }
}

/** A task's amount per period as bars, with its goal as a line. The current period is lighter. */
export function TaskProgressChart({ view, today }: { view: TaskView; today: LocalDate }) {
  const period = view.target?.period ?? "day"
  const ranges = CHART_RANGES[period]
  const [periods, setPeriods] = useState(ranges[0])
  const data = useMemo(() => progressSeries(view, today, periods), [view, today, periods])
  const hasGoal = data.some((d) => d.goal !== null)
  const config = {
    actual: { label: { accumulate: "Done", limit: "Used", track: "Count" }[view.task.type], color: view.task.color },
    goal: { label: view.task.type === "limit" ? "Limit" : "Goal", color: "var(--muted-foreground)" },
  } satisfies ChartConfig

  if (data.length < 2) return null
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Progress</h3>
        <RangePicker options={ranges} value={periods} onChange={setPeriods} unit={RANGE_LABEL[period]} />
      </div>
      <ChartContainer config={config} className="aspect-auto h-44 w-full">
        <ComposedChart data={data} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fillOpacity: 0.4 }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(label, p) => {
                  const point = p[0]?.payload as ProgressPoint | undefined
                  const state = point && (point.current && point.state === "open" ? "so far" : STATE_LABEL[point.state])
                  return state ? `${label} · ${state}` : label
                }}
              />
            }
          />
          <Bar dataKey="actual" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} {...barStyle(d.state, d.current, view.task.color)} />
            ))}
          </Bar>
          {hasGoal && (
            <Line
              dataKey="goal"
              type="stepAfter"
              stroke="var(--color-goal)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}

const HOUR_LABELS = [
  "12a",
  "",
  "",
  "3a",
  "",
  "",
  "6a",
  "",
  "",
  "9a",
  "",
  "",
  "12p",
  "",
  "",
  "3p",
  "",
  "",
  "6p",
  "",
  "",
  "9p",
  "",
  "",
]

/** When in the day entries are made (wall clock where they were made). */
export function HourChart({ view }: { view: TaskView }) {
  const data = useMemo(
    () => entriesByHour(view).map((count, hour) => ({ hour: HOUR_LABELS[hour], name: hourName(hour), count })),
    [view],
  )
  if (data.reduce((sum, d) => sum + d.count, 0) < 3) return null
  const config = { count: { label: "Entries", color: view.task.color } } satisfies ChartConfig
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Time of day</h3>
      <ChartContainer config={config} className="aspect-auto h-28 w-full">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="hour" tickLine={false} axisLine={false} interval={0} fontSize={11} />
          <ChartTooltip
            cursor={{ fillOpacity: 0.4 }}
            content={<ChartTooltipContent labelFormatter={(_, p) => p[0]?.payload.name} />}
          />
          <Bar dataKey="count" fill="var(--color-count)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

function hourName(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}:00 ${hour < 12 ? "AM" : "PM"}`
}

/** Goals met and missed per week, stacked. */
export function WeeklyOutcomeChart({ data }: { data: WeekOutcome[] }) {
  const config = {
    met: { label: "Met", color: GREEN },
    missed: { label: "Missed", color: "var(--destructive)" },
  } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full">
      <BarChart data={data} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} allowDecimals={false} />
        <ChartTooltip
          cursor={{ fillOpacity: 0.4 }}
          content={<ChartTooltipContent labelFormatter={(label) => `Week of ${label}`} />}
        />
        <Bar dataKey="met" stackId="a" fill="var(--color-met)" isAnimationActive={false} />
        <Bar dataKey="missed" stackId="a" fill="var(--color-missed)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

/** Each task's share of goals met, as horizontal bars in the task's color. */
export function TaskRateChart({ rates }: { rates: TaskRate[] }) {
  const data = rates.map((r) => ({
    name: r.task.name,
    rate: r.rate,
    detail: `${r.met} of ${r.total}`,
    color: r.task.color,
  }))
  const config = { rate: { label: "Met %" } } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: data.length * 32 + 8 }}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={112}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          tickFormatter={(name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)}
        />
        <Bar
          dataKey="rate"
          radius={3}
          barSize={18}
          background={{ fill: "var(--muted)", radius: 3 }}
          isAnimationActive={false}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
          <LabelList
            dataKey="rate"
            position="right"
            fontSize={12}
            className="fill-foreground"
            formatter={(v) => `${v}%`}
            offset={8}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
