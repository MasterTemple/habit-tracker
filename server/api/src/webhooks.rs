//! Webhooks. Incoming: `POST /hooks/{token}` records progress on a task. Outgoing:
//! signed JSON POSTs to user-chosen URLs, only to public internet addresses.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::post;
use chrono::{DateTime, TimeDelta, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;

use crate::AppState;
use crate::clock::timestamp;
use crate::error::{ApiError, ApiResult};
use crate::push::SendResult;
use crate::sync::write_row;
use crate::userdata;

pub fn router() -> Router<AppState> {
    Router::new().route("/hooks/{token}", post(incoming).get(incoming))
}

// ---------- incoming ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncomingWebhook {
    #[serde(default)]
    name: String,
    enabled: bool,
    task_id: String,
    amount: f64,
}

#[derive(Deserialize, Default)]
struct HookBody {
    amount: Option<f64>,
    note: Option<String>,
}

/// Calls per webhook per minute.
const HOOK_RATE: usize = 30;

/// Remembers recent calls per webhook, to cap how fast one can record entries.
#[derive(Default)]
pub struct HookLimiter(Mutex<HashMap<String, Vec<DateTime<Utc>>>>);

impl HookLimiter {
    fn allow(&self, token: &str, now: DateTime<Utc>) -> bool {
        let mut map = self.0.lock().unwrap();
        let calls = map.entry(token.to_string()).or_default();
        calls.retain(|t| now - *t < TimeDelta::minutes(1));
        if calls.len() >= HOOK_RATE {
            return false;
        }
        calls.push(now);
        true
    }
}

/// Records the webhook's amount (or the body's `amount`) on its task, dated on the
/// owner's wall clock in their current time zone. Devices get it on their next sync.
async fn incoming(
    State(state): State<AppState>,
    Path(token): Path<String>,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let now = state.clock.now();
    if !state.hook_limiter.allow(&token, now) {
        return Err(ApiError::RateLimited);
    }
    let found: Option<(String, String)> = sqlx::query_as(
        "SELECT user_id, data FROM sync_rows WHERE tbl = 'automations' AND deleted = 0
           AND json_extract(data, '$.token') = ? AND json_extract(data, '$.kind') = 'webhook_in'
           AND json_extract(data, '$.deletedAt') IS NULL",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?;
    let (user_id, data) =
        found.ok_or_else(|| ApiError::NotFound("No webhook at this address".into()))?;
    let hook: IncomingWebhook =
        serde_json::from_str(&data).map_err(|e| ApiError::Internal(e.to_string()))?;
    if !hook.enabled {
        return Err(ApiError::Forbidden("This webhook is turned off".into()));
    }

    let task: Option<String> = sqlx::query_scalar(
        "SELECT data FROM sync_rows WHERE user_id = ? AND tbl = 'tasks' AND id = ? AND deleted = 0",
    )
    .bind(&user_id)
    .bind(&hook.task_id)
    .fetch_optional(&state.db)
    .await?;
    let task: habit_core::types::Task = task
        .and_then(|t| serde_json::from_str(&t).ok())
        .ok_or_else(|| ApiError::Gone("This webhook's task was deleted".into()))?;
    if task.retired_at.is_some() {
        return Err(ApiError::Gone("This webhook's task is retired".into()));
    }

    let extra: HookBody = if body.is_empty() {
        HookBody::default()
    } else {
        serde_json::from_slice(&body).unwrap_or_default()
    };
    let amount = extra
        .amount
        .filter(|a| a.is_finite() && a.abs() <= 1_000_000.0)
        .unwrap_or(hook.amount);
    let note = extra
        .note
        .map(|n| n.chars().take(200).collect::<String>())
        .unwrap_or_else(|| {
            if hook.name.trim().is_empty() {
                "via webhook".into()
            } else {
                format!("via {}", hook.name.trim())
            }
        });

    let (settings, zone) = userdata::settings_and_zone(&state.db, &user_id).await?;
    let local = now.with_timezone(&zone).naive_local();
    let id = uuid::Uuid::now_v7().to_string();
    let entry = json!({
        "id": id, "taskId": task.id, "amount": amount, "occurredAt": timestamp(now),
        "localDate": habit_core::dates::to_local_date(local, settings.day_start_hour),
        "localTime": local.format("%H:%M").to_string(), "timeZone": zone.name(), "note": note,
        "createdAt": timestamp(now), "updatedAt": timestamp(now), "deletedAt": null,
    });
    let mut tx = state.db.begin().await?;
    write_row(
        &mut tx,
        &user_id,
        "events",
        &id,
        &entry.to_string(),
        now,
        now,
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "recorded": amount, "task": task.name, "entryId": id })),
    ))
}

// ---------- outgoing ----------

/// Queued outgoing webhook: where, what, and the secret to sign with (if any).
#[derive(Serialize, Deserialize)]
pub struct WebhookJob {
    pub url: String,
    pub event: String,
    pub body: Value,
    pub secret: Option<String>,
}

/// Addresses on the public internet only: no loopback, private, link-local, CGNAT,
/// multicast, or reserved ranges (so a webhook can't reach the server's own network).
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (64..128).contains(&o[1])) // carrier-grade NAT
                || (o[0] == 192 && o[1] == 0 && o[2] == 0) // IETF protocol assignments
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // benchmarking
                || o[0] >= 240) // reserved
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link-local
                || (s[0] == 0x2001 && s[1] == 0x0db8)) // documentation
        }
    }
}

fn sign(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("any key length");
    mac.update(body);
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Delivers one webhook. Resolves the host, refuses non-public addresses, then connects
/// to exactly the address it checked (so DNS can't be switched in between).
pub async fn send(state: &AppState, delivery_id: &str, job: &WebhookJob) -> SendResult {
    let Ok(url) = url::Url::parse(&job.url) else {
        return SendResult::Rejected("invalid URL".into());
    };
    if !matches!(url.scheme(), "http" | "https") {
        return SendResult::Rejected("only http(s) URLs".into());
    }
    let Some(host) = url.host_str().map(str::to_string) else {
        return SendResult::Rejected("no host".into());
    };
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<SocketAddr> = match tokio::net::lookup_host((host.as_str(), port)).await {
        Ok(a) => a.collect(),
        Err(e) => return SendResult::Retry(format!("DNS: {e}")),
    };
    let Some(addr) = addrs
        .iter()
        .copied()
        .find(|a| state.config.allow_private_targets || is_public(a.ip()))
    else {
        return SendResult::Rejected(format!("{host} isn't a public internet address"));
    };
    if !state.config.allow_private_targets && addrs.iter().any(|a| !is_public(a.ip())) {
        return SendResult::Rejected(format!("{host} resolves to a private address"));
    }

    let client = match reqwest::Client::builder()
        .resolve(&host, addr)
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("habit-tracker/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(c) => c,
        Err(e) => return SendResult::Retry(e.to_string()),
    };
    let body = serde_json::to_vec(&job.body).expect("serializable");
    let mut req = client
        .post(url)
        .header("content-type", "application/json")
        .header("x-habit-event", &job.event)
        .header("x-habit-delivery", delivery_id);
    if let Some(secret) = job.secret.as_deref().filter(|s| !s.is_empty()) {
        req = req.header(
            "x-habit-signature",
            format!("sha256={}", sign(secret, &body)),
        );
    }
    match req.body(body).send().await {
        Ok(r) if r.status().is_success() => SendResult::Sent,
        Ok(r)
            if r.status().as_u16() == 408
                || r.status().as_u16() == 429
                || r.status().is_server_error() =>
        {
            SendResult::Retry(format!("answered {}", r.status()))
        }
        Ok(r) => SendResult::Rejected(format!("answered {}", r.status())),
        Err(e) => SendResult::Retry(e.to_string()),
    }
}
