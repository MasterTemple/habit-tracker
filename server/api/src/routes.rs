//! HTTP handlers. Request and response bodies are camelCase JSON, like the app's data.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header::USER_AGENT};
use axum::response::IntoResponse;
use axum::{
    Json, Router,
    routing::{get, post},
};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::AppState;
use crate::auth::{
    AuthUser, check_password_strength, create_session, hash_password, normalize_username,
    verify_password,
};
use crate::clock::timestamp;
use crate::error::{ApiError, ApiResult};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/me", get(me).patch(update_me).delete(delete_account))
        .route("/me/password", post(change_password))
        .route("/me/email/test", post(send_test_email))
}

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub time_zone: String,
    /// For email reminders, reports, and backups ("" = none).
    pub email: String,
    pub created_at: String,
    /// Whether this server can send email.
    #[sqlx(skip)]
    pub email_enabled: bool,
}

#[derive(Serialize)]
pub struct SessionResponse {
    token: String,
    user: User,
}

async fn load_user(state: &AppState, id: &str) -> ApiResult<User> {
    let mut user: User = sqlx::query_as(
        "SELECT id, username, display_name, time_zone, email, created_at FROM users WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::Unauthorized)?;
    user.email_enabled = state.mailer.is_some();
    Ok(user)
}

fn user_agent(headers: &HeaderMap) -> String {
    headers
        .get(USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

fn validate_time_zone(tz: &str) -> ApiResult<()> {
    if tz.is_empty() || tz.parse::<Tz>().is_ok() {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!("Unknown time zone {tz:?}")))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterRequest {
    username: String,
    password: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    time_zone: String,
    #[serde(default)]
    signup_code: Option<String>,
}

async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RegisterRequest>,
) -> ApiResult<(StatusCode, Json<SessionResponse>)> {
    if let Some(code) = &state.config.signup_code
        && req.signup_code.as_deref() != Some(code.as_str())
    {
        return Err(ApiError::Forbidden(
            "A sign-up code is needed to create an account here".into(),
        ));
    }
    let username = normalize_username(&req.username)?;
    check_password_strength(&req.password)?;
    validate_time_zone(&req.time_zone)?;

    let id = uuid::Uuid::now_v7().to_string();
    let hash = hash_password(req.password).await?;
    let inserted = sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, time_zone, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (username) DO NOTHING",
    )
    .bind(&id)
    .bind(&username)
    .bind(&hash)
    .bind(req.display_name.trim())
    .bind(&req.time_zone)
    .bind(timestamp(state.clock.now()))
    .execute(&state.db)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError::Conflict("That username is taken".into()));
    }

    let token = create_session(&state, &id, &user_agent(&headers)).await?;
    Ok((
        StatusCode::CREATED,
        Json(SessionResponse {
            token,
            user: load_user(&state, &id).await?,
        }),
    ))
}

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Json<SessionResponse>> {
    // Malformed usernames can't exist; treat them like unknown ones.
    let username = normalize_username(&req.username).unwrap_or_default();
    let now = state.clock.now();
    state.limiter.check(&username, now)?;

    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = ?")
            .bind(&username)
            .fetch_optional(&state.db)
            .await?;
    let (id, hash) = row.map_or((None, None), |(id, hash)| (Some(id), Some(hash)));
    if !verify_password(req.password, hash).await? {
        state.limiter.record_failure(&username, now);
        return Err(ApiError::BadCredentials);
    }
    state.limiter.clear(&username);

    let id = id.expect("verified users exist");
    let token = create_session(&state, &id, &user_agent(&headers)).await?;
    Ok(Json(SessionResponse {
        token,
        user: load_user(&state, &id).await?,
    }))
}

async fn logout(State(state): State<AppState>, auth: AuthUser) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(&auth.token_hash)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn me(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<User>> {
    Ok(Json(load_user(&state, &auth.user_id).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMe {
    display_name: Option<String>,
    /// The device's current IANA zone; deadlines and reminders follow it.
    time_zone: Option<String>,
    /// "" to remove.
    email: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UpdateMe>,
) -> ApiResult<Json<User>> {
    if let Some(tz) = &req.time_zone {
        validate_time_zone(tz)?;
    }
    let email = req.email.as_deref().map(str::trim);
    if email.is_some_and(|e| !e.is_empty() && !crate::email::looks_like_email(e)) {
        return Err(ApiError::BadRequest(
            "That doesn't look like an email address".into(),
        ));
    }
    sqlx::query(
        "UPDATE users SET display_name = COALESCE(?, display_name), time_zone = COALESCE(?, time_zone),
           email = COALESCE(?, email) WHERE id = ?",
    )
    .bind(req.display_name.as_deref().map(str::trim))
    .bind(req.time_zone.as_deref())
    .bind(email)
    .bind(&auth.user_id)
    .execute(&state.db)
    .await?;
    Ok(Json(load_user(&state, &auth.user_id).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePassword {
    current_password: String,
    new_password: String,
}

/// Changes the password and signs out every other session.
async fn change_password(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ChangePassword>,
) -> ApiResult<StatusCode> {
    let now = state.clock.now();
    state.limiter.check(&auth.user_id, now)?;
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
        .bind(&auth.user_id)
        .fetch_one(&state.db)
        .await?;
    if !verify_password(req.current_password, Some(hash)).await? {
        state.limiter.record_failure(&auth.user_id, now);
        return Err(ApiError::BadCredentials);
    }
    check_password_strength(&req.new_password)?;
    let new_hash = hash_password(req.new_password).await?;

    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(&new_hash)
        .bind(&auth.user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
        .bind(&auth.user_id)
        .bind(&auth.token_hash)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Sends a test email to the account's address right away (to check the server's SMTP settings).
async fn send_test_email(State(state): State<AppState>, auth: AuthUser) -> ApiResult<StatusCode> {
    let Some(mailer) = &state.mailer else {
        return Err(ApiError::Conflict(
            "Email isn't set up on this server (SMTP_URL)".into(),
        ));
    };
    let to = crate::email::user_email(&state, &auth.user_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Add your email address first".into()))?;
    let text = "Email from your Habit Tracker server is working. Reports, backups, and email reminders will come from this address.";
    let job = crate::email::EmailJob {
        to,
        subject: "Habit Tracker: test email".into(),
        html: Some(crate::email::html_from_text(text)),
        text: text.into(),
        attachments: vec![],
    };
    mailer
        .send(&job)
        .await
        .map_err(|e| ApiError::BadRequest(format!("Sending failed: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct DeleteAccount {
    password: String,
}

/// Permanently deletes the account and everything the server has for it: synced data,
/// sessions, devices, inbox, deliveries, friendships, and the alert rules others see.
async fn delete_account(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<DeleteAccount>,
) -> ApiResult<StatusCode> {
    let now = state.clock.now();
    state.limiter.check(&auth.user_id, now)?;
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
        .bind(&auth.user_id)
        .fetch_one(&state.db)
        .await?;
    if !verify_password(req.password, Some(hash)).await? {
        state.limiter.record_failure(&auth.user_id, now);
        return Err(ApiError::BadCredentials);
    }
    // Every table references users with ON DELETE CASCADE; friendships too.
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&auth.user_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
