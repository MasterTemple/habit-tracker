//! Accountability alerts and outgoing webhooks: notice what happened to a user's tasks
//! (progress, goals met or missed, deadlines, streaks) and tell whoever their rules say.
//!
//! Each event fires once: per-task records in `job_state` remember what was already
//! reported this period, and deliveries are deduplicated by event. Turning an alert rule
//! on or off (or deleting it) also tells its recipients, who can list the alerts about them.

use std::collections::BTreeSet;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use chrono::{NaiveDate, TimeDelta};
use habit_core::status::{DeadlineState, PeriodState, PeriodStatus, period_status, streak};
use habit_core::types::{Period, Task, TaskEvent, TaskType};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::AuthUser;
use crate::clock::timestamp;
use crate::error::ApiResult;
use crate::notifications::{Channel, Notice, notify};
use crate::outbox;
use crate::scheduler::{get_state, set_state};
use crate::userdata::{self, LocalNow, Scope, UserData};
use crate::webhooks::WebhookJob;

/// Entries are reported this long after the server receives them (an undo in that
/// window means they're never reported).
pub const ENTRY_DELAY: TimeDelta = TimeDelta::seconds(60);
/// Entries recorded longer ago than this (e.g. a merged backup) aren't reported.
const ENTRY_MAX_AGE: TimeDelta = TimeDelta::hours(24);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutgoingRule {
    id: String,
    enabled: bool,
    scope: Scope,
    url: String,
    #[serde(default)]
    events: Vec<String>,
    #[serde(default)]
    secret: String,
    #[serde(default)]
    deleted_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotifyRule {
    id: String,
    #[serde(default)]
    name: String,
    enabled: bool,
    scope: Scope,
    #[serde(default)]
    contact_ids: Vec<String>,
    #[serde(default)]
    events: Vec<String>,
    #[serde(default)]
    channels: Vec<String>,
    #[serde(default)]
    webhook_url: String,
    #[serde(default)]
    deleted_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contact {
    id: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    deleted_at: Option<String>,
}

enum Trigger<'a> {
    Entry {
        task: &'a Task,
        event: TaskEvent,
    },
    Completed {
        task: &'a Task,
        status: PeriodStatus,
    },
    Failed {
        task: &'a Task,
        status: PeriodStatus,
    },
    DeadlineMissed {
        task: &'a Task,
        status: PeriodStatus,
    },
    StreakBroken {
        task: &'a Task,
        previous: u32,
        period: Period,
    },
}

impl Trigger<'_> {
    fn kind(&self) -> &'static str {
        match self {
            Self::Entry { .. } => "entry",
            Self::Completed { .. } => "completed",
            Self::Failed { .. } => "failed",
            Self::DeadlineMissed { .. } => "deadline_missed",
            Self::StreakBroken { .. } => "streak_broken",
        }
    }

    fn task(&self) -> &Task {
        match self {
            Self::Entry { task, .. }
            | Self::Completed { task, .. }
            | Self::Failed { task, .. }
            | Self::DeadlineMissed { task, .. }
            | Self::StreakBroken { task, .. } => task,
        }
    }

    /// Identifies the event, so it's delivered once per rule and recipient.
    fn key(&self, today: NaiveDate) -> String {
        let task = &self.task().id;
        match self {
            Self::Entry { event, .. } => format!("entry:{}", event.id),
            Self::Completed { status, .. }
            | Self::Failed { status, .. }
            | Self::DeadlineMissed { status, .. } => {
                format!("{}:{task}:{}", self.kind(), status.range.start)
            }
            Self::StreakBroken { .. } => format!("streak_broken:{task}:{today}"),
        }
    }

    fn status(&self) -> Option<&PeriodStatus> {
        match self {
            Self::Completed { status, .. }
            | Self::Failed { status, .. }
            | Self::DeadlineMissed { status, .. } => Some(status),
            _ => None,
        }
    }

    /// One sentence for a person, e.g. "Blake completed Pull-ups (100 / 100 reps)".
    fn sentence(&self, actor: &str) -> String {
        let task = self.task();
        let name = &task.name;
        match self {
            Self::Entry { event, .. } => format!(
                "{actor} made progress on {name}: +{}",
                quantity(event.amount, &task.unit)
            ),
            Self::Completed { status, .. } => format!(
                "{actor} completed {name} ({})",
                fraction(status, &task.unit)
            ),
            Self::Failed { status, .. } if task.kind == TaskType::Limit => {
                format!(
                    "{actor} went over the limit on {name} ({})",
                    fraction(status, &task.unit)
                )
            }
            Self::Failed { status, .. } => {
                format!("{actor} missed {name} ({})", fraction(status, &task.unit))
            }
            Self::DeadlineMissed { status, .. } => {
                let time = status
                    .deadline
                    .as_ref()
                    .map(|d| habit_core::schedule::format_time(&d.time))
                    .unwrap_or_default();
                format!("{actor} missed the {time} deadline for {name}")
            }
            Self::StreakBroken {
                previous, period, ..
            } => {
                let unit = match period {
                    Period::Day => "day",
                    Period::Week => "week",
                    Period::Month => "month",
                };
                format!("{actor}'s {previous}-{unit} streak on {name} ended")
            }
        }
    }

    fn webhook_body(&self, data: &UserData, now: chrono::DateTime<chrono::Utc>) -> Value {
        let task = self.task();
        let mut body = json!({
            "event": self.kind(),
            "at": timestamp(now),
            "user": { "username": data.username, "displayName": data.display_name },
            "task": { "id": task.id, "name": task.name, "type": task.kind, "unit": task.unit },
        });
        let obj = body.as_object_mut().expect("object");
        if let Some(status) = self.status() {
            obj.insert(
                "period".into(),
                json!({ "start": status.range.start, "end": status.range.end }),
            );
            obj.insert("actual".into(), json!(status.actual));
            obj.insert("goal".into(), json!(status.goal));
        }
        match self {
            Self::Entry { event, .. } => {
                obj.insert("amount".into(), json!(event.amount));
                obj.insert("entry".into(), json!({ "id": event.id, "localDate": event.local_date, "localTime": event.local_time }));
            }
            Self::StreakBroken { previous, .. } => {
                obj.insert("previousStreak".into(), json!(previous));
            }
            _ => {}
        }
        body
    }
}

fn number(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{n:.0}")
    } else {
        format!("{n}")
    }
}

fn quantity(n: f64, unit: &str) -> String {
    if unit.is_empty() {
        number(n)
    } else {
        format!("{} {unit}", number(n))
    }
}

fn fraction(status: &PeriodStatus, unit: &str) -> String {
    let goal = status.goal.unwrap_or(0.0);
    let base = format!("{} / {}", number(status.actual), number(goal));
    if unit.is_empty() {
        base
    } else {
        format!("{base} {unit}")
    }
}

/// What the app shows for the period `date` is in, and the task's current streak.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskRecord {
    period_start: NaiveDate,
    completed: bool,
    failed: bool,
    deadline: bool,
    streak: u32,
}

/// What a recipient sees about an alert rule (kept even after it's deleted, to say so).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleSnapshot {
    pub enabled: bool,
    pub recipients: Vec<String>,
    pub from_username: String,
    pub from_name: String,
    pub what: String,
    pub events: Vec<String>,
    pub updated_at: String,
}

/// Users with alert rules (or rules that existed before, to report their removal).
pub async fn users_with_rules(state: &AppState) -> ApiResult<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM sync_rows WHERE deleted = 0 AND (
           (tbl = 'automations' AND json_extract(data, '$.kind') = 'webhook_out') OR
           (tbl = 'shares' AND json_extract(data, '$.kind') = 'notify'))
         UNION SELECT DISTINCT user_id FROM job_state WHERE key LIKE 'alerts:rule:%'",
    )
    .fetch_all(&state.db)
    .await?)
}

fn parse<T: for<'de> Deserialize<'de>>(rows: &[Value], kind: &str) -> Vec<T> {
    rows.iter()
        .filter(|r| r.get("kind").and_then(Value::as_str) == Some(kind))
        .filter_map(|r| serde_json::from_value(r.clone()).ok())
        .collect()
}

/// Account ids of a rule's recipients: its contacts who have accounts here and are
/// accepted friends (so knowing a username isn't enough to send someone alerts).
async fn recipients(
    state: &AppState,
    owner: &str,
    data: &UserData,
    contact_ids: &[String],
) -> ApiResult<Vec<String>> {
    let contacts: Vec<Contact> = data
        .contacts
        .iter()
        .filter_map(|c| serde_json::from_value(c.clone()).ok())
        .collect();
    let mut ids = BTreeSet::new();
    for contact in contacts
        .iter()
        .filter(|c| c.deleted_at.is_none() && contact_ids.contains(&c.id))
    {
        let username = contact
            .username
            .trim()
            .trim_start_matches('@')
            .to_lowercase();
        if username.is_empty() {
            continue;
        }
        let id: Option<String> = sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
            .bind(&username)
            .fetch_optional(&state.db)
            .await?;
        if let Some(id) = id
            && crate::friends::are_friends(&state.db, owner, &id).await?
        {
            ids.insert(id);
        }
    }
    Ok(ids.into_iter().collect())
}

/// "Exercise, Pull-ups" or "all their tasks".
fn describe_scope(data: &UserData, scope: &Scope) -> String {
    if scope.applies_to_all {
        return "all their tasks".into();
    }
    let categories = data.categories.iter().filter(|c| {
        c.get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| scope.category_ids.iter().any(|s| s == id))
    });
    let names: Vec<String> = categories
        .filter_map(|c| c.get("name").and_then(Value::as_str).map(str::to_string))
        .chain(
            data.tasks
                .iter()
                .filter(|t| scope.task_ids.contains(&t.id))
                .map(|t| t.name.clone()),
        )
        .collect();
    if names.is_empty() {
        "some of their tasks".into()
    } else {
        names.join(", ")
    }
}

/// One pass for one user: rule changes, entries, and task events.
pub async fn check_user(state: &AppState, user_id: &str) -> ApiResult<()> {
    let data = userdata::load(&state.db, user_id).await?;
    let now = state.clock.now();
    let local = data.local_now(now);
    let webhooks: Vec<OutgoingRule> = parse::<OutgoingRule>(&data.automations, "webhook_out")
        .into_iter()
        .filter(|r| r.deleted_at.is_none())
        .collect();
    let rules: Vec<NotifyRule> = parse::<NotifyRule>(&data.shares, "notify")
        .into_iter()
        .filter(|r| r.deleted_at.is_none())
        .collect();

    announce_rule_changes(state, user_id, &data, &rules).await?;

    let mut triggers = entry_triggers(state, user_id, &data).await?;
    triggers.extend(task_triggers(state, user_id, &data, &local).await?);

    let actor = data.actor();
    for trigger in &triggers {
        let task = trigger.task();
        let key = trigger.key(local.today);
        let body = trigger.webhook_body(&data, now);
        for rule in webhooks.iter().filter(|r| {
            r.enabled && r.events.iter().any(|e| e == trigger.kind()) && r.scope.covers(task)
        }) {
            let job = WebhookJob {
                url: rule.url.clone(),
                event: trigger.kind().into(),
                body: body.clone(),
                secret: Some(rule.secret.clone()),
            };
            outbox::enqueue(
                state,
                user_id,
                "webhook",
                &rule.url,
                &job,
                &format!("wh:{}:{key}", rule.id),
            )
            .await?;
        }
        for rule in rules.iter().filter(|r| {
            r.enabled && r.events.iter().any(|e| e == trigger.kind()) && r.scope.covers(task)
        }) {
            let channels: Vec<Channel> = if rule.channels.iter().any(|c| c == "push") {
                vec![Channel::Push]
            } else {
                vec![]
            };
            for recipient in recipients(state, user_id, &data, &rule.contact_ids).await? {
                notify(
                    state,
                    &recipient,
                    Notice {
                        kind: "alert".into(),
                        title: actor.clone(),
                        body: trigger.sentence(&actor),
                        url: None,
                        dedupe: format!("alert:{}:{key}:{recipient}", rule.id),
                        data: json!({ "from": data.username, "event": trigger.kind(), "task": task.name, "rule": rule.name }),
                    },
                    &channels,
                )
                .await?;
            }
            if rule.channels.iter().any(|c| c == "email") {
                let sentence = trigger.sentence(&actor);
                let text = format!(
                    "{sentence}\n\n—\nYou're getting this because {actor} added you to an accountability alert in Habit Tracker. Ask them to remove you to stop."
                );
                let contacts: Vec<Contact> = data
                    .contacts
                    .iter()
                    .filter_map(|c| serde_json::from_value(c.clone()).ok())
                    .collect();
                for contact in contacts
                    .iter()
                    .filter(|c| c.deleted_at.is_none() && rule.contact_ids.contains(&c.id))
                {
                    let job = crate::email::EmailJob {
                        to: contact.email.trim().to_string(),
                        subject: sentence.clone(),
                        html: Some(crate::email::html_from_text(&text)),
                        text: text.clone(),
                        attachments: vec![],
                    };
                    crate::email::queue(
                        state,
                        user_id,
                        job,
                        &format!("alert-email:{}:{key}:{}", rule.id, contact.id),
                    )
                    .await?;
                }
            }
            if !rule.webhook_url.trim().is_empty() {
                let job = WebhookJob {
                    url: rule.webhook_url.clone(),
                    event: trigger.kind().into(),
                    body: body.clone(),
                    secret: None,
                };
                outbox::enqueue(
                    state,
                    user_id,
                    "webhook",
                    &rule.webhook_url,
                    &job,
                    &format!("nw:{}:{key}", rule.id),
                )
                .await?;
            }
        }
    }
    Ok(())
}

/// New entries, at least a minute after the server got them (in order received).
async fn entry_triggers<'a>(
    state: &AppState,
    user_id: &str,
    data: &'a UserData,
) -> ApiResult<Vec<Trigger<'a>>> {
    let now = state.clock.now();
    let marker_key = "alerts:entries_seq";
    let Some(marker) = get_state(state, user_id, marker_key)
        .await?
        .and_then(|v| v.parse::<i64>().ok())
    else {
        // First look: start from now, so existing history isn't reported.
        let latest: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(seq), 0) FROM sync_rows WHERE user_id = ? AND tbl = 'events'",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        set_state(state, user_id, marker_key, &latest.to_string()).await?;
        return Ok(vec![]);
    };
    let rows: Vec<(i64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT seq, data, received_at FROM sync_rows WHERE user_id = ? AND tbl = 'events' AND seq > ? ORDER BY seq LIMIT 500",
    )
    .bind(user_id)
    .bind(marker)
    .fetch_all(&state.db)
    .await?;

    let mut triggers = Vec::new();
    let mut last = marker;
    for (seq, row, received_at) in rows {
        let received = received_at
            .as_deref()
            .and_then(|r| crate::auth::parse_time(r).ok())
            .unwrap_or(now);
        if now - received < ENTRY_DELAY {
            break; // not yet: keep the undo window open
        }
        last = seq;
        let Some(event) = row.and_then(|r| serde_json::from_str::<TaskEvent>(&r).ok()) else {
            continue;
        };
        let recent =
            crate::auth::parse_time(&event.created_at).is_ok_and(|c| now - c < ENTRY_MAX_AGE);
        if event.deleted_at.is_some() || event.amount <= 0.0 || !recent {
            continue; // undone, a correction, or old history
        }
        if let Some(task) = data
            .tasks
            .iter()
            .find(|t| t.id == event.task_id && t.retired_at.is_none())
        {
            triggers.push(Trigger::Entry { task, event });
        }
    }
    if last != marker {
        set_state(state, user_id, marker_key, &last.to_string()).await?;
    }
    Ok(triggers)
}

/// Goals met or missed, deadlines missed, streaks broken: compared with what was last seen.
async fn task_triggers<'a>(
    state: &AppState,
    user_id: &str,
    data: &'a UserData,
    now: &LocalNow,
) -> ApiResult<Vec<Trigger<'a>>> {
    let mut triggers = Vec::new();
    for task in data
        .tasks
        .iter()
        .filter(|t| t.retired_at.is_none() && t.kind != TaskType::Track)
    {
        let ctx = data.context(task, now);
        let current = period_status(&ctx, now.today, now.today);
        if current.target.is_none() {
            continue;
        }
        let streak_now = streak(&ctx, now.today);
        let key = format!("alerts:task:{}", task.id);
        let fresh = TaskRecord {
            period_start: current.range.start,
            completed: current.state == PeriodState::Success,
            failed: current.state == PeriodState::Failure,
            deadline: current
                .deadline
                .as_ref()
                .is_some_and(|d| d.state == DeadlineState::Missed),
            streak: streak_now,
        };
        let Some(mut record) = get_state(state, user_id, &key)
            .await?
            .and_then(|v| serde_json::from_str::<TaskRecord>(&v).ok())
        else {
            // First look at this task: remember where things stand without reporting.
            set_state(
                state,
                user_id,
                &key,
                &serde_json::to_string(&fresh).expect("serializable"),
            )
            .await?;
            continue;
        };

        if record.period_start != current.range.start {
            // A new period began. A "Do" goal left unmet last period counts as missed.
            if task.kind == TaskType::Accumulate && !record.completed && !record.failed {
                let previous = period_status(&ctx, record.period_start, now.today);
                if previous.state == PeriodState::Failure {
                    triggers.push(Trigger::Failed {
                        task,
                        status: previous,
                    });
                }
            }
            record = TaskRecord {
                period_start: current.range.start,
                completed: false,
                failed: false,
                deadline: false,
                streak: record.streak,
            };
        }
        if task.kind == TaskType::Accumulate
            && current.state == PeriodState::Success
            && !record.completed
        {
            record.completed = true;
            triggers.push(Trigger::Completed {
                task,
                status: current.clone(),
            });
        }
        if task.kind == TaskType::Limit && current.state == PeriodState::Failure && !record.failed {
            record.failed = true;
            triggers.push(Trigger::Failed {
                task,
                status: current.clone(),
            });
        }
        if current
            .deadline
            .as_ref()
            .is_some_and(|d| d.state == DeadlineState::Missed)
            && !record.deadline
        {
            record.deadline = true;
            triggers.push(Trigger::DeadlineMissed {
                task,
                status: current.clone(),
            });
        }
        if record.streak >= 2 && streak_now == 0 {
            triggers.push(Trigger::StreakBroken {
                task,
                previous: record.streak,
                period: current.period,
            });
        }
        record.streak = streak_now;
        set_state(
            state,
            user_id,
            &key,
            &serde_json::to_string(&record).expect("serializable"),
        )
        .await?;
    }
    Ok(triggers)
}

/// Tells recipients when an alert about them is turned on, turned off, deleted, or no
/// longer includes them; keeps a snapshot so they can see each alert's status.
async fn announce_rule_changes(
    state: &AppState,
    user_id: &str,
    data: &UserData,
    rules: &[NotifyRule],
) -> ApiResult<()> {
    let now = state.clock.now();
    let actor = data.actor();
    let stamp = now.timestamp_millis();
    let tell = |recipient: String, body: String, dedupe: String| Notice {
        kind: "alert-status".into(),
        title: actor.clone(),
        body,
        url: None,
        dedupe: format!("{dedupe}:{recipient}:{stamp}"),
        data: json!({ "from": data.username }),
    };

    let previous: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM job_state WHERE user_id = ? AND key LIKE 'alerts:rule:%'",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    let mut seen = BTreeSet::new();

    for rule in rules {
        let key = format!("alerts:rule:{}", rule.id);
        seen.insert(key.clone());
        let what = if rule.name.trim().is_empty() {
            describe_scope(data, &rule.scope)
        } else {
            rule.name.trim().to_string()
        };
        let recipients = recipients(state, user_id, data, &rule.contact_ids).await?;
        let before: Option<RuleSnapshot> = previous
            .iter()
            .find(|(k, _)| *k == key)
            .and_then(|(_, v)| serde_json::from_str(v).ok());
        let was_on_for = |r: &String| {
            before
                .as_ref()
                .is_some_and(|b| b.enabled && b.recipients.contains(r))
        };

        for r in &recipients {
            if rule.enabled && !was_on_for(r) {
                let events: Vec<&str> = rule.events.iter().map(|e| event_phrase(e)).collect();
                let body = format!(
                    "{actor} will tell you when they {} ({what})",
                    events.join(", ")
                );
                notify(
                    state,
                    r,
                    tell(r.clone(), body, format!("rule-on:{}", rule.id)),
                    &[Channel::Push],
                )
                .await?;
            } else if !rule.enabled && was_on_for(r) {
                let body = format!("{actor} turned off alerts about {what}");
                notify(
                    state,
                    r,
                    tell(r.clone(), body, format!("rule-off:{}", rule.id)),
                    &[Channel::Push],
                )
                .await?;
            }
        }
        // People taken off an active alert.
        for r in before
            .iter()
            .filter(|b| b.enabled)
            .flat_map(|b| b.recipients.iter())
            .filter(|r| !recipients.contains(r))
        {
            let body = format!("{actor} stopped sending you alerts about {what}");
            notify(
                state,
                r,
                tell(r.clone(), body, format!("rule-removed:{}", rule.id)),
                &[Channel::Push],
            )
            .await?;
        }

        let snapshot = RuleSnapshot {
            enabled: rule.enabled,
            recipients,
            from_username: data.username.clone(),
            from_name: actor.clone(),
            what,
            events: rule.events.clone(),
            updated_at: timestamp(now),
        };
        let changed = before.as_ref().is_none_or(|b| {
            b.enabled != snapshot.enabled
                || b.recipients != snapshot.recipients
                || b.what != snapshot.what
                || b.events != snapshot.events
        });
        if changed {
            set_state(
                state,
                user_id,
                &key,
                &serde_json::to_string(&snapshot).expect("serializable"),
            )
            .await?;
        }
    }

    // Deleted rules: tell anyone who was getting them, then forget the rule.
    for (key, value) in previous.iter().filter(|(k, _)| !seen.contains(k)) {
        if let Ok(before) = serde_json::from_str::<RuleSnapshot>(value)
            && before.enabled
        {
            for r in &before.recipients {
                let body = format!("{actor} turned off alerts about {}", before.what);
                notify(
                    state,
                    r,
                    tell(r.clone(), body, format!("rule-deleted:{key}")),
                    &[Channel::Push],
                )
                .await?;
            }
        }
        sqlx::query("DELETE FROM job_state WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(key)
            .execute(&state.db)
            .await?;
    }
    Ok(())
}

fn event_phrase(event: &str) -> &'static str {
    match event {
        "entry" => "make progress",
        "completed" => "complete a goal",
        "failed" => "miss a goal or go over a limit",
        "deadline_missed" => "miss a deadline",
        "streak_broken" => "break a streak",
        _ => "do something",
    }
}

// ---------- recipients' view ----------

pub fn router() -> Router<AppState> {
    Router::new().route("/alerts/incoming", get(incoming))
}

/// Alerts other people set up about themselves for the caller, with their current status.
async fn incoming(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<Value>> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT value FROM job_state WHERE key LIKE 'alerts:rule:%' AND value LIKE ?",
    )
    .bind(format!("%\"{}\"%", auth.user_id))
    .fetch_all(&state.db)
    .await?;
    let alerts: Vec<RuleSnapshot> = rows
        .iter()
        .filter_map(|r| serde_json::from_str::<RuleSnapshot>(r).ok())
        .filter(|s| s.recipients.contains(&auth.user_id))
        .collect();
    Ok(Json(json!({ "alerts": alerts })))
}
