import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * A horizontally scrolling row with no visible scrollbar. An inset shadow appears
 * on each side that has more content, to show it can be scrolled.
 */
export function ScrollRow({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => observer.disconnect()
  }, [update, children])

  return (
    <div className="relative -mx-4">
      <div
        ref={ref}
        onScroll={update}
        className={cn(
          "flex overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-6 bg-linear-to-r from-foreground/15 to-transparent transition-opacity",
          edges.left ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-foreground/15 to-transparent transition-opacity",
          edges.right ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}
