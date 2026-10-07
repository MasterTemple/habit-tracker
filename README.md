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

## Server (in progress)

`server/` is a Rust workspace. `server/core` is the app's rules (`src/domain`) ported to Rust, so the server
computes exactly what the app shows. Both are checked against the same cases in `fixtures/core.json`:

```sh
bun run test                  # includes src/domain/conformance.test.ts (checks TS against the fixture)
bun run fixtures              # regenerate the fixture after an intentional rule change…
cd server && cargo test       # …then make the Rust port match it
```

`server/api` is the server itself (axum + SQLite). So far: accounts and sessions.

```sh
cd server
SIGNUP_CODE=pick-one cargo run -p habit-api   # http://127.0.0.1:8080, database in ./habits.db
```

| Variable | Default | |
|---|---|---|
| `BIND` | `127.0.0.1:8080` | Address to listen on |
| `DATABASE_URL` | `sqlite://habits.db` | Created and migrated on start |
| `ALLOWED_ORIGINS` | `https://mastertemple.github.io,https://localhost:5173` | Web app origins allowed to call the API |
| `SIGNUP_CODE` | unset (open sign-up) | Required to create an account when set; set it on a public server |
| `SESSION_DAYS` | `90` | Sessions expire after this long unused |

Endpoints: `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET`/`PATCH /me`,
`POST /me/password`. Passwords (min 10 characters) are stored as Argon2id hashes; session tokens are stored only
as SHA-256 hashes; failed logins lock a username for 15 minutes after 10 tries.



```
src/domain/     Pure TS: types, periods, progress/streak/carry-over rules. No React or DB imports.
                Mirrored in Rust by server/core; fixtures/core.json keeps them in agreement.
src/db/         Dexie schema (db.ts) and the only place that writes data (repo.ts).
src/hooks/      useAppData: live-loads everything and derives per-task summaries.
                useEditors: hosts the task/category/break editors so any page or the + menu can open them.
src/components/ Task card, editors, history sheet, dialogs.
src/pages/      Tasks (Tasks | Categories), Schedule (Breaks | Reminders | Actions | Webhooks),
                Social (Friends | Sharing | Accountability), Settings.
```

## Data model

Progress is never stored; it's derived from append-only **events** (`+10 at 09:01`).

- **tasks**: what the task is, with an optional unit ("minute", "page"). `track` tasks are counters with no
  goal. Type (`accumulate` / `limit` / `track`) is immutable; use *Duplicate* or
  *Copy & retire* (both link the copy via `createdFromId`).
- **targets**: versioned goals (track tasks have one too, only for their period) (`period`, `amount`, `carryOver`, `effectiveFrom`). The version in effect at a
  period's start governs that period. Editing a goal creates a version starting at the current period.
- **events**: amounts (negative for corrections) with a fixed `localDate` and `localTime` (wall clock when
  recorded, plus the IANA `timeZone`); soft-deleted for undo.
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
- **Due times** ("Do" tasks): wall-clock, like an alarm: 9:00 means 9:00 wherever you are. Weekly/monthly goals
  are due on the period's last day. Entries are compared by their recorded `localDate`/`localTime` and "now" by
  the current wall clock, so traveling never re-times past entries. Times are measured from the day-start hour,
  so a 1 AM entry with a 3 AM day start counts as late in the day. Finishing after the due time still meets the
  goal but shows as late; "overdue" means the deadline passed with the goal unmet.
- **Undo:** the card's undo button deletes the newest entry in the current period, whichever button made it
  (with Redo in the toast). Corrections that should stay in the history go through *Custom amount*.
- **Streaks:** consecutive successful periods; the current open period and excused periods don't break it.

### Server-dependent features (configured now, delivered later)

Reminders, scheduled reports/backups, webhooks, sharing, and accountability alerts are stored locally
(`automations`, `contacts`, `shares` tables) so they can be set up now; a sync server will deliver them.
What already works without one:

- **Shortcut links** for incoming webhooks: opening `…/?hook=<token>` records the webhook's amount on its task
  (e.g. from an iOS Shortcuts automation).
- **Messaging friends**: Messages, Call, Email, Telegram, Signal, and Discord links from their details.
- Progress alerts must wait a minute so undone entries aren't reported: `progressReadyToAlert` in
  `src/domain/notify.ts`, for the server to use.

Deleting a task is a hard delete (it will need a tombstone once sync exists).

All rows use UUIDv7 ids, `updatedAt`, and soft deletes so sync can be added later.
