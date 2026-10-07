//! The background loop: every 30 seconds, fire due reminders and deliver queued notices.
//! `tick` takes no hidden time: it uses the state's clock, so tests drive it directly.

use std::time::Duration;

use chrono::{NaiveDateTime, TimeDelta};
use habit_core::schedule::next_run;
use habit_core::status::PeriodState;
use habit_core::types::TaskType;
use serde_json::json;

use crate::AppState;
use crate::email::{self, EmailAttachment, EmailJob};
use crate::error::ApiResult;
use crate::notifications::{Channel, Notice, notify};
use crate::outbox;
use crate::reports;
use crate::userdata::{self, Reminder, ScheduledAction, UserData};
use base64::Engine;
use habit_core::types::Schedule;

/// A reminder that comes due while the server is down fires late only if this recent.
const STALE_AFTER: TimeDelta = TimeDelta::hours(2);
const LOCAL_FORMAT: &str = "%Y-%m-%dT%H:%M";

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = tick(&state).await {
                tracing::error!(error = %e, "scheduler tick failed");
            }
            outbox::process_due(&state).await;
            outbox::prune(&state).await;
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

/// One pass: reminders for every user with them, then alerts and webhooks.
pub async fn tick(state: &AppState) -> ApiResult<()> {
    let users: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM sync_rows
         WHERE tbl = 'automations' AND deleted = 0
           AND json_extract(data, '$.kind') IN ('reminder', 'report', 'export')",
    )
    .fetch_all(&state.db)
    .await?;
    for user_id in users {
        let data = userdata::load(&state.db, &user_id).await?;
        for reminder in data.reminders() {
            if let Err(e) = check_reminder(state, &user_id, &data, &reminder).await {
                tracing::error!(error = %e, reminder = %reminder.id, "reminder failed");
            }
        }
        for action in data.scheduled_actions() {
            if let Err(e) = check_action(state, &user_id, &data, &action).await {
                tracing::error!(error = %e, action = %action.id, "scheduled action failed");
            }
        }
    }
    for user_id in crate::alerts::users_with_rules(state).await? {
        if let Err(e) = crate::alerts::check_user(state, &user_id).await {
            tracing::error!(error = %e, user = %user_id, "alerts failed");
        }
    }
    Ok(())
}

pub async fn get_state(state: &AppState, user_id: &str, key: &str) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT value FROM job_state WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(key)
            .fetch_optional(&state.db)
            .await?,
    )
}

pub async fn set_state(state: &AppState, user_id: &str, key: &str, value: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO job_state (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value")
        .bind(user_id)
        .bind(key)
        .bind(value)
        .execute(&state.db)
        .await?;
    Ok(())
}

/// When a schedule (tracked under `key`) should fire now: its next time after the last
/// check has arrived on the user's wall clock, and isn't stale. Records the check. A
/// newly seen schedule starts counting from now (nothing in the past fires).
async fn due_now(
    state: &AppState,
    user_id: &str,
    key: &str,
    schedule: &Schedule,
    now: NaiveDateTime,
) -> ApiResult<Option<NaiveDateTime>> {
    let last = get_state(state, user_id, key)
        .await?
        .and_then(|v| NaiveDateTime::parse_from_str(&v, LOCAL_FORMAT).ok());
    let stamp = now.format(LOCAL_FORMAT).to_string();
    let Some(last) = last else {
        set_state(state, user_id, key, &stamp).await?;
        return Ok(None);
    };
    let Some(due) = next_run(schedule, last) else {
        return Ok(None);
    };
    if due > now {
        return Ok(None);
    }
    set_state(state, user_id, key, &stamp).await?;
    Ok((now - due <= STALE_AFTER).then_some(due))
}

/// Fires a reminder when its next time (after the last check) has arrived, on the
/// user's current wall clock. A newly seen reminder starts counting from now.
async fn check_reminder(
    state: &AppState,
    user_id: &str,
    data: &UserData,
    reminder: &Reminder,
) -> ApiResult<()> {
    let now = data.local_now(state.clock.now());
    let key = format!("reminder:{}", reminder.id);
    let Some(due) = due_now(state, user_id, &key, &reminder.schedule, now.at).await? else {
        return Ok(());
    };
    if !reminder.enabled {
        return Ok(());
    }

    // What's still to do among the tasks it covers ("Do" goals not yet met).
    let todo: Vec<String> = data
        .statuses(&now)
        .into_iter()
        .filter(|(task, status)| {
            reminder.scope.covers(task)
                && task.kind == TaskType::Accumulate
                && status.state == PeriodState::Open
        })
        .map(|(task, status)| {
            let left = status.goal.unwrap_or(0.0) - status.actual;
            if left > 1.0 {
                format!("{} ({} left)", task.name, left)
            } else {
                task.name.clone()
            }
        })
        .collect();
    if reminder.only_if_incomplete && todo.is_empty() {
        return Ok(());
    }

    let body = if !reminder.message.trim().is_empty() {
        reminder.message.trim().to_string()
    } else if todo.is_empty() {
        "Time to check in.".into()
    } else {
        format!("Still to do: {}", todo.join(", "))
    };
    let channels: Vec<Channel> = reminder
        .channels
        .iter()
        .filter_map(|c| (c == "push").then_some(Channel::Push))
        .collect();
    let title: String = if reminder.name.trim().is_empty() {
        "Reminder".into()
    } else {
        reminder.name.trim().into()
    };
    if reminder.channels.iter().any(|c| c == "email")
        && let Some(to) = email::user_email(state, user_id).await?
    {
        let job = EmailJob {
            to,
            subject: title.clone(),
            html: Some(email::html_from_text(&body)),
            text: body.clone(),
            attachments: vec![],
        };
        email::queue(
            state,
            user_id,
            job,
            &format!(
                "reminder-email:{}:{}",
                reminder.id,
                due.format(LOCAL_FORMAT)
            ),
        )
        .await?;
    }
    notify(
        state,
        user_id,
        Notice {
            kind: "reminder".into(),
            title,
            body,
            url: Some("./".into()),
            dedupe: format!("reminder:{}:{}", reminder.id, due.format(LOCAL_FORMAT)),
            data: json!({ "reminderId": reminder.id, "due": due.format(LOCAL_FORMAT).to_string(), "tasks": todo }),
        },
        &channels,
    )
    .await?;
    Ok(())
}

/// Scheduled reports and backups, by email (needs email set up on the server).
async fn check_action(
    state: &AppState,
    user_id: &str,
    data: &UserData,
    action: &ScheduledAction,
) -> ApiResult<()> {
    let now = data.local_now(state.clock.now());
    let key = format!("action:{}", action.id);
    let Some(due) = due_now(state, user_id, &key, &action.schedule, now.at).await? else {
        return Ok(());
    };
    if !action.enabled {
        return Ok(());
    }
    let when = due.format(LOCAL_FORMAT).to_string();
    let actor = data.actor();
    let mut recipients: Vec<String> = action
        .emails
        .iter()
        .filter(|e| email::looks_like_email(e))
        .cloned()
        .collect();
    let mut friends_without_email = Vec::new();
    for contact in data.contacts.iter().filter(|c| {
        c.get("id")
            .and_then(|v| v.as_str())
            .is_some_and(|id| action.contact_ids.iter().any(|x| x == id))
            && c.get("deletedAt").is_none_or(|d| d.is_null())
    }) {
        match contact
            .get("email")
            .and_then(|e| e.as_str())
            .filter(|e| email::looks_like_email(e))
        {
            Some(address) => recipients.push(address.to_string()),
            None => friends_without_email.extend(
                contact
                    .get("username")
                    .and_then(|u| u.as_str())
                    .map(str::to_string),
            ),
        }
    }

    match action.kind.as_str() {
        "report" => {
            let report =
                reports::weekly_style_report(data, &action.scope, action.period, &now, &actor);
            let reports::Report { subject, text, .. } = &report;
            if recipients.is_empty() && friends_without_email.is_empty() {
                recipients.extend(email::user_email(state, user_id).await?);
            }
            // Rendered only when it'll be emailed. Without it the email still goes.
            let pdf = if recipients.is_empty() {
                None
            } else {
                reports::render_pdf(&report).await
            };
            for to in recipients {
                let job = EmailJob {
                    to: to.clone(),
                    subject: subject.clone(),
                    html: Some(email::html_from_text(text)),
                    text: text.clone(),
                    attachments: pdf
                        .iter()
                        .map(|pdf| EmailAttachment {
                            filename: report.pdf_filename(now.today),
                            content_type: "application/pdf".into(),
                            data: base64::engine::general_purpose::STANDARD.encode(pdf),
                        })
                        .collect(),
                };
                email::queue(
                    state,
                    user_id,
                    job,
                    &format!("report:{}:{when}:{to}", action.id),
                )
                .await?;
            }
            // Friends with accounts but no email address get it in their inbox.
            for username in friends_without_email {
                let username = username.trim().trim_start_matches('@').to_lowercase();
                let friend: Option<String> =
                    sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
                        .bind(&username)
                        .fetch_optional(&state.db)
                        .await?;
                if let Some(friend) = friend
                    && crate::friends::are_friends(&state.db, user_id, &friend).await?
                {
                    let notice = Notice {
                        kind: "report".into(),
                        title: subject.clone(),
                        body: text.clone(),
                        url: None,
                        dedupe: format!("report:{}:{when}:{friend}", action.id),
                        data: json!({ "from": data.username }),
                    };
                    notify(state, &friend, notice, &[Channel::Push]).await?;
                }
            }
        }
        "export" => {
            if recipients.is_empty() {
                recipients.extend(email::user_email(state, user_id).await?);
            }
            let backup = reports::backup_json(&state.db, user_id, state.clock.now()).await?;
            let date = now.today;
            for to in recipients {
                let job = EmailJob {
                    to: to.clone(),
                    subject: format!("Habit Tracker backup ({date})"),
                    text: format!(
                        "Your scheduled backup is attached. Import it in Settings → Data → Import.\n\n— {actor}'s Habit Tracker"
                    ),
                    html: None,
                    attachments: vec![EmailAttachment {
                        filename: format!("habit-tracker-{date}.json"),
                        content_type: "application/json".into(),
                        data: base64::engine::general_purpose::STANDARD.encode(&backup),
                    }],
                };
                email::queue(
                    state,
                    user_id,
                    job,
                    &format!("backup:{}:{when}:{to}", action.id),
                )
                .await?;
            }
        }
        _ => {}
    }
    Ok(())
}
