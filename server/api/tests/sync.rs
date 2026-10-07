mod common;

use axum::http::StatusCode;
use chrono::TimeDelta;
use common::TestApp;
use serde_json::{Value, json};

const PASSWORD: &str = "correct horse battery";

fn task(id: &str, name: &str, updated_at: &str) -> Value {
    json!({
        "id": id, "name": name, "type": "accumulate", "createdAt": "2026-10-01T00:00:00.000Z",
        "updatedAt": updated_at, "description": "", "icon": "circle", "color": "#000", "unit": "",
        "dueTime": null, "sortOrder": 0, "incrementAmounts": [1], "displayMode": "period",
        "retiredAt": null, "createdFromId": null, "categoryIds": []
    })
}

fn event(id: &str, task_id: &str, updated_at: &str) -> Value {
    json!({
        "id": id, "taskId": task_id, "amount": 1, "occurredAt": updated_at, "localDate": "2026-10-06",
        "localTime": "08:30", "timeZone": "America/Denver", "note": "", "createdAt": updated_at,
        "updatedAt": updated_at, "deletedAt": null
    })
}

async fn sync(app: &TestApp, token: &str, body: Value) -> Value {
    let (status, res) = app.post("/sync", Some(token), body).await;
    assert_eq!(status, StatusCode::OK, "{res}");
    res
}

fn names(res: &Value) -> Vec<String> {
    res["changes"]["tasks"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|t| t["name"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn changes_from_one_device_reach_another() {
    let app = TestApp::new().await;
    let phone = app.register("blake", PASSWORD).await;
    let laptop = phone.clone();

    let res = sync(
        &app,
        &phone,
        json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Run", "2026-10-06T10:00:00.000Z")],
                "events": [event("e1", "t1", "2026-10-06T10:00:01.000Z")] } }),
    )
    .await;
    let phone_cursor = res["cursor"].as_i64().unwrap();
    assert_eq!(phone_cursor, 2, "two writes");

    // The other device, starting fresh, gets both rows.
    let res = sync(&app, &laptop, json!({ "cursor": 0 })).await;
    assert_eq!(names(&res), ["Run"]);
    assert_eq!(res["changes"]["events"][0]["id"], "e1");
    assert_eq!(res["more"], false);

    // Nothing new after that.
    let res = sync(&app, &laptop, json!({ "cursor": res["cursor"] })).await;
    assert!(res["changes"].as_object().unwrap().is_empty());
}

#[tokio::test]
async fn the_newer_edit_wins() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Run", "2026-10-06T10:00:00.000Z")] } })).await;

    // An older edit (e.g. from a device that was offline) loses.
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Old name", "2026-10-06T09:00:00.000Z")] } })).await;
    assert_eq!(
        names(&sync(&app, &token, json!({ "cursor": 0 })).await),
        ["Run"]
    );

    // A newer one wins.
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Run 5k", "2026-10-06T11:00:00.000Z")] } })).await;
    assert_eq!(
        names(&sync(&app, &token, json!({ "cursor": 0 })).await),
        ["Run 5k"]
    );
}

#[tokio::test]
async fn deletes_beat_older_versions_and_drop_the_data() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Secret", "2026-10-06T10:00:00.000Z")] } })).await;
    sync(
        &app,
        &token,
        json!({ "cursor": 0, "deletes": [{ "table": "tasks", "id": "t1", "deletedAt": "2026-10-06T11:00:00.000Z" }] }),
    )
    .await;

    // A stale copy from another device can't bring it back.
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Secret", "2026-10-06T10:30:00.000Z")] } })).await;
    let res = sync(&app, &token, json!({ "cursor": 0 })).await;
    assert!(names(&res).is_empty());
    assert_eq!(
        res["deletes"],
        json!([{ "table": "tasks", "id": "t1", "deletedAt": "2026-10-06T11:00:00.000Z" }])
    );
    assert!(
        !res.to_string().contains("Secret"),
        "deleted content isn't kept or returned"
    );

    // A deliberate later edit (e.g. a merge import) can.
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Back", "2026-10-06T12:00:00.000Z")] } })).await;
    assert_eq!(
        names(&sync(&app, &token, json!({ "cursor": 0 })).await),
        ["Back"]
    );
}

#[tokio::test]
async fn accounts_never_see_each_others_data() {
    let app = TestApp::new().await;
    let blake = app.register("blake", PASSWORD).await;
    let sam = app.register("sam", PASSWORD).await;
    sync(&app, &blake, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Blake's", "2026-10-06T10:00:00.000Z")] } })).await;
    // Same id from another account is a separate row.
    sync(&app, &sam, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Sam's", "2026-10-06T10:00:00.000Z")] } })).await;

    assert_eq!(
        names(&sync(&app, &blake, json!({ "cursor": 0 })).await),
        ["Blake's"]
    );
    assert_eq!(
        names(&sync(&app, &sam, json!({ "cursor": 0 })).await),
        ["Sam's"]
    );
}

#[tokio::test]
async fn bad_requests_change_nothing() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    let good = task("t1", "Run", "2026-10-06T10:00:00.000Z");
    for (body, why) in [
        (
            json!({ "cursor": 0, "changes": { "passwords": [good.clone()] } }),
            "unknown table",
        ),
        (
            json!({ "cursor": 0, "changes": { "tasks": [good.clone(), { "name": "no id", "updatedAt": "2026-10-06T10:00:00Z" }] } }),
            "missing id",
        ),
        (
            json!({ "cursor": 0, "changes": { "tasks": [good.clone(), { "id": "t2", "updatedAt": "yesterday" }] } }),
            "bad timestamp",
        ),
        (
            json!({ "cursor": 0, "changes": { "tasks": [good.clone(), { "id": "t2", "updatedAt": "2026-10-06T10:00:00Z", "type": "nonsense" }] } }),
            "invalid task",
        ),
        (
            json!({ "cursor": 0, "timeZone": "Mars/Base", "changes": { "tasks": [good.clone()] } }),
            "bad zone",
        ),
    ] {
        let (status, _) = app.post("/sync", Some(&token), body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{why}");
    }
    let res = sync(&app, &token, json!({ "cursor": 0 })).await;
    assert!(
        names(&res).is_empty(),
        "the valid row in a rejected request wasn't saved"
    );
    assert_eq!(res["cursor"], 0);

    let (status, _) = app.post("/sync", None, json!({ "cursor": 0 })).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_device_clock_far_in_the_future_cant_win_forever() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    // Server time is 2026-10-06 12:00 UTC; this device thinks it's 2027.
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "From the future", "2027-01-01T00:00:00.000Z")] } })).await;
    let res = sync(&app, &token, json!({ "cursor": 0 })).await;
    assert_eq!(
        res["changes"]["tasks"][0]["updatedAt"], "2026-10-06T12:00:00.000Z",
        "capped at server time"
    );

    app.clock.advance(TimeDelta::minutes(1));
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Fixed", "2026-10-06T12:01:00.000Z")] } })).await;
    assert_eq!(
        names(&sync(&app, &token, json!({ "cursor": 0 })).await),
        ["Fixed"]
    );
}

#[tokio::test]
async fn large_histories_come_in_pages() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    let events: Vec<Value> = (0..2500)
        .map(|i| event(&format!("e{i:05}"), "t1", "2026-10-06T10:00:00.000Z"))
        .collect();
    sync(
        &app,
        &token,
        json!({ "cursor": 0, "changes": { "events": events } }),
    )
    .await;

    let mut cursor = 0;
    let mut seen = 0;
    let mut pages = 0;
    loop {
        let res = sync(&app, &token, json!({ "cursor": cursor })).await;
        seen += res["changes"]["events"].as_array().map_or(0, Vec::len);
        cursor = res["cursor"].as_i64().unwrap();
        pages += 1;
        if res["more"] == false {
            break;
        }
    }
    assert_eq!((seen, pages, cursor), (2500, 3, 2500));
}

#[tokio::test]
async fn a_device_ahead_of_the_server_starts_over() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    sync(&app, &token, json!({ "cursor": 0, "changes": { "tasks": [task("t1", "Run", "2026-10-06T10:00:00.000Z")] } })).await;
    // E.g. the server was restored from an older backup.
    let res = sync(&app, &token, json!({ "cursor": 999 })).await;
    assert_eq!(res["reset"], true);
    assert_eq!(names(&res), ["Run"]);
}

#[tokio::test]
async fn sync_records_the_devices_time_zone() {
    let app = TestApp::new().await;
    let token = app.register("blake", PASSWORD).await;
    sync(
        &app,
        &token,
        json!({ "cursor": 0, "timeZone": "America/Los_Angeles" }),
    )
    .await;
    let (_, me) = app.get("/me", Some(&token)).await;
    assert_eq!(me["timeZone"], "America/Los_Angeles");
}
