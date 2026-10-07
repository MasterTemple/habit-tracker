//! Data types, serialized exactly like the web app's (camelCase JSON), so rows synced
//! from devices deserialize directly. Mirrors `src/domain/types.ts`.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// Calendar date in the user's local time ("2026-10-06").
pub type LocalDate = NaiveDate;
/// Wall-clock time of day, 24-hour "HH:MM", in whatever zone the user was in.
pub type LocalTime = String;
/// UTC timestamp, ISO-8601.
pub type Timestamp = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskType {
    /// Reach at least N per period ("Do").
    Accumulate,
    /// Stay at or under N per period.
    Limit,
    /// Count occurrences, with no goal.
    Track,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    Day,
    Week,
    Month,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "type")]
    pub kind: TaskType,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub due_time: Option<LocalTime>,
    #[serde(default)]
    pub sort_order: f64,
    #[serde(default)]
    pub increment_amounts: Vec<f64>,
    #[serde(default)]
    pub display_mode: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[serde(default)]
    pub retired_at: Option<Timestamp>,
    #[serde(default)]
    pub created_from_id: Option<String>,
    /// Categories the task belongs to (priority order comes from the categories themselves).
    #[serde(default)]
    pub category_ids: Vec<String>,
}

/// A versioned goal: the version in effect at a period's start governs that period.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTarget {
    pub id: String,
    pub task_id: String,
    pub period: Period,
    pub amount: f64,
    pub carry_over: bool,
    pub effective_from: LocalDate,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: String,
    pub task_id: String,
    pub amount: f64,
    pub occurred_at: Timestamp,
    pub local_date: LocalDate,
    pub local_time: LocalTime,
    #[serde(default)]
    pub time_zone: String,
    #[serde(default)]
    pub note: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[serde(default)]
    pub deleted_at: Option<Timestamp>,
}

/// A break: goals are prorated or excused for these days; progress can still be recorded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskException {
    pub id: String,
    pub applies_to_all: bool,
    pub task_ids: Vec<String>,
    pub category_ids: Vec<String>,
    pub start_date: LocalDate,
    /// Inclusive.
    pub end_date: LocalDate,
    #[serde(default)]
    pub description: String,
    pub updated_at: Timestamp,
    #[serde(default)]
    pub deleted_at: Option<Timestamp>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 0 = Sunday … 6 = Saturday.
    pub week_starts_on: u8,
    /// Hour (0–23) when a new day begins; earlier entries count toward the previous day.
    pub day_start_hour: u32,
    pub carry_over_default: bool,
    pub limit_display: String,
    pub uncategorized_name: String,
    pub display_name: String,
    pub username: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            week_starts_on: 0,
            day_start_hour: 0,
            carry_over_default: false,
            limit_display: "used".into(),
            uncategorized_name: "Other".into(),
            display_name: String::new(),
            username: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub repeat: Repeat,
    /// "HH:MM", local wall-clock time.
    pub time: LocalTime,
    /// Weekly: 0 = Sunday … 6 = Saturday.
    pub weekdays: Vec<u32>,
    /// Monthly: 1–31, clamped to the month's last day.
    pub month_day: u32,
}
