import { DownloadIcon, Share2Icon, UploadIcon } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/PageHeader"
import { ShareSheet } from "@/components/ShareSheet"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { exportData, importData, importTemplate, isTemplate, updateSettings, type ExportData } from "@/db/repo"
import type { WeekStart } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { saveJson } from "@/lib/files"

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function hourLabel(hour: number) {
  if (hour === 0) return "Midnight"
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`
}

export function SettingsPage() {
  const { settings, today } = useAppData()
  const fileInput = useRef<HTMLInputElement>(null)

  const [sharing, setSharing] = useState(false)
  // A parsed full backup waiting for the user to pick replace or merge.
  const [pendingImport, setPendingImport] = useState<ExportData | null>(null)

  const doExport = async () => saveJson(`habit-tracker-${today}.json`, await exportData())

  const readFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      if (isTemplate(data)) {
        const result = await importTemplate(data)
        toast.success(
          `Added ${result.tasks} ${result.tasks === 1 ? "task" : "tasks"}` +
            (result.categories ? ` and ${result.categories} new ${result.categories === 1 ? "category" : "categories"}` : ""),
        )
      } else {
        setPendingImport(data)
      }
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`)
    }
  }

  const finishImport = async (mode: "replace" | "merge") => {
    if (!pendingImport) return
    try {
      await importData(pendingImport, mode)
      toast.success(mode === "replace" ? "Data replaced" : "Data merged")
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`)
    }
    setPendingImport(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />

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
        <Row label="Show limits as" hint="e.g. a limit of 4 with 3 used">
          <Select
            value={settings.limitDisplay}
            onValueChange={(v) => updateSettings({ limitDisplay: v as typeof settings.limitDisplay })}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="used">Used (3 / 4)</SelectItem>
              <SelectItem value="remaining">Remaining (1 / 4)</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Uncategorized filter" hint="Name of the filter for tasks without a category">
          <Input
            className="w-36"
            defaultValue={settings.uncategorizedName}
            placeholder="Other"
            onBlur={(e) => updateSettings({ uncategorizedName: e.target.value.trim() || "Other" })}
          />
        </Row>
        <Row label="Carry over by default" hint="Default for new tasks; each task can override it">
          <Switch
            checked={settings.carryOverDefault}
            onCheckedChange={(v) => updateSettings({ carryOverDefault: v })}
          />
        </Row>
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
              if (file) readFile(file)
              e.target.value = ""
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Data is stored only on this device. Export regularly as a backup. Import accepts a backup or a shared task
          file.
        </p>
        <Button variant="outline" onClick={() => setSharing(true)}>
          <Share2Icon /> Share tasks…
        </Button>
      </Section>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} />

      <Dialog open={!!pendingImport} onOpenChange={(o) => !o && setPendingImport(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Import backup</DialogTitle>
            <DialogDescription>
              {pendingImport &&
                `${pendingImport.tasks?.length ?? 0} tasks and ${pendingImport.events?.length ?? 0} entries from ${
                  pendingImport.exportedAt ? new Date(pendingImport.exportedAt).toLocaleDateString() : "an export"
                }.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button onClick={() => finishImport("merge")}>Merge with my data</Button>
            <p className="text-xs text-muted-foreground">
              Keeps everything here and adds what's new from the file. Where both have the same item, the more
              recently changed one wins. Your settings stay as they are.
            </p>
            <Button variant="destructive" className="mt-2" onClick={() => finishImport("replace")}>
              Replace everything
            </Button>
            <p className="text-xs text-muted-foreground">Deletes all data on this device, then loads the file.</p>
          </div>
        </DialogContent>
      </Dialog>

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
