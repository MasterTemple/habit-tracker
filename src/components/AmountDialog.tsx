import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { recordEvent } from "@/db/repo"
import type { TaskView } from "@/hooks/useAppData"

interface Props {
  view: TaskView | null
  onClose: () => void
}

/** Record a one-off amount (positive or negative) with an optional note. */
export function AmountDialog({ view, onClose }: Props) {
  return (
    <Dialog open={!!view} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {view && <AmountForm key={view.task.id} view={view} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function AmountForm({ view, onDone }: { view: TaskView; onDone: () => void }) {
  const goal = view.summary.current.goal ?? 0
  const max = Math.max(10, goal, ...view.task.incrementAmounts) * 2
  const [amount, setAmount] = useState(view.task.incrementAmounts[0] ?? 1)
  const [note, setNote] = useState("")

  const submit = async () => {
    if (amount === 0) return
    await recordEvent(view.task.id, amount, note.trim())
    onDone()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{view.task.name}</DialogTitle>
        <DialogDescription>Record a custom amount. Use a negative number to correct a mistake.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          <Slider
            min={0}
            max={max}
            step={1}
            value={[Math.max(0, amount)]}
            onValueChange={([v]) => setAmount(v)}
            className="flex-1"
          />
          <Input
            type="number"
            inputMode="numeric"
            className="w-20"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="amount-note">Note</Label>
          <Input id="amount-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
        <Button size="lg" className="h-11" onClick={submit} disabled={amount === 0}>
          {amount > 0 ? `Add ${amount}` : `Subtract ${-amount}`}
        </Button>
      </div>
    </>
  )
}
