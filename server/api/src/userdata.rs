//! A user's synced data, parsed into the shared rule types, and what the app would show
//! for each task right now (in the user's own time zone).

use chrono::{DateTime, NaiveDateTime, Utc};
use chrono_tz::Tz;
use habit_core::dates::to_local_date;
use habit_core::status::{PeriodStatus, TaskContext, exceptions_for_task, period_status};
use habit_core::types::{
    LocalDate, Schedule, Settings, Task, TaskEvent, TaskException, TaskTarget,
};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use sqlx::SqlitePool;

/// Which tasks a rule covers. Mirrors the app's `Scope`.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub applies_to_all: bool,
    #[serde(default)]
    pub task_ids: Vec<String>,
    #[serde(default)]
    pub category_ids: Vec<String>,
}

impl Scope {
    pub fn covers(&self, task: &Task) -> bool {
        self.applies_to_all
            || self.task_ids.contains(&task.id)
            || task
                .category_ids
                .iter()
                .any(|c| self.category_ids.contains(c))
    }
}

/// A reminder, as the app stores it (an automation with kind "reminder").
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub enabled: bool,
    pub scope: Scope,
    pub schedule: Schedule,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub only_if_incomplete: bool,
    #[serde(default)]
    pub channels: Vec<String>,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

pub struct UserData {
    pub tasks: Vec<Task>,
    pub targets: Vec<TaskTarget>,
    pub events: Vec<TaskEvent>,
    pub exceptions: Vec<TaskException>,
    pub settings: Settings,
    /// Raw automation rows (reminders, actions, webhooks).
    pub automations: Vec<serde_json::Value>,
    /// Raw share rows (view shares and accountability alerts).
    pub shares: Vec<serde_json::Value>,
    pub contacts: Vec<serde_json::Value>,
    pub categories: Vec<serde_json::Value>,
    pub time_zone: Tz,
    pub username: String,
    pub display_name: String,
}

fn parse_all<T: DeserializeOwned>(rows: &[(String, String)], table: &str) -> Vec<T> {
    rows.iter()
        .filter(|(t, _)| t == table)
        .filter_map(|(_, data)| serde_json::from_str(data).ok())
        .collect()
}

/// Just the settings and current zone (cheaper than loading everything).
pub async fn settings_and_zone(
    db: &SqlitePool,
    user_id: &str,
) -> Result<(Settings, Tz), sqlx::Error> {
    let settings: Option<String> = sqlx::query_scalar(
        "SELECT data FROM sync_rows WHERE user_id = ? AND tbl = 'settings' AND deleted = 0",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    let zone: String = sqlx::query_scalar("SELECT time_zone FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(db)
        .await?;
    Ok((
        settings
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        zone.parse().unwrap_or(Tz::UTC),
    ))
}

pub async fn load(db: &SqlitePool, user_id: &str) -> Result<UserData, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT tbl, data FROM sync_rows WHERE user_id = ? AND deleted = 0 AND data IS NOT NULL",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    let (zone, username, display_name): (String, String, String) =
        sqlx::query_as("SELECT time_zone, username, display_name FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(db)
            .await?;
    Ok(UserData {
        tasks: parse_all(&rows, "tasks"),
        targets: parse_all(&rows, "targets"),
        events: parse_all(&rows, "events"),
        exceptions: parse_all(&rows, "exceptions"),
        settings: parse_all(&rows, "settings")
            .into_iter()
            .next()
            .unwrap_or_default(),
        automations: parse_all(&rows, "automations"),
        shares: parse_all(&rows, "shares"),
        contacts: parse_all(&rows, "contacts"),
        categories: parse_all(&rows, "categories"),
        time_zone: zone.parse().unwrap_or(Tz::UTC),
        username,
        display_name,
    })
}

/// The user's wall clock now: local date-time, the day it counts toward, and "HH:MM".
pub struct LocalNow {
    pub at: NaiveDateTime,
    pub today: LocalDate,
    pub time: String,
}

impl UserData {
    pub fn local_now(&self, now: DateTime<Utc>) -> LocalNow {
        let at = now.with_timezone(&self.time_zone).naive_local();
        LocalNow {
            at,
            today: to_local_date(at, self.settings.day_start_hour),
            time: at.format("%H:%M").to_string(),
        }
    }

    pub fn reminders(&self) -> Vec<Reminder> {
        self.automations
            .iter()
            .filter(|a| a.get("kind").and_then(|k| k.as_str()) == Some("reminder"))
            .filter_map(|a| serde_json::from_value::<Reminder>(a.clone()).ok())
            .filter(|r| r.deleted_at.is_none())
            .collect()
    }

    /// "Blake" (display name) or "@blake".
    pub fn actor(&self) -> String {
        if self.display_name.trim().is_empty() {
            format!("@{}", self.username)
        } else {
            self.display_name.trim().into()
        }
    }

    pub fn context(&self, task: &Task, now: &LocalNow) -> TaskContext {
        TaskContext {
            task: task.clone(),
            targets: self
                .targets
                .iter()
                .filter(|t| t.task_id == task.id)
                .cloned()
                .collect(),
            events: self
                .events
                .iter()
                .filter(|e| e.task_id == task.id)
                .cloned()
                .collect(),
            exceptions: exceptions_for_task(&task.id, &task.category_ids, &self.exceptions)
                .into_iter()
                .cloned()
                .collect(),
            settings: self.settings.clone(),
            now: Some(now.time.clone()),
            time_zone: Some(self.time_zone),
        }
    }

    /// Active (not retired) tasks with what the app would show for them now.
    pub fn statuses(&self, now: &LocalNow) -> Vec<(&Task, PeriodStatus)> {
        self.tasks
            .iter()
            .filter(|t| t.retired_at.is_none())
            .map(|task| {
                (
                    task,
                    period_status(&self.context(task, now), now.today, now.today),
                )
            })
            .collect()
    }
}
