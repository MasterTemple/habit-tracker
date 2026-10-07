//! Text for scheduled reports, and backups in the app's export format.

use chrono::{DateTime, TimeDelta, Utc};
use habit_core::status::{PeriodState, period_history, streak};
use habit_core::types::{Period, TaskType};
use serde_json::{Value, json};
use sqlx::SqlitePool;

use axum::Router;
use axum::extract::{Query, State};
use axum::http::header;
use axum::response::IntoResponse;
use axum::routing::get;
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthUser;
use crate::clock::timestamp;
use crate::error::{ApiError, ApiResult};
use crate::userdata::{self, LocalNow, Scope, UserData};

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
        "" => format!("{} total", number(n)),
        u if n == 1.0 => format!("1 {u}"),
        u if u.ends_with('s') => format!("{} {u}", number(n)),
        u => format!("{} {u}s", number(n)),
    }
}

/// A report as email text, plus the data for its PDF (see `habit_pdf::report_pdf`).
pub struct Report {
    pub subject: String,
    pub text: String,
    pub pdf_data: Value,
}

impl Report {
    pub fn pdf_filename(&self, date: chrono::NaiveDate) -> String {
        format!("habit-report-{date}.pdf")
    }
}

/// `#rrggbb`, or a neutral gray (the PDF template parses it as a color).
fn hex_color(color: &str) -> String {
    let c = color.trim();
    if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit()) {
        c.to_string()
    } else {
        "#71717a".into()
    }
}

fn bar_label(period: Period, start: chrono::NaiveDate) -> String {
    match period {
        Period::Month => start.format("%b").to_string(),
        _ => start.format("%-m/%-d").to_string(),
    }
}

fn state_name(state: PeriodState) -> &'static str {
    match state {
        PeriodState::Success => "success",
        PeriodState::Failure => "failure",
        PeriodState::Open => "open",
        PeriodState::Excused => "excused",
    }
}

/// A report on the tasks in `scope` over the past day, 7 days, or 30 days (ending today):
/// for each task, how many of its periods met the goal, the total, and the streak.
/// The PDF adds a chart of each task's recent periods.
pub fn weekly_style_report(
    data: &UserData,
    scope: &Scope,
    covers: Period,
    now: &LocalNow,
    actor: &str,
) -> Report {
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
    let mut pdf_tasks = Vec::new();
    let (mut all_met, mut all_total) = (0, 0);
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
        // Recent periods for the PDF's chart, oldest first.
        let history = period_history(&ctx, now.today, 40);
        let shown = match history.first().map_or(Period::Day, |p| p.period) {
            Period::Day => days.max(14) as usize,
            Period::Week => 8,
            Period::Month => 6,
        };
        let bars: Vec<Value> = history
            .iter()
            .take(shown)
            .rev()
            .map(|p| {
                json!({
                    "label": bar_label(p.period, p.range.start),
                    "actual": p.actual,
                    "goal": p.goal,
                    "state": state_name(p.state),
                })
            })
            .collect();
        let pdf_task = |summary: String, streak: u32, period: Period| {
            json!({
                "name": task.name,
                "color": hex_color(&task.color),
                "kind": match task.kind { TaskType::Accumulate => "accumulate", TaskType::Limit => "limit", TaskType::Track => "track" },
                "summary": summary,
                "streak": streak,
                "period": unit_word(period, 1),
                "bars": bars,
            })
        };

        if task.kind == TaskType::Track {
            let summary = quantity(
                total,
                if task.unit.is_empty() {
                    "time"
                } else {
                    &task.unit
                },
            );
            lines.push(format!("• {} — {summary}", task.name));
            pdf_tasks.push(pdf_task(summary, 0, Period::Day));
            continue;
        }
        let periods: Vec<_> = history
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
        all_met += met;
        all_total += periods.len();
        let s = streak(&ctx, now.today);
        // The PDF shows the streak beside the name.
        pdf_tasks.push(pdf_task(parts.join(" · "), s, period));
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
    let pdf_data = json!({
        "title": format!("{actor}'s {label} report"),
        "window": window,
        "generated": now.at.format("%b %-d, %Y, %-I:%M %p").to_string(),
        "met": all_met,
        "total": all_total,
        "tasks": pdf_tasks,
    });
    Report {
        subject,
        text,
        pdf_data,
    }
}

/// The report as a PDF, or None (logged) if rendering fails. Runs off the async threads.
pub async fn render_pdf(report: &Report) -> Option<Vec<u8>> {
    let data = report.pdf_data.clone();
    match tokio::task::spawn_blocking(move || habit_pdf::report_pdf(&data)).await {
        Ok(Ok(pdf)) => Some(pdf),
        Ok(Err(e)) => {
            tracing::error!("report PDF: {e}");
            None
        }
        Err(e) => {
            tracing::error!("report PDF task: {e}");
            None
        }
    }
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

pub fn router() -> Router<AppState> {
    Router::new().route("/reports/pdf", get(download_pdf))
}

#[derive(Deserialize)]
struct PdfQuery {
    /// "day", "week" (default), or "month".
    #[serde(default)]
    period: Option<String>,
    /// Comma-separated category ids; empty = all tasks.
    #[serde(default)]
    categories: Option<String>,
}

/// The signed-in user's report as a PDF, on demand (the same report scheduled emails attach).
async fn download_pdf(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(q): Query<PdfQuery>,
) -> ApiResult<impl IntoResponse> {
    let covers = match q.period.as_deref().unwrap_or("week") {
        "day" => Period::Day,
        "week" => Period::Week,
        "month" => Period::Month,
        _ => {
            return Err(ApiError::BadRequest(
                "period must be day, week, or month".into(),
            ));
        }
    };
    let category_ids: Vec<String> = q
        .categories
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_string)
        .collect();
    let scope = Scope {
        applies_to_all: category_ids.is_empty(),
        task_ids: vec![],
        category_ids,
    };
    let data = userdata::load(&state.db, &auth.user_id).await?;
    let now = data.local_now(state.clock.now());
    let report = weekly_style_report(&data, &scope, covers, &now, &data.actor());
    let pdf = render_pdf(&report)
        .await
        .ok_or_else(|| ApiError::Internal("report PDF failed".into()))?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!(
                    "attachment; filename=\"{}\"",
                    report.pdf_filename(now.today)
                ),
            ),
        ],
        pdf,
    ))
}
