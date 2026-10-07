import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { deleteContact, saveContact, type Draft } from "@/db/repo"
import type { Contact, Relationship } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { RELATIONSHIPS } from "@/lib/labels"
import { BOTTOM_SHEET } from "@/lib/viewport"

/** "new" or a contact id; null when closed. */
export type ContactTarget = "new" | string

const BLANK: Draft<Contact> = {
  name: "",
  relationship: "friend",
  username: "",
  phone: "",
  email: "",
  telegram: "",
  signal: "",
  discordId: "",
  notes: "",
}

export function ContactEditor({ target, onClose }: { target: ContactTarget | null; onClose: () => void }) {
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className={BOTTOM_SHEET} onOpenAutoFocus={(e) => e.preventDefault()}>
        {target && <Form target={target} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function Form({ target, onDone }: { target: ContactTarget; onDone: () => void }) {
  const { contacts } = useAppData()
  const existing = target === "new" ? undefined : contacts.find((c) => c.id === target)
  const [draft, setDraft] = useState<Draft<Contact>>(() => existing ?? BLANK)
  const set = (changes: Partial<Draft<Contact>>) => setDraft((d) => ({ ...d, ...changes }))

  const save = async () => {
    if (!draft.name.trim()) return
    await saveContact({ ...draft, name: draft.name.trim() })
    onDone()
  }

  const field = (key: keyof Omit<Draft<Contact>, "relationship" | "id">, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`contact-${key}`}>{label}</Label>
      <Input
        id={`contact-${key}`}
        autoCapitalize="none"
        value={draft[key]}
        onChange={(e) => set({ [key]: e.target.value })}
        {...props}
      />
    </div>
  )

  return (
    <>
      <SheetHeader>
        <SheetTitle>{existing ? "Edit friend" : "New friend"}</SheetTitle>
        <SheetDescription>
          Details are only used to open other apps for messaging. Nothing is sent from here.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {field("name", "Name", { autoCapitalize: "words", placeholder: "Sam" })}
        <div className="grid gap-1.5">
          <Label>Relationship</Label>
          <Select value={draft.relationship} onValueChange={(v) => set({ relationship: v as Relationship })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATIONSHIPS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {field("phone", "Phone", { type: "tel", placeholder: "+1 555 123 4567" })}
        {field("email", "Email", { type: "email", placeholder: "sam@example.com" })}
        {field("telegram", "Telegram username", { placeholder: "@sam" })}
        {field("signal", "Signal phone number", { type: "tel", placeholder: "+1 555 123 4567" })}
        {field("discordId", "Discord user ID", { inputMode: "numeric", placeholder: "Numbers only, from “Copy User ID”" })}
        {field("username", "Username in this app (once accounts exist)", { placeholder: "sam" })}
        <div className="grid gap-1.5">
          <Label htmlFor="contact-notes">Notes</Label>
          <Textarea id="contact-notes" rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        <Button size="lg" className="h-11" onClick={save} disabled={!draft.name.trim()}>
          {existing ? "Save" : "Add friend"}
        </Button>
        {existing && (
          <Button
            variant="destructive"
            onClick={async () => {
              if (!confirm(`Remove ${existing.name}? They'll also be removed from your sharing and alerts.`)) return
              await deleteContact(existing.id)
              toast(`Removed ${existing.name}`)
              onDone()
            }}
          >
            Remove friend
          </Button>
        )}
      </div>
    </>
  )
}
