import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  Trash2Icon,
  TreePalmIcon,
  UploadIcon,
  WebhookIcon,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { ColorPicker } from "@/components/ColorPicker"
import { ExceptionForm } from "@/components/ExceptionForm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  createCategory,
  deleteCategory,
  deleteException,
  exportData,
  importData,
  moveCategory,
  updateCategory,
  updateSettings,
} from "@/db/repo"
import type { WeekStart } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { COLORS } from "@/lib/icons"

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function hourLabel(hour: number) {
  if (hour === 0) return "Midnight"
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`
}

export function SettingsPage() {
  const { settings, categories, exceptions, tasks, today } = useAppData()
  const [addingBreak, setAddingBreak] = useState(false)
  const [breakFor, setBreakFor] = useState<string | null>(null)
  const [newCategory, setNewCategory] = useState("")

  const addCategory = async () => {
    const name = newCategory.trim()
    if (!name) return
    await createCategory(name, COLORS[categories.length % COLORS.length])
    setNewCategory("")
  }
  const fileInput = useRef<HTMLInputElement>(null)

  const upcomingBreaks = exceptions
    .filter((e) => e.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))

  const scopeName = (scopeType: string, scopeId: string | null) => {
    if (scopeType === "all") return "All tasks"
    if (scopeType === "category") return categories.find((c) => c.id === scopeId)?.name ?? "Deleted category"
    return tasks.find((t) => t.task.id === scopeId)?.task.name ?? "Deleted task"
  }

  const doExport = async () => {
    const data = await exportData()
    const name = `habit-tracker-${today}.json`
    const file = new File([JSON.stringify(data, null, 2)], name, { type: "application/json" })
    // The share sheet is the most reliable way to save a file on iOS.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name })
        return
      } catch (e) {
        if ((e as Error).name === "AbortError") return
      }
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = async (file: File) => {
    if (!confirm("Replace ALL current data with this file?")) return
    try {
      await importData(JSON.parse(await file.text()))
      toast.success("Data imported")
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Section title="General">
        <Row label="Week starts on">
          <Select
            value={String(settings.weekStartsOn)}
            onValueChange={(v) => updateSettings({ weekStartsOn: Number(v) as WeekStart })}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((day, i) => (
                <SelectItem key={day} value={String(i)}>
                  {day}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="New day starts at" hint="Late-night entries before this count toward the previous day">
          <Select
            value={String(settings.dayStartHour)}
            onValueChange={(v) => updateSettings({ dayStartHour: Number(v) })}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 7 }, (_, hour) => (
                <SelectItem key={hour} value={String(hour)}>
                  {hourLabel(hour)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Carry over by default" hint="Default for new tasks; each task can override it">
          <Switch
            checked={settings.carryOverDefault}
            onCheckedChange={(v) => updateSettings({ carryOverDefault: v })}
          />
        </Row>
      </Section>

      <Section title="Categories">
        {categories.map((c, i) => (
          <div key={c.id} className="grid gap-2">
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="size-7 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color }}
                    aria-label={`Change color of ${c.name}`}
                  />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto">
                  <ColorPicker value={c.color} onChange={(color) => updateCategory(c.id, { color })} />
                </PopoverContent>
              </Popover>
              <Input
                defaultValue={c.name}
                onBlur={(e) => e.target.value.trim() && updateCategory(c.id, { name: e.target.value.trim() })}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-lg" aria-label={`Options for ${c.name}`}>
                    <EllipsisVerticalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={i === 0} onSelect={() => moveCategory(c.id, -1)}>
                    <ArrowUpIcon /> Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === categories.length - 1} onSelect={() => moveCategory(c.id, 1)}>
                    <ArrowDownIcon /> Move down
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setBreakFor(c.id)}>
                    <TreePalmIcon /> Take a break…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      confirm(`Delete category “${c.name}”? Tasks keep their data.`) && deleteCategory(c.id)
                    }
                  >
                    <Trash2Icon /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {breakFor === c.id && (
              <ExceptionForm
                defaultScope={{ scopeType: "category", scopeId: c.id }}
                onDone={() => setBreakFor(null)}
              />
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
            placeholder="New category"
          />
          <Button variant="outline" size="icon-lg" onClick={addCategory} aria-label="Add category">
            <PlusIcon />
          </Button>
        </div>
      </Section>

      <Section title="Breaks">
        <p className="text-xs text-muted-foreground">
          During a break, goals are reduced (or excused for fully covered periods) and limits ignore entries, but
          you can still record progress.
        </p>
        {upcomingBreaks.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5 text-sm">
            <span>
              {e.startDate} → {e.endDate} · {scopeName(e.scopeType, e.scopeId)}
              {e.description && <span className="text-muted-foreground"> · {e.description}</span>}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => deleteException(e.id)} aria-label="Remove break">
              <Trash2Icon />
            </Button>
          </div>
        ))}
        {addingBreak ? (
          <ExceptionForm onDone={() => setAddingBreak(false)} />
        ) : (
          <Button variant="outline" onClick={() => setAddingBreak(true)}>
            <PlusIcon /> Add break
          </Button>
        )}
      </Section>

      <Section title="Data">
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={doExport}>
            <DownloadIcon /> Export
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => fileInput.current?.click()}>
            <UploadIcon /> Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) doImport(file)
              e.target.value = ""
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">Data is stored only on this device. Export regularly as a backup.</p>
      </Section>

      <Section title="Automations">
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <WebhookIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            Reminders, webhooks, and scheduled reports (like “6pm Saturday, send report”) need the sync server and
            are coming later.
          </p>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}
