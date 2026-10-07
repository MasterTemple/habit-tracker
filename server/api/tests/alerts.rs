mod common;

use std::net::IpAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use chrono::{TimeDelta, TimeZone, Utc};
use common::TestApp;
use habit_api::config::Config;
use habit_api::webhooks::is_public;
use habit_api::{outbox, scheduler};
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;

const PASSWORD: &str = "correct horse battery";
const T0: &str = "2026-10-01T00:00:00.000Z";

type Received = Arc<Mutex<Vec<(HeaderMap, Value)>>>;

/// A local server that records webhook deliveries.
async fn receiver() -> (Received, String) {
    let received: Received = Arc::default();
    let app = Router::new()
        .route(
            "/hook",
            post(|State(r): State<Received>, headers: HeaderMap, body: axum::body::Bytes| async move {
                r.lock().unwrap().push((headers, serde_json::from_slice(&body).unwrap()));
                StatusCode::NO_CONTENT
            }),
        )
        .with_state(received.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/hook", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (received, url)
}

fn task(id: &str, name: &str, kind: &str, extra: Value) -> Value {
    let mut t = json!({ "id": id, "name": name, "type": kind, "unit": "", "createdAt": T0, "updatedAt": T0,
                        "categoryIds": [], "dueTime": null });
    t.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    t
}

fn target(task_id: &str, period: &str, amount: f64) -> Value {
    json!({ "id": format!("target-{task_id}"), "taskId": task_id, "period": period, "amount": amount,
            "carryOver": false, "effectiveFrom": "2026-09-01", "updatedAt": T0 })
}

/// An entry recorded "now" (by the fake clock), on Denver's wall clock.
fn entry(
    app: &TestApp,
    id: &str,
    task_id: &str,
    amount: f64,
    local_date: &str,
    local_time: &str,
) -> Value {
    let now = habit_api::clock::timestamp(app.clock_now());
    json!({ "id": id, "taskId": task_id, "amount": amount, "occurredAt": now, "localDate": local_date,
            "localTime": local_time, "timeZone": "America/Denver", "note": "", "createdAt": now, "updatedAt": now,
            "deletedAt": null })
}

/// The alert rule, stamped `minutes` after the fake clock's start (later edits must be newer).
fn notify_rule(enabled: bool, minutes: i64) -> Value {
    let updated = Utc.with_ymd_and_hms(2026, 10, 6, 12, 0, 0).unwrap()
        + TimeDelta::minutes(minutes)
        - TimeDelta::hours(1);
    json!({ "id": "rule1", "kind": "notify", "name": "", "enabled": enabled,
            "scope": { "appliesToAll": true, "taskIds": [], "categoryIds": [] },
            "contactIds": ["c-sam"], "events": ["entry", "completed", "failed", "deadline_missed", "streak_broken"],
            "channels": ["push"], "webhookUrl": "", "updatedAt": habit_api::clock::timestamp(updated), "deletedAt": null })
}

struct Setup {
    app: TestApp,
    blake: String,
    sam: String,
    hooks: Received,
}

/// Blake (Denver) has three tasks, an alert rule telling Sam, and an outgoing webhook.
/// The clock starts at 2026-10-06 06:00 Denver, and one scheduler pass has looked around.
/// Makes the two users friends (alerts only reach friends).
async fn befriend(app: &TestApp, a: &str, b: &str, b_username: &str, a_username: &str) {
    let (status, _) = app
        .post(
            &format!("/friends/{b_username}/request"),
            Some(a),
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = app
        .post(&format!("/friends/{a_username}/accept"), Some(b), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn setup() -> Setup {
    let app = TestApp::new().await;
    let blake = app.register("blake", PASSWORD).await;
    let sam = app.register("sam", PASSWORD).await;
    befriend(&app, &blake, &sam, "sam", "blake").await;
    let (hooks, url) = receiver().await;
    let (status, body) = app
        .post(
            "/sync",
            Some(&blake),
            json!({ "cursor": 0, "timeZone": "America/Denver", "changes": {
                "tasks": [
                    task("pullups", "Pull-ups", "accumulate", json!({ "unit": "rep" })),
                    task("icecream", "Ice cream", "limit", json!({})),
                    task("proverb", "Daily Proverb", "accumulate", json!({ "dueTime": "09:00" })),
                ],
                "targets": [target("pullups", "day", 100.0), target("icecream", "week", 3.0), target("proverb", "day", 1.0)],
                "contacts": [{ "id": "c-sam", "name": "Sam", "username": "Sam", "updatedAt": T0, "deletedAt": null }],
                "shares": [notify_rule(true, 0)],
                "automations": [{ "id": "wh1", "kind": "webhook_out", "name": "", "enabled": true, "url": url,
                                  "events": ["entry", "completed"], "secret": "s3cret",
                                  "scope": { "appliesToAll": true, "taskIds": [], "categoryIds": [] },
                                  "updatedAt": T0, "deletedAt": null }]
            } }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let s = Setup {
        app,
        blake,
        sam,
        hooks,
    };
    tick(&s).await;
    s
}

async fn tick(s: &Setup) {
    scheduler::tick(&s.app.state).await.unwrap();
    outbox::process_due(&s.app.state).await;
}

async fn advance(s: &Setup, by: TimeDelta) {
    s.app.clock.advance(by);
    tick(s).await;
}

async fn sync(s: &Setup, changes: Value) {
    let (status, body) = s
        .app
        .post(
            "/sync",
            Some(&s.blake),
            json!({ "cursor": 0, "changes": changes }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

/// Sam's inbox, oldest first.
async fn sams_inbox(s: &Setup) -> Vec<String> {
    let (_, inbox) = s.app.get("/inbox", Some(&s.sam)).await;
    let mut items: Vec<String> = inbox["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| !i["kind"].as_str().unwrap().starts_with("friend"))
        .map(|i| i["body"].as_str().unwrap().to_string())
        .collect();
    items.reverse();
    items
}

#[tokio::test]
async fn recipients_hear_when_an_alert_starts_and_can_see_it() {
    let s = setup().await;
    assert_eq!(
        sams_inbox(&s).await,
        [
            "@blake will tell you when they make progress, complete a goal, miss a goal or go over a limit, miss a deadline, break a streak (all their tasks)"
        ]
    );
    let (_, incoming) = s.app.get("/alerts/incoming", Some(&s.sam)).await;
    assert_eq!(incoming["alerts"][0]["fromUsername"], "blake");
    assert_eq!(incoming["alerts"][0]["enabled"], true);
    // Blake isn't a recipient of his own alert.
    assert_eq!(
        s.app.get("/alerts/incoming", Some(&s.blake)).await.1["alerts"],
        json!([])
    );
}

#[tokio::test]
async fn progress_is_reported_after_a_minute_unless_undone() {
    let s = setup().await;
    let before = sams_inbox(&s).await.len();
    sync(
        &s,
        json!({ "events": [entry(&s.app, "e1", "pullups", 10.0, "2026-10-06", "06:00")] }),
    )
    .await;
    tick(&s).await;
    assert_eq!(
        sams_inbox(&s).await.len(),
        before,
        "not within the first minute"
    );

    advance(&s, TimeDelta::seconds(61)).await;
    assert_eq!(
        sams_inbox(&s).await.last().unwrap(),
        "@blake made progress on Pull-ups: +10 rep"
    );

    // The webhook got it too, signed with its secret.
    let (headers, body) = s.hooks.lock().unwrap().last().cloned().unwrap();
    assert_eq!(headers["x-habit-event"], "entry");
    assert_eq!(body["amount"], 10.0);
    assert_eq!(body["task"]["name"], "Pull-ups");
    let mut mac = Hmac::<Sha256>::new_from_slice(b"s3cret").unwrap();
    mac.update(&serde_json::to_vec(&body).unwrap());
    let expected: String = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        headers["x-habit-signature"].to_str().unwrap(),
        format!("sha256={expected}")
    );

    // An entry undone within the minute is never reported.
    let count = sams_inbox(&s).await.len();
    let mut oops = entry(&s.app, "e2", "pullups", 5.0, "2026-10-06", "06:01");
    sync(&s, json!({ "events": [oops.clone()] })).await;
    s.app.clock.advance(TimeDelta::seconds(20));
    oops["deletedAt"] = json!(habit_api::clock::timestamp(s.app.clock_now()));
    oops["updatedAt"] = oops["deletedAt"].clone();
    sync(&s, json!({ "events": [oops] })).await;
    advance(&s, TimeDelta::seconds(120)).await;
    assert_eq!(sams_inbox(&s).await.len(), count);
}

#[tokio::test]
async fn goals_met_limits_exceeded_and_deadlines_missed_are_reported_once() {
    let s = setup().await;
    sync(
        &s,
        json!({ "events": [entry(&s.app, "e1", "pullups", 100.0, "2026-10-06", "06:00")] }),
    )
    .await;
    tick(&s).await;
    assert!(
        sams_inbox(&s)
            .await
            .contains(&"@blake completed Pull-ups (100 / 100 rep)".to_string())
    );
    tick(&s).await;
    assert_eq!(
        sams_inbox(&s)
            .await
            .iter()
            .filter(|m| m.contains("completed"))
            .count(),
        1,
        "once"
    );

    let icecream: Vec<Value> = (0..4)
        .map(|i| {
            entry(
                &s.app,
                &format!("ic{i}"),
                "icecream",
                1.0,
                "2026-10-06",
                "06:00",
            )
        })
        .collect();
    sync(&s, json!({ "events": icecream })).await;
    tick(&s).await;
    assert!(
        sams_inbox(&s)
            .await
            .contains(&"@blake went over the limit on Ice cream (4 / 3)".to_string())
    );

    // Daily Proverb is due at 9:00 Denver (15:00 UTC).
    let at = |h, m| Utc.with_ymd_and_hms(2026, 10, 6, h, m, 0).unwrap();
    advance(&s, at(14, 59) - s.app.clock_now()).await;
    let inbox = sams_inbox(&s).await;
    assert!(
        !inbox.iter().any(|m| m.contains("deadline for")),
        "{inbox:#?}"
    );
    advance(&s, at(15, 1) - s.app.clock_now()).await;
    assert!(
        sams_inbox(&s)
            .await
            .contains(&"@blake missed the 9:00 AM deadline for Daily Proverb".to_string())
    );
}

#[tokio::test]
async fn unmet_goals_and_broken_streaks_are_reported_when_the_day_ends() {
    let app = TestApp::new().await;
    // Proverb done Oct 4 and 5 (a 2-day streak) before the alert is set up.
    let s = {
        let s = Setup {
            blake: app.register("blake", PASSWORD).await,
            sam: app.register("sam", PASSWORD).await,
            hooks: Arc::default(),
            app,
        };
        befriend(&s.app, &s.blake, &s.sam, "sam", "blake").await;
        let done = |id: &str, d: &str| {
            json!({ "id": id, "taskId": "proverb", "amount": 1, "occurredAt": T0, "localDate": d,
                                                "localTime": "08:00", "timeZone": "", "note": "", "createdAt": T0, "updatedAt": T0, "deletedAt": null })
        };
        let (status, _) = s
            .app
            .post("/sync", Some(&s.blake), json!({ "cursor": 0, "timeZone": "America/Denver", "changes": {
                "tasks": [task("proverb", "Daily Proverb", "accumulate", json!({}))], "targets": [target("proverb", "day", 1.0)],
                "events": [done("d4", "2026-10-04"), done("d5", "2026-10-05")],
                "contacts": [{ "id": "c-sam", "name": "Sam", "username": "sam", "updatedAt": T0, "deletedAt": null }],
                "shares": [notify_rule(true, 0)] } }))
            .await;
        assert_eq!(status, StatusCode::OK);
        tick(&s).await; // 06:00 Oct 6: looks around (streak 2, today open)
        s
    };
    // Oct 6 passes without it. 06:00 Oct 7 Denver = 12:00 UTC.
    advance(&s, TimeDelta::days(1)).await;
    let inbox = sams_inbox(&s).await;
    assert!(
        inbox.contains(&"@blake missed Daily Proverb (0 / 1)".to_string()),
        "{inbox:?}"
    );
    assert!(
        inbox.contains(&"@blake's 2-day streak on Daily Proverb ended".to_string()),
        "{inbox:?}"
    );
}

#[tokio::test]
async fn recipients_hear_when_an_alert_is_turned_off_or_deleted() {
    let s = setup().await;
    sync(&s, json!({ "shares": [notify_rule(false, 1)] })).await;
    tick(&s).await;
    assert_eq!(
        sams_inbox(&s).await.last().unwrap(),
        "@blake turned off alerts about all their tasks"
    );
    assert_eq!(
        s.app.get("/alerts/incoming", Some(&s.sam)).await.1["alerts"][0]["enabled"],
        false
    );

    // While off, nothing is reported.
    let count = sams_inbox(&s).await.len();
    sync(
        &s,
        json!({ "events": [entry(&s.app, "e1", "pullups", 100.0, "2026-10-06", "06:00")] }),
    )
    .await;
    advance(&s, TimeDelta::seconds(61)).await;
    assert_eq!(sams_inbox(&s).await.len(), count);

    // Back on, then deleted.
    sync(&s, json!({ "shares": [notify_rule(true, 2)] })).await;
    tick(&s).await;
    assert!(
        sams_inbox(&s)
            .await
            .last()
            .unwrap()
            .starts_with("@blake will tell you")
    );
    s.app.post("/sync", Some(&s.blake), json!({ "cursor": 0, "deletes": [{ "table": "shares", "id": "rule1", "deletedAt": habit_api::clock::timestamp(s.app.clock_now()) }] })).await;
    tick(&s).await;
    assert_eq!(
        sams_inbox(&s).await.last().unwrap(),
        "@blake turned off alerts about all their tasks"
    );
    assert_eq!(
        s.app.get("/alerts/incoming", Some(&s.sam)).await.1["alerts"],
        json!([])
    );
}

#[tokio::test]
async fn incoming_webhooks_record_entries_on_the_owners_clock() {
    let s = setup().await;
    sync(&s, json!({ "automations": [{ "id": "in1", "kind": "webhook_in", "name": "Shortcut", "enabled": true,
                                       "taskId": "pullups", "amount": 5, "token": "tok-123", "updatedAt": T0, "deletedAt": null }] }))
    .await;
    let (status, body) = s.app.post("/hooks/tok-123", None, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["recorded"], 5.0);
    let (status, body) = s
        .app
        .post(
            "/hooks/tok-123",
            None,
            json!({ "amount": 12, "note": "from my watch" }),
        )
        .await;
    assert_eq!(
        (status, body["recorded"].clone()),
        (StatusCode::CREATED, json!(12.0))
    );

    // Blake's devices get both entries, dated on Denver's clock (06:00 Oct 6).
    let (_, pulled) = s
        .app
        .post("/sync", Some(&s.blake), json!({ "cursor": 0 }))
        .await;
    let entries: Vec<&Value> = pulled["changes"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["taskId"] == "pullups")
        .collect();
    assert_eq!(entries.len(), 2);
    assert_eq!(
        (
            entries[0]["localDate"].as_str(),
            entries[0]["localTime"].as_str()
        ),
        (Some("2026-10-06"), Some("06:00"))
    );
    assert_eq!(entries[1]["note"], "from my watch");

    assert_eq!(
        s.app.post("/hooks/nope", None, json!({})).await.0,
        StatusCode::NOT_FOUND
    );
    sync(&s, json!({ "automations": [{ "id": "in1", "kind": "webhook_in", "name": "", "enabled": false, "taskId": "pullups",
                                       "amount": 5, "token": "tok-123", "updatedAt": "2026-10-02T00:00:00.000Z", "deletedAt": null }] }))
    .await;
    assert_eq!(
        s.app.post("/hooks/tok-123", None, json!({})).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn incoming_webhooks_are_rate_limited() {
    let s = setup().await;
    sync(&s, json!({ "automations": [{ "id": "in1", "kind": "webhook_in", "name": "", "enabled": true,
                                       "taskId": "pullups", "amount": 1, "token": "tok-9", "updatedAt": T0, "deletedAt": null }] }))
    .await;
    for _ in 0..30 {
        assert_eq!(
            s.app.post("/hooks/tok-9", None, json!({})).await.0,
            StatusCode::CREATED
        );
    }
    assert_eq!(
        s.app.post("/hooks/tok-9", None, json!({})).await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn outgoing_webhooks_cant_reach_private_addresses() {
    let app = TestApp::with_config(Config {
        allow_private_targets: false,
        ..Config::for_tests()
    })
    .await;
    let blake = app.register("blake", PASSWORD).await;
    let (hooks, url) = receiver().await;
    app.post("/sync", Some(&blake), json!({ "cursor": 0, "changes": {
        "tasks": [task("pullups", "Pull-ups", "accumulate", json!({}))], "targets": [target("pullups", "day", 1.0)],
        "automations": [{ "id": "wh1", "kind": "webhook_out", "enabled": true, "url": url, "events": ["completed"], "secret": "",
                          "scope": { "appliesToAll": true }, "updatedAt": T0, "deletedAt": null }] } }))
    .await;
    scheduler::tick(&app.state).await.unwrap();
    let now = habit_api::clock::timestamp(app.clock_now());
    app.post("/sync", Some(&blake), json!({ "cursor": 0, "changes": { "events": [{ "id": "e1", "taskId": "pullups", "amount": 1,
        "occurredAt": now, "localDate": "2026-10-06", "localTime": "12:00", "timeZone": "", "note": "", "createdAt": now,
        "updatedAt": now, "deletedAt": null }] } }))
    .await;
    scheduler::tick(&app.state).await.unwrap();
    outbox::process_due(&app.state).await;

    assert!(
        hooks.lock().unwrap().is_empty(),
        "nothing reached the local address"
    );
    let (status, error): (String, String) =
        sqlx::query_as("SELECT status, last_error FROM outbox WHERE channel = 'webhook'")
            .fetch_one(&app.state.db)
            .await
            .unwrap();
    assert_eq!(status, "failed");
    assert!(error.contains("public internet"), "{error}");
}

#[test]
fn public_address_check() {
    for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "151.101.1.69"] {
        assert!(is_public(ip.parse::<IpAddr>().unwrap()), "{ip}");
    }
    for ip in [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.3.4",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "255.255.255.255",
        "224.0.0.1",
        "::1",
        "fd00::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
    ] {
        assert!(!is_public(ip.parse::<IpAddr>().unwrap()), "{ip}");
    }
}

#[tokio::test]
async fn alerts_only_reach_friends() {
    let app = TestApp::new().await;
    let blake = app.register("blake", PASSWORD).await;
    let sam = app.register("sam", PASSWORD).await;
    app.post("/sync", Some(&blake), json!({ "cursor": 0, "timeZone": "America/Denver", "changes": {
        "contacts": [{ "id": "c-sam", "name": "Sam", "username": "sam", "updatedAt": T0, "deletedAt": null }],
        "shares": [notify_rule(true, 0)] } }))
    .await;
    scheduler::tick(&app.state).await.unwrap();
    let (_, inbox) = app.get("/inbox", Some(&sam)).await;
    assert_eq!(inbox["items"], json!([]), "not friends: nothing");
    assert_eq!(
        app.get("/alerts/incoming", Some(&sam)).await.1["alerts"],
        json!([])
    );

    befriend(&app, &blake, &sam, "sam", "blake").await;
    scheduler::tick(&app.state).await.unwrap();
    let (_, inbox) = app.get("/inbox", Some(&sam)).await;
    assert!(
        inbox["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["kind"] == "alert-status")
    );
}
