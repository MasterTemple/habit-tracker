import type { LucideProps } from "lucide-react"
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic"

const KNOWN = new Set<string>(iconNames)

function isIconName(name: string): name is IconName {
  return KNOWN.has(name)
}

/** Any Lucide icon by kebab-case name, loaded on demand. Unknown names fall back to a circle. */
export function TaskIcon({ name, className, style, ...props }: { name: string } & Omit<LucideProps, "ref">) {
  return (
    <DynamicIcon
      name={isIconName(name) ? name : "circle"}
      className={className}
      style={style}
      // Hold the space while the icon's chunk loads so the layout doesn't jump.
      fallback={() => <span className={className} style={{ display: "inline-block" }} />}
      {...props}
    />
  )
}
