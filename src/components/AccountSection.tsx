import { formatDistanceToNow } from "date-fns"
import { CloudCheckIcon, CloudOffIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSync } from "@/hooks/useSync"
import { defaultServerUrl } from "@/sync/api"
import { createAccount, signIn, signOut, syncNow } from "@/sync/engine"

/** Sign in / create an account, and sync status once signed in. */
export function AccountSection() {
  const sync = useSync()
  if (!sync) return null
  const { account } = sync

  if (!account?.token) return <SignInForm previous={account?.username} serverUrl={account?.serverUrl} />

  const status = sync.syncing
    ? { icon: <LoaderCircleIcon className="size-4 animate-spin" />, text: "Syncing…" }
    : account.lastError
      ? {
          icon: <CloudOffIcon className="size-4 text-destructive" />,
          text: sync.pending > 0 ? `${account.lastError} · ${sync.pending} ${sync.pending === 1 ? "change" : "changes"} waiting` : account.lastError,
        }
      : sync.pending > 0
        ? { icon: <CloudOffIcon className="size-4" />, text: `${sync.pending} ${sync.pending === 1 ? "change" : "changes"} waiting to sync` }
        : { icon: <CloudCheckIcon className="size-4 text-green-600" />, text: "Everything is synced" }

  return (
    <div className="grid gap-3">
      <div>
        <div className="font-medium">Signed in as @{account.username}</div>
        <div className="text-xs text-muted-foreground">{new URL(account.serverUrl, location.href).host}</div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        {status.icon}
        <span>{status.text}</span>
      </div>
      {account.lastSyncAt && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Last synced {formatDistanceToNow(new Date(account.lastSyncAt), { addSuffix: true })}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={sync.syncing}
          onClick={() => syncNow().catch((e) => toast.error((e as Error).message))}
        >
          <RefreshCwIcon /> Sync now
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={async () => {
            await signOut()
            toast("Signed out. Your data stays on this device.")
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  )
}

function SignInForm({ previous, serverUrl: savedServer }: { previous?: string; serverUrl?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in")
  const [serverUrl, setServerUrl] = useState(() => savedServer ?? defaultServerUrl())
  const [showServer, setShowServer] = useState(!serverUrl)
  const [username, setUsername] = useState(previous ?? "")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [signupCode, setSignupCode] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      if (mode === "in") await signIn(serverUrl, username, password)
      else await createAccount(serverUrl, { username, password, displayName, signupCode: signupCode || undefined })
      toast.success(mode === "in" ? "Signed in. Syncing your data…" : "Account created. Syncing your data…")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="text-xs text-muted-foreground">
        {previous
          ? "This device was signed out. Sign in again to keep syncing."
          : "Sign in to keep your data in sync across devices (and backed up on the server). Your data here stays either way."}
      </p>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["in", "up"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              mode === m ? "rounded-md bg-background py-1.5 text-sm font-medium shadow-sm" : "py-1.5 text-sm text-muted-foreground"
            }
          >
            {m === "in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="account-username">Username</Label>
        <Input
          id="account-username"
          autoCapitalize="none"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="account-password">Password</Label>
        <Input
          id="account-password"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "up" && <p className="text-xs text-muted-foreground">At least 10 characters; a few words works well.</p>}
      </div>
      {mode === "up" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="account-display">Display name</Label>
            <Input id="account-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="account-code">Sign-up code</Label>
            <Input
              id="account-code"
              autoCapitalize="none"
              value={signupCode}
              onChange={(e) => setSignupCode(e.target.value)}
              placeholder="If the server needs one"
            />
          </div>
        </>
      )}
      {showServer ? (
        <div className="grid gap-1.5">
          <Label htmlFor="account-server">Server</Label>
          <Input
            id="account-server"
            type="url"
            autoCapitalize="none"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value.trim())}
            placeholder="https://habits.example.com"
          />
        </div>
      ) : (
        <button type="button" className="text-left text-xs text-muted-foreground underline" onClick={() => setShowServer(true)}>
          Server: {serverUrl}
        </button>
      )}
      <Button type="submit" disabled={busy || !username || !password || !serverUrl}>
        {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
      </Button>
    </form>
  )
}
