import { CircleIcon, type LucideProps } from "lucide-react"
import { createElement } from "react"
import { TASK_ICONS } from "@/lib/icons"

export function TaskIcon({ name, ...props }: { name: string } & LucideProps) {
  return createElement(TASK_ICONS[name] ?? CircleIcon, props)
}
