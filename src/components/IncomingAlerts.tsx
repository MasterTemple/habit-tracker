import { BellOffIcon, BellRingIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useSync } from "@/hooks/useSync"
import { getAccount } from "@/sync/engine"
import { call } from "@/sync/api"
import { EVENT_OPTIONS } from "@/lib/labels"
import { ListRow } from "./layout"

interface IncomingAlert {
  enabled: boolean
  fromUsername: string
  fromName: string
  what: string
  events: string[]
  updatedAt: string
}

/** Alerts other people set up to tell you about their progress, and whether each is on. */
export function IncomingAlerts() {
  const signedIn = !!useSync()?.account?.token
  const [alerts, setAlerts] = useState<IncomingAlert[] | null>(null)

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    void (async () => {
      const account = await getAccount()
      if (!account?.token) return
      const res = await call<{ alerts: IncomingAlert[] }>(account.serverUrl, "/alerts/incoming", { token: account.token }).catch(() => null)
      if (!cancelled && res) setAlerts(res.alerts)
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn])

  if (!signedIn) {
    return <p className="mt-10 text-center text-sm text-muted-foreground">Sign in (Settings) to see alerts friends send you.</p>
  }
  if (!alerts) return null
  if (alerts.length === 0) {
    return (
      <p className="mt-6 text-center text-sm text-muted-foreground">
        No one sends you alerts yet. When a friend adds you to an accountability alert, it shows up here.
      </p>
    )
  }
  return (
    <div className="grid gap-2">
      {alerts.map((a) => (
        <ListRow
          key={`${a.fromUsername}:${a.what}:${a.updatedAt}`}
          icon={a.enabled ? <BellRingIcon className="size-4" /> : <BellOffIcon className="size-4" />}
          title={`${a.fromName} · ${a.what}`}
          subtitle={
            a.enabled
              ? `On: ${a.events.map((e) => EVENT_OPTIONS.find((o) => o.value === e)?.label.toLowerCase() ?? e).join(", ")}`
              : "Turned off"
          }
          muted={!a.enabled}
          onClick={() => {}}
        />
      ))}
    </div>
  )
}
