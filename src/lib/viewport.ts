/**
 * iOS doesn't resize the page when the on-screen keyboard opens; only the visual
 * viewport shrinks, so fixed bottom sheets end up behind the keyboard. This mirrors
 * the visible area into CSS variables that sheets and dialogs position against:
 *   --vv-height  visible height
 *   --vv-top     how far the visible area is scrolled down
 *   --kb-inset   space taken by the keyboard at the bottom
 */
export function trackVisualViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement.style
  const update = () => {
    const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    root.setProperty("--vv-height", `${vv.height}px`)
    root.setProperty("--vv-top", `${vv.offsetTop}px`)
    root.setProperty("--kb-inset", `${keyboard}px`)
    // Keep the field being typed in visible inside the (now shorter) sheet.
    if (keyboard > 0) {
      requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" }))
    }
  }
  vv.addEventListener("resize", update)
  vv.addEventListener("scroll", update)
  update()
}

/** Classes for bottom sheets: sit on top of the keyboard and fit the visible area. */
export const BOTTOM_SHEET =
  "mx-auto max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl data-[side=bottom]:bottom-(--kb-inset,0px) max-h-[calc(var(--vv-height,100dvh)*0.92)]"

/** Classes for centered dialogs: center in the visible area and scroll if taller. */
export const CENTERED_DIALOG =
  "top-[calc(var(--vv-top,0px)+var(--vv-height,100dvh)/2)] max-h-[calc(var(--vv-height,100dvh)-2rem)] overflow-y-auto overscroll-contain"
