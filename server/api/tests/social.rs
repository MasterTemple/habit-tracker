mod common;

use axum::http::{Method, StatusCode};
use common::TestApp;
use serde_json::{Value, json};

const PASSWORD: &str = "correct horse battery";
const T0: &str = "2026-10-01T00:00:00.000Z";

async fn people(app: &TestApp, token: &str, q: &str) -> Vec<(String, String)> {
    let (_, res) = app.get(&format!("/users/search?q={q}"), Some(token)).await;
    res["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["username"].as_str().unwrap().into(),
                p["relation"].as_str().unwrap().into(),
            )
        })
        .collect()
}

#[tokio::test]
async fn search_finds_people_by_username_prefix() {
    let app = TestApp::new().await;
    let blake = app.register("blake", PASSWORD).await;
    app.register("sam", PASSWORD).await;
    app.register("samantha", PASSWORD).await;
    app.register("bob_x", PASSWORD).await;

    assert_eq!(
        people(&app, &blake, "sa").await,
        [
            ("sam".into(), "none".into()),
            ("samantha".into(), "none".into())
        ]
    );
    assert_eq!(
        people(&app, &blake, "@SAM").await.len(),
        2,
        "case and @ don't matter"
    );
    assert!(
        people(&app, &blake, "s").await.is_empty(),
        "at least 2 characters"
    );
    assert!(people(&app, &blake, "bl").await.is_empty(), "not yourself");
    assert!(
        people(&app, &blake, "b_").await.is_empty(),
        "_ is literal, not a wildcard"
    );
    assert_eq!(people(&app, &blake, "bob_").await.len(), 1);
}

#[tokio::test]
async fn friend_requests_need_acceptance() {
    let app = TestApp::new().await;
    let blake = app.register("blake", PASSWORD).await;
    let sam = app.register("sam", PASSWORD).await;

    let (status, res) = app
        .post("/friends/sam/request", Some(&blake), json!({}))
        .await;
    assert_eq!(
        (status, res["relation"].clone()),
        (StatusCode::OK, json!("requested"))
    );
    let (_, mine) = app.get("/friends", Some(&blake)).await;
    assert_eq!(mine["outgoing"][0]["username"], "sam");
    let (_, theirs) = app.get("/friends", Some(&sam)).await;
    assert_eq!(theirs["incoming"][0]["username"], "blake");
    assert_eq!(theirs["friends"], json!([]));
    let (_, inbox) = app.get("/inbox", Some(&sam)).await;
    assert!(
        inbox["items"][0]["body"]
            .as_str()
            .unwrap()
            .contains("wants to be friends")
    );

    // Only the person asked can accept.
    assert_eq!(
        app.post("/friends/sam/accept", Some(&blake), json!({}))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = app
        .post("/friends/blake/accept", Some(&sam), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        app.get("/friends", Some(&blake)).await.1["friends"][0]["username"],
        "sam"
    );
    assert_eq!(
        people(&app, &blake, "sam").await,
        [("sam".into(), "friend".into())]
    );
    let (_, inbox) = app.get("/inbox", Some(&blake)).await;
    assert!(
        inbox["items"][0]["body"]
            .as_str()
            .unwrap()
            .contains("accepted")
    );

    // Either can unfriend.
    assert_eq!(
        app.call(Method::DELETE, "/friends/blake", Some(&sam), None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.get("/friends", Some(&blake)).await.1["friends"],
        json!([])
    );
}

#[tokio::test]
async fn asking_someone_who_already_asked_you_makes_you_friends() {
    let app = TestApp::new().await;
    let blake = app.register("blake", PASSWORD).await;
    let sam = app.register("sam", PASSWORD).await;
    app.post("/friends/sam/request", Some(&blake), json!({}))
        .await;
    let (_, res) = app
        .post("/friends/blake/request", Some(&sam), json!({}))
        .await;
    assert_eq!(res["relation"], "friend");
    assert_eq!(
        app.post("/friends/nobody/request", Some(&sam), json!({}))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.post("/friends/sam/request", Some(&sam), json!({}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

fn task(id: &str, name: &str, categories: &[&str]) -> Value {
    json!({ "id": id, "name": name, "type": "accumulate", "createdAt": T0, "updatedAt": T0, "categoryIds": categories })
}

fn target(task_id: &str) -> Value {
    json!({ "id": format!("target-{task_id}"), "taskId": task_id, "period": "day", "amount": 10, "carryOver": false,
            "effectiveFrom": "2026-09-01", "updatedAt": T0 })
}

fn view_rule(id: &str, extra: Value) -> Value {
    let mut r = json!({ "id": id, "kind": "view", "name": "", "enabled": true,
                        "scope": { "appliesToAll": false, "taskIds": [], "categoryIds": ["exercise"] },
                        "contactIds": ["c-sam"], "anyoneWithLink": false, "token": format!("link-{id}"), "webhookUrl": "",
                        "updatedAt": T0, "deletedAt": null });
    r.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    r
}

/// Blake shares his Exercise tasks with Sam (they aren't friends yet).
async fn sharing_setup(rules: Vec<Value>) -> (TestApp, String, String) {
    let app = TestApp::new().await;
    let blake = app.register("blake", PASSWORD).await;
    let sam = app.register("sam", PASSWORD).await;
    let (status, body) = app
        .post(
            "/sync",
            Some(&blake),
            json!({ "cursor": 0, "timeZone": "America/Denver", "changes": {
                "tasks": [task("pullups", "Pull-ups", &["exercise"]), task("diary", "Private diary", &[])],
                "targets": [target("pullups"), target("diary")],
                "categories": [{ "id": "exercise", "name": "Exercise", "color": "#f00", "icon": "", "sortOrder": 0, "updatedAt": T0, "deletedAt": null },
                               { "id": "secret", "name": "Secret", "color": "#000", "icon": "", "sortOrder": 1, "updatedAt": T0, "deletedAt": null }],
                "events": [
                    { "id": "e1", "taskId": "pullups", "amount": 10, "occurredAt": T0, "localDate": "2026-10-06", "localTime": "07:00",
                      "timeZone": "America/Denver", "note": "felt great after the breakup", "createdAt": T0, "updatedAt": T0, "deletedAt": null },
                    { "id": "e2", "taskId": "diary", "amount": 1, "occurredAt": T0, "localDate": "2026-10-06", "localTime": "07:00",
                      "timeZone": "", "note": "", "createdAt": T0, "updatedAt": T0, "deletedAt": null }],
                "exceptions": [{ "id": "x1", "appliesToAll": true, "taskIds": [], "categoryIds": [], "startDate": "2026-10-10",
                                 "endDate": "2026-10-12", "description": "Hospital stay", "updatedAt": T0, "deletedAt": null }],
                "contacts": [{ "id": "c-sam", "name": "Sam", "username": "sam", "updatedAt": T0, "deletedAt": null }],
                "shares": rules,
            } }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    (app, blake, sam)
}

#[tokio::test]
async fn friends_see_only_what_is_shared_with_them() {
    let (app, blake, sam) = sharing_setup(vec![view_rule("v1", json!({}))]).await;

    // Not friends yet: nothing.
    assert_eq!(app.get("/shared", Some(&sam)).await.1["people"], json!([]));
    assert_eq!(
        app.get("/shared/blake", Some(&sam)).await.0,
        StatusCode::NOT_FOUND
    );

    app.post("/friends/sam/request", Some(&blake), json!({}))
        .await;
    app.post("/friends/blake/accept", Some(&sam), json!({}))
        .await;
    let (_, list) = app.get("/shared", Some(&sam)).await;
    assert_eq!(
        list["people"],
        json!([{ "username": "blake", "displayName": "", "shares": ["Exercise"] }])
    );

    let (status, view) = app.get("/shared/blake", Some(&sam)).await;
    assert_eq!(status, StatusCode::OK, "{view}");
    let names: Vec<&str> = view["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Pull-ups"], "only the shared category");
    assert_eq!(view["events"].as_array().unwrap().len(), 1);
    assert_eq!(view["events"][0]["note"], "", "entry notes stay private");
    assert_eq!(
        view["exceptions"][0]["description"], "",
        "break reasons stay private"
    );
    assert_eq!(view["categories"].as_array().unwrap().len(), 1);
    assert_eq!(view["owner"]["timeZone"], "America/Denver");
    assert!(
        !view.to_string().contains("breakup")
            && !view.to_string().contains("Hospital")
            && !view.to_string().contains("diary")
    );

    // Blake can't see Sam's (Sam shares nothing).
    assert_eq!(
        app.get("/shared/sam", Some(&blake)).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn unlisted_links_work_without_an_account_until_turned_off() {
    let (app, blake, _) = sharing_setup(vec![
        view_rule(
            "public",
            json!({ "anyoneWithLink": true, "contactIds": [] }),
        ),
        view_rule("private", json!({ "anyoneWithLink": false })),
    ])
    .await;
    let (status, view) = app.get("/s/link-public", None).await;
    assert_eq!(status, StatusCode::OK, "{view}");
    assert_eq!(view["tasks"][0]["name"], "Pull-ups");
    assert_eq!(
        app.get("/s/link-private", None).await.0,
        StatusCode::NOT_FOUND,
        "not a link share"
    );
    assert_eq!(
        app.get("/s/no-such-link", None).await.0,
        StatusCode::NOT_FOUND
    );

    app.post("/sync", Some(&blake), json!({ "cursor": 0, "changes": { "shares": [
        view_rule("public", json!({ "anyoneWithLink": true, "contactIds": [], "enabled": false, "updatedAt": "2026-10-02T00:00:00.000Z" }))
    ] } }))
    .await;
    assert_eq!(
        app.get("/s/link-public", None).await.0,
        StatusCode::NOT_FOUND,
        "turned off"
    );
}

#[tokio::test]
async fn friends_hear_when_something_is_shared_with_them() {
    let (app, blake, sam) = sharing_setup(vec![view_rule("v1", json!({}))]).await;
    let shares = |inbox: &Value| -> Vec<String> {
        inbox["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|i| i["kind"] == "share")
            .map(|i| i["body"].as_str().unwrap().to_string())
            .collect()
    };
    let tick = || async { habit_api::scheduler::tick(&app.state).await.unwrap() };

    // Not friends yet: nothing to see, so no notice.
    tick().await;
    assert!(shares(&app.get("/inbox", Some(&sam)).await.1).is_empty());

    app.post("/friends/sam/request", Some(&blake), json!({}))
        .await;
    app.post("/friends/blake/accept", Some(&sam), json!({}))
        .await;
    tick().await;
    tick().await;
    assert_eq!(
        shares(&app.get("/inbox", Some(&sam)).await.1),
        ["@blake shared Exercise with you. See it in Social → Friends."],
        "once"
    );

    // Off and on again: told again.
    let toggle = |enabled: bool, at: &str| json!({ "cursor": 0, "changes": { "shares": [view_rule("v1", json!({ "enabled": enabled, "updatedAt": at }))] } });
    app.post(
        "/sync",
        Some(&blake),
        toggle(false, "2026-10-02T00:00:00.000Z"),
    )
    .await;
    tick().await;
    app.clock.advance(chrono::TimeDelta::seconds(1));
    app.post(
        "/sync",
        Some(&blake),
        toggle(true, "2026-10-03T00:00:00.000Z"),
    )
    .await;
    tick().await;
    assert_eq!(shares(&app.get("/inbox", Some(&sam)).await.1).len(), 2);
}
