import type { TaskEvent } from "./types"

/** Progress alerts wait this long so an accidental tap can be undone before anyone is told. */
export const PROGRESS_ALERT_DELAY_MS = 60_000

/**
 * Entries ready for a "progress was made" alert: recorded after `since` (the last
 * check), at least PROGRESS_ALERT_DELAY_MS ago, and not deleted (undone) since.
 * Entries younger than the delay are left for the next check.
 */
export function progressReadyToAlert(events: TaskEvent[], since: Date, now: Date): TaskEvent[] {
  const cutoff = now.getTime() - PROGRESS_ALERT_DELAY_MS
  return events.filter((e) => {
    const created = new Date(e.createdAt).getTime()
    return !e.deletedAt && created > since.getTime() - PROGRESS_ALERT_DELAY_MS && created <= cutoff
  })
}
