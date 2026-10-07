//! The habit tracker's rules, ported from the web app's `src/domain` so the server
//! computes exactly what the app shows. Pure functions on local (wall-clock) dates and
//! times; no I/O. `tests/conformance.rs` checks this crate against `fixtures/core.json`,
//! which the TypeScript tests also verify.

pub mod dates;
pub mod notify;
pub mod schedule;
pub mod status;
pub mod types;
