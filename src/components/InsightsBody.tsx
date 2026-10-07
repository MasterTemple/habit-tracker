import { FileDownIcon, LoaderCircleIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { TaskView } from "@/hooks/useAppData"
import { useSync } from "@/hooks/useSync"
import { saveFile } from "@/lib/files"
import { reportPdf } from "@/sync/api"
import { taskRates, weeklyOutcomes } from "@/lib/insights"
import type { InsightsProps } from "./InsightsSheet"
import { RangePicker, TaskRateChart, WeeklyOutcomeChart } from "./charts"

const WEEKS = [8, 12, 26] as const

/** Loaded on first open, so the chart library isn't in the startup bundle. */
export default function InsightsBody({ tasks, today, weekStartsOn, scope, pdf }: InsightsProps) {
  const [weeks, setWeeks] = useState<(typeof WEEKS)[number]>(WEEKS[0])
  const weekly = useMemo(() => weeklyOutcomes(tasks, today, weeks, weekStartsOn), [tasks, today, weeks, weekStartsOn])
  const since = weekly[0].start
  const rates = useMemo(() => taskRates(tasks, today, since), [tasks, today, since])
  const met = weekly.reduce((s, w) => s + w.met, 0)
  const total = weekly.reduce((s, w) => s + w.met + w.missed, 0)
  const best = tasks.reduce<TaskView | null>((b, t) => (t.summary.streak > (b?.summary.streak ?? 0) ? t : b), null)

  return (
    <>
      <SheetHeader>
        <SheetTitle>Insights</SheetTitle>
        <SheetDescription>{scope}. Finished goals only; breaks and today don't count yet.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Goals met" value={total ? `${Math.round((met / total) * 100)}%` : "–"} />
          <Stat label="Met / total" value={`${met} / ${total}`} />
          <Stat label="Best streak" value={best ? String(best.summary.streak) : "–"} hint={best?.task.name} />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">By week</h3>
            <RangePicker options={WEEKS} value={weeks} onChange={setWeeks} unit="weeks" />
          </div>
          {total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No finished goals in this range yet.</p>
          ) : (
            // Weeks before anything was tracked would just be empty space.
            <WeeklyOutcomeChart data={weekly.slice(weekly.findIndex((w) => w.met + w.missed > 0))} />
          )}
        </div>

        {rates.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">By task</h3>
            <TaskRateChart rates={rates} />
          </div>
        )}

        {pdf && <PdfReport categoryIds={pdf.categoryIds} today={today} />}
      </div>
    </>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted px-1 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** The server's PDF report of your synced data (the same one scheduled reports email). */
function PdfReport({ categoryIds, today }: { categoryIds: string[]; today: string }) {
  const account = useSync()?.account
  const [busy, setBusy] = useState(false)
  if (!account?.token) {
    return <p className="text-center text-xs text-muted-foreground">Sign in (Settings) for PDF reports.</p>
  }
  const download = async (period: "week" | "month") => {
    setBusy(true)
    try {
      const blob = await reportPdf(account.serverUrl, account.token, period, categoryIds)
      await saveFile(new File([blob], `habit-report-${today}.pdf`, { type: "application/pdf" }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <FileDownIcon />} PDF report…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuItem onSelect={() => download("week")}>Last 7 days</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download("month")}>Last 30 days</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
