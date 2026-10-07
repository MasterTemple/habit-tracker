# BoltFFI vs wasm-bindgen for running the Rust core in the app

Evaluated 2026-10-07 with BoltFFI 0.31.0 and wasm-bindgen 0.2 (wasm-pack 0.14).

## Question

The rules (periods, progress, streaks, deadlines) exist twice: TypeScript in `src/domain/` and Rust in
`server/core/`, kept identical by the shared fixtures in `fixtures/core.json`. Would compiling the Rust core to
WebAssembly for the app be worth it, and if so, should we use BoltFFI or wasm-bindgen?

## Spike

Both tools wrapped the same function, `habit_core::status::summarize`, taking a task context as JSON and
returning JSON. That's how the app would call it, since the core's types already serialize to the app's JSON.
Release builds, `opt-level = "s"`, LTO.

|                          | wasm-bindgen                  | BoltFFI                                            |
|--------------------------|-------------------------------|----------------------------------------------------|
| Annotate                 | `#[wasm_bindgen]`             | `#[export]`                                        |
| Build                    | `wasm-pack build --target web` | `boltffi init`, then set `targets.wasm.npm.package_name`, then `boltffi pack wasm` |
| Extra JS dependency      | none                          | `@boltffi/runtime` (~19 KB gzipped); `pack` fails without it installed |
| `.wasm` size (gzipped)   | 208 KB                        | 221 KB                                             |
| Generated API            | `summarize_json(ctx, today)`  | `summarizeJson(ctx, today)` (camelCase)            |
| Errors                   | `Result<_, JsError>` throws   | needs its own error type (spike returned `""`)     |
| Time per call, 3,000 entries (Node 20) | 3.48 ms        | 2.96 ms                                            |

Both returned identical results.

## Findings

- **Speed doesn't matter here.** BoltFFI's headline numbers (up to 450× faster than wasm-bindgen) come from
  crossing the boundary many times with structs. This app makes a few coarse calls per render, and their time
  is spent parsing JSON and computing streaks, not crossing the boundary. The measured difference was about 15%
  of a 3 ms call.
- **Download size is the real cost, either way.** About 210 KB gzipped of wasm roughly doubles the app's startup
  JavaScript (259 KB). Most of it is the core's logic plus serde_json and chrono; the time-zone database
  isn't the cause (about 15 KB).
- **BoltFFI's strength is elsewhere.** It shines when one Rust library feeds Swift, Kotlin and the web at once.
  If the app ever goes native (iOS/Android) on a shared Rust core, it's the better choice. For a web-only
  PWA, wasm-bindgen is simpler: one tool, no runtime package, and better-documented error handling.

## Recommendation

**Keep the TypeScript rules in the app for now**, with the shared fixtures guaranteeing they match the
server. Moving them to wasm would add ~210 KB to startup and a Rust build step to the web app's CI, in
exchange for removing one copy of about 300 lines that the fixtures already keep in sync.

Revisit if:

- **The app goes native (Tauri mobile, Swift/Kotlin):** use BoltFFI there; the same `#[export]` surface
  then serves the web too.
- **The rules grow large or start drifting despite the fixtures:** use wasm-bindgen for a web-only move, and
  lazy-load the wasm the way the charts are loaded.
