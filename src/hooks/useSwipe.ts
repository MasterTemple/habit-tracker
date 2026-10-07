import { useEffect, type RefObject } from "react"

/** Elements where a horizontal swipe means something else (scrolling chips, dragging, sliders, typing). */
const IGNORE = "[data-no-swipe], input, textarea, select, [role=slider], .overflow-x-auto"

/**
 * Calls onSwipe(1) for a left swipe (go forward) and onSwipe(-1) for a right swipe.
 * Uses native listeners on the element itself, so touches inside dialogs (portaled
 * elsewhere in the DOM) never count.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (direction: 1 | -1) => void) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let start: { x: number; y: number; time: number } | null = null

    const onStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      start =
        e.touches.length === 1 && !target?.closest(IGNORE)
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() }
          : null
    }
    const onEnd = (e: TouchEvent) => {
      if (!start) return
      const dx = e.changedTouches[0].clientX - start.x
      const dy = e.changedTouches[0].clientY - start.y
      const quick = Date.now() - start.time < 700
      start = null
      // Mostly horizontal and long enough, so vertical scrolling never triggers it.
      if (quick && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1)
    }

    el.addEventListener("touchstart", onStart, { passive: true })
    el.addEventListener("touchend", onEnd, { passive: true })
    return () => {
      el.removeEventListener("touchstart", onStart)
      el.removeEventListener("touchend", onEnd)
    }
  }, [ref, onSwipe])
}
