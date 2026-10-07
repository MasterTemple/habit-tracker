import { DownloadIcon, UploadIcon } from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { exportData, importData, updateSettings } from "@/db/repo"
import type { WeekStart } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function hourLabel(hour: number) {
  if (hour === 0) return "Midnight"
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`
}

export function SettingsPage() {
  const { settings, today } = useAppData()
  const fileInput = useRef<HTMLInputElement>(null)

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
      <PageHeader title="Settings" create={false} />

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
