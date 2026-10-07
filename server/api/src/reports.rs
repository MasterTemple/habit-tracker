//! Text for scheduled reports, and backups in the app's export format.

use chrono::{DateTime, TimeDelta, Utc};
use habit_core::status::{PeriodState, period_history, streak};
use habit_core::types::{Period, TaskType};
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::clock::timestamp;
use crate::userdata::{LocalNow, Scope, UserData};

fn unit_word(period: Period, n: usize) -> &'static str {
    match (period, n == 1) {
        (Period::Day, true) => "day",
        (Period::Day, false) => "days",
        (Period::Week, true) => "week",
        (Period::Week, false) => "weeks",
        (Period::Month, true) => "month",
        (Period::Month, false) => "months",
    }
}

fn number(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{n:.0}")
    } else {
        format!("{n:.1}")
    }
}

fn quantity(n: f64, unit: &str) -> String {
    match unit.trim() {
        "" => number(n),
        u if n == 1.0 => format!("1 {u}"),
        u if u.ends_with('s') => format!("{} {u}", number(n)),
        u => format!("{} {u}s", number(n)),
    }
}

/// A report on the tasks in `scope` over the past day, 7 days, or 30 days (ending today):
/// for each task, how many of its periods met the goal, the total, and the streak.
pub fn weekly_style_report(
    data: &UserData,
    scope: &Scope,
    covers: Period,
    now: &LocalNow,
    actor: &str,
) -> (String, String) {
    let days = match covers {
        Period::Day => 1,
        Period::Week => 7,
        Period::Month => 30,
    };
    let start = now.today - TimeDelta::days(days - 1);
    let label = match covers {
        Period::Day => "daily",
        Period::Week => "weekly",
        Period::Month => "monthly",
    };
    let window = match covers {
        Period::Day => format!("{}", now.today.format("%a, %b %-d")),
        _ => format!(
            "{} – {}",
            start.format("%b %-d"),
            now.today.format("%b %-d")
        ),
    };

    let mut lines = Vec::new();
    for task in data
        .tasks
        .iter()
        .filter(|t| t.retired_at.is_none() && scope.covers(t))
    {
        let ctx = data.context(task, now);
        let total: f64 = ctx
            .events
            .iter()
            .filter(|e| {
                e.deleted_at.is_none() && e.local_date >= start && e.local_date <= now.today
            })
            .fold(0.0, |sum, e| sum + e.amount);
        if task.kind == TaskType::Track {
            lines.push(format!(
                "• {} — {}",
                task.name,
                quantity(
                    total,
                    if task.unit.is_empty() {
                        "time"
                    } else {
                        &task.unit
                    }
                )
            ));
            continue;
        }
        let periods: Vec<_> = period_history(&ctx, now.today, 40)
            .into_iter()
            .filter(|p| p.range.end >= start && p.state != PeriodState::Excused)
            // The current period counts only once it's decided.
            .filter(|p| p.state != PeriodState::Open)
            .collect();
        let met = periods
            .iter()
            .filter(|p| p.state == PeriodState::Success)
            .count();
        let period = periods.first().map_or(Period::Day, |p| p.period);
        let verb = if task.kind == TaskType::Limit {
            "stayed within"
        } else {
            "met"
        };
        let mut parts = Vec::new();
        if !periods.is_empty() {
            parts.push(format!(
                "{verb} {met} of {} {}",
                periods.len(),
                unit_word(period, periods.len())
            ));
        }
        parts.push(quantity(total, &task.unit));
        let s = streak(&ctx, now.today);
        if s >= 2 {
            parts.push(format!("{s}-{} streak", unit_word(period, 1)));
        }
        lines.push(format!("• {} — {}", task.name, parts.join(" · ")));
    }
    if lines.is_empty() {
        lines.push("No tasks in this report.".into());
    }

    let subject = format!("{actor}'s {label} report ({window})");
    let text = format!(
        "{actor}'s {label} report, {window}\n\n{}\n\n— Habit Tracker",
        lines.join("\n")
    );
    (subject, text)
}

/// Everything the user has synced, in the app's export format (Settings → Import reads it).
pub async fn backup_json(
    db: &SqlitePool,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<Vec<u8>, sqlx::Error> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT tbl, data FROM sync_rows WHERE user_id = ? AND deleted = 0 AND data IS NOT NULL ORDER BY tbl, id")
            .bind(user_id)
            .fetch_all(db)
            .await?;
    let table = |name: &str| -> Vec<Value> {
        rows.iter()
            .filter(|(t, _)| t == name)
            .filter_map(|(_, d)| serde_json::from_str(d).ok())
            .collect()
    };
    let settings = table("settings").into_iter().next().map(|mut s| {
        if let Some(obj) = s.as_object_mut() {
            obj.remove("id");
        }
        s
    });
    let export = json!({
        "app": "habit-tracker",
        "version": 6,
        "exportedAt": timestamp(now),
        "settings": settings.unwrap_or_else(|| json!({})),
        "tasks": table("tasks"),
        "targets": table("targets"),
        "events": table("events"),
        "categories": table("categories"),
        "exceptions": table("exceptions"),
        "automations": table("automations"),
        "contacts": table("contacts"),
        "shares": table("shares"),
    });
    Ok(serde_json::to_vec_pretty(&export).expect("serializable"))
}
