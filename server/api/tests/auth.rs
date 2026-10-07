mod common;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use chrono::TimeDelta;
use common::TestApp;
use habit_api::config::Config;
use serde_json::json;
use tower::ServiceExt;

const PASSWORD: &str = "correct horse battery";

#[tokio::test]
async fn health() {
    let app = TestApp::new().await;
    let (status, body) = app.get("/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn register_then_use_the_session() {
    let app = TestApp::new().await;
    let (status, body) = app
        .post(
            "/auth/register",
            None,
            json!({ "username": "  Blake ", "password": PASSWORD, "displayName": "Blake", "timeZone": "America/Denver" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        body["user"]["username"], "blake",
        "usernames are normalized to lowercase"
    );
    assert_eq!(body["user"]["timeZone"], "America/Denver");
    assert!(
        body["user"].get("passwordHash").is_none(),
        "never leak the hash"
    );

    let token = body["token"].as_str().unwrap();
    let (status, me) = app.get("/me", Some(token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["displayName"], "Blake");
}

#[tokio::test]
async fn rejects_bad_usernames_short_passwords_and_duplicates() {
    let app = TestApp::new().await;
    for username in ["ab", "has space", "émoji", &"x".repeat(33)] {
        let (status, _) = app
            .post(
                "/auth/register",
                None,
                json!({ "username": username, "password": PASSWORD }),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "username {username:?}");
    }
    let (status, body) = app
        .post(
            "/auth/register",
            None,
            json!({ "username": "blake", "password": "H4b1t" }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["message"].as_str().unwrap().contains("at least 10"));

    app.register("blake", PASSWORD).await;
    let (status, _) = app
        .post(
            "/auth/register",
            None,
            json!({ "username": "BLAKE", "password": PASSWORD }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "usernames are unique regardless of case"
    );

    let (status, _) = app
        .post(
            "/auth/register",
            None,
            json!({ "username": "sam", "password": PASSWORD, "timeZone": "Mars/Base" }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn sign_up_code_is_required_when_configured() {
    let app = TestApp::with_config(Config {
        signup_code: Some("friends-only".into()),
        ..Config::for_tests()
    })
    .await;
    let (status, _) = app
        .post(
            "/auth/register",
            None,
            json!({ "username": "sam", "password": PASSWORD }),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .post(
            "/auth/register",
            None,
            json!({ "username": "sam", "password": PASSWORD, "signupCode": "wrong" }),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .post(
            "/auth/register",
            None,
            json!({ "username": "sam", "password": PASSWORD, "signupCode": "friends-only" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn login_does_not_reveal_which_usernames_exist() {
    let app = TestApp::new().await;
    app.register("blake", PASSWORD).await;

    let (status, body) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "Blake", "password": PASSWORD }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["token"].as_str().is_some());

    let (wrong_status, wrong) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "blake", "password": "nope nope nope" }),
        )
        .await;
    let (unknown_status, unknown) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "nobody", "password": "nope nope nope" }),
        )
        .await;
    assert_eq!(wrong_status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        (wrong_status, &wrong),
        (unknown_status, &unknown),
        "same response for both"
    );
}

#[tokio::test]
async fn logout_ends_only_that_session() {
    let app = TestApp::new().await;
    let phone = app.register("blake", PASSWORD).await;
    let (_, body) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "blake", "password": PASSWORD }),
        )
        .await;
    let laptop = body["token"].as_str().unwrap().to_string();

    let (status, _) = app
        .call(Method::POST, "/auth/logout", Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        app.get("/me", Some(&phone)).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(app.get("/me", Some(&laptop)).await.0, StatusCode::OK);
}

#[tokio::test]
async fn sessions_expire_unless_used() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;

    // Used every 60 days, it keeps renewing.
    for _ in 0..3 {
        app.clock.advance(TimeDelta::days(60));
        assert_eq!(app.get("/me", Some(&token)).await.0, StatusCode::OK);
    }
    // Left alone for 91 days, it expires.
    app.clock.advance(TimeDelta::days(91));
    assert_eq!(
        app.get("/me", Some(&token)).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn rejects_missing_and_forged_tokens() {
    let app = TestApp::new().await;
    app.register("blake", PASSWORD).await;
    assert_eq!(app.get("/me", None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(
        app.get("/me", Some("not-a-real-token")).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn repeated_failures_lock_the_username_for_a_while() {
    let app = TestApp::new().await;
    app.register("blake", PASSWORD).await;
    for _ in 0..10 {
        let (status, _) = app
            .post(
                "/auth/login",
                None,
                json!({ "username": "blake", "password": "guess guess guess" }),
            )
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    // Locked, even with the right password.
    let (status, _) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "blake", "password": PASSWORD }),
        )
        .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);

    app.clock.advance(TimeDelta::minutes(16));
    let (status, _) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "blake", "password": PASSWORD }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn update_profile_and_time_zone() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    let (status, me) = app
        .call(
            Method::PATCH,
            "/me",
            Some(&token),
            Some(json!({ "displayName": " Blake S ", "timeZone": "Asia/Tokyo" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["displayName"], "Blake S");
    assert_eq!(me["timeZone"], "Asia/Tokyo");

    let (status, _) = app
        .call(
            Method::PATCH,
            "/me",
            Some(&token),
            Some(json!({ "timeZone": "Not/AZone" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Omitted fields stay as they were.
    let (_, me) = app
        .call(Method::PATCH, "/me", Some(&token), Some(json!({})))
        .await;
    assert_eq!(me["timeZone"], "Asia/Tokyo");
}

#[tokio::test]
async fn changing_the_password_signs_out_other_sessions() {
    let app = TestApp::new().await;
    let phone = app.register("blake", PASSWORD).await;
    let (_, body) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "blake", "password": PASSWORD }),
        )
        .await;
    let laptop = body["token"].as_str().unwrap().to_string();

    let (status, _) = app
        .post("/me/password", Some(&phone), json!({ "currentPassword": "wrong wrong wrong", "newPassword": "a brand new passphrase" }))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, _) = app
        .post(
            "/me/password",
            Some(&phone),
            json!({ "currentPassword": PASSWORD, "newPassword": "a brand new passphrase" }),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        app.get("/me", Some(&phone)).await.0,
        StatusCode::OK,
        "this session stays"
    );
    assert_eq!(
        app.get("/me", Some(&laptop)).await.0,
        StatusCode::UNAUTHORIZED,
        "others are signed out"
    );

    let (status, _) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "blake", "password": PASSWORD }),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .post(
            "/auth/login",
            None,
            json!({ "username": "blake", "password": "a brand new passphrase" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn cors_allows_only_the_app() {
    let app = TestApp::new().await;
    let preflight = |origin: &'static str| {
        Request::builder()
            .method(Method::OPTIONS)
            .uri("/me")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization")
            .body(Body::empty())
            .unwrap()
    };
    let allowed = app
        .router
        .clone()
        .oneshot(preflight("https://localhost:5173"))
        .await
        .unwrap();
    assert_eq!(
        allowed.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "https://localhost:5173"
    );
    let other = app
        .router
        .clone()
        .oneshot(preflight("https://evil.example"))
        .await
        .unwrap();
    assert!(
        other
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );
}
