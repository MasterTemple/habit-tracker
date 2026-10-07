import { CheckIcon, EyeIcon, SearchIcon, UserPlusIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveContact } from "@/db/repo"
import { useAppData } from "@/hooks/useAppData"
import { useNav } from "@/hooks/useNav"
import { useSync } from "@/hooks/useSync"
import { onSyncActivity } from "@/sync/engine"
import {
  acceptFriend,
  listFriends,
  removeFriend,
  requestFriend,
  searchPeople,
  sharedWithMe,
  type FriendLists,
  type PersonResult,
  type SharingPerson,
} from "@/sync/social"
import { ListRow } from "./layout"

/** Finding people, friend requests, and who shares with you. Shown when signed in. */
export function FriendsPanel({ onChange }: { onChange: (lists: FriendLists | null) => void }) {
  const signedIn = !!useSync()?.account?.token
  const { contacts } = useAppData()
  const { view } = useNav()
  const [query, setQuery] = useState("")
  // Search results, tagged with the query they're for (so stale ones never show).
  const [found, setFound] = useState<{ q: string; people: PersonResult[] }>({ q: "", people: [] })
  const q = query.trim()
  const searchable = signedIn && q.replace(/^@/, "").length >= 2
  const results = searchable && found.q === q ? found.people : []
  const [lists, setLists] = useState<FriendLists | null>(null)
  const [sharing, setSharing] = useState<SharingPerson[]>([])

  const refresh = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([listFriends(), sharedWithMe()])
      setLists(l)
      setSharing(s)
      onChange(l)
    } catch {
      onChange(null)
    }
  }, [onChange])

  // Fresh on open, after each sync, when the app comes back, and every minute.
  useEffect(() => {
    if (!signedIn) return
    const id = setTimeout(refresh, 0)
    const stopSync = onSyncActivity(() => void refresh())
    const onVisible = () => document.visibilityState === "visible" && void refresh()
    document.addEventListener("visibilitychange", onVisible)
    const interval = setInterval(onVisible, 60_000)
    return () => {
      clearTimeout(id)
      stopSync()
      document.removeEventListener("visibilitychange", onVisible)
      clearInterval(interval)
    }
  }, [signedIn, refresh])

  // Search as you type (after a short pause).
  useEffect(() => {
    if (!searchable) return
    const id = setTimeout(
      () => searchPeople(q).then((people) => setFound({ q, people }), () => setFound({ q, people: [] })),
      250,
    )
    return () => clearTimeout(id)
  }, [q, searchable])

  /** Friends go in your contacts too, so you can pick them for sharing and alerts. */
  const ensureContact = async (username: string, displayName: string) => {
    if (contacts.some((c) => c.username.trim().replace(/^@/, "").toLowerCase() === username)) return
    await saveContact({
      name: displayName.trim() || username,
      relationship: "friend",
      username,
      phone: "",
      email: "",
      telegram: "",
      signal: "",
      discordId: "",
      notes: "",
    })
  }

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast.success(done)
      await refresh()
      if (searchable) setFound({ q, people: await searchPeople(q).catch(() => []) })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (!signedIn) {
    return (
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input disabled className="pl-8" placeholder="Sign in (Settings) to find people" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          type="search"
          autoCapitalize="none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find people by username"
        />
      </div>
      {results.map((p) => (
        <ListRow
          key={p.username}
          icon={<UserPlusIcon className="size-4" />}
          title={p.displayName || `@${p.username}`}
          subtitle={`@${p.username}`}
          onClick={() => {}}
          trailing={
            p.relation === "friend" ? (
              <span className="text-xs text-muted-foreground">Friends</span>
            ) : p.relation === "requested" ? (
              <span className="text-xs text-muted-foreground">Requested</span>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  act(async () => {
                    await (p.relation === "incoming" ? acceptFriend(p.username) : requestFriend(p.username))
                    await ensureContact(p.username, p.displayName)
                  }, p.relation === "incoming" ? "You're now friends" : "Friend request sent")
                }
              >
                {p.relation === "incoming" ? "Accept" : "Add friend"}
              </Button>
            )
          }
        />
      ))}

      {!!lists?.incoming.length && (
        <div className="grid gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Friend requests</h2>
          {lists.incoming.map((p) => (
            <ListRow
              key={p.username}
              icon={<UserPlusIcon className="size-4" />}
              title={p.displayName || `@${p.username}`}
              subtitle={`@${p.username} wants to be friends`}
              onClick={() => {}}
              trailing={
                <div className="flex gap-1">
                  <Button
                    size="icon-lg"
                    aria-label={`Accept ${p.username}`}
                    onClick={() =>
                      act(async () => {
                        await acceptFriend(p.username)
                        await ensureContact(p.username, p.displayName)
                      }, "You're now friends")
                    }
                  >
                    <CheckIcon />
                  </Button>
                  <Button
                    size="icon-lg"
                    variant="outline"
                    aria-label={`Decline ${p.username}`}
                    onClick={() => act(() => removeFriend(p.username), "Request declined")}
                  >
                    <XIcon />
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      )}

      {!!lists?.outgoing.length && (
        <p className="text-xs text-muted-foreground">
          Waiting for {lists.outgoing.map((p) => `@${p.username}`).join(", ")} to accept.
        </p>
      )}

      {sharing.length > 0 && (
        <div className="grid gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Shared with you</h2>
          {sharing.map((p) => (
            <ListRow
              key={p.username}
              icon={<EyeIcon className="size-4" />}
              title={p.displayName || `@${p.username}`}
              subtitle={p.shares.join(", ")}
              onClick={() => view({ kind: "friend", username: p.username })}
              trailing={
                <Button size="sm" variant="outline" onClick={() => view({ kind: "friend", username: p.username })}>
                  View
                </Button>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
