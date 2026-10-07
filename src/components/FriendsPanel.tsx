import { CheckIcon, ClockIcon, EyeIcon, SearchIcon, UserPlusIcon, UsersIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { db } from "@/db/db"
import { saveContact } from "@/db/repo"
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
  const { view } = useNav()
  const [query, setQuery] = useState("")
  // Search results, tagged with the query they're for (so stale ones never show).
  const [found, setFound] = useState<{ q: string; people: PersonResult[] }>({ q: "", people: [] })
  const q = query.trim()
  const searchable = signedIn && q.replace(/^@/, "").length >= 2
  const results = searchable && found.q === q ? found.people : []
  const [lists, setLists] = useState<FriendLists | null>(null)
  const [sharing, setSharing] = useState<SharingPerson[]>([])
  // Bumped on each refresh, so search results (e.g. "Requested") update too.
  const [version, setVersion] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([listFriends(), sharedWithMe()])
      await addNewFriends(l)
      setLists(l)
      setSharing(s)
      setVersion((v) => v + 1)
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
  }, [q, searchable, version])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast.success(done)
      await refresh()
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
                  act(
                    () => (p.relation === "incoming" ? acceptFriend(p.username) : requestFriend(p.username)),
                    p.relation === "incoming" ? "You're now friends" : "Friend request sent",
                  )
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
                    onClick={() => act(() => acceptFriend(p.username), "You're now friends")}
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
        <div className="grid gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Pending</h2>
          {lists.outgoing.map((p) => (
            <ListRow
              key={p.username}
              icon={<ClockIcon className="size-4" />}
              title={p.displayName || `@${p.username}`}
              subtitle={p.displayName ? `@${p.username} · waiting for them to accept` : "Waiting for them to accept"}
              onClick={() => {}}
              trailing={
                <Button size="sm" variant="outline" onClick={() => act(() => removeFriend(p.username), "Request canceled")}>
                  Cancel
                </Button>
              }
            />
          ))}
        </div>
      )}

      {sharing.length > 0 && (
        <div className="grid gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Shared with you</h2>
          {sharing.length > 1 && (
            <ListRow
              icon={<UsersIcon className="size-4" />}
              title="Everyone"
              subtitle={`All ${sharing.length} friends' shared tasks together`}
              onClick={() => view({ kind: "everyone" })}
              trailing={
                <Button size="sm" variant="outline" onClick={() => view({ kind: "everyone" })}>
                  View
                </Button>
              }
            />
          )}
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

const ADDED_KEY = "friends-added-to-contacts"

/**
 * New friends go in your contacts, so you can pick them for sharing and alerts. Each is
 * added once (remembered on this device), so deleting the contact sticks; pending
 * requests aren't added, so someone who declines never shows up in your people.
 */
function addNewFriends(lists: FriendLists): Promise<void> {
  // One at a time: refreshes overlap (sync, focus, an accept), and each would add the same friend.
  adding = adding.then(() => addMissing(lists)).catch(() => {})
  return adding
}
let adding: Promise<void> = Promise.resolve()

async function addMissing(lists: FriendLists) {
  let added: string[] = []
  try {
    added = JSON.parse(localStorage.getItem(ADDED_KEY) ?? "[]")
  } catch {
    // Unavailable storage: add (missing) contacts every time instead.
  }
  const fresh = lists.friends.filter((f) => !added.includes(f.username))
  if (fresh.length === 0) return
  const contacts = await db.contacts.filter((c) => !c.deletedAt).toArray()
  const has = (username: string) => contacts.some((c) => c.username.trim().replace(/^@/, "").toLowerCase() === username)
  for (const f of fresh) {
    if (has(f.username)) continue
    await saveContact({
      name: f.displayName.trim() || f.username,
      relationship: "friend",
      username: f.username,
      phone: "",
      email: "",
      telegram: "",
      signal: "",
      discordId: "",
      notes: "",
    })
  }
  try {
    localStorage.setItem(ADDED_KEY, JSON.stringify([...added, ...fresh.map((f) => f.username)]))
  } catch {
    // See above.
  }
}
