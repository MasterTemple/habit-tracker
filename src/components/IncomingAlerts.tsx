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

  if (!signedIn || !alerts?.length) return null
  return (
    <div className="grid gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">Alerts you get</h2>
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
      <h2 className="mt-2 text-sm font-semibold text-muted-foreground">Alerts you send</h2>
    </div>
  )
}
