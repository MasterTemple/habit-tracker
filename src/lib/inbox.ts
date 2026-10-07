import type { InboxItem } from "@/sync/notifications"

/** Where a notification shows in the inbox: accountability alerts, or everything else. */
export type InboxSection = "general" | "alerts"

export const inboxSection = (kind: string): InboxSection => (kind === "alert" || kind === "alert-status" ? "alerts" : "general")

/** The same notification sent more than once, shown as one row. */
export interface InboxGroup {
  /** The most recent one. */
  latest: InboxItem
  /** Newest first, including `latest`. */
  items: InboxItem[]
  unread: number
  section: InboxSection
}

/** Stacks identical notifications (same kind, title, and text), ordered by their latest. */
export function groupInbox(items: InboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>()
  const newestFirst = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  for (const item of newestFirst) {
    const key = JSON.stringify([item.kind, item.title, item.body])
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { latest: item, items: [item], unread: 0, section: inboxSection(item.kind) })
    if (!item.readAt) groups.get(key)!.unread++
  }
  return [...groups.values()]
}
