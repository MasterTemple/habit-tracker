import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  title: string
  /** Shows a round + button. */
  onCreate?: () => void
  createLabel?: string
}

export function PageHeader({ title, onCreate, createLabel }: Props) {
  return (
    <header className="flex items-end justify-between">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {onCreate && <CreateButton onClick={onCreate} label={createLabel ?? "Create"} />}
    </header>
  )
}

export function CreateButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="icon-lg" className="size-10 shrink-0 rounded-full" onClick={onClick} aria-label={label}>
      <PlusIcon className="size-5" />
    </Button>
  )
}
