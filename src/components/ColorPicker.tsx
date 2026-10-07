import { PipetteIcon } from "lucide-react"
import { COLORS } from "@/lib/icons"
import { cn } from "@/lib/utils"

interface Props {
  value: string
  onChange: (color: string) => void
}

/** Preset swatches plus the system color picker for any other color. */
export function ColorPicker({ value, onChange }: Props) {
  const custom = !COLORS.includes(value)
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            "size-8 rounded-full ring-offset-2 ring-offset-background",
            value === color && "ring-2 ring-foreground",
          )}
          style={{ backgroundColor: color }}
          aria-label={color}
        />
      ))}
      <label
        className={cn(
          "relative flex size-8 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-background",
          custom && "ring-2 ring-foreground",
        )}
        style={{
          background: custom
            ? value
            : "conic-gradient(#ef4444, #eab308, #22c55e, #14b8a6, #3b82f6, #a855f7, #ec4899, #ef4444)",
        }}
        aria-label="Custom color"
      >
        <PipetteIcon className="size-4 text-white drop-shadow" />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}
