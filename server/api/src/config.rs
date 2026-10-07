use std::env;

/// Server settings, from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// `BIND`, default `127.0.0.1:8080`.
    pub bind: String,
    /// `DATABASE_URL`, default `sqlite://habits.db` (created if missing).
    pub database_url: String,
    /// `ALLOWED_ORIGINS`, comma-separated web app origins allowed to call the API.
    pub allowed_origins: Vec<String>,
    /// `SIGNUP_CODE`: when set, new accounts must provide it (the server is public).
    pub signup_code: Option<String>,
    /// Sessions expire after this many days without use.
    pub session_days: i64,
}

impl Config {
    pub fn from_env() -> Self {
        let var = |name: &str| env::var(name).ok().filter(|v| !v.trim().is_empty());
        Self {
            bind: var("BIND").unwrap_or_else(|| "127.0.0.1:8080".into()),
            database_url: var("DATABASE_URL").unwrap_or_else(|| "sqlite://habits.db".into()),
            allowed_origins: var("ALLOWED_ORIGINS")
                .unwrap_or_else(|| "https://mastertemple.github.io,https://localhost:5173".into())
                .split(',')
                .map(|o| o.trim().trim_end_matches('/').to_string())
                .filter(|o| !o.is_empty())
                .collect(),
            signup_code: var("SIGNUP_CODE"),
            session_days: var("SESSION_DAYS")
                .and_then(|d| d.parse().ok())
                .unwrap_or(90),
        }
    }

    /// Defaults for tests: open sign-up, local origins only.
    pub fn for_tests() -> Self {
        Self {
            bind: "127.0.0.1:0".into(),
            database_url: "sqlite::memory:".into(),
            allowed_origins: vec!["https://localhost:5173".into()],
            signup_code: None,
            session_days: 90,
        }
    }
}
