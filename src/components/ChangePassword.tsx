import { KeyRoundIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { changePassword, passwordError } from "@/sync/api"
import { getAccount } from "@/sync/engine"

/** Changes the account password. Other devices are signed out; this one stays signed in. */
export function ChangePassword() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const tooShort = next.length > 0 && next.length < 10

  const close = (o: boolean) => {
    setOpen(o)
    if (!o) {
      setCurrent("")
      setNext("")
      setError("")
    }
  }

  const save = async () => {
    const account = await getAccount()
    if (!account?.token) return
    setBusy(true)
    setError("")
    try {
      await changePassword(account.serverUrl, account.token, current, next)
      close(false)
      toast.success("Password changed. Your other devices will need to sign in again.")
    } catch (e) {
      setError(passwordError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <KeyRoundIcon /> Change password…
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Your other devices are signed out and will need the new password.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <Label htmlFor="new-password" className="mt-2">
              New password
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className={tooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              At least 10 characters. A few random words works well.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="mt-2" disabled={!current || next.length < 10 || busy}>
              Change password
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
