//! Friends: find people by username, request, accept. Alerts and shared data only ever
//! reach accepted friends, so knowing a username isn't enough to send someone anything.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::AppState;
use crate::auth::{AuthUser, normalize_username};
use crate::clock::timestamp;
use crate::error::{ApiError, ApiResult};
use crate::notifications::{Channel, Notice, notify};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/search", get(search))
        .route("/friends", get(list))
        .route("/friends/{username}/request", post(request))
        .route("/friends/{username}/accept", post(accept))
        .route("/friends/{username}", delete(remove))
}

fn pair<'a>(a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    if a < b { (a, b) } else { (b, a) }
}

/// Whether two accounts are accepted friends.
pub async fn are_friends(db: &SqlitePool, a: &str, b: &str) -> Result<bool, sqlx::Error> {
    if a == b {
        return Ok(false);
    }
    let (x, y) = pair(a, b);
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM friendships WHERE user_a = ? AND user_b = ?")
            .bind(x)
            .bind(y)
            .fetch_optional(db)
            .await?;
    Ok(status.as_deref() == Some("accepted"))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    #[serde(skip)]
    pub id: String,
    pub username: String,
    pub display_name: String,
}

async fn find_user(db: &SqlitePool, username: &str) -> ApiResult<Person> {
    let username = normalize_username(username)
        .map_err(|_| ApiError::NotFound("No one has that username".into()))?;
    sqlx::query_as("SELECT id, username, display_name FROM users WHERE username = ?")
        .bind(&username)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| ApiError::NotFound("No one has that username".into()))
}

/// "friend", "requested" (I asked), "incoming" (they asked), or "none".
async fn relation(db: &SqlitePool, me: &str, other: &str) -> ApiResult<&'static str> {
    let (x, y) = pair(me, other);
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT status, requested_by FROM friendships WHERE user_a = ? AND user_b = ?",
    )
    .bind(x)
    .bind(y)
    .fetch_optional(db)
    .await?;
    Ok(match row {
        Some((status, _)) if status == "accepted" => "friend",
        Some((_, by)) if by == me => "requested",
        Some(_) => "incoming",
        None => "none",
    })
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

/// Usernames starting with the query (at least 2 characters), up to 10.
async fn search(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<SearchQuery>,
) -> ApiResult<Json<Value>> {
    let q = query.q.trim().trim_start_matches('@').to_lowercase();
    if q.chars().count() < 2 {
        return Ok(Json(json!({ "people": [] })));
    }
    // Escape LIKE wildcards so "_" and "%" match literally.
    let pattern = format!(
        "{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let people: Vec<Person> = sqlx::query_as(
        "SELECT id, username, display_name FROM users WHERE username LIKE ? ESCAPE '\\' AND id != ? ORDER BY username LIMIT 10",
    )
    .bind(pattern)
    .bind(&auth.user_id)
    .fetch_all(&state.db)
    .await?;
    let mut out = Vec::new();
    for p in people {
        let rel = relation(&state.db, &auth.user_id, &p.id).await?;
        out.push(json!({ "username": p.username, "displayName": p.display_name, "relation": rel }));
    }
    Ok(Json(json!({ "people": out })))
}

async fn me(db: &SqlitePool, id: &str) -> ApiResult<Person> {
    Ok(
        sqlx::query_as("SELECT id, username, display_name FROM users WHERE id = ?")
            .bind(id)
            .fetch_one(db)
            .await?,
    )
}

fn name_of(p: &Person) -> String {
    if p.display_name.trim().is_empty() {
        format!("@{}", p.username)
    } else {
        p.display_name.trim().into()
    }
}

/// Friends, and requests both ways.
async fn list(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT u.username, u.display_name, f.status, f.requested_by, f.accepted_at, f.created_at
         FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
         WHERE f.user_a = ? OR f.user_b = ? ORDER BY u.username",
    )
    .bind(&auth.user_id)
    .bind(&auth.user_id)
    .bind(&auth.user_id)
    .fetch_all(&state.db)
    .await?;
    let (mut friends, mut incoming, mut outgoing) = (vec![], vec![], vec![]);
    for (username, display_name, status, by, accepted_at, created_at) in rows {
        let person = json!({ "username": username, "displayName": display_name, "since": accepted_at.unwrap_or(created_at) });
        match (status.as_str(), by == auth.user_id) {
            ("accepted", _) => friends.push(person),
            (_, true) => outgoing.push(person),
            (_, false) => incoming.push(person),
        }
    }
    Ok(Json(
        json!({ "friends": friends, "incoming": incoming, "outgoing": outgoing }),
    ))
}

/// Asks to be friends (or accepts, if they already asked).
async fn request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(username): Path<String>,
) -> ApiResult<Json<Value>> {
    let other = find_user(&state.db, &username).await?;
    if other.id == auth.user_id {
        return Err(ApiError::BadRequest("That's you".into()));
    }
    match relation(&state.db, &auth.user_id, &other.id).await? {
        "friend" | "requested" => {}
        "incoming" => return accept_from(&state, &auth.user_id, &other).await,
        _ => {
            let (x, y) = pair(&auth.user_id, &other.id);
            let now = timestamp(state.clock.now());
            sqlx::query("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)")
                .bind(x)
                .bind(y)
                .bind(&auth.user_id)
                .bind(&now)
                .execute(&state.db)
                .await?;
            let requester = me(&state.db, &auth.user_id).await?;
            notify(
                &state,
                &other.id,
                Notice {
                    kind: "friend-request".into(),
                    title: name_of(&requester),
                    body: format!(
                        "{} (@{}) wants to be friends. Accept in Social → Friends.",
                        name_of(&requester),
                        requester.username
                    ),
                    url: None,
                    dedupe: format!("friend-request:{}:{}:{now}", auth.user_id, other.id),
                    data: json!({ "from": requester.username }),
                },
                &[Channel::Push],
            )
            .await?;
        }
    }
    Ok(Json(
        json!({ "relation": relation(&state.db, &auth.user_id, &other.id).await? }),
    ))
}

async fn accept(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(username): Path<String>,
) -> ApiResult<Json<Value>> {
    let other = find_user(&state.db, &username).await?;
    if relation(&state.db, &auth.user_id, &other.id).await? != "incoming" {
        return Err(ApiError::NotFound("There's no request from them".into()));
    }
    accept_from(&state, &auth.user_id, &other).await
}

async fn accept_from(state: &AppState, me_id: &str, other: &Person) -> ApiResult<Json<Value>> {
    let (x, y) = pair(me_id, &other.id);
    let now = timestamp(state.clock.now());
    sqlx::query("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?")
        .bind(&now)
        .bind(x)
        .bind(y)
        .execute(&state.db)
        .await?;
    let accepter = me(&state.db, me_id).await?;
    notify(
        state,
        &other.id,
        Notice {
            kind: "friend-accepted".into(),
            title: name_of(&accepter),
            body: format!(
                "{} (@{}) accepted your friend request.",
                name_of(&accepter),
                accepter.username
            ),
            url: None,
            dedupe: format!("friend-accepted:{me_id}:{}:{now}", other.id),
            data: json!({ "from": accepter.username }),
        },
        &[Channel::Push],
    )
    .await?;
    Ok(Json(json!({ "relation": "friend" })))
}

/// Unfriends, declines a request, or cancels one.
async fn remove(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(username): Path<String>,
) -> ApiResult<StatusCode> {
    let other = find_user(&state.db, &username).await?;
    let (x, y) = pair(&auth.user_id, &other.id);
    sqlx::query("DELETE FROM friendships WHERE user_a = ? AND user_b = ?")
        .bind(x)
        .bind(y)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
