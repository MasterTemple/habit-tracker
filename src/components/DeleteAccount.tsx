import { UserXIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { db } from "@/db/db"
import { call, passwordError } from "@/sync/api"
import { getAccount } from "@/sync/engine"

/** Deletes the account on the server (password required). This device keeps its data. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const remove = async () => {
    const account = await getAccount()
    if (!account?.token) return
    setBusy(true)
    setError("")
    try {
      await call(account.serverUrl, "/me", { method: "DELETE", token: account.token, body: { password } })
      await db.account.delete("account")
      setOpen(false)
      setPassword("")
      toast("Account deleted. Your data is still on this device.")
    } catch (e) {
      setError(passwordError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <UserXIcon /> Delete account…
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setPassword("")
            setError("")
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Permanently deletes your account and everything the server has: synced data, friends, shares, alerts, and
              your inbox. Other devices stop syncing. This device keeps its data and is signed out. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="delete-password">Password</Label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="destructive" className="mt-2" disabled={!password || busy} onClick={remove}>
              Delete account
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
