import { useEffect } from "react"
import { defaultServerUrl } from "@/sync/api"
import type { Viewing } from "./useNav"

/** Opens a shared link (`?share=<token>&server=<url>`): someone's tasks, no account needed. */
export function useShareLinks(view: (viewing: Viewing) => void) {
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const token = params.get("share")
    const serverUrl = params.get("server") || defaultServerUrl()
    if (token && serverUrl) view({ kind: "link", serverUrl, token })
  }, [view])
}

/** Leaves a shared link: back to the app's own address. */
export function clearShareParams() {
  const params = new URLSearchParams(location.search)
  if (!params.has("share")) return
  params.delete("share")
  params.delete("server")
  const query = params.toString()
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`)
}

/** The link to give someone for a share that's open to anyone with the link. */
export function shareLink(serverUrl: string, token: string): string {
  const url = new URL(import.meta.env.BASE_URL, location.origin)
  url.searchParams.set("share", token)
  url.searchParams.set("server", serverUrl)
  return url.href
}
