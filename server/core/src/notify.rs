//! Rules for when alerts go out. Mirrors `src/domain/notify.ts`.

use chrono::{DateTime, TimeDelta, Utc};

use crate::types::TaskEvent;

/// Progress alerts wait this long so an accidental tap can be undone before anyone is told.
pub const PROGRESS_ALERT_DELAY: TimeDelta = TimeDelta::seconds(60);

/// Entries ready for a "progress was made" alert: recorded after `since` (the last
/// check), at least [`PROGRESS_ALERT_DELAY`] ago, and not deleted (undone) since.
/// Younger entries are left for the next check.
pub fn progress_ready_to_alert(
    events: &[TaskEvent],
    since: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Vec<&TaskEvent> {
    let cutoff = now - PROGRESS_ALERT_DELAY;
    let window_start = since - PROGRESS_ALERT_DELAY;
    events
        .iter()
        .filter(|e| e.deleted_at.is_none())
        .filter(|e| {
            DateTime::parse_from_rfc3339(&e.created_at)
                .map(|t| t.with_timezone(&Utc))
                .is_ok_and(|created| created > window_start && created <= cutoff)
        })
        .collect()
}
