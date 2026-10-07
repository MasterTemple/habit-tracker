import { TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Top tabs (plus optional content below them) pinned while the page scrolls. Must be
 * inside <Tabs>. The negative margin cancels the page's top inset so that, once
 * stuck, the header's own padding keeps it clear of the status bar.
 */
export function PinnedTabs({ tabs, children }: { tabs: { value: string; label: string }[]; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-30 -mx-4 -mt-[calc(0.5rem+env(safe-area-inset-top))] flex flex-col gap-3 bg-background px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-3">
      <TabsList className="w-full">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="px-1">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </div>
  )
}

/** A bottom action that stays just above the nav bar when the list is long, so it never needs scrolling to. */
export function BottomAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur">
      {children}
    </div>
  )
}

/** A note that something is configured here but only takes effect once the sync server exists. */
export function ServerNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{children}</p>
}

/** A tappable list row with an optional trailing control. */
export function ListRow({
  icon,
  title,
  subtitle,
  onClick,
  trailing,
  muted,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  onClick: () => void
  trailing?: React.ReactNode
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <span className={muted ? "min-w-0 opacity-60" : "min-w-0"}>
          <span className="block truncate font-medium">{title}</span>
          {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
        </span>
      </button>
      {trailing}
    </div>
  )
}
