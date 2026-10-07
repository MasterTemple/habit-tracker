import { useEffect, useSyncExternalStore } from "react"
import { onSyncActivity } from "@/sync/engine"
import { fetchInbox, markRead, type InboxItem } from "@/sync/notifications"

interface InboxState {
  items: InboxItem[]
  unread: number
  /** null until loaded, or when signed out. */
  loaded: boolean
  error: string | null
}

let state: InboxState = { items: [], unread: 0, loaded: false, error: null }
const listeners = new Set<() => void>()
const set = (next: Partial<InboxState>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export async function refreshInbox() {
  try {
    const res = await fetchInbox()
    set(res ? { items: res.items, unread: res.unread, loaded: true, error: null } : { items: [], unread: 0, loaded: false })
  } catch (e) {
    set({ error: (e as Error).message })
  }
}

export async function readItems(ids?: string[]) {
  const now = new Date().toISOString()
  // Optimistic: show it read right away.
  set({
    items: state.items.map((i) => (!ids || ids.includes(i.id) ? { ...i, readAt: i.readAt ?? now } : i)),
    unread: ids ? Math.max(0, state.unread - state.items.filter((i) => ids.includes(i.id) && !i.readAt).length) : 0,
  })
  await markRead(ids).catch(() => refreshInbox())
}

let started = false

/** Keeps the inbox fresh: after syncs, on focus, and every minute while open. */
function start() {
  if (started) return
  started = true
  void refreshInbox()
  onSyncActivity(() => void refreshInbox())
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void refreshInbox())
  setInterval(() => document.visibilityState === "visible" && void refreshInbox(), 60_000)
}

export function useInbox(): InboxState {
  useEffect(start, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
