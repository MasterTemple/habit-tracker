import { lazy, Suspense } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import type { LocalDate, WeekStart } from "@/domain/types"
import type { TaskView } from "@/hooks/useAppData"
import { SHEET } from "@/lib/viewport"

const InsightsBody = lazy(() => import("./InsightsBody"))

export interface InsightsProps {
  /** The tasks the overview covers (respects the category filter). */
  tasks: TaskView[]
  today: LocalDate
  weekStartsOn: WeekStart
  /** e.g. "Exercise" when the list is filtered. */
  scope: string
  /** Offer a PDF of your own report (not for someone else's tasks), limited to these categories (empty = all). */
  pdf?: { categoryIds: string[] }
}

/** How goals have gone lately: met vs missed by week, and each task's rate. */
export function InsightsSheet({
  open,
  onOpenChange,
  ...rest
}: InsightsProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className={SHEET}>
        {open && (
          <Suspense fallback={<div className="h-96" />}>
            <InsightsBody {...rest} />
          </Suspense>
        )}
      </SheetContent>
    </Sheet>
  )
}
