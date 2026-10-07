# Habit Tracker

A local-first task/habit tracker and counter. React + TypeScript + shadcn/ui + Dexie (IndexedDB), built as a PWA.

## Run

```sh
bun install
bun dev          # https://localhost:5173 and https://<lan-ip>:5173
bun run test     # domain + repository tests
bun run build
```

The dev server uses a self-signed HTTPS cert (`@vitejs/plugin-basic-ssl`) so phones on your LAN get a
secure context (needed for service workers, `crypto`, notifications). Accept the certificate warning
on the phone. For a real cert — needed for "Add to Home Screen" to install the service worker on iOS —
use `tailscale serve` or a `cloudflared` tunnel pointed at the dev/preview server.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which typechecks, tests, builds with
`BASE_PATH=/<repo>/`, and publishes `dist/` to GitHub Pages. To build for a sub-path locally:
`BASE_PATH=/habit-tracker/ bun run build`.

Data lives in the browser's IndexedDB for that exact origin, so moving between the dev server and the
deployed site means using Export / Import in Settings.

## Layout

```
src/domain/     Pure TS: types, periods, progress/streak/carry-over rules. No React or DB imports,
                so a future sync server can run the same logic.
src/db/         Dexie schema (db.ts) and the only place that writes data (repo.ts).
src/hooks/      useAppData: live-loads everything and derives per-task summaries.
                useEditors: hosts the task/category/break editors so any page or the + menu can open them.
src/components/ Task card, editors, history sheet, dialogs.
src/pages/      Tasks (Tasks | Categories), Schedule (Breaks | Automations), Social (placeholder), Settings.
```

## Data model

Progress is never stored; it's derived from append-only **events** (`+10 at 09:01`).

- **tasks**: what the task is, with an optional unit ("minute", "page"). `track` tasks are counters with no
  goal. Type (`accumulate` / `limit` / `track`) is immutable; use *Duplicate* or
  *Copy & retire* (both link the copy via `createdFromId`).
- **targets**: versioned goals (track tasks have one too, only for their period) (`period`, `amount`, `carryOver`, `effectiveFrom`). The version in effect at a
  period's start governs that period. Editing a goal creates a version starting at the current period.
- **events**: amounts (negative for corrections) with a fixed `localDate`; soft-deleted for undo.
- **categories** / **taskCategories**: many-to-many; priorities are just categories. List order is priority:
  a new task takes the default icon of its highest-priority category.
- **exceptions** ("breaks"): cover all tasks, or any mix of tasks and categories.
- **settings**: week start, day start hour, carry-over default, limit wording (used / remaining), name of the
  "uncategorized" filter.

### Import / export

- **Backup** (Settings → Export): everything. Importing one asks to **merge** (newest copy of each row wins,
  local settings kept) or **replace**.
- **Shared tasks** (Settings → Share tasks): task settings and categories, no entries. Importing adds them as new
  tasks, reusing categories with the same name.

### Rules

- **Breaks:** accumulate goals are prorated by non-break days (rounded up); a fully covered period is excused.
  Limit goals stay the same, but entries on break days don't count.
- **Carry-over** (per task, one period back only): accumulate surplus lowers the next goal; limit overage lowers
  the next allowance. Unused limit allowance does not roll forward.
- **Undo:** the card's undo button deletes the newest entry in the current period, whichever button made it
  (with Redo in the toast). Corrections that should stay in the history go through *Custom amount*.
- **Streaks:** consecutive successful periods; the current open period and excused periods don't break it.

All rows use UUIDv7 ids, `updatedAt`, and soft deletes so sync can be added later.
