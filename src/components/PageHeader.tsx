import type { ReactNode } from "react"
import { CreateButton } from "./CreateButton"

export function PageHeader({ title, subtitle, create = true }: { title: string; subtitle?: ReactNode; create?: boolean }) {
  return (
    <header className="flex items-end justify-between">
      <div>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>
      {create && <CreateButton />}
    </header>
  )
}
