//! The delivery queue. Notices become rows here; a worker sends them, retrying with
//! backoff, so a push service being down for a while loses nothing.

use chrono::TimeDelta;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::clock::timestamp;
use crate::error::ApiResult;
use crate::push::{self, PushPayload, SendResult, SubscriptionKeys};
use crate::webhooks::{self, WebhookJob};

/// Attempts before giving up on a delivery.
const MAX_ATTEMPTS: i64 = 8;

#[derive(Serialize)]
pub struct PushJob<'a> {
    pub keys: SubscriptionKeys,
    pub payload: &'a PushPayload,
}

#[derive(Deserialize)]
struct StoredPushJob {
    keys: SubscriptionKeys,
    payload: PushPayload,
}

/// Queues a delivery. A second delivery with the same `dedupe` key is ignored.
pub async fn enqueue(
    state: &AppState,
    user_id: &str,
    channel: &str,
    target: &str,
    job: &impl Serialize,
    dedupe: &str,
) -> ApiResult<()> {
    let now = timestamp(state.clock.now());
    sqlx::query(
        "INSERT INTO outbox (id, user_id, channel, target, payload, dedupe_key, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING",
    )
    .bind(uuid::Uuid::now_v7().to_string())
    .bind(user_id)
    .bind(channel)
    .bind(target)
    .bind(serde_json::to_string(job).expect("serializable"))
    .bind(dedupe)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await?;
    Ok(())
}

/// Backoff after `attempts` failures: 30 s, 1 min, 2 min, … capped at 1 hour.
fn backoff(attempts: i64) -> TimeDelta {
    TimeDelta::seconds((30 * 2i64.pow(attempts.clamp(0, 7) as u32)).min(3600))
}

/// Sends everything due now. Returns how many deliveries succeeded. Errors are recorded
/// on the rows (and logged), never returned.
pub async fn process_due(state: &AppState) -> usize {
    let now = state.clock.now();
    let due: Vec<(String, String, String, String, i64)> = match sqlx::query_as(
        "SELECT id, channel, target, payload, attempts FROM outbox
         WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 100",
    )
    .bind(timestamp(now))
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "outbox: query failed");
            return 0;
        }
    };

    let mut sent = 0;
    for (id, channel, target, payload, attempts) in due {
        let result = match channel.as_str() {
            "push" => match serde_json::from_str::<StoredPushJob>(&payload) {
                Ok(job) => push::send(state, &target, &job.keys, &job.payload).await,
                Err(e) => SendResult::Retry(format!("bad payload: {e}")),
            },
            "webhook" => match serde_json::from_str::<WebhookJob>(&payload) {
                Ok(job) => webhooks::send(state, &id, &job).await,
                Err(e) => SendResult::Rejected(format!("bad payload: {e}")),
            },
            other => SendResult::Rejected(format!("unknown channel {other}")),
        };
        let update = match result {
            SendResult::Sent => {
                sent += 1;
                sqlx::query("UPDATE outbox SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?")
                    .bind(timestamp(now))
                    .bind(&id)
                    .execute(&state.db)
                    .await
            }
            SendResult::Gone => {
                if channel == "push" {
                    // The device unsubscribed or the subscription expired.
                    let _ = sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = ?")
                        .bind(&target)
                        .execute(&state.db)
                        .await;
                }
                sqlx::query(
                    "UPDATE outbox SET status = 'gone', attempts = attempts + 1 WHERE id = ?",
                )
                .bind(&id)
                .execute(&state.db)
                .await
            }
            SendResult::Rejected(error) => {
                tracing::warn!(%id, %channel, %error, "outbox: delivery rejected");
                sqlx::query("UPDATE outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?")
                    .bind(error)
                    .bind(&id)
                    .execute(&state.db)
                    .await
            }
            SendResult::Retry(error) => {
                let attempts = attempts + 1;
                let status = if attempts >= MAX_ATTEMPTS {
                    "failed"
                } else {
                    "pending"
                };
                tracing::warn!(%id, %channel, %error, attempts, "outbox: delivery failed");
                sqlx::query("UPDATE outbox SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?")
                    .bind(status)
                    .bind(attempts)
                    .bind(error)
                    .bind(timestamp(now + backoff(attempts)))
                    .bind(&id)
                    .execute(&state.db)
                    .await
            }
        };
        if let Err(e) = update {
            tracing::error!(error = %e, "outbox: update failed");
        }
    }
    sent
}
