import { BellIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { disablePush, enablePush, pushEnabled, pushSupport, sendTestNotification } from "@/sync/notifications"

/** Turn push notifications on or off for this device. Shown when signed in. */
export function NotificationsSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const support = pushSupport()

  useEffect(() => {
    pushEnabled().then(setEnabled, () => setEnabled(false))
  }, [])

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      if (on) await enablePush()
      else await disablePush()
      setEnabled(on)
      if (on) toast.success("Notifications are on for this device")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (support === "needs-install") {
    return (
      <p className="text-sm text-muted-foreground">
        On iPhone, notifications work once the app is on your Home Screen: tap Share → Add to Home Screen, then open
        it from there.
      </p>
    )
  }
  if (support === "unsupported") {
    return <p className="text-sm text-muted-foreground">This browser doesn't support notifications.</p>
  }
  if (support === "denied") {
    return (
      <p className="text-sm text-muted-foreground">
        Notifications are blocked for this app. Allow them in your device's settings, then come back here.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="push-enabled">Notifications on this device</Label>
          <p className="text-xs text-muted-foreground">Reminders and alerts, even when the app is closed.</p>
        </div>
        <Switch id="push-enabled" checked={!!enabled} disabled={busy || enabled === null} onCheckedChange={toggle} />
      </div>
      {enabled && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            try {
              const devices = await sendTestNotification()
              toast(devices ? `Sent to ${devices} ${devices === 1 ? "device" : "devices"}` : "No devices are subscribed")
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        >
          <BellIcon /> Send a test notification
        </Button>
      )}
    </div>
  )
}
