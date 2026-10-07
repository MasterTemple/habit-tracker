import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

/** Bottom-nav views in order, each with its top tabs (if any). Swiping walks this sequence. */
export const VIEWS = [
  { page: "tasks", tabs: ["tasks", "categories"] },
  { page: "schedule", tabs: ["breaks", "automations"] },
  { page: "social", tabs: [] },
  { page: "settings", tabs: [] },
] as const

export type PageId = (typeof VIEWS)[number]["page"]

interface Nav {
  page: PageId
  /** The direction of the last move, for the slide animation. */
  direction: 1 | -1
  setPage: (page: PageId) => void
  tabOf: (page: PageId) => string
  setTab: (page: PageId, tab: string) => void
  /** Next (1) or previous (-1) tab, crossing into the neighbouring view at the edges. */
  step: (direction: 1 | -1) => void
}

const NavContext = createContext<Nav | null>(null)

const STEPS = VIEWS.flatMap((v) => (v.tabs.length ? v.tabs.map((tab) => ({ page: v.page, tab })) : [{ page: v.page, tab: "" }]))
const pageIndex = (page: PageId) => VIEWS.findIndex((v) => v.page === page)

export function NavProvider({ children }: { children: ReactNode }) {
  const [page, setPageState] = useState<PageId>("tasks")
  const [direction, setDirection] = useState<1 | -1>(1)
  // Each view remembers its own tab.
  const [tabs, setTabs] = useState<Record<string, string>>(() =>
    Object.fromEntries(VIEWS.map((v) => [v.page, v.tabs[0] ?? ""])),
  )

  const setPage = useCallback(
    (next: PageId) => {
      setDirection(pageIndex(next) >= pageIndex(page) ? 1 : -1)
      setPageState(next)
    },
    [page],
  )

  const setTab = useCallback((p: PageId, tab: string) => setTabs((t) => ({ ...t, [p]: tab })), [])

  const step = useCallback(
    (dir: 1 | -1) => {
      const index = STEPS.findIndex((s) => s.page === page && s.tab === tabs[page])
      const next = STEPS[index + dir]
      if (!next) return
      setDirection(dir)
      if (next.tab) setTabs((t) => ({ ...t, [next.page]: next.tab }))
      setPageState(next.page)
    },
    [page, tabs],
  )

  const value = useMemo<Nav>(
    () => ({ page, direction, setPage, tabOf: (p) => tabs[p], setTab, step }),
    [page, direction, setPage, tabs, setTab, step],
  )
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav(): Nav {
  const value = useContext(NavContext)
  if (!value) throw new Error("useNav must be used inside NavProvider")
  return value
}

/** [tab, setTab] for one view's top tabs. */
export function useViewTab(page: PageId): [string, (tab: string) => void] {
  const { tabOf, setTab } = useNav()
  return [tabOf(page), (tab) => setTab(page, tab)]
}
