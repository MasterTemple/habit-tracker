import { CopyIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { deleteAutomation, newToken, saveAutomation, type Draft } from "@/db/repo"
import { DEFAULT_SCHEDULE } from "@/domain/schedule"
import type { Automation, Period } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { CHANNEL_OPTIONS, EVENT_OPTIONS } from "@/lib/labels"
import { SHEET } from "@/lib/viewport"
import { NumberInput } from "./NumberInput"
import { ContactPicker, isEmptyScope, MultiChips, ScopePicker } from "./pickers"
import { ScheduleFields } from "./ScheduleFields"

export type AutomationKind = Automation["kind"]
/** An existing automation to edit, or a kind to create. */
export type AutomationTarget = { id: string } | { kind: AutomationKind }

const TITLES: Record<AutomationKind, string> = {
  reminder: "Reminder",
  report: "Scheduled report",
  export: "Scheduled backup",
  webhook_in: "Incoming webhook",
  webhook_out: "Outgoing webhook",
}

const ALL = { appliesToAll: true, taskIds: [], categoryIds: [] }

function blank(kind: AutomationKind, firstTaskId: string): Draft<Automation> {
  const base = { name: "", enabled: true }
  switch (kind) {
    case "reminder":
      return { ...base, kind, scope: ALL, schedule: DEFAULT_SCHEDULE, message: "", onlyIfIncomplete: true, channels: ["push"] }
    case "report":
      return { ...base, kind, scope: ALL, schedule: { ...DEFAULT_SCHEDULE, repeat: "weekly" }, period: "week", contactIds: [], emails: [] }
    case "export":
      return { ...base, kind, scope: ALL, schedule: { ...DEFAULT_SCHEDULE, repeat: "weekly", weekdays: [0] }, period: "week", contactIds: [], emails: [] }
    case "webhook_in":
      return { ...base, kind, taskId: firstTaskId, amount: 1, token: newToken() }
    case "webhook_out":
      return { ...base, kind, scope: ALL, url: "", events: ["completed"] }
  }
}

/** Opens the app and records progress for an incoming webhook (see useShortcutLinks). Works without a server. */
export function shortcutLink(token: string) {
  return `${location.origin}${import.meta.env.BASE_URL}?hook=${token}`
}

export function AutomationEditor({ target, onClose }: { target: AutomationTarget | null; onClose: () => void }) {
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="top" className={SHEET} onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Content unmounts on close, so each opening starts from the saved values. */}
        {target && <Form target={target} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function Form({ target, onDone }: { target: AutomationTarget; onDone: () => void }) {
  const { automations, tasks } = useAppData()
  const activeTasks = tasks.filter((t) => !t.task.retiredAt)
  const existing = "id" in target ? automations.find((a) => a.id === target.id) : undefined
  const [draft, setDraft] = useState<Draft<Automation>>(
    () => existing ?? blank("kind" in target ? target.kind : "reminder", activeTasks[0]?.task.id ?? ""),
  )
  const set = (changes: Partial<Draft<Automation>>) => setDraft((d) => ({ ...d, ...changes }) as Draft<Automation>)

  const invalid =
    ("scope" in draft && draft.kind !== "export" && isEmptyScope(draft.scope)) ||
    (draft.kind === "webhook_in" && !draft.taskId) ||
    (draft.kind === "webhook_out" && !/^https?:\/\/\S+$/.test(draft.url))

  const save = async () => {
    if (invalid) return
    await saveAutomation(draft)
    onDone()
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied")
    } catch {
      toast.error("Couldn't copy; select the text instead")
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {existing ? "Edit" : "New"} {TITLES[draft.kind].toLowerCase()}
        </SheetTitle>
        <SheetDescription>
          {draft.kind === "webhook_in"
            ? "The shortcut link works now. The web address needs the sync server."
            : draft.kind === "reminder"
              ? "Sent by your sync server at this time in your current time zone, to devices with notifications on."
              : "Saved on this device. It starts running once the sync server supports it."}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="grid gap-1.5">
          <Label htmlFor="automation-name">Name</Label>
          <Input
            id="automation-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={{ reminder: "Evening check-in", report: "Weekly report", export: "Weekly backup", webhook_in: "Opened YouTube", webhook_out: "Tell my server" }[draft.kind]}
          />
        </div>

        {draft.kind === "reminder" && (
          <>
            <Field label="When">
              <ScheduleFields id="reminder" value={draft.schedule} onChange={(schedule) => set({ schedule })} />
            </Field>
            <Field label="For">
              <ScopePicker id="reminder" value={draft.scope} onChange={(scope) => set({ scope })} />
            </Field>
            <p className="-mt-3 text-xs text-muted-foreground">
              One reminder covers everything chosen, e.g. one notification for all Exercise tasks.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="reminder-message">Message</Label>
              <Textarea
                id="reminder-message"
                rows={2}
                value={draft.message}
                onChange={(e) => set({ message: e.target.value })}
                placeholder="Optional. Defaults to listing what's left to do."
              />
            </div>
            <SwitchRow
              id="reminder-incomplete"
              label="Only if not done"
              hint="Skip it when everything it covers is already done for the period"
              checked={draft.onlyIfIncomplete}
              onChange={(onlyIfIncomplete) => set({ onlyIfIncomplete })}
            />
            <Field label="Send as">
              <MultiChips options={CHANNEL_OPTIONS} value={draft.channels} onChange={(channels) => set({ channels })} />
            </Field>
          </>
        )}

        {(draft.kind === "report" || draft.kind === "export") && (
          <>
            <Field label="When">
              <ScheduleFields id="action" value={draft.schedule} onChange={(schedule) => set({ schedule })} />
            </Field>
            {draft.kind === "report" && (
              <>
                <Field label="Report covers">
                  <Select value={draft.period} onValueChange={(v) => set({ period: v as Period })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">The past day</SelectItem>
                      <SelectItem value="week">The past week</SelectItem>
                      <SelectItem value="month">The past month</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tasks">
                  <ScopePicker id="report" value={draft.scope} onChange={(scope) => set({ scope })} />
                </Field>
                <Field label="Send to friends">
                  <ContactPicker value={draft.contactIds} onChange={(contactIds) => set({ contactIds })} />
                </Field>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="action-emails">{draft.kind === "export" ? "Email the backup to" : "Also email"}</Label>
              <Input
                id="action-emails"
                type="email"
                multiple
                autoCapitalize="none"
                defaultValue={draft.emails.join(", ")}
                onBlur={(e) => set({ emails: e.target.value.split(/[,\s]+/).filter(Boolean) })}
                placeholder="me@example.com, coach@example.com"
              />
            </div>
          </>
        )}

        {draft.kind === "webhook_in" && (
          <>
            <Field label="Records">
              <div className="flex gap-2">
                <NumberInput
                  aria-label="Amount"
                  className="w-16 shrink-0 text-center"
                  value={draft.amount}
                  allowNegative
                  onChange={(amount) => amount !== null && set({ amount })}
                />
                <Select value={draft.taskId} onValueChange={(taskId) => set({ taskId })}>
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder="Pick a task" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeTasks.map((t) => (
                      <SelectItem key={t.task.id} value={t.task.id}>
                        {t.task.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <CopyField
              label="Shortcut link (works now)"
              value={shortcutLink(draft.token)}
              hint="Opening this link records the entry. In iOS Shortcuts, make an automation (e.g. “When YouTube is opened”) with the action “Open URLs” and paste this link."
              onCopy={copy}
            />
            <CopyField
              label="Web address (needs the server)"
              value={`https://<sync server>/hooks/${draft.token}`}
              hint="Other apps and services will be able to call this directly, without opening the app."
              onCopy={copy}
              disabled
            />
          </>
        )}

        {draft.kind === "webhook_out" && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-url">Post to URL</Label>
              <Input
                id="webhook-url"
                type="url"
                autoCapitalize="none"
                value={draft.url}
                onChange={(e) => set({ url: e.target.value.trim() })}
                placeholder="https://example.com/habits"
              />
            </div>
            <Field label="When">
              <MultiChips options={EVENT_OPTIONS} value={draft.events} onChange={(events) => set({ events })} />
            </Field>
            <Field label="For">
              <ScopePicker id="webhook" value={draft.scope} onChange={(scope) => set({ scope })} />
            </Field>
          </>
        )}

        <SwitchRow id="automation-enabled" label="On" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />

        <Button size="lg" className="h-11" onClick={save} disabled={invalid}>
          {existing ? "Save" : "Create"}
        </Button>
        {existing && (
          <Button
            variant="destructive"
            onClick={async () => {
              await deleteAutomation(existing.id)
              toast("Deleted")
              onDone()
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function CopyField({
  label,
  value,
  hint,
  onCopy,
  disabled,
}: {
  label: string
  value: string
  hint: string
  onCopy: (text: string) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button variant="outline" size="icon-lg" onClick={() => onCopy(value)} disabled={disabled} aria-label={`Copy ${label}`}>
          <CopyIcon />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
