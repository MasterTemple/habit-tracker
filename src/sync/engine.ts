// Two-way sync with the server: push rows marked dirty (and tombstones), pull what
// changed elsewhere. The server keeps the newer version of each row; this side does
// the same when applying pulled rows, so a local edit made while offline is never
// overwritten by an older copy.

import { db, markRemote, onLocalChange, SYNCED_TABLES, type Account, type SyncedTable, type Tombstone } from "@/db/db"
import { ApiError, call, login, logout, register, type SessionResponse } from "./api"

/** Rows per push; the server accepts up to 5000. */
const BATCH = 2000

type Row = { id: string; updatedAt: string; dirty?: number; [key: string]: unknown }

interface SyncResponse {
  cursor: number
  more: boolean
  reset: boolean
  changes: Partial<Record<SyncedTable, Row[]>>
  deletes: Tombstone[]
  serverTime: string
}

export type SyncStatus =
  | { state: "signed-out" }
  | { state: "idle"; account: Account; pending: number }
  | { state: "syncing"; account: Account; pending: number }

// ---------- account ----------

export const getAccount = () => db.account.get("account")

async function signedIn(serverUrl: string, session: SessionResponse) {
  await db.account.put({
    key: "account",
    serverUrl,
    token: session.token,
    username: session.user.username,
    cursor: 0,
    lastSyncAt: null,
    lastError: null,
  })
  void syncNow()
}

export async function signIn(serverUrl: string, username: string, password: string) {
  await signedIn(serverUrl, await login(serverUrl, username, password))
}

export async function createAccount(serverUrl: string, fields: { username: string; password: string; displayName?: string; signupCode?: string }) {
  await signedIn(serverUrl, await register(serverUrl, { ...fields, timeZone: currentTimeZone() }))
}

/** Signs this device out. Data stays here; unsynced changes are sent first if possible. */
export async function signOut() {
  const account = await getAccount()
  if (!account) return
  await syncNow().catch(() => {})
  await logout(account.serverUrl, account.token).catch(() => {})
  await db.account.delete("account")
}

function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
  } catch {
    return ""
  }
}

// ---------- the sync itself ----------

/** Unsynced changes waiting on this device. */
export async function pendingCount(): Promise<number> {
  let count = await db.tombstones.count()
  for (const table of SYNCED_TABLES) count += await db.table(table).where("dirty").equals(1).count()
  return count
}

/** Settings is a single row keyed "settings"; on the wire it has id "settings". */
const toWire = (table: SyncedTable, row: Row): Row => {
  const { dirty: _dirty, key: _key, ...rest } = row
  return table === "settings" ? { ...rest, id: "settings" } : rest
}
const fromWire = (table: SyncedTable, row: Row) => {
  if (table !== "settings") return { ...row, dirty: 0 }
  const { id: _id, ...rest } = row
  return { ...rest, key: "settings", dirty: 0 }
}
const keyOf = (table: SyncedTable, id: string) => (table === "settings" ? "settings" : id)

async function collect() {
  const changes: Partial<Record<SyncedTable, Row[]>> = {}
  let room = BATCH
  for (const table of SYNCED_TABLES) {
    if (room <= 0) break
    const rows = (await db.table(table).where("dirty").equals(1).limit(room).toArray()) as Row[]
    if (rows.length) changes[table] = rows.map((r) => toWire(table, r))
    room -= rows.length
  }
  const deletes = room > 0 ? await db.tombstones.limit(room).toArray() : []
  return { changes, deletes, full: room <= 0 }
}

/** Applies a server response; returns nothing. Runs as a "remote" transaction so the
 *  writes aren't themselves marked as local changes. */
async function apply(res: SyncResponse, sent: { changes: Partial<Record<SyncedTable, Row[]>>; deletes: Tombstone[] }) {
  await db.transaction("rw", [...SYNCED_TABLES.map((t) => db.table(t)), db.tombstones, db.account], async () => {
    markRemote()

    if (res.reset) {
      // The server lost track of this device: send everything again.
      for (const table of SYNCED_TABLES) await db.table(table).toCollection().modify({ dirty: 1 })
    }

    for (const table of SYNCED_TABLES) {
      const incoming = res.changes[table] ?? []
      if (!incoming.length) continue
      const t = db.table(table)
      const local = (await t.bulkGet(incoming.map((r) => keyOf(table, r.id)))) as (Row | undefined)[]
      const winners = incoming.filter((r, i) => !local[i] || local[i]!.updatedAt <= r.updatedAt)
      await t.bulkPut(winners.map((r) => fromWire(table, r)))
    }

    for (const tomb of res.deletes) {
      const t = db.table(tomb.table)
      const local = (await t.get(keyOf(tomb.table, tomb.id))) as Row | undefined
      // A local edit newer than the delete survives (and will re-create the row).
      if (!local || local.updatedAt <= tomb.deletedAt) await t.delete(keyOf(tomb.table, tomb.id))
    }

    // What we sent is on the server now, unless the row changed again meanwhile.
    for (const [table, rows] of Object.entries(sent.changes) as [SyncedTable, Row[]][]) {
      const t = db.table(table)
      const current = (await t.bulkGet(rows.map((r) => keyOf(table, r.id)))) as (Row | undefined)[]
      const done = rows.filter((r, i) => current[i]?.dirty === 1 && current[i]!.updatedAt === r.updatedAt)
      for (const r of done) await t.update(keyOf(table, r.id), { dirty: 0 })
    }
    for (const tomb of sent.deletes) {
      const current = await db.tombstones.get([tomb.table, tomb.id])
      if (current?.deletedAt === tomb.deletedAt) await db.tombstones.delete([tomb.table, tomb.id])
    }

    await db.account.update("account", { cursor: res.cursor, lastSyncAt: new Date().toISOString(), lastError: null })
  })
}

let running: Promise<void> | null = null
let again = false

/**
 * Syncs until nothing is left to send or receive. Concurrent calls share the run in
 * progress (and trigger one more pass after it, to catch changes made meanwhile).
 */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await syncRounds()
      } while (again)
    } finally {
      running = null
      notify()
    }
  })()
  notify()
  return running
}

async function syncRounds() {
  for (let round = 0; round < 50; round++) {
    const account = await getAccount()
    // Not signed in, or the server ended the session (sign in again to resume).
    if (!account?.token) return
    const sent = await collect()
    let res: SyncResponse
    try {
      res = await call<SyncResponse>(account.serverUrl, "/sync", {
        token: account.token,
        body: { cursor: account.cursor, timeZone: currentTimeZone(), ...sent },
      })
    } catch (e) {
      const message = e instanceof ApiError && e.status === 401 ? "Signed out by the server. Sign in again to sync." : (e as Error).message
      await db.account.update("account", { lastError: message })
      if (e instanceof ApiError && e.status === 401) await db.account.update("account", { token: "" })
      throw e
    }
    await apply(res, sent)
    if (!res.more && !sent.full && !res.reset) return
  }
}

// ---------- when to sync ----------

type Listener = () => void
const listeners = new Set<Listener>()
const notify = () => listeners.forEach((l) => l())

/** Re-render hooks when a sync starts or ends. */
export function onSyncActivity(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const isSyncing = () => running !== null

let debounce: ReturnType<typeof setTimeout> | undefined

/** Starts automatic syncing: soon after edits, on launch, on focus, when back online, and every minute. */
export function startAutoSync() {
  const quietly = () => syncNow().catch(() => {})
  const stop = onLocalChange(() => {
    clearTimeout(debounce)
    debounce = setTimeout(quietly, 1500)
  })
  const onVisible = () => document.visibilityState === "visible" && quietly()
  document.addEventListener("visibilitychange", onVisible)
  window.addEventListener("online", quietly)
  const interval = setInterval(() => document.visibilityState === "visible" && quietly(), 60_000)
  quietly()
  return () => {
    stop()
    document.removeEventListener("visibilitychange", onVisible)
    window.removeEventListener("online", quietly)
    clearInterval(interval)
  }
}
