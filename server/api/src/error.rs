use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// API errors, returned as `{ "error": "<code>", "message": "<for people>" }`.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    /// Missing, expired, or revoked session.
    #[error("Please sign in")]
    Unauthorized,
    /// Same message for unknown usernames and wrong passwords, so accounts can't be probed.
    #[error("Wrong username or password")]
    BadCredentials,
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Too many attempts. Try again in a few minutes.")]
    RateLimited,
    #[error("Something went wrong")]
    Internal(String),
}

impl ApiError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::BadCredentials => (StatusCode::UNAUTHORIZED, "bad_credentials"),
            Self::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
            Self::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            Self::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            Self::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let Self::Internal(detail) = &self {
            // Logged for us; never sent to the client.
            tracing::error!(%detail, "internal error");
        }
        let (status, code) = self.status_and_code();
        (
            status,
            Json(json!({ "error": code, "message": self.to_string() })),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
