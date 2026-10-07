import { CopyIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { deleteShare, newToken, saveShare, type Draft } from "@/db/repo"
import type { Share } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { CHANNEL_OPTIONS, EVENT_OPTIONS } from "@/lib/labels"
import { SHEET } from "@/lib/viewport"
import { Field, SwitchRow } from "./AutomationEditor"
import { ContactPicker, isEmptyScope, MultiChips, ScopePicker } from "./pickers"

/** An existing rule, or a kind to create; null when closed. */
export type ShareTarget = { id: string } | { kind: Share["kind"] }

const NONE = { appliesToAll: false, taskIds: [], categoryIds: [] }

function blank(kind: Share["kind"]): Draft<Share> {
  return kind === "view"
    ? { kind, name: "", enabled: true, scope: NONE, contactIds: [], anyoneWithLink: false, token: newToken(), webhookUrl: "" }
    : {
        kind,
        name: "",
        enabled: true,
        scope: NONE,
        contactIds: [],
        events: ["entry", "completed", "failed"],
        channels: ["push"],
        webhookUrl: "",
      }
}

export function ShareEditor({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="top" className={SHEET} onOpenAutoFocus={(e) => e.preventDefault()}>
        {target && <Form target={target} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function Form({ target, onDone }: { target: ShareTarget; onDone: () => void }) {
  const { shares } = useAppData()
  const existing = "id" in target ? shares.find((s) => s.id === target.id) : undefined
  const [draft, setDraft] = useState<Draft<Share>>(() => existing ?? blank("kind" in target ? target.kind : "view"))
  const set = (changes: Partial<Draft<Share>>) => setDraft((d) => ({ ...d, ...changes }) as Draft<Share>)
  const view = draft.kind === "view"

  const hasAudience =
    draft.contactIds.length > 0 || !!draft.webhookUrl || (draft.kind === "view" && draft.anyoneWithLink)
  const badUrl = !!draft.webhookUrl && !/^https?:\/\/\S+$/.test(draft.webhookUrl)
  const invalid = isEmptyScope(draft.scope) || !hasAudience || badUrl || (draft.kind === "notify" && draft.events.length === 0)

  const save = async () => {
    if (invalid) return
    await saveShare(draft)
    onDone()
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {existing ? "Edit" : "New"} {view ? "share" : "accountability alert"}
        </SheetTitle>
        <SheetDescription>
          {view
            ? "Choose what people can see: your progress on these tasks (never other tasks). Takes effect once accounts and the sync server exist."
            : "Tell people when things happen on these tasks. Takes effect once the sync server exists."}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-5 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="grid gap-1.5">
          <Label htmlFor="share-name">Name</Label>
          <Input
            id="share-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={view ? "Exercise with Sam" : "Tell Sam about workouts"}
          />
        </div>

        <Field label={view ? "Share" : "About"}>
          <ScopePicker id="share" value={draft.scope} onChange={(scope) => set({ scope })} />
        </Field>

        {draft.kind === "notify" && (
          <Field label="When">
            <MultiChips options={EVENT_OPTIONS} value={draft.events} onChange={(events) => set({ events })} />
            {draft.events.includes("entry") && (
              <p className="text-xs text-muted-foreground">
                Progress alerts wait a minute, so an entry you undo right away is never sent.
              </p>
            )}
          </Field>
        )}

        <Field label={view ? "Who can see it" : "Tell"}>
          <ContactPicker value={draft.contactIds} onChange={(contactIds) => set({ contactIds })} />
        </Field>

        {draft.kind === "view" && (
          <>
            <SwitchRow
              id="share-link"
              label="Anyone with the link"
              hint="Unlisted: not searchable, but anyone you give the link to can view."
              checked={draft.anyoneWithLink}
              onChange={(anyoneWithLink) => set({ anyoneWithLink })}
            />
            {draft.anyoneWithLink && (
              <div className="grid gap-1.5">
                <div className="flex gap-2">
                  <Input readOnly value={`https://<sync server>/s/${draft.token}`} className="min-w-0 flex-1 font-mono text-xs" />
                  <Button variant="outline" size="icon-lg" disabled aria-label="Copy link">
                    <CopyIcon />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">The link will work once the sync server exists.</p>
              </div>
            )}
          </>
        )}

        {draft.kind === "notify" && (
          <Field label="Via">
            <MultiChips options={CHANNEL_OPTIONS} value={draft.channels} onChange={(channels) => set({ channels })} />
          </Field>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="share-webhook">{view ? "Also post updates to a webhook" : "Also post to a webhook"}</Label>
          <Input
            id="share-webhook"
            type="url"
            autoCapitalize="none"
            value={draft.webhookUrl}
            onChange={(e) => set({ webhookUrl: e.target.value.trim() })}
            placeholder="https://example.com/hook (optional)"
            aria-invalid={badUrl}
          />
        </div>

        <SwitchRow id="share-enabled" label="On" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />

        {!hasAudience && !isEmptyScope(draft.scope) && (
          <p className="text-xs text-muted-foreground">
            Pick at least one friend{view ? ", turn on the link," : ""} or add a webhook.
          </p>
        )}
        <Button size="lg" className="h-11" onClick={save} disabled={invalid}>
          {existing ? "Save" : "Create"}
        </Button>
        {existing && (
          <Button
            variant="destructive"
            onClick={async () => {
              await deleteShare(existing.id)
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
