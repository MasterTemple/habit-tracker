//! The habit tracker's sync server. `app()` builds the HTTP service from an [`AppState`];
//! `main.rs` wires it to real config, a database file, and the system clock.

pub mod auth;
pub mod clock;
pub mod config;
pub mod error;
pub mod routes;

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
}

impl AppState {
    pub fn new(db: SqlitePool, clock: Arc<dyn Clock>, config: Config) -> Self {
        Self {
            db,
            clock,
            config: Arc::new(config),
            limiter: Arc::default(),
        }
    }
}

/// Opens (creating if needed) the database and applies migrations.
pub async fn connect(url: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
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
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
