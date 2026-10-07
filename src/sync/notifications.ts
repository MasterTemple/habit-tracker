// Push notifications for this device, and the server-side inbox.

import { getAccount } from "./engine"
import { call } from "./api"

export type PushSupport =
  | "ready"
  /** iPhone/iPad Safari: web apps get notifications only once added to the Home Screen. */
  | "needs-install"
  | "unsupported"
  | "denied"

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIOS() && !isStandalone() ? "needs-install" : "unsupported"
  }
  if (Notification.permission === "denied") return "denied"
  return "ready"
}

/** The service worker registration, or null if there isn't one (e.g. in development). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function pushEnabled(): Promise<boolean> {
  const reg = await registration()
  return !!(await reg?.pushManager.getSubscription())
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

async function signedInAccount() {
  const account = await getAccount()
  if (!account?.token) throw new Error("Sign in first")
  return account
}

/** Asks permission, subscribes this device, and registers it with the server. */
export async function enablePush(): Promise<void> {
  const account = await signedInAccount()
  const reg = await registration()
  if (!reg) throw new Error("Notifications need the installed app (not available in development)")
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications weren't allowed")
  const { publicKey } = await call<{ publicKey: string }>(account.serverUrl, "/push/key")
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })
  await call(account.serverUrl, "/push/subscribe", { token: account.token, body: subscription.toJSON() })
}

export async function disablePush(): Promise<void> {
  const reg = await registration()
  const subscription = await reg?.pushManager.getSubscription()
  if (!subscription) return
  const account = await getAccount()
  if (account?.token) {
    await call(account.serverUrl, "/push/subscribe", { method: "DELETE", token: account.token, body: { endpoint: subscription.endpoint } }).catch(() => {})
  }
  await subscription.unsubscribe()
}

export async function sendTestNotification(): Promise<number> {
  const account = await signedInAccount()
  const res = await call<{ devices: number }>(account.serverUrl, "/push/test", { token: account.token, body: {} })
  return res.devices
}

// ---------- inbox ----------

export interface InboxItem {
  id: string
  kind: string
  title: string
  body: string
  data: Record<string, unknown>
  createdAt: string
  readAt: string | null
}

export async function fetchInbox(): Promise<{ items: InboxItem[]; unread: number } | null> {
  const account = await getAccount()
  if (!account?.token) return null
  return call(account.serverUrl, "/inbox?limit=100", { token: account.token })
}

export async function markRead(ids?: string[]): Promise<void> {
  const account = await signedInAccount()
  await call(account.serverUrl, "/inbox/read", { token: account.token, body: ids ? { ids } : {} })
}
