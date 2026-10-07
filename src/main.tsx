import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"

// Follow the system light/dark preference (shadcn themes key off the .dark class).
const dark = window.matchMedia("(prefers-color-scheme: dark)")
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches)
applyTheme()
dark.addEventListener("change", applyTheme)

// Ask the browser not to evict our IndexedDB data under storage pressure.
navigator.storage?.persist?.()

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js")
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
