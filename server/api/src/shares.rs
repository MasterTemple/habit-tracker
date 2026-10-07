//! Viewing other people's tasks. A "view" share rule lists the tasks/categories shared,
//! with which friends, and optionally anyone with its link. The payload is the owner's
//! own rows (same shapes the app uses) for just those tasks, minus private bits.

use std::collections::BTreeSet;

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::TimeDelta;
use habit_core::status::exceptions_for_task;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::friends::are_friends;
use crate::userdata::{self, Scope, UserData};

/// History included in a shared view.
const HISTORY: TimeDelta = TimeDelta::days(400);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/shared", get(shared_with_me))
        .route("/shared/{username}", get(view_friend))
        .route("/s/{token}", get(view_link))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewRule {
    #[serde(default)]
    name: String,
    enabled: bool,
    scope: Scope,
    #[serde(default)]
    contact_ids: Vec<String>,
    #[serde(default)]
    anyone_with_link: bool,
    #[serde(default)]
    deleted_at: Option<String>,
}

fn view_rules(data: &UserData) -> Vec<ViewRule> {
    data.shares
        .iter()
        .filter(|r| r.get("kind").and_then(Value::as_str) == Some("view"))
        .filter_map(|r| serde_json::from_value::<ViewRule>(r.clone()).ok())
        .filter(|r| r.enabled && r.deleted_at.is_none())
        .collect()
}

/// Usernames (lowercase) of the owner's contacts a rule names.
fn rule_usernames(data: &UserData, rule: &ViewRule) -> BTreeSet<String> {
    data.contacts
        .iter()
        .filter(|c| c.get("deletedAt").is_none_or(Value::is_null))
        .filter(|c| {
            c.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| rule.contact_ids.iter().any(|r| r == id))
        })
        .filter_map(|c| c.get("username").and_then(Value::as_str))
        .map(|u| u.trim().trim_start_matches('@').to_lowercase())
        .filter(|u| !u.is_empty())
        .collect()
}

/// The owner's rules that share with `viewer` (by username, and only if they're friends).
async fn rules_for(
    state: &AppState,
    owner_id: &str,
    data: &UserData,
    viewer_id: &str,
    viewer: &str,
) -> ApiResult<Vec<ViewRule>> {
    if !are_friends(&state.db, owner_id, viewer_id).await? {
        return Ok(vec![]);
    }
    Ok(view_rules(data)
        .into_iter()
        .filter(|r| rule_usernames(data, r).contains(viewer))
        .collect())
}

fn what(data: &UserData, rule: &ViewRule) -> String {
    if !rule.name.trim().is_empty() {
        return rule.name.trim().into();
    }
    if rule.scope.applies_to_all {
        return "All tasks".into();
    }
    let names: Vec<String> = data
        .categories
        .iter()
        .filter(|c| {
            c.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| rule.scope.category_ids.iter().any(|s| s == id))
        })
        .filter_map(|c| c.get("name").and_then(Value::as_str).map(str::to_string))
        .chain(
            data.tasks
                .iter()
                .filter(|t| rule.scope.task_ids.contains(&t.id))
                .map(|t| t.name.clone()),
        )
        .collect();
    names.join(", ")
}

/// People sharing tasks with the caller.
async fn shared_with_me(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<Value>> {
    let me: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&auth.user_id)
        .fetch_one(&state.db)
        .await?;
    let owners: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM sync_rows WHERE tbl = 'shares' AND deleted = 0
           AND json_extract(data, '$.kind') = 'view' AND user_id != ?",
    )
    .bind(&auth.user_id)
    .fetch_all(&state.db)
    .await?;
    let mut people = Vec::new();
    for owner in owners {
        let data = userdata::load(&state.db, &owner).await?;
        let rules = rules_for(&state, &owner, &data, &auth.user_id, &me).await?;
        if !rules.is_empty() {
            let shares: Vec<String> = rules.iter().map(|r| what(&data, r)).collect();
            people.push(json!({ "username": data.username, "displayName": data.display_name, "shares": shares }));
        }
    }
    Ok(Json(json!({ "people": people })))
}

/// What a friend shares with the caller.
async fn view_friend(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(username): Path<String>,
) -> ApiResult<Json<Value>> {
    let not_shared = || ApiError::NotFound("They aren't sharing anything with you".into());
    let username = username.trim().trim_start_matches('@').to_lowercase();
    let owner: String = sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
        .bind(&username)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(not_shared)?;
    let me: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&auth.user_id)
        .fetch_one(&state.db)
        .await?;
    let data = userdata::load(&state.db, &owner).await?;
    let rules = rules_for(&state, &owner, &data, &auth.user_id, &me).await?;
    if rules.is_empty() {
        return Err(not_shared());
    }
    Ok(Json(payload(&state, &data, rules.iter().map(|r| &r.scope))))
}

/// A share anyone with the link can open (no account needed).
async fn view_link(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Json<Value>> {
    let not_found = || ApiError::NotFound("This link isn't shared (anymore)".into());
    let owner: String = sqlx::query_scalar(
        "SELECT user_id FROM sync_rows WHERE tbl = 'shares' AND deleted = 0
           AND json_extract(data, '$.kind') = 'view' AND json_extract(data, '$.token') = ?",
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(not_found)?;
    let data = userdata::load(&state.db, &owner).await?;
    let rule = data
        .shares
        .iter()
        .filter(|r| r.get("token").and_then(Value::as_str) == Some(token.as_str()))
        .filter_map(|r| serde_json::from_value::<ViewRule>(r.clone()).ok())
        .find(|r| r.enabled && r.anyone_with_link && r.deleted_at.is_none())
        .ok_or_else(not_found)?;
    Ok(Json(payload(&state, &data, std::iter::once(&rule.scope))))
}

/// The shared tasks with their goals, recent entries (without notes), categories, and
/// breaks (without reasons), plus the settings and time zone needed to show them.
fn payload<'a>(
    state: &AppState,
    data: &UserData,
    scopes: impl Iterator<Item = &'a Scope> + Clone,
) -> Value {
    let tasks: Vec<_> = data
        .tasks
        .iter()
        .filter(|t| t.retired_at.is_none() && scopes.clone().any(|s| s.covers(t)))
        .collect();
    let ids: BTreeSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
    let since = data.local_now(state.clock.now()).today - HISTORY;
    let category_ids: BTreeSet<&str> = tasks
        .iter()
        .flat_map(|t| t.category_ids.iter().map(String::as_str))
        .collect();

    let events: Vec<Value> = data
        .events
        .iter()
        .filter(|e| {
            ids.contains(e.task_id.as_str()) && e.deleted_at.is_none() && e.local_date >= since
        })
        .map(|e| {
            let mut v = serde_json::to_value(e).expect("serializable");
            v["note"] = json!("");
            v
        })
        .collect();
    let mut exception_ids = BTreeSet::new();
    let exceptions: Vec<Value> = tasks
        .iter()
        .flat_map(|t| exceptions_for_task(&t.id, &t.category_ids, &data.exceptions))
        .filter(|e| exception_ids.insert(e.id.clone()))
        .map(|e| {
            let mut v = serde_json::to_value(e).expect("serializable");
            v["description"] = json!("");
            v
        })
        .collect();
    let categories: Vec<&Value> = data
        .categories
        .iter()
        .filter(|c| {
            c.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| category_ids.contains(id))
        })
        .filter(|c| c.get("deletedAt").is_none_or(Value::is_null))
        .collect();
    let s = &data.settings;
    json!({
        "owner": { "username": data.username, "displayName": data.display_name, "timeZone": data.time_zone.name() },
        "settings": { "weekStartsOn": s.week_starts_on, "dayStartHour": s.day_start_hour, "limitDisplay": s.limit_display,
                      "uncategorizedName": s.uncategorized_name, "carryOverDefault": s.carry_over_default },
        "tasks": tasks,
        "targets": data.targets.iter().filter(|t| ids.contains(t.task_id.as_str())).collect::<Vec<_>>(),
        "events": events,
        "categories": categories,
        "exceptions": exceptions,
    })
}
