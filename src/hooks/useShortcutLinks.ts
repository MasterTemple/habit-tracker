import { useEffect } from "react"
import { toast } from "sonner"
import { db } from "@/db/db"
import { deleteEvent, recordEvent } from "@/db/repo"

// React runs effects twice in development; make sure a link is only handled once per load.
let handled = false

/**
 * Handles incoming-webhook shortcut links (?hook=<token>): records the webhook's
 * amount on its task, then removes the parameter so a reload doesn't record it again.
 * Works without a server, e.g. from an iOS Shortcuts automation that opens the link.
 */
export function useShortcutLinks() {
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const token = params.get("hook")
    if (!token || handled) return
    handled = true

    params.delete("hook")
    const query = params.toString()
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`)

    void (async () => {
      const hook = (await db.automations.toArray()).find(
        (a) => a.kind === "webhook_in" && a.token === token && !a.deletedAt,
      )
      if (!hook || hook.kind !== "webhook_in") return toast.error("That shortcut link isn't set up on this device")
      if (!hook.enabled) return toast(`“${hook.name || "Webhook"}” is turned off`)
      const task = await db.tasks.get(hook.taskId)
      if (!task) return toast.error("That shortcut's task was deleted")
      const id = await recordEvent(task.id, hook.amount, hook.name ? `via ${hook.name}` : "via shortcut")
      toast.success(`Recorded ${hook.amount > 0 ? "+" : ""}${hook.amount} on “${task.name}”`, {
        action: { label: "Undo", onClick: () => deleteEvent(id) },
      })
    })()
  }, [])
}
