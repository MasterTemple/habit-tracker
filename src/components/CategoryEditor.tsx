import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createCategory, updateCategory } from "@/db/repo"
import { useAppData } from "@/hooks/useAppData"
import { COLORS, nextColor } from "@/lib/icons"
import { ColorPicker } from "./ColorPicker"
import { IconPicker } from "./IconPicker"

/** "new" to create, a category id to edit, or null when closed. */
export type CategoryTarget = "new" | string

interface Props {
  target: CategoryTarget | null
  onClose: () => void
}

export function CategoryEditor({ target, onClose }: Props) {
  const { categories } = useAppData()
  const [name, setName] = useState("")
  const [color, setColor] = useState(COLORS[0])
  const [icon, setIcon] = useState("")
  const existing = target && target !== "new" ? categories.find((c) => c.id === target) : undefined

  useEffect(() => {
    if (!target) return
    setName(existing?.name ?? "")
    setColor(existing?.color ?? nextColor(categories.map((c) => c.color)))
    setIcon(existing?.icon ?? "")
    // Only reset when opened for something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (existing) await updateCategory(existing.id, { name: trimmed, color, icon })
    else await createCategory(trimmed, color, icon)
    onClose()
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>Categories group tasks. Use them for priorities too (High, Medium, …).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="Exercise"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Default icon</Label>
              {icon && (
                <Button variant="ghost" size="xs" onClick={() => setIcon("")}>
                  Clear
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Optional. New tasks in this category start with it (the highest category in the list wins).
            </p>
            <IconPicker value={icon} color={color} onChange={setIcon} />
          </div>
          <Button size="lg" className="h-11" onClick={save} disabled={!name.trim()}>
            {existing ? "Save" : "Create category"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
