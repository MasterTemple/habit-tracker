//! The habit tracker's sync server. `app()` builds the HTTP service from an [`AppState`];
//! `main.rs` wires it to real config, a database file, and the system clock.

pub mod alerts;
pub mod auth;
pub mod clock;
pub mod config;
pub mod error;
pub mod friends;
pub mod notifications;
pub mod outbox;
pub mod push;
pub mod routes;
pub mod scheduler;
pub mod shares;
pub mod sync;
pub mod userdata;
pub mod webhooks;

use std::str::FromStr;
use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

use crate::auth::LoginLimiter;
use crate::clock::Clock;
use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub clock: Arc<dyn Clock>,
    pub config: Arc<Config>,
    pub limiter: Arc<LoginLimiter>,
    pub vapid: Arc<push::Vapid>,
    pub hook_limiter: Arc<webhooks::HookLimiter>,
    /// For push services and webhooks: short timeouts, no redirects.
    pub http: reqwest::Client,
}

impl AppState {
    pub async fn new(
        db: SqlitePool,
        clock: Arc<dyn Clock>,
        config: Config,
    ) -> Result<Self, sqlx::Error> {
        let vapid = push::Vapid::load_or_create(&db, &config.vapid_subject).await?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("habit-tracker/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Ok(Self {
            db,
            clock,
            config: Arc::new(config),
            limiter: Arc::default(),
            vapid: Arc::new(vapid),
            hook_limiter: Arc::default(),
            http,
        })
    }
}

/// Opens (creating if needed) the database and applies migrations.
pub async fn connect(url: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        // Concurrent syncs wait for the single SQLite writer instead of failing.
        .busy_timeout(std::time::Duration::from_secs(10));
    // An in-memory database exists per connection, so tests use exactly one.
    let max = if url.contains(":memory:") { 1 } else { 8 };
    let pool = SqlitePoolOptions::new()
        .max_connections(max)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

pub fn app(state: AppState) -> Router {
    let origins: Vec<HeaderValue> = state
        .config
        .allowed_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    routes::router()
        .merge(sync::router())
        .merge(push::router())
        .merge(notifications::router())
        .merge(webhooks::router())
        .merge(alerts::router())
        .merge(friends::router())
        .merge(shares::router())
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
