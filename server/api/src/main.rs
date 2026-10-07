use std::sync::Arc;

use habit_api::clock::SystemClock;
use habit_api::config::Config;
use habit_api::{AppState, app, connect};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env();
    let db = connect(&config.database_url).await?;
    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!(
        bind = %config.bind,
        origins = ?config.allowed_origins,
        signup_code = config.signup_code.is_some(),
        "listening"
    );

    let state = AppState::new(db, Arc::new(SystemClock), config).await?;
    habit_api::scheduler::spawn(state.clone());
    axum::serve(listener, app(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
