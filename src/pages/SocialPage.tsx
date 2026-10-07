import { BellRingIcon, EyeIcon, LinkIcon, MessageCircleIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { ContactEditor, type ContactTarget } from "@/components/ContactEditor"
import { IncomingAlerts } from "@/components/IncomingAlerts"
import { FriendsPanel } from "@/components/FriendsPanel"
import { InboxList } from "@/components/InboxList"
import { BottomAction, ListRow, PinnedTabs, ServerNote } from "@/components/layout"
import { ShareEditor, type ShareTarget } from "@/components/ShareEditor"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { saveShare } from "@/db/repo"
import type { Share } from "@/domain/types"
import { useAppData } from "@/hooks/useAppData"
import { useNav, useViewTab } from "@/hooks/useNav"
import { contactLinks, initials } from "@/lib/contacts"
import type { FriendLists } from "@/sync/social"
import { EVENT_OPTIONS, RELATIONSHIPS } from "@/lib/labels"
import { scopeSummary } from "@/lib/scope"

const TABS = [
  { value: "inbox", label: "Inbox" },
  { value: "friends", label: "Friends" },
  { value: "sharing", label: "Sharing" },
  { value: "accountability", label: "Accountability" },
]

export function SocialPage() {
  const [tab, setTab] = useViewTab("social")
  const { openInbox, clearOpenInbox } = useNav()
  const [contact, setContact] = useState<ContactTarget | null>(null)
  const [share, setShare] = useState<ShareTarget | null>(null)

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <PinnedTabs tabs={TABS} />
      <TabsContent value="inbox">
        <InboxList openId={openInbox} onOpened={clearOpenInbox} />
      </TabsContent>
      <TabsContent value="friends">
        <FriendsList onEdit={setContact} />
      </TabsContent>
      <TabsContent value="sharing">
        <ShareList
          kind="view"
          note="Shares take effect through your sync server while you're signed in. Friends you pick (accepted friends, by their username) see these tasks under Friends → Shared with you; a link works for anyone you give it to."
          empty="Nothing shared. Share some tasks or categories with friends, or with anyone who has the link."
          onEdit={setShare}
        />
      </TabsContent>
      <TabsContent value="accountability">
        <IncomingAlerts />
        <ShareList
          kind="notify"
          note="Alerts are sent by your sync server while you're signed in. A friend gets them in their inbox (and as notifications) when their username here is set on them in Friends."
          empty="No alerts. Tell someone when you make progress, finish a goal, or miss one."
          onEdit={setShare}
        />
      </TabsContent>
      <ContactEditor target={contact} onClose={() => setContact(null)} />
      <ShareEditor target={share} onClose={() => setShare(null)} />
    </Tabs>
  )
}

function FriendsList({ onEdit }: { onEdit: (target: ContactTarget) => void }) {
  const { contacts } = useAppData()
  const [lists, setLists] = useState<FriendLists | null>(null)
  const friendUsernames = new Set(lists?.friends.map((f) => f.username) ?? [])
  const isFriend = (username: string) => friendUsernames.has(username.trim().replace(/^@/, "").toLowerCase())
  return (
    <div className="flex flex-col gap-3">
      <FriendsPanel onChange={setLists} />
      <h2 className="mt-2 text-sm font-semibold text-muted-foreground">Your people</h2>
      {contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No one yet. Find friends above, or add someone to message from here.
        </p>
      )}
      {contacts.map((c) => {
        const links = contactLinks(c)
        return (
          <ListRow
            key={c.id}
            icon={
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                {initials(c.name)}
              </span>
            }
            title={c.name}
            subtitle={[
              RELATIONSHIPS.find((r) => r.value === c.relationship)?.label,
              c.username && `@${c.username.replace(/^@/, "")}${isFriend(c.username) ? " · connected" : ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            onClick={() => onEdit(c.id)}
            trailing={
              links.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-lg" aria-label={`Message ${c.name}`}>
                      <MessageCircleIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {links.map((l) => (
                      <DropdownMenuItem key={l.label} asChild>
                        <a href={l.href} target="_blank" rel="noreferrer">
                          {l.label}
                        </a>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            }
          />
        )
      })}
      <BottomAction>
        <Button variant="outline" className="w-full" onClick={() => onEdit("new")}>
          <PlusIcon /> Add someone
        </Button>
      </BottomAction>
    </div>
  )
}

function ShareList({
  kind,
  note,
  empty,
  onEdit,
}: {
  kind: Share["kind"]
  note: string
  empty: string
  onEdit: (target: ShareTarget) => void
}) {
  const { shares, contacts, categories, tasks } = useAppData()
  const items = shares.filter((s) => s.kind === kind)

  const audience = (s: Share) => {
    const parts = s.contactIds.map((id) => contacts.find((c) => c.id === id)?.name).filter(Boolean) as string[]
    if (s.kind === "view" && s.anyoneWithLink) parts.push("anyone with the link")
    if (s.webhookUrl) parts.push("webhook")
    return parts.join(", ") || "no one yet"
  }

  const subtitle = (s: Share) => {
    const what = scopeSummary(s.scope, categories, tasks)
    if (s.kind === "view") return `${what} · visible to ${audience(s)}`
    const when = s.events.map((e) => EVENT_OPTIONS.find((o) => o.value === e)?.label.toLowerCase()).join(", ")
    return `${what} · tell ${audience(s)} when: ${when}`
  }

  const Icon = kind === "view" ? EyeIcon : BellRingIcon

  return (
    <div className="flex flex-col gap-3">
      <ServerNote>{note}</ServerNote>
      {items.length === 0 && <p className="mt-6 text-center text-sm text-muted-foreground">{empty}</p>}
      {items.map((s) => (
        <ListRow
          key={s.id}
          icon={s.kind === "view" && s.anyoneWithLink ? <LinkIcon className="size-4" /> : <Icon className="size-4" />}
          title={s.name || scopeSummary(s.scope, categories, tasks)}
          subtitle={subtitle(s)}
          muted={!s.enabled}
          onClick={() => onEdit({ id: s.id })}
          trailing={
            <Switch
              checked={s.enabled}
              onCheckedChange={(enabled) => saveShare({ ...s, enabled })}
              aria-label={`Turn ${s.name || "rule"} ${s.enabled ? "off" : "on"}`}
            />
          }
        />
      ))}
      <BottomAction>
        <Button variant="outline" className="w-full" onClick={() => onEdit({ kind })}>
          <PlusIcon /> {kind === "view" ? "Share tasks" : "New alert"}
        </Button>
      </BottomAction>
    </div>
  )
}
