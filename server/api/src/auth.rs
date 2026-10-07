//! Passwords, session tokens, the signed-in user extractor, and the login limiter.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use argon2::Argon2;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, TimeDelta, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::clock::timestamp;
use crate::error::{ApiError, ApiResult};

pub const MIN_PASSWORD_LEN: usize = 10;
const MAX_PASSWORD_LEN: usize = 256;

/// Lowercased; 3–32 characters of a–z, 0–9, `_`, `.`, `-`.
pub fn normalize_username(raw: &str) -> ApiResult<String> {
    let username = raw.trim().to_lowercase();
    let valid_chars = username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_.-".contains(c));
    if !(3..=32).contains(&username.len()) || !valid_chars {
        return Err(ApiError::BadRequest(
            "Usernames are 3–32 characters: letters, numbers, _ . -".into(),
        ));
    }
    Ok(username)
}

pub fn check_password_strength(password: &str) -> ApiResult<()> {
    let len = password.chars().count();
    if len < MIN_PASSWORD_LEN {
        return Err(ApiError::BadRequest(format!(
            "Passwords need at least {MIN_PASSWORD_LEN} characters (a few words works well)"
        )));
    }
    if len > MAX_PASSWORD_LEN {
        return Err(ApiError::BadRequest("That password is too long".into()));
    }
    Ok(())
}

/// Argon2id hashing is deliberately slow, so it runs off the async threads.
pub async fn hash_password(password: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| ApiError::Internal(e.to_string()))
    })
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
}

/// Verifies against `hash`, or against a dummy hash when the user doesn't exist, so both
/// cases take the same time and usernames can't be discovered by timing.
pub async fn verify_password(password: String, hash: Option<String>) -> ApiResult<bool> {
    static DUMMY: LazyLock<String> = LazyLock::new(|| {
        let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
        Argon2::default()
            .hash_password(b"not a real password", &salt)
            .unwrap()
            .to_string()
    });
    tokio::task::spawn_blocking(move || {
        let exists = hash.is_some();
        let hash = hash.unwrap_or_else(|| DUMMY.clone());
        let parsed = PasswordHash::new(&hash).map_err(|e| ApiError::Internal(e.to_string()))?;
        Ok(exists
            && Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok())
    })
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
}

/// A new random bearer token (256 bits) and the hash that gets stored.
pub fn new_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let hash = token_hash(&token);
    (token, hash)
}

pub fn token_hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Creates a session for `user_id` and returns its bearer token.
pub async fn create_session(
    state: &AppState,
    user_id: &str,
    user_agent: &str,
) -> ApiResult<String> {
    let (token, hash) = new_token();
    let now = state.clock.now();
    let expires = now + TimeDelta::days(state.config.session_days);
    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&hash)
    .bind(user_id)
    .bind(timestamp(now))
    .bind(timestamp(now))
    .bind(timestamp(expires))
    .bind(user_agent.chars().take(200).collect::<String>())
    .execute(&state.db)
    .await?;
    Ok(token)
}

/// The signed-in user, from `Authorization: Bearer <token>`. Using a session extends it
/// (expiry is sliding), refreshed at most hourly to avoid a write per request.
pub struct AuthUser {
    pub user_id: String,
    pub token_hash: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(ApiError::Unauthorized)?;
        let hash = token_hash(token.trim());
        let now = state.clock.now();

        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT user_id, last_used_at, expires_at FROM sessions WHERE token_hash = ?",
        )
        .bind(&hash)
        .fetch_optional(&state.db)
        .await?;
        let (user_id, last_used, expires) = row.ok_or(ApiError::Unauthorized)?;
        if parse_time(&expires)? <= now {
            sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
                .bind(&hash)
                .execute(&state.db)
                .await?;
            return Err(ApiError::Unauthorized);
        }
        if now - parse_time(&last_used)? > TimeDelta::hours(1) {
            sqlx::query(
                "UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?",
            )
            .bind(timestamp(now))
            .bind(timestamp(now + TimeDelta::days(state.config.session_days)))
            .bind(&hash)
            .execute(&state.db)
            .await?;
        }
        Ok(Self {
            user_id,
            token_hash: hash,
        })
    }
}

pub fn parse_time(s: &str) -> ApiResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|e| ApiError::Internal(format!("bad timestamp {s:?}: {e}")))
}

/// Limits failed logins per username: after `MAX_FAILURES` within `WINDOW`, further
/// attempts are refused until the oldest failure ages out. In memory, so a restart resets it.
#[derive(Default)]
pub struct LoginLimiter(Mutex<HashMap<String, Vec<DateTime<Utc>>>>);

const MAX_FAILURES: usize = 10;
const WINDOW: TimeDelta = TimeDelta::minutes(15);

impl LoginLimiter {
    pub fn check(&self, username: &str, now: DateTime<Utc>) -> ApiResult<()> {
        let mut map = self.0.lock().unwrap();
        let failures = map.entry(username.to_string()).or_default();
        failures.retain(|t| now - *t < WINDOW);
        if failures.len() >= MAX_FAILURES {
            Err(ApiError::RateLimited)
        } else {
            Ok(())
        }
    }

    pub fn record_failure(&self, username: &str, now: DateTime<Utc>) {
        self.0
            .lock()
            .unwrap()
            .entry(username.to_string())
            .or_default()
            .push(now);
    }

    pub fn clear(&self, username: &str) {
        self.0.lock().unwrap().remove(username);
    }
}
