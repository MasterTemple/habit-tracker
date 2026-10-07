//! The background loop: every 30 seconds, fire due reminders and deliver queued notices.
//! `tick` takes no hidden time: it uses the state's clock, so tests drive it directly.

use std::time::Duration;

use chrono::{NaiveDateTime, TimeDelta};
use habit_core::schedule::next_run;
use habit_core::status::PeriodState;
use habit_core::types::TaskType;
use serde_json::json;

use crate::AppState;
use crate::error::ApiResult;
use crate::notifications::{Channel, Notice, notify};
use crate::outbox;
use crate::userdata::{self, Reminder, UserData};

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
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

/// One pass over every user with reminders.
pub async fn tick(state: &AppState) -> ApiResult<()> {
    let users: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM sync_rows
         WHERE tbl = 'automations' AND deleted = 0 AND json_extract(data, '$.kind') = 'reminder'",
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
    }
    Ok(())
}

async fn get_state(state: &AppState, user_id: &str, key: &str) -> ApiResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT value FROM job_state WHERE user_id = ? AND key = ?")
            .bind(user_id)
            .bind(key)
            .fetch_optional(&state.db)
            .await?,
    )
}

async fn set_state(state: &AppState, user_id: &str, key: &str, value: &str) -> ApiResult<()> {
    sqlx::query("INSERT INTO job_state (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value")
        .bind(user_id)
        .bind(key)
        .bind(value)
        .execute(&state.db)
        .await?;
    Ok(())
}

/// Fires a reminder when its next time (after the last check) has arrived, on the
/// user's current wall clock. A newly seen reminder starts counting from now.
async fn check_reminder(
    state: &AppState,
    user_id: &str,
    data: &UserData,
    reminder: &Reminder,
) -> ApiResult<()> {
    let key = format!("reminder:{}", reminder.id);
    let now = data.local_now(state.clock.now());
    let last = get_state(state, user_id, &key)
        .await?
        .and_then(|v| NaiveDateTime::parse_from_str(&v, LOCAL_FORMAT).ok());
    let Some(last) = last else {
        return set_state(
            state,
            user_id,
            &key,
            &now.at.format(LOCAL_FORMAT).to_string(),
        )
        .await;
    };
    let Some(due) = next_run(&reminder.schedule, last) else {
        return Ok(());
    };
    if due > now.at {
        return Ok(());
    }
    set_state(
        state,
        user_id,
        &key,
        &now.at.format(LOCAL_FORMAT).to_string(),
    )
    .await?;
    if !reminder.enabled || now.at - due > STALE_AFTER {
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
    notify(
        state,
        user_id,
        Notice {
            kind: "reminder".into(),
            title: if reminder.name.trim().is_empty() { "Reminder".into() } else { reminder.name.trim().into() },
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
