//! Test harness: the real app on an in-memory database with a fake clock, called directly
//! (no network).

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use chrono::{DateTime, TimeZone, Utc};
use habit_api::clock::FakeClock;
use habit_api::config::Config;
use habit_api::{AppState, app, connect};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

pub struct TestApp {
    pub router: Router,
    pub clock: Arc<FakeClock>,
}

pub fn start_time() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 6, 12, 0, 0).unwrap()
}

impl TestApp {
    pub async fn new() -> Self {
        Self::with_config(Config::for_tests()).await
    }

    pub async fn with_config(config: Config) -> Self {
        let db = connect("sqlite::memory:").await.expect("database");
        let clock = Arc::new(FakeClock::new(start_time()));
        let router = app(AppState::new(db, clock.clone(), config));
        Self { router, clock }
    }

    /// Sends a request; returns status and parsed JSON (Null for empty bodies).
    pub async fn call(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(t) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let req = match body {
            Some(b) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = self.router.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let json = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        };
        (status, json)
    }

    pub async fn get(&self, path: &str, token: Option<&str>) -> (StatusCode, Value) {
        self.call(Method::GET, path, token, None).await
    }

    pub async fn post(&self, path: &str, token: Option<&str>, body: Value) -> (StatusCode, Value) {
        self.call(Method::POST, path, token, Some(body)).await
    }

    /// Registers a user and returns their token.
    pub async fn register(&self, username: &str, password: &str) -> String {
        let (status, body) = self
            .post(
                "/auth/register",
                None,
                json!({ "username": username, "password": password }),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "register {username}: {body}");
        body["token"].as_str().unwrap().to_string()
    }
}
