import { MailIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { call } from "@/sync/api"
import { getAccount } from "@/sync/engine"

interface Me {
  email: string
  emailEnabled: boolean
}

/** The account's email address (for reports, backups, and email reminders). */
export function AccountEmail() {
  const [me, setMe] = useState<Me | null>(null)
  const [email, setEmail] = useState("")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const account = await getAccount()
      if (!account?.token) return
      const res = await call<Me>(account.serverUrl, "/me", { token: account.token }).catch(() => null)
      if (!cancelled && res) {
        setMe(res)
        setEmail(res.email)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!me) return null

  const save = async () => {
    const account = await getAccount()
    if (!account?.token || email.trim() === me.email) return
    try {
      const res = await call<Me>(account.serverUrl, "/me", { method: "PATCH", token: account.token, body: { email: email.trim() } })
      setMe(res)
      toast.success(res.email ? "Email saved" : "Email removed")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const test = async () => {
    const account = await getAccount()
    if (!account?.token) return
    try {
      await call(account.serverUrl, "/me/email/test", { token: account.token, body: {} })
      toast.success(`Sent to ${me.email}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="account-email">Email</Label>
      <Input
        id="account-email"
        type="email"
        autoCapitalize="none"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={save}
        placeholder="For reports, backups, and email reminders"
      />
      {me.emailEnabled ? (
        me.email && (
          <Button variant="outline" size="sm" className="justify-self-start" onClick={test}>
            <MailIcon /> Send a test email
          </Button>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Email isn't set up on this server yet.</p>
      )}
    </div>
  )
}
