import { SearchIcon } from "lucide-react"
import { iconNames } from "lucide-react/dynamic"
import { useEffect, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { useAppData } from "@/hooks/useAppData"
import { SUGGESTED_ICONS } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { TaskIcon } from "./TaskIcon"

const MAX_RESULTS = 96
const RECENTS_KEY = "recent-icons"
const MAX_RECENTS = 16

// Recently picked icons are a per-device convenience, so browser storage is fine (and may be unavailable).
function loadRecents(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "string") : []
  } catch {
    return []
  }
}

function saveRecent(name: string) {
  try {
    const next = [name, ...loadRecents().filter((n) => n !== name)].slice(0, MAX_RECENTS)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

type Tags = Record<string, string[]>

/** Ranks icons: name prefix, then name substring, then keyword match. Every search term must match. */
function search(query: string, tags: Tags | null): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const scored: { name: string; score: number }[] = []
  for (const name of iconNames) {
    const words = tags?.[name] ?? []
    let score = 0
    for (const term of terms) {
      if (name.startsWith(term)) score += 3
      else if (name.includes(term)) score += 2
      else if (words.some((w) => w.includes(term))) score += 1
      else {
        score = 0
        break
      }
    }
    if (score > 0) scored.push({ name, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((s) => s.name)
}

interface Props {
  value: string
  color: string
  onChange: (name: string) => void
}

export function IconPicker({ value, color, onChange }: Props) {
  const { tasks, categories } = useAppData()
  const [query, setQuery] = useState("")
  const [recents] = useState(loadRecents)
  const [tags, setTags] = useState<Tags | null>(null)

  useEffect(() => {
    // ~30 KB gzipped of keywords, so only load it when the picker is shown.
    import("lucide-static/tags.json").then((m) => setTags(m.default as Tags))
  }, [])

  const matches = useMemo(() => {
    if (!query.trim()) {
      // Current choice, then recently picked, then icons already in use, then suggestions.
      const inUse = [...tasks.filter((t) => !t.task.retiredAt).map((t) => t.task.icon), ...categories.map((c) => c.icon)]
      return [...new Set([value, ...recents, ...inUse, ...SUGGESTED_ICONS])].filter((n) => n && iconNames.includes(n as never))
    }
    return search(query, tags)
  }, [query, tags, value, recents, tasks, categories])

  const pick = (name: string) => {
    saveRecent(name)
    onChange(name)
  }

  return (
    <div className="grid gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${iconNames.length.toLocaleString()} icons (e.g. run, book, water)`}
          className="pl-8"
          type="search"
        />
      </div>
      <div className="grid grid-cols-8 gap-1">
        {matches.slice(0, MAX_RESULTS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => pick(name)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-md border",
              value === name ? "border-foreground bg-muted" : "border-transparent",
            )}
            aria-label={name}
            title={name}
          >
            <TaskIcon name={name} className="size-5" style={{ color }} />
          </button>
        ))}
      </div>
      {query.trim() && (
        <p className="text-xs text-muted-foreground">
          {matches.length === 0
            ? "No icons match."
            : matches.length > MAX_RESULTS
              ? `Showing ${MAX_RESULTS} of ${matches.length}. Keep typing to narrow it down.`
              : `${matches.length} match${matches.length === 1 ? "" : "es"}`}
        </p>
      )}
    </div>
  )
}
