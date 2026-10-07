import { ListPlusIcon, PlusIcon, TagIcon, TreePalmIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useEditors } from "@/hooks/useEditors"

/** The round + in page headers: choose what to create. */
export function CreateButton() {
  const { openTask, openCategory, openBreak } = useEditors()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-lg" className="size-10 rounded-full" aria-label="Create">
          <PlusIcon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={() => openTask({ mode: "new" })}>
          <ListPlusIcon /> Task
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openCategory("new")}>
          <TagIcon /> Category
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openBreak({})}>
          <TreePalmIcon /> Break
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
