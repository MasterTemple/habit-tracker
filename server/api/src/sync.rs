//! `POST /sync`: devices push rows changed locally and pull rows changed elsewhere.
//!
//! - Rows are the app's JSON records, stored per user by (table, id).
//! - Conflicts: the newer `updatedAt` wins (as in the app's merge import). Timestamps
//!   more than a few minutes in the future are capped at server time, so a device with
//!   a wrong clock can't win every conflict forever.
//! - Permanent deletes arrive as tombstones; a tombstone beats any older version of the
//!   row, and the row's data is dropped on the server.
//! - Every write gets the user's next sequence number; a device pulls everything after
//!   its cursor, in pages.

use std::collections::BTreeMap;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, TimeDelta, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Sqlite, Transaction};

use crate::AppState;
use crate::auth::AuthUser;
use crate::clock::timestamp;
use crate::error::{ApiError, ApiResult};

/// App tables that sync. Anything else is rejected.
pub const TABLES: &[&str] = &[
    "tasks",
    "targets",
    "events",
    "categories",
    "exceptions",
    "automations",
    "contacts",
    "shares",
    "settings",
];

/// Rows returned per response; the device keeps asking while `more` is true.
pub const PAGE_SIZE: i64 = 1000;
/// Rows accepted per request (the app sends in batches).
const MAX_PUSH: usize = 5000;
const MAX_ROW_BYTES: usize = 64 * 1024;
const MAX_CLOCK_AHEAD: TimeDelta = TimeDelta::minutes(5);

pub fn router() -> Router<AppState> {
    Router::new().route("/sync", post(sync))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    pub table: String,
    pub id: String,
    pub deleted_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    /// The last `cursor` this device received (0 on first sync).
    pub cursor: i64,
    /// The device's current IANA zone; deadlines and reminders follow it.
    #[serde(default)]
    pub time_zone: Option<String>,
    /// Changed rows by table.
    #[serde(default)]
    pub changes: BTreeMap<String, Vec<Value>>,
    /// Permanently deleted rows.
    #[serde(default)]
    pub deletes: Vec<Tombstone>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    /// Pass back as `cursor` next time.
    pub cursor: i64,
    /// More changes are waiting: sync again right away.
    pub more: bool,
    /// The server forgot this device's position (e.g. restored from backup): it should
    /// re-send all of its data. Changes below are from the start.
    pub reset: bool,
    pub changes: BTreeMap<String, Vec<Value>>,
    pub deletes: Vec<Tombstone>,
    pub server_time: String,
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError::BadRequest(msg.into())
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Timestamps from a device clock that's too far ahead are replaced with server time.
fn cap_future(at: DateTime<Utc>, now: DateTime<Utc>) -> DateTime<Utc> {
    if at > now + MAX_CLOCK_AHEAD { now } else { at }
}

/// Checks a pushed row and returns (id, updatedAt) with any future timestamp capped.
fn prepare_row(
    table: &str,
    row: &mut Value,
    now: DateTime<Utc>,
) -> ApiResult<(String, DateTime<Utc>)> {
    let obj = row
        .as_object_mut()
        .ok_or_else(|| bad(format!("{table}: rows must be objects")))?;
    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .ok_or_else(|| bad(format!("{table}: every row needs an id")))?
        .to_string();
    let sent = obj
        .get("updatedAt")
        .and_then(Value::as_str)
        .and_then(parse_ts)
        .ok_or_else(|| bad(format!("{table}/{id}: updatedAt must be an ISO timestamp")))?;
    let updated = cap_future(sent, now);
    if updated != sent {
        obj.insert("updatedAt".into(), Value::String(timestamp(now)));
    }
    if serde_json::to_vec(&row).map_or(0, |b| b.len()) > MAX_ROW_BYTES {
        return Err(bad(format!("{table}/{id}: row is too large")));
    }
    validate_shape(table, &id, row)?;
    Ok((id, updated))
}

/// Rows the server computes with must match the shared rule types.
fn validate_shape(table: &str, id: &str, row: &Value) -> ApiResult<()> {
    use habit_core::types::{Settings, Task, TaskEvent, TaskException, TaskTarget};
    let err = |e: serde_json::Error| bad(format!("{table}/{id}: {e}"));
    match table {
        "tasks" => serde_json::from_value::<Task>(row.clone())
            .map(drop)
            .map_err(err),
        "targets" => serde_json::from_value::<TaskTarget>(row.clone())
            .map(drop)
            .map_err(err),
        "events" => serde_json::from_value::<TaskEvent>(row.clone())
            .map(drop)
            .map_err(err),
        "exceptions" => serde_json::from_value::<TaskException>(row.clone())
            .map(drop)
            .map_err(err),
        "settings" => serde_json::from_value::<Settings>(row.clone())
            .map(drop)
            .map_err(err),
        _ => Ok(()),
    }
}

/// Stores a row version unless the stored one is at least as new. Returns whether it
/// was written. Used by sync and by server-created rows (e.g. webhook entries).
pub async fn write_row(
    tx: &mut Transaction<'_, Sqlite>,
    user: &str,
    table: &str,
    id: &str,
    data: &str,
    updated: DateTime<Utc>,
    now: DateTime<Utc>,
) -> ApiResult<bool> {
    if existing_updated(tx, user, table, id)
        .await?
        .is_some_and(|stored| stored >= updated)
    {
        return Ok(false);
    }
    let seq = next_seq(tx, user).await?;
    sqlx::query(
        "INSERT INTO sync_rows (user_id, tbl, id, data, updated_at, deleted, seq, received_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT (user_id, tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
           deleted = 0, seq = excluded.seq, received_at = excluded.received_at",
    )
    .bind(user)
    .bind(table)
    .bind(id)
    .bind(data)
    .bind(timestamp(updated))
    .bind(seq)
    .bind(timestamp(now))
    .execute(&mut **tx)
    .await?;
    Ok(true)
}

async fn next_seq(tx: &mut Transaction<'_, Sqlite>, user_id: &str) -> ApiResult<i64> {
    Ok(sqlx::query_scalar(
        "UPDATE users SET sync_seq = sync_seq + 1 WHERE id = ? RETURNING sync_seq",
    )
    .bind(user_id)
    .fetch_one(&mut **tx)
    .await?)
}

/// The stored version's timestamp, if any.
async fn existing_updated(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    table: &str,
    id: &str,
) -> ApiResult<Option<DateTime<Utc>>> {
    let row: Option<String> = sqlx::query_scalar(
        "SELECT updated_at FROM sync_rows WHERE user_id = ? AND tbl = ? AND id = ?",
    )
    .bind(user_id)
    .bind(table)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.as_deref().and_then(parse_ts))
}

pub async fn sync(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(mut req): Json<SyncRequest>,
) -> ApiResult<Json<SyncResponse>> {
    let now = state.clock.now();
    let user = auth.user_id.as_str();

    let pushed: usize = req.changes.values().map(Vec::len).sum::<usize>() + req.deletes.len();
    if pushed > MAX_PUSH {
        return Err(bad(format!("Send at most {MAX_PUSH} rows per sync")));
    }
    for table in req
        .changes
        .keys()
        .chain(req.deletes.iter().map(|t| &t.table))
    {
        if !TABLES.contains(&table.as_str()) {
            return Err(bad(format!("Unknown table {table:?}")));
        }
    }
    // Validate everything before writing anything.
    let mut rows = Vec::with_capacity(pushed);
    for (table, list) in &mut req.changes {
        for row in list {
            let (id, updated) = prepare_row(table, row, now)?;
            rows.push((table.clone(), id, updated, row.to_string()));
        }
    }
    let mut deletes = Vec::with_capacity(req.deletes.len());
    for t in &req.deletes {
        let at = parse_ts(&t.deleted_at).ok_or_else(|| {
            bad(format!(
                "{}/{}: deletedAt must be an ISO timestamp",
                t.table, t.id
            ))
        })?;
        deletes.push((t.table.clone(), t.id.clone(), cap_future(at, now)));
    }
    if let Some(tz) = req.time_zone.as_deref().filter(|tz| !tz.is_empty())
        && tz.parse::<Tz>().is_err()
    {
        return Err(bad(format!("Unknown time zone {tz:?}")));
    }

    let mut tx = state.db.begin().await?;

    if let Some(tz) = req.time_zone.as_deref().filter(|tz| !tz.is_empty()) {
        sqlx::query("UPDATE users SET time_zone = ? WHERE id = ?")
            .bind(tz)
            .bind(user)
            .execute(&mut *tx)
            .await?;
    }

    // Push: the newer version wins.
    for (table, id, updated, data) in rows {
        write_row(&mut tx, user, &table, &id, &data, updated, now).await?;
    }
    // A tombstone wins over any version not newer than it.
    for (table, id, deleted_at) in deletes {
        if existing_updated(&mut tx, user, &table, &id)
            .await?
            .is_some_and(|stored| stored > deleted_at)
        {
            continue;
        }
        let seq = next_seq(&mut tx, user).await?;
        sqlx::query(
            "INSERT INTO sync_rows (user_id, tbl, id, data, updated_at, deleted, seq, received_at) VALUES (?, ?, ?, NULL, ?, 1, ?, ?)
             ON CONFLICT (user_id, tbl, id) DO UPDATE SET data = NULL, updated_at = excluded.updated_at, deleted = 1,
               seq = excluded.seq, received_at = excluded.received_at",
        )
        .bind(user)
        .bind(&table)
        .bind(&id)
        .bind(timestamp(deleted_at))
        .bind(seq)
        .bind(timestamp(now))
        .execute(&mut *tx)
        .await?;
    }

    // Pull: everything after the device's cursor (including what it just pushed, which it
    // recognizes by matching updatedAt).
    let latest: i64 = sqlx::query_scalar("SELECT sync_seq FROM users WHERE id = ?")
        .bind(user)
        .fetch_one(&mut *tx)
        .await?;
    let reset = req.cursor > latest;
    let from = if reset { 0 } else { req.cursor.max(0) };
    let page: Vec<(String, String, Option<String>, String, i64, i64)> = sqlx::query_as(
        "SELECT tbl, id, data, updated_at, deleted, seq FROM sync_rows WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    )
    .bind(user)
    .bind(from)
    .bind(PAGE_SIZE + 1)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let more = page.len() as i64 > PAGE_SIZE;
    let page = &page[..page.len().min(PAGE_SIZE as usize)];
    let cursor = page.last().map_or(from, |r| r.5);
    let mut changes: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut tombstones = Vec::new();
    for (table, id, data, updated_at, deleted, _) in page {
        match (deleted, data) {
            (0, Some(data)) => changes
                .entry(table.clone())
                .or_default()
                .push(serde_json::from_str(data).map_err(|e| ApiError::Internal(e.to_string()))?),
            _ => tombstones.push(Tombstone {
                table: table.clone(),
                id: id.clone(),
                deleted_at: updated_at.clone(),
            }),
        }
    }
    Ok(Json(SyncResponse {
        cursor,
        more,
        reset,
        changes,
        deletes: tombstones,
        server_time: timestamp(now),
    }))
}
