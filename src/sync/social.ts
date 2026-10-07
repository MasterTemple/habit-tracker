// Friends and shared views on the sync server.

import type { Category, Settings, Task, TaskEvent, TaskException, TaskTarget } from "@/domain/types"
import { call } from "./api"
import { getAccount } from "./engine"

export type Relation = "none" | "requested" | "incoming" | "friend"

export interface PersonResult {
  username: string
  displayName: string
  relation: Relation
}

export interface FriendEntry {
  username: string
  displayName: string
  since: string
}

export interface FriendLists {
  friends: FriendEntry[]
  incoming: FriendEntry[]
  outgoing: FriendEntry[]
}

export interface SharingPerson {
  username: string
  displayName: string
  /** What they share, e.g. ["Exercise"]. */
  shares: string[]
}

/** Someone else's shared tasks: their rows, settings, and time zone. */
export interface SharedView {
  owner: { username: string; displayName: string; timeZone: string }
  settings: Partial<Settings>
  tasks: Task[]
  targets: TaskTarget[]
  events: TaskEvent[]
  categories: Category[]
  exceptions: TaskException[]
}

async function signedIn() {
  const account = await getAccount()
  if (!account?.token) throw new Error("Sign in first")
  return account
}

const authed = async <T>(path: string, init: { method?: string; body?: unknown } = {}) => {
  const account = await signedIn()
  return call<T>(account.serverUrl, path, { ...init, token: account.token })
}

export const searchPeople = (q: string) =>
  authed<{ people: PersonResult[] }>(`/users/search?q=${encodeURIComponent(q)}`).then((r) => r.people)
export const listFriends = () => authed<FriendLists>("/friends")
export const requestFriend = (username: string) => authed<{ relation: Relation }>(`/friends/${encodeURIComponent(username)}/request`, { body: {} })
export const acceptFriend = (username: string) => authed<{ relation: Relation }>(`/friends/${encodeURIComponent(username)}/accept`, { body: {} })
export const removeFriend = (username: string) => authed<void>(`/friends/${encodeURIComponent(username)}`, { method: "DELETE" })
export const sharedWithMe = () => authed<{ people: SharingPerson[] }>("/shared").then((r) => r.people)
export const viewFriend = (username: string) => authed<SharedView>(`/shared/${encodeURIComponent(username)}`)
/** A public link share: no account needed. */
export const viewLink = (serverUrl: string, token: string) => call<SharedView>(serverUrl, `/s/${encodeURIComponent(token)}`)
