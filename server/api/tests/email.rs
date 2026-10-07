mod common;

use axum::http::{Method, StatusCode};
use base64::Engine;
use chrono::{TimeZone, Utc};
use common::TestApp;
use habit_api::email::{EmailJob, MemoryMailer};
use habit_api::{outbox, scheduler};
use serde_json::{Value, json};

const PASSWORD: &str = "correct horse battery";
const T0: &str = "2026-10-01T00:00:00.000Z";

fn task() -> Value {
    json!({ "id": "pullups", "name": "Pull-ups", "type": "accumulate", "unit": "rep", "createdAt": T0, "updatedAt": T0,
            "categoryIds": ["exercise"] })
}

fn target() -> Value {
    json!({ "id": "target-pullups", "taskId": "pullups", "period": "day", "amount": 100, "carryOver": false,
            "effectiveFrom": "2026-09-01", "updatedAt": T0 })
}

fn entry(id: &str, amount: f64, local_date: &str) -> Value {
    json!({ "id": id, "taskId": "pullups", "amount": amount, "occurredAt": T0, "localDate": local_date, "localTime": "07:00",
            "timeZone": "America/Denver", "note": "", "createdAt": T0, "updatedAt": T0, "deletedAt": null })
}

const ALL: &str = r#"{ "appliesToAll": true, "taskIds": [], "categoryIds": [] }"#;

/// A Denver user with an email address, Pull-ups, and the given automations/shares/contacts.
async fn setup(extra: Value) -> (TestApp, String, MemoryMailer) {
    let (app, mailbox) = TestApp::with_mailer().await;
    let token = app.register("blake", PASSWORD).await;
    let (status, _) = app
        .call(
            Method::PATCH,
            "/me",
            Some(&token),
            Some(json!({ "email": "blake@example.com" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let mut changes = json!({ "tasks": [task()], "targets": [target()] });
    changes
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (status, body) = app
        .post(
            "/sync",
            Some(&token),
            json!({ "cursor": 0, "timeZone": "America/Denver", "changes": changes }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    scheduler::tick(&app.state).await.unwrap(); // first look at 06:00 Denver
    (app, token, mailbox)
}

async fn at(app: &TestApp, y: i32, mo: u32, d: u32, h: u32, mi: u32) {
    let target = Utc.with_ymd_and_hms(y, mo, d, h, mi, 30).unwrap();
    app.clock.advance(target - app.clock_now());
    scheduler::tick(&app.state).await.unwrap();
    outbox::process_due(&app.state).await;
}

fn sent(mailbox: &MemoryMailer) -> Vec<EmailJob> {
    mailbox.0.lock().unwrap().clone()
}

#[tokio::test]
async fn account_email_is_validated() {
    let (app, _) = TestApp::with_mailer().await;
    let token = app.register("blake", PASSWORD).await;
    let (status, me) = app
        .call(
            Method::PATCH,
            "/me",
            Some(&token),
            Some(json!({ "email": " blake@example.com " })),
        )
        .await;
    assert_eq!(
        (status, me["email"].clone(), me["emailEnabled"].clone()),
        (StatusCode::OK, json!("blake@example.com"), json!(true))
    );
    for bad in ["nope", "a@b", "two words@example.com"] {
        assert_eq!(
            app.call(
                Method::PATCH,
                "/me",
                Some(&token),
                Some(json!({ "email": bad }))
            )
            .await
            .0,
            StatusCode::BAD_REQUEST,
            "{bad}"
        );
    }
    let (_, me) = app
        .call(
            Method::PATCH,
            "/me",
            Some(&token),
            Some(json!({ "email": "" })),
        )
        .await;
    assert_eq!(me["email"], "");
    // Without SMTP settings the server says email is off.
    let plain = TestApp::new().await;
    let t = plain.register("sam", PASSWORD).await;
    assert_eq!(plain.get("/me", Some(&t)).await.1["emailEnabled"], false);
}

#[tokio::test]
async fn reminders_can_be_emailed() {
    let reminder: Value = serde_json::from_str(&format!(
        r#"{{ "id": "r1", "kind": "reminder", "name": "Workout nudge", "enabled": true, "scope": {ALL},
             "schedule": {{ "repeat": "daily", "time": "18:00", "weekdays": [], "monthDay": 1 }},
             "message": "", "onlyIfIncomplete": true, "channels": ["email"], "updatedAt": "{T0}", "deletedAt": null }}"#
    ))
    .unwrap();
    let (app, _, mailbox) = setup(json!({ "automations": [reminder] })).await;
    at(&app, 2026, 10, 7, 0, 0).await; // 18:00 Oct 6 Denver
    let mail = sent(&mailbox);
    assert_eq!(mail.len(), 1);
    assert_eq!(
        (mail[0].to.as_str(), mail[0].subject.as_str()),
        ("blake@example.com", "Workout nudge")
    );
    assert_eq!(mail[0].text, "Still to do: Pull-ups (100 left)");
}

#[tokio::test]
async fn weekly_reports_go_to_the_chosen_people() {
    let report: Value = serde_json::from_str(&format!(
        r#"{{ "id": "rep1", "kind": "report", "name": "Weekly", "enabled": true, "scope": {ALL},
             "schedule": {{ "repeat": "weekly", "time": "18:00", "weekdays": [6], "monthDay": 1 }},
             "period": "week", "contactIds": ["c-coach"], "emails": ["me@example.com"], "updatedAt": "{T0}", "deletedAt": null }}"#
    ))
    .unwrap();
    let coach = json!({ "id": "c-coach", "name": "Coach", "email": "coach@example.com", "updatedAt": T0, "deletedAt": null });
    let entries: Vec<Value> = ["2026-10-04", "2026-10-05", "2026-10-07", "2026-10-09"]
        .iter()
        .enumerate()
        .map(|(i, d)| entry(&format!("e{i}"), if i == 2 { 40.0 } else { 100.0 }, d))
        .collect();
    let (app, _, mailbox) =
        setup(json!({ "automations": [report], "contacts": [coach], "events": entries })).await;
    at(&app, 2026, 10, 10, 23, 59).await; // Sat 17:59 Denver: not yet
    assert!(sent(&mailbox).is_empty());
    at(&app, 2026, 10, 11, 0, 0).await; // Sat 18:00 Denver
    let mail = sent(&mailbox);
    let mut to: Vec<&str> = mail.iter().map(|m| m.to.as_str()).collect();
    to.sort();
    assert_eq!(to, ["coach@example.com", "me@example.com"]);
    assert_eq!(mail[0].subject, "@blake's weekly report (Oct 4 – Oct 10)");
    // Oct 4–9 decided (today Oct 10 still open): met on Oct 4, 5, 9; not 6, 7, 8.
    assert!(
        mail[0]
            .text
            .contains("• Pull-ups — met 3 of 6 days · 340 reps"),
        "{}",
        mail[0].text
    );
}

#[tokio::test]
async fn backups_arrive_as_importable_attachments() {
    let backup: Value = serde_json::from_str(&format!(
        r#"{{ "id": "b1", "kind": "export", "name": "", "enabled": true, "scope": {ALL},
             "schedule": {{ "repeat": "daily", "time": "23:00", "weekdays": [], "monthDay": 1 }},
             "period": "week", "contactIds": [], "emails": [], "updatedAt": "{T0}", "deletedAt": null }}"#
    ))
    .unwrap();
    let (app, _, mailbox) =
        setup(json!({ "automations": [backup], "events": [entry("e1", 10.0, "2026-10-06")] }))
            .await;
    at(&app, 2026, 10, 7, 5, 0).await; // 23:00 Denver
    let mail = sent(&mailbox);
    assert_eq!(
        mail.len(),
        1,
        "to the account's own address when none are listed"
    );
    assert_eq!(mail[0].to, "blake@example.com");
    let file = &mail[0].attachments[0];
    assert_eq!(file.filename, "habit-tracker-2026-10-06.json");
    let export: Value = serde_json::from_slice(
        &base64::engine::general_purpose::STANDARD
            .decode(&file.data)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        (export["app"].as_str(), export["version"].as_i64()),
        (Some("habit-tracker"), Some(6))
    );
    assert_eq!(export["tasks"][0]["name"], "Pull-ups");
    assert_eq!(export["events"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn accountability_alerts_can_email_people_without_accounts() {
    let rule: Value = serde_json::from_str(&format!(
        r#"{{ "id": "rule1", "kind": "notify", "name": "", "enabled": true, "scope": {ALL}, "contactIds": ["c-mom"],
             "events": ["entry"], "channels": ["email"], "webhookUrl": "", "updatedAt": "{T0}", "deletedAt": null }}"#
    ))
    .unwrap();
    let mom = json!({ "id": "c-mom", "name": "Mom", "email": "mom@example.com", "updatedAt": T0, "deletedAt": null });
    let (app, token, mailbox) = setup(json!({ "shares": [rule], "contacts": [mom] })).await;
    scheduler::tick(&app.state).await.unwrap(); // the alert engine's first look
    let now = habit_api::clock::timestamp(app.clock_now());
    let mut e = entry("e1", 25.0, "2026-10-06");
    e["createdAt"] = json!(now);
    e["updatedAt"] = json!(now);
    app.post(
        "/sync",
        Some(&token),
        json!({ "cursor": 0, "changes": { "events": [e] } }),
    )
    .await;
    at(&app, 2026, 10, 6, 12, 2).await;
    let mail = sent(&mailbox);
    assert_eq!(mail.len(), 1, "{mail:?}");
    assert_eq!(
        (mail[0].to.as_str(), mail[0].subject.as_str()),
        (
            "mom@example.com",
            "@blake made progress on Pull-ups: +25 rep"
        )
    );
    assert!(
        mail[0]
            .text
            .contains("added you to an accountability alert")
    );
}

#[tokio::test]
async fn nothing_is_queued_for_email_when_it_isnt_set_up() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    app.call(
        Method::PATCH,
        "/me",
        Some(&token),
        Some(json!({ "email": "blake@example.com" })),
    )
    .await;
    let reminder: Value = serde_json::from_str(&format!(
        r#"{{ "id": "r1", "kind": "reminder", "name": "", "enabled": true, "scope": {ALL},
             "schedule": {{ "repeat": "daily", "time": "18:00", "weekdays": [], "monthDay": 1 }},
             "message": "", "onlyIfIncomplete": false, "channels": ["email"], "updatedAt": "{T0}", "deletedAt": null }}"#
    ))
    .unwrap();
    app.post("/sync", Some(&token), json!({ "cursor": 0, "timeZone": "America/Denver", "changes": { "automations": [reminder] } })).await;
    scheduler::tick(&app.state).await.unwrap();
    at(&app, 2026, 10, 7, 0, 0).await;
    let queued: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM outbox WHERE channel = 'email'")
        .fetch_one(&app.state.db)
        .await
        .unwrap();
    assert_eq!(queued, 0);
}
