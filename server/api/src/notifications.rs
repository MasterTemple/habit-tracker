//! Notifying a user: every notice is kept in their inbox and queued for delivery on
//! the channels asked for (push to each of their devices; email later).

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppState;
use crate::auth::AuthUser;
use crate::clock::timestamp;
use crate::error::ApiResult;
use crate::outbox;
use crate::push::{PushPayload, SubscriptionKeys};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Push,
}

pub struct Notice {
    /// "reminder", "alert", "test", …
    pub kind: String,
    pub title: String,
    pub body: String,
    /// Where tapping it should go in the app (relative), if anywhere.
    pub url: Option<String>,
    /// Identifies the event; a notice with the same key is only ever sent once.
    pub dedupe: String,
    pub data: Value,
}

/// Records the notice in the user's inbox and queues it. Returns how many deliveries
/// were queued (0 if this notice was already sent, or the user has no devices).
pub async fn notify(
    state: &AppState,
    user_id: &str,
    notice: Notice,
    channels: &[Channel],
) -> ApiResult<usize> {
    let now = state.clock.now();
    // The recipient may have deleted their account since (e.g. a saved alert snapshot).
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Ok(0);
    }
    let inbox_id = uuid::Uuid::now_v7().to_string();
    let inserted = sqlx::query(
        "INSERT INTO inbox (id, user_id, kind, title, body, data, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (dedupe_key) DO NOTHING",
    )
    .bind(&inbox_id)
    .bind(user_id)
    .bind(&notice.kind)
    .bind(&notice.title)
    .bind(&notice.body)
    .bind(notice.data.to_string())
    .bind(&notice.dedupe)
    .bind(timestamp(now))
    .execute(&state.db)
    .await?;
    if inserted.rows_affected() == 0 {
        return Ok(0);
    }

    let mut queued = 0;
    if channels.contains(&Channel::Push) {
        let devices: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_all(&state.db)
        .await?;
        let payload = PushPayload {
            title: notice.title.clone(),
            body: notice.body.clone(),
            url: notice.url.clone(),
            tag: Some(notice.dedupe.clone()),
            inbox_id: Some(inbox_id.clone()),
        };
        for (endpoint, p256dh, auth) in devices {
            let job = outbox::PushJob {
                keys: SubscriptionKeys { p256dh, auth },
                payload: &payload,
            };
            outbox::enqueue(
                state,
                user_id,
                "push",
                &endpoint,
                &job,
                &format!("{}|{endpoint}", notice.dedupe),
            )
            .await?;
            queued += 1;
        }
    }
    Ok(queued)
}

// ---------- the inbox, for the app ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/inbox", get(list))
        .route("/inbox/read", post(mark_read))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    id: String,
    kind: String,
    title: String,
    body: String,
    #[sqlx(json)]
    data: Value,
    created_at: String,
    read_at: Option<String>,
}

#[derive(Deserialize)]
struct ListQuery {
    /// Only items created before this (for paging), newest first.
    before: Option<String>,
    limit: Option<i64>,
}

async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<Value>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let items: Vec<InboxItem> = sqlx::query_as(
        "SELECT id, kind, title, body, data, created_at, read_at FROM inbox
         WHERE user_id = ? AND (? IS NULL OR created_at < ?) ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .bind(&auth.user_id)
    .bind(&q.before)
    .bind(&q.before)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    let unread: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inbox WHERE user_id = ? AND read_at IS NULL")
            .bind(&auth.user_id)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(
        serde_json::json!({ "items": items, "unread": unread }),
    ))
}

#[derive(Deserialize)]
struct MarkRead {
    /// Items to mark read; omit to mark everything read.
    ids: Option<Vec<String>>,
}

async fn mark_read(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<MarkRead>,
) -> ApiResult<StatusCode> {
    let now = timestamp(state.clock.now());
    match req.ids {
        Some(ids) => {
            for id in ids {
                sqlx::query(
                    "UPDATE inbox SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND id = ?",
                )
                .bind(&now)
                .bind(&auth.user_id)
                .bind(id)
                .execute(&state.db)
                .await?;
            }
        }
        None => {
            sqlx::query("UPDATE inbox SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
                .bind(&now)
                .bind(&auth.user_id)
                .execute(&state.db)
                .await?;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}
