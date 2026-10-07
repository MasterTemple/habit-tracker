import { useState } from "react"
import { Input } from "@/components/ui/input"

type Props = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null
  onChange: (value: number | null) => void
  /** Allow leaving the field empty (reported as null). Otherwise an empty field reverts on blur. */
  allowEmpty?: boolean
  allowNegative?: boolean
}

/**
 * A number field that keeps the raw text while typing, so a field can be
 * cleared (or hold just "-") instead of snapping back to 0.
 */
export function NumberInput({ value, onChange, allowEmpty, allowNegative, onBlur, ...props }: Props) {
  const [text, setText] = useState(value === null ? "" : String(value))
  const [prevValue, setPrevValue] = useState(value)

  // Pick up changes made from outside (e.g. a slider), without clobbering in-progress typing.
  if (value !== prevValue) {
    setPrevValue(value)
    if (parse(text) !== value) setText(value === null ? "" : String(value))
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode={allowNegative ? "text" : "numeric"}
      pattern={allowNegative ? "-?[0-9]*" : "[0-9]*"}
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        if (!(allowNegative ? /^-?\d*$/ : /^\d*$/).test(raw)) return
        setText(raw)
        const n = parse(raw)
        if (n !== null || allowEmpty) onChange(n)
      }}
      onBlur={(e) => {
        if (parse(text) === null && !allowEmpty) setText(value === null ? "" : String(value))
        onBlur?.(e)
      }}
    />
  )
}

function parse(raw: string): number | null {
  if (raw.trim() === "" || raw === "-") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
