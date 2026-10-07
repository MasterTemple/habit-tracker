import { useLiveQuery } from "dexie-react-hooks"
import { useEffect, useState } from "react"
import { db, SYNCED_TABLES, type Account } from "@/db/db"
import { isSyncing, onSyncActivity } from "@/sync/engine"

export interface SyncInfo {
  account: Account | undefined
  /** Changes on this device the server doesn't have yet. */
  pending: number
  syncing: boolean
}

/** Live sign-in and sync state for the UI. */
export function useSync(): SyncInfo | undefined {
  const [syncing, setSyncing] = useState(isSyncing)
  useEffect(() => onSyncActivity(() => setSyncing(isSyncing())), [])
  const data = useLiveQuery(async () => {
    let pending = await db.tombstones.count()
    for (const table of SYNCED_TABLES) pending += await db.table(table).where("dirty").equals(1).count()
    return { account: await db.account.get("account"), pending }
  })
  return data && { ...data, syncing }
}
