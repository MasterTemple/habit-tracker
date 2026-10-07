mod common;

use std::sync::{Arc, Mutex};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes128Gcm, Nonce};
use axum::Router;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::routing::post;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use chrono::{TimeDelta, TimeZone, Utc};
use common::TestApp;
use habit_api::config::Config;
use habit_api::push::{PushPayload, derive_keys};
use habit_api::{outbox, scheduler};
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use rand_core::{OsRng, RngCore};
use serde_json::{Value, json};

const PASSWORD: &str = "correct horse battery";

/// A browser's push subscription: its private key (to decrypt) and what it gives the server.
struct Device {
    secret: SecretKey,
    auth: [u8; 16],
    endpoint: String,
}

impl Device {
    fn new(endpoint: String) -> Self {
        let mut auth = [0u8; 16];
        OsRng.fill_bytes(&mut auth);
        Self {
            secret: SecretKey::random(&mut OsRng),
            auth,
            endpoint,
        }
    }

    fn subscription(&self) -> Value {
        json!({
            "endpoint": self.endpoint,
            "keys": {
                "p256dh": B64.encode(self.secret.public_key().to_encoded_point(false).as_bytes()),
                "auth": B64.encode(self.auth),
            }
        })
    }

    /// Decrypts a push body exactly as a browser would (RFC 8291).
    fn decrypt(&self, body: &[u8]) -> PushPayload {
        let salt = &body[0..16];
        let id_len = body[20] as usize;
        let as_public_bytes = &body[21..21 + id_len];
        let ciphertext = &body[21 + id_len..];
        let as_public = PublicKey::from_sec1_bytes(as_public_bytes).unwrap();
        let shared =
            p256::ecdh::diffie_hellman(self.secret.to_nonzero_scalar(), as_public.as_affine());
        let ua_public = self.secret.public_key().to_encoded_point(false);
        let (cek, nonce) = derive_keys(
            shared.raw_secret_bytes(),
            &self.auth,
            ua_public.as_bytes(),
            as_public_bytes,
            salt,
        );
        let mut plain = Aes128Gcm::new_from_slice(&cek)
            .unwrap()
            .decrypt(Nonce::from_slice(&nonce), ciphertext)
            .unwrap();
        assert_eq!(plain.pop(), Some(2), "last-record delimiter");
        serde_json::from_slice(&plain).unwrap()
    }
}

/// Requests the fake push service got: (endpoint id, headers, body).
type Received = Arc<Mutex<Vec<(String, HeaderMap, Vec<u8>)>>>;

#[derive(Clone, Default)]
struct PushService {
    received: Received,
    /// Status to answer with, per endpoint path id (default 201).
    answers: Arc<Mutex<std::collections::HashMap<String, u16>>>,
}

/// A local stand-in for a browser push service.
async fn push_service() -> (PushService, String) {
    let service = PushService::default();
    let app = Router::new()
        .route(
            "/push/{id}",
            post(
                |State(s): State<PushService>,
                 Path(id): Path<String>,
                 headers: HeaderMap,
                 body: axum::body::Bytes| async move {
                    s.received
                        .lock()
                        .unwrap()
                        .push((id.clone(), headers, body.to_vec()));
                    StatusCode::from_u16(*s.answers.lock().unwrap().get(&id).unwrap_or(&201))
                        .unwrap()
                },
            ),
        )
        .with_state(service.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (service, base)
}

/// Checks the VAPID header: signed by the server's key, for the endpoint's origin, not expired.
fn assert_valid_vapid(headers: &HeaderMap, server_key: &str, origin: &str) {
    let auth = headers["authorization"].to_str().unwrap();
    let (t, k) = auth
        .strip_prefix("vapid t=")
        .unwrap()
        .split_once(", k=")
        .unwrap();
    assert_eq!(k, server_key);
    let (signed, sig) = t.rsplit_once('.').unwrap();
    let key = VerifyingKey::from_sec1_bytes(&B64.decode(k).unwrap()).unwrap();
    let sig = Signature::from_slice(&B64.decode(sig).unwrap()).unwrap();
    key.verify(signed.as_bytes(), &sig)
        .expect("valid ES256 signature");
    let claims: Value =
        serde_json::from_slice(&B64.decode(signed.split('.').nth(1).unwrap()).unwrap()).unwrap();
    assert_eq!(claims["aud"], origin);
    assert!(claims["exp"].as_i64().unwrap() > Utc::now().timestamp() - 86400 * 365);
    assert_eq!(headers["content-encoding"], "aes128gcm");
}

async fn subscribe(app: &TestApp, token: &str, device: &Device) {
    let (status, body) = app
        .post("/push/subscribe", Some(token), device.subscription())
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn test_notification_reaches_the_device_encrypted_and_signed() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    let (service, base) = push_service().await;
    let phone = Device::new(format!("{base}/push/phone"));
    subscribe(&app, &token, &phone).await;

    let (_, key) = app.get("/push/key", None).await;
    let (status, res) = app.post("/push/test", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{res}");
    assert_eq!(res["devices"], 1);

    let (id, headers, body) = service.received.lock().unwrap()[0].clone();
    assert_eq!(id, "phone");
    assert_valid_vapid(&headers, key["publicKey"].as_str().unwrap(), &base);
    let payload = phone.decrypt(&body);
    assert_eq!(payload.title, "Notifications are working");

    // It's also in the inbox, unread.
    let (_, inbox) = app.get("/inbox", Some(&token)).await;
    assert_eq!(inbox["unread"], 1);
    assert_eq!(inbox["items"][0]["title"], "Notifications are working");
    assert_eq!(
        inbox["items"][0]["id"].as_str(),
        payload.inbox_id.as_deref()
    );
}

#[tokio::test]
async fn only_real_push_services_are_accepted() {
    let app = TestApp::with_config(Config {
        allow_private_targets: false,
        ..Config::for_tests()
    })
    .await;
    let token = app.register("blake", PASSWORD).await;
    for endpoint in [
        "http://127.0.0.1:9/push/x",
        "https://evil.example/push",
        "https://fcm.googleapis.com.evil.example/x",
        "ftp://fcm.googleapis.com/x",
    ] {
        let (status, _) = app
            .post(
                "/push/subscribe",
                Some(&token),
                Device::new(endpoint.into()).subscription(),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{endpoint}");
    }
    for endpoint in [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://web.push.apple.com/QH2xyz",
        "https://updates.push.services.mozilla.com/wpush/v2/x",
    ] {
        let (status, _) = app
            .post(
                "/push/subscribe",
                Some(&token),
                Device::new(endpoint.into()).subscription(),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{endpoint}");
    }
    let mut bad_keys = Device::new("https://fcm.googleapis.com/fcm/send/abc".into()).subscription();
    bad_keys["keys"]["p256dh"] = json!("not-a-key");
    assert_eq!(
        app.post("/push/subscribe", Some(&token), bad_keys).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn unsubscribed_devices_are_dropped_and_failures_retry() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    let (service, base) = push_service().await;
    service.answers.lock().unwrap().insert("old".into(), 410);
    service.answers.lock().unwrap().insert("flaky".into(), 503);
    subscribe(&app, &token, &Device::new(format!("{base}/push/old"))).await;
    subscribe(&app, &token, &Device::new(format!("{base}/push/flaky"))).await;

    app.post("/push/test", Some(&token), json!({})).await;
    let subs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM push_subscriptions")
        .fetch_one(&app.state.db)
        .await
        .unwrap();
    assert_eq!(subs, 1, "the 410 subscription is removed");
    let (attempts, status): (i64, String) =
        sqlx::query_as("SELECT attempts, status FROM outbox WHERE target LIKE '%flaky'")
            .fetch_one(&app.state.db)
            .await
            .unwrap();
    assert_eq!((attempts, status.as_str()), (1, "pending"));

    // Not retried before the backoff…
    assert_eq!(outbox::process_due(&app.state).await, 0);
    // …and delivered once it's due and the service is back.
    service.answers.lock().unwrap().insert("flaky".into(), 201);
    app.clock.advance(TimeDelta::seconds(61));
    assert_eq!(outbox::process_due(&app.state).await, 1);
}

// ---------- reminders ----------

fn task(id: &str, name: &str) -> Value {
    json!({ "id": id, "name": name, "type": "accumulate", "createdAt": "2026-10-01T00:00:00.000Z",
            "updatedAt": "2026-10-01T00:00:00.000Z", "categoryIds": ["exercise"] })
}

fn target(task_id: &str, amount: f64) -> Value {
    json!({ "id": format!("target-{task_id}"), "taskId": task_id, "period": "day", "amount": amount,
            "carryOver": false, "effectiveFrom": "2026-10-01", "updatedAt": "2026-10-01T00:00:00.000Z" })
}

fn entry(id: &str, task_id: &str, amount: f64, local_date: &str) -> Value {
    json!({ "id": id, "taskId": task_id, "amount": amount, "occurredAt": "2026-10-06T20:00:00.000Z",
            "localDate": local_date, "localTime": "14:00", "timeZone": "America/Denver",
            "createdAt": "2026-10-06T20:00:00.000Z", "updatedAt": "2026-10-06T20:00:00.000Z", "deletedAt": null })
}

fn reminder(extra: Value) -> Value {
    let mut r = json!({
        "id": "r1", "kind": "reminder", "name": "Workout nudge", "enabled": true,
        "scope": { "appliesToAll": false, "taskIds": [], "categoryIds": ["exercise"] },
        "schedule": { "repeat": "daily", "time": "18:00", "weekdays": [], "monthDay": 1 },
        "message": "", "onlyIfIncomplete": true, "channels": ["push"],
        "updatedAt": "2026-10-01T00:00:00.000Z", "deletedAt": null
    });
    r.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    r
}

/// A signed-in user in Denver with one task, a reminder, and a phone.
async fn reminder_setup(extra: Value) -> (TestApp, String, PushService) {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    let (status, _) = app
        .post(
            "/sync",
            Some(&token),
            json!({ "cursor": 0, "timeZone": "America/Denver", "changes": {
                "tasks": [task("t1", "Pull-ups")], "targets": [target("t1", 100.0)], "automations": [reminder(extra)] } }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (service, base) = push_service().await;
    subscribe(&app, &token, &Device::new(format!("{base}/push/phone"))).await;
    (app, token, service)
}

/// Sets the fake clock to a UTC time and runs one scheduler pass plus deliveries.
async fn tick_at(app: &TestApp, y: i32, mo: u32, d: u32, h: u32, mi: u32) {
    let target = Utc.with_ymd_and_hms(y, mo, d, h, mi, 30).unwrap();
    app.clock.advance(target - app.clock_now());
    scheduler::tick(&app.state).await.unwrap();
    outbox::process_due(&app.state).await;
}

async fn inbox_titles(app: &TestApp, token: &str) -> Vec<String> {
    let (_, inbox) = app.get("/inbox", Some(token)).await;
    inbox["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            format!(
                "{}: {}",
                i["title"].as_str().unwrap(),
                i["body"].as_str().unwrap()
            )
        })
        .collect()
}

#[tokio::test]
async fn reminders_fire_once_at_the_users_local_time() {
    let (app, token, service) = reminder_setup(json!({})).await;
    // Denver is UTC-6 in October: 18:00 local = 00:00 UTC the next day.
    tick_at(&app, 2026, 10, 6, 12, 0).await; // 06:00 local: first look, starts counting
    tick_at(&app, 2026, 10, 6, 23, 59).await; // 17:59 local
    assert!(inbox_titles(&app, &token).await.is_empty());

    tick_at(&app, 2026, 10, 7, 0, 0).await; // 18:00 local
    assert_eq!(
        inbox_titles(&app, &token).await,
        ["Workout nudge: Still to do: Pull-ups (100 left)"]
    );
    assert_eq!(
        service.received.lock().unwrap().len(),
        1,
        "pushed to the phone"
    );

    tick_at(&app, 2026, 10, 7, 0, 5).await; // later the same evening: no repeat
    assert_eq!(inbox_titles(&app, &token).await.len(), 1);

    tick_at(&app, 2026, 10, 8, 0, 0).await; // the next evening
    assert_eq!(inbox_titles(&app, &token).await.len(), 2);
}

#[tokio::test]
async fn reminders_are_skipped_when_everything_is_done() {
    let (app, token, _) = reminder_setup(json!({})).await;
    tick_at(&app, 2026, 10, 6, 12, 0).await;
    app.post(
        "/sync",
        Some(&token),
        json!({ "cursor": 0, "changes": { "events": [entry("e1", "t1", 100.0, "2026-10-06")] } }),
    )
    .await;
    tick_at(&app, 2026, 10, 7, 0, 0).await; // 18:00 Oct 6 local: goal met
    assert!(inbox_titles(&app, &token).await.is_empty());
    tick_at(&app, 2026, 10, 8, 0, 0).await; // Oct 7: not done yet
    assert_eq!(inbox_titles(&app, &token).await.len(), 1);
}

#[tokio::test]
async fn reminders_follow_the_devices_time_zone() {
    let (app, token, _) = reminder_setup(json!({})).await;
    tick_at(&app, 2026, 10, 6, 12, 0).await;
    // The phone reports it's now in Tokyo (UTC+9): 18:00 there is 09:00 UTC.
    app.post(
        "/sync",
        Some(&token),
        json!({ "cursor": 0, "timeZone": "Asia/Tokyo" }),
    )
    .await;
    tick_at(&app, 2026, 10, 7, 8, 59).await;
    assert!(inbox_titles(&app, &token).await.is_empty());
    tick_at(&app, 2026, 10, 7, 9, 0).await;
    assert_eq!(inbox_titles(&app, &token).await.len(), 1);
}

#[tokio::test]
async fn disabled_and_long_overdue_reminders_stay_quiet() {
    let (app, token, _) = reminder_setup(json!({ "enabled": false })).await;
    tick_at(&app, 2026, 10, 6, 12, 0).await;
    tick_at(&app, 2026, 10, 7, 0, 0).await;
    assert!(inbox_titles(&app, &token).await.is_empty(), "disabled");

    let (app, token, _) = reminder_setup(json!({})).await;
    tick_at(&app, 2026, 10, 6, 12, 0).await;
    // The server was down from before 18:00 until 21:00 local: too late to bother.
    tick_at(&app, 2026, 10, 7, 3, 0).await;
    assert!(inbox_titles(&app, &token).await.is_empty(), "stale");
}

#[tokio::test]
async fn the_inbox_tracks_what_was_read() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    app.post("/push/test", Some(&token), json!({})).await;
    app.clock.advance(TimeDelta::seconds(1));
    app.post("/push/test", Some(&token), json!({})).await;
    let (_, inbox) = app.get("/inbox", Some(&token)).await;
    assert_eq!(inbox["unread"], 2);
    let first = inbox["items"][0]["id"].as_str().unwrap().to_string();

    let (status, _) = app
        .post("/inbox/read", Some(&token), json!({ "ids": [first] }))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(app.get("/inbox", Some(&token)).await.1["unread"], 1);
    app.post("/inbox/read", Some(&token), json!({})).await;
    assert_eq!(app.get("/inbox", Some(&token)).await.1["unread"], 0);

    // Another account sees none of it.
    let other = app.register("sam", PASSWORD).await;
    assert_eq!(
        app.call(Method::GET, "/inbox", Some(&other), None).await.1["items"],
        json!([])
    );
}

/// RFC 8291 Appendix A: the published example, so the key derivation is checked against
/// an independent source rather than only against our own decryption.
#[test]
fn matches_the_rfc_8291_example() {
    let receiver = SecretKey::from_slice(
        &B64.decode("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94")
            .unwrap(),
    )
    .unwrap();
    let receiver_public = B64.decode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4").unwrap();
    assert_eq!(
        receiver.public_key().to_encoded_point(false).as_bytes(),
        receiver_public.as_slice()
    );
    let sender_public = B64.decode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8").unwrap();
    let auth = B64.decode("BTBZMqHH6r4Tts7J_aSIgg").unwrap();
    let salt = B64.decode("DGv6ra1nlYgDCS1FRnbzlw").unwrap();

    let shared = p256::ecdh::diffie_hellman(
        receiver.to_nonzero_scalar(),
        PublicKey::from_sec1_bytes(&sender_public)
            .unwrap()
            .as_affine(),
    );
    let (cek, nonce) = derive_keys(
        shared.raw_secret_bytes(),
        &auth,
        &receiver_public,
        &sender_public,
        &salt,
    );
    assert_eq!(B64.encode(cek), "oIhVW04MRdy2XN9CiKLxTg");
    assert_eq!(B64.encode(nonce), "4h_95klXJ5E_qnoN");

    let body = B64
        .decode("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
        .unwrap();
    let mut plain = Aes128Gcm::new_from_slice(&cek)
        .unwrap()
        .decrypt(Nonce::from_slice(&nonce), &body[86..])
        .unwrap();
    assert_eq!(plain.pop(), Some(2));
    assert_eq!(
        String::from_utf8(plain).unwrap(),
        "When I grow up, I want to be a watermelon"
    );
}
