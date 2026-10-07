import type { TaskType } from "@/domain/types"
import { NumberInput } from "./NumberInput"

interface Props {
  type: TaskType
  /** Always three slots; null slots aren't shown on the card. */
  value: (number | null)[]
  onChange: (value: (number | null)[]) => void
}

/** Three square boxes laid out like the buttons on the task card. */
export function ButtonAmounts({ type, value, onChange }: Props) {
  // Limits count down: the card shows "−N" buttons (see TaskCard). Empty boxes stay blank.
  const sign = type === "limit" ? "−" : "+"
  return (
    <div className="flex gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative">
          {value[i] != null && (
            <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm text-muted-foreground">
              {sign}
            </span>
          )}
          <NumberInput
            aria-label={`Button ${i + 1}`}
            className="size-14 pl-5 text-center text-base"
            value={value[i] ?? null}
            allowEmpty
            onChange={(n) => {
              const next = [...value]
              next[i] = n && n > 0 ? n : null
              onChange(next)
            }}
          />
        </div>
      ))}
    </div>
  )
}
