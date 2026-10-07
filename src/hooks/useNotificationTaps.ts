import { useEffect } from "react"

/**
 * Opens the inbox item a tapped notification is about: from the `?inbox=<id>` link the
 * service worker opens when the app was closed, or its message when the app was open.
 */
export function useNotificationTaps(show: (id: string) => void) {
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const id = params.get("inbox")
    if (id) {
      params.delete("inbox")
      const query = params.toString()
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`)
      show(id)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "open-inbox" && typeof e.data.id === "string") show(e.data.id)
    }
    navigator.serviceWorker?.addEventListener("message", onMessage)
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage)
  }, [show])
}
