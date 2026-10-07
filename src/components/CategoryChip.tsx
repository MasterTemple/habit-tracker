import type { Category } from "@/domain/types"
import { cn } from "@/lib/utils"

interface Props {
  category: Category
  selected?: boolean
  onClick?: () => void
  size?: "sm" | "md"
}

export function CategoryChip({ category, selected, onClick, size = "sm" }: Props) {
  const className = cn(
    "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
    size === "sm" ? "px-1.5 text-[10px] leading-4" : "px-2.5 py-1 text-xs",
    selected === false && "opacity-50",
  )
  const style = {
    borderColor: `${category.color}66`,
    backgroundColor: selected ? `${category.color}33` : `${category.color}14`,
    color: category.color,
  }
  if (!onClick) {
    return (
      <span className={className} style={style}>
        {category.name}
      </span>
    )
  }
  return (
    <button type="button" className={className} style={style} onClick={onClick} aria-pressed={selected}>
      {category.name}
    </button>
  )
}
