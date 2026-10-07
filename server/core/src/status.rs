//! Progress derived from entries: per-period status, breaks, carry-over, deadlines,
//! streaks, history, and the cross-task overview. Mirrors `src/domain/status.ts`;
//! both are checked against `fixtures/core.json`.

use chrono::{DateTime, NaiveDate};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

use crate::dates::{
    DateRange, add_days, minutes_into_day, period_range, previous_period_range, to_local_date,
};
use crate::types::{
    LocalDate, LocalTime, Period, Settings, Task, TaskEvent, TaskException, TaskTarget, TaskType,
};

/// Everything needed to derive one task's progress. Events and exceptions must already
/// be filtered to this task (see [`exceptions_for_task`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub task: Task,
    pub targets: Vec<TaskTarget>,
    pub events: Vec<TaskEvent>,
    pub exceptions: Vec<TaskException>,
    pub settings: Settings,
    /// Current wall-clock time, for whether today's deadline has passed. None = not yet.
    #[serde(default)]
    pub now: Option<LocalTime>,
    /// The user's zone, used to place `task.createdAt` on a local date. Defaults to UTC.
    /// (Server-only: the web app uses the device's zone.)
    #[serde(default)]
    pub time_zone: Option<Tz>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PeriodState {
    /// Still running, outcome undecided.
    Open,
    Success,
    Failure,
    /// Every day of the period was covered by a break.
    Excused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeadlineState {
    Pending,
    OnTime,
    Late,
    Missed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Deadline {
    pub date: LocalDate,
    pub time: LocalTime,
    pub state: DeadlineState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodStatus {
    pub period: Period,
    pub range: DateRange,
    pub target: Option<TaskTarget>,
    /// Effective goal after breaks and carry-over: minimum for accumulate, maximum for limit.
    pub goal: Option<f64>,
    /// How much carry-over from the previous period reduced the goal.
    pub carried: f64,
    /// Amount counted toward the goal (not clamped: negative means a stray correction).
    pub actual: f64,
    pub excused_days: u32,
    pub state: PeriodState,
    pub deadline: Option<Deadline>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskSummary {
    pub current: PeriodStatus,
    pub today: f64,
    pub total: f64,
    pub streak: u32,
}

/// Breaks that apply to a task directly, through one of its categories, or globally.
pub fn exceptions_for_task<'a>(
    task_id: &str,
    category_ids: &[String],
    exceptions: &'a [TaskException],
) -> Vec<&'a TaskException> {
    exceptions
        .iter()
        .filter(|e| e.deleted_at.is_none())
        .filter(|e| {
            e.applies_to_all
                || e.task_ids.iter().any(|t| t == task_id)
                || e.category_ids.iter().any(|c| category_ids.contains(c))
        })
        .collect()
}

pub fn is_excused(date: LocalDate, exceptions: &[TaskException]) -> bool {
    exceptions
        .iter()
        .any(|e| date >= e.start_date && date <= e.end_date)
}

/// The target version governing a period: the latest in effect at the period start, or,
/// for a task created mid-period, the first one that starts inside it.
pub fn target_for(targets: &[TaskTarget], range: DateRange) -> Option<&TaskTarget> {
    let mut sorted: Vec<&TaskTarget> = targets.iter().collect();
    sorted.sort_by_key(|t| t.effective_from);
    sorted
        .iter()
        .rev()
        .find(|t| t.effective_from <= range.start)
        .or_else(|| sorted.iter().find(|t| t.effective_from <= range.end))
        .copied()
}

pub fn current_target(targets: &[TaskTarget], today: LocalDate) -> Option<&TaskTarget> {
    target_for(
        targets,
        DateRange {
            start: today,
            end: today,
        },
    )
}

fn sum_events(events: &[TaskEvent], include: impl Fn(&TaskEvent) -> bool) -> f64 {
    events
        .iter()
        .filter(|e| e.deleted_at.is_none() && include(e))
        // Fold from +0.0: an empty float `sum()` is -0.0, which would show as "-0".
        .fold(0.0, |total, e| total + e.amount)
}

fn count_excused_days(range: DateRange, exceptions: &[TaskException]) -> u32 {
    if exceptions.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut d = range.start;
    while d <= range.end {
        if is_excused(d, exceptions) {
            count += 1;
        }
        d = add_days(d, 1);
    }
    count
}

fn period_for(ctx: &TaskContext, date: LocalDate) -> Period {
    current_target(&ctx.targets, date).map_or(Period::Day, |t| t.period)
}

/// Status of the period containing `date`.
///
/// - Breaks: accumulate goals are prorated by non-break days (rounded up); limit goals
///   stay the same but entries on break days don't count.
/// - Carry-over (only when the target enables it, one period back): accumulate surplus
///   lowers the next goal; limit overage lowers the next allowance.
/// - Deadlines ("Do" tasks with a due time): compared on recorded wall-clock values.
pub fn period_status(ctx: &TaskContext, date: LocalDate, today: LocalDate) -> PeriodStatus {
    period_status_inner(ctx, date, today, true)
}

fn period_status_inner(
    ctx: &TaskContext,
    date: LocalDate,
    today: LocalDate,
    with_carry: bool,
) -> PeriodStatus {
    let task = &ctx.task;
    let period = period_for(ctx, date);
    let range = period_range(period, date, ctx.settings.week_starts_on);
    let ended = range.end < today;

    if task.kind == TaskType::Track {
        // A counter with no goal: the target only sets the period it resets on.
        let actual = sum_events(&ctx.events, |e| range.contains(e.local_date));
        return PeriodStatus {
            period,
            range,
            target: target_for(&ctx.targets, range).cloned(),
            goal: None,
            carried: 0.0,
            actual,
            excused_days: 0,
            state: if actual > 0.0 {
                PeriodState::Success
            } else {
                PeriodState::Open
            },
            deadline: None,
        };
    }

    let target = target_for(&ctx.targets, range).cloned();
    let excused_days = count_excused_days(range, &ctx.exceptions);
    let fully_excused = i64::from(excused_days) == range.len_days();

    let actual = if task.kind == TaskType::Limit {
        sum_events(&ctx.events, |e| {
            range.contains(e.local_date) && !is_excused(e.local_date, &ctx.exceptions)
        })
    } else {
        sum_events(&ctx.events, |e| range.contains(e.local_date))
    };

    let base = |goal, carried, state, deadline, target| PeriodStatus {
        period,
        range,
        target,
        goal,
        carried,
        actual,
        excused_days,
        state,
        deadline,
    };

    let Some(target) = target else {
        return base(None, 0.0, PeriodState::Open, None, None);
    };
    if fully_excused {
        return base(Some(0.0), 0.0, PeriodState::Excused, None, Some(target));
    }

    let len = range.len_days() as f64;
    let mut goal = if task.kind == TaskType::Accumulate {
        (target.amount * (len - f64::from(excused_days)) / len).ceil()
    } else {
        target.amount
    };

    let mut carried = 0.0;
    if with_carry && target.carry_over {
        let prev_range = previous_period_range(period, range, ctx.settings.week_starts_on);
        let prev = period_status_inner(ctx, prev_range.start, today, false);
        if let Some(prev_goal) = prev.goal
            && prev.period == period
            && prev.state != PeriodState::Excused
        {
            // Surplus for accumulate, overage for limit — both reduce this period's goal.
            carried = (prev.actual - prev_goal).max(0.0);
            goal = (goal - carried).max(0.0);
        }
    }

    let state = if task.kind == TaskType::Accumulate {
        if actual >= goal {
            PeriodState::Success
        } else if ended {
            PeriodState::Failure
        } else {
            PeriodState::Open
        }
    } else if actual > goal {
        PeriodState::Failure
    } else if ended {
        PeriodState::Success
    } else {
        PeriodState::Open
    };

    let deadline = match (&task.due_time, task.kind) {
        (Some(due), TaskType::Accumulate) => {
            Some(deadline_for(ctx, due, range, goal, actual, today))
        }
        _ => None,
    };

    base(Some(goal), carried, state, deadline, Some(target))
}

/// Wall-clock comparison only: entries' recorded localDate/localTime, the due time, and
/// the current wall clock — so a deadline means the same local time wherever the user is.
fn deadline_for(
    ctx: &TaskContext,
    due_time: &str,
    range: DateRange,
    goal: f64,
    actual: f64,
    today: LocalDate,
) -> Deadline {
    let day_start = ctx.settings.day_start_hour;
    let date = range.end;
    let due = minutes_into_day(due_time, day_start);
    let by_deadline = sum_events(&ctx.events, |e| {
        (e.local_date < date || minutes_into_day(&e.local_time, day_start) <= due)
            && range.contains(e.local_date)
    });
    let passed = date < today
        || (date == today
            && ctx
                .now
                .as_deref()
                .is_some_and(|now| minutes_into_day(now, day_start) > due));
    let state = if by_deadline >= goal {
        DeadlineState::OnTime
    } else if !passed {
        DeadlineState::Pending
    } else if actual >= goal {
        DeadlineState::Late
    } else {
        DeadlineState::Missed
    };
    Deadline {
        date,
        time: due_time.to_string(),
        state,
    }
}

/// The local date the task was created on, in the context's zone (UTC by default).
fn created_date(ctx: &TaskContext) -> LocalDate {
    let tz = ctx.time_zone.unwrap_or(Tz::UTC);
    match DateTime::parse_from_rfc3339(&ctx.task.created_at) {
        Ok(at) => to_local_date(
            at.with_timezone(&tz).naive_local(),
            ctx.settings.day_start_hour,
        ),
        Err(_) => ctx
            .task
            .created_at
            .get(..10)
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .unwrap_or(NaiveDate::MIN),
    }
}

/// Periods from the current one backwards, stopping at the task's creation.
pub fn period_history(
    ctx: &TaskContext,
    today: LocalDate,
    max_periods: usize,
) -> Vec<PeriodStatus> {
    let created = created_date(ctx);
    let mut history = Vec::new();
    let mut date = today;
    for _ in 0..max_periods {
        let status = period_status(ctx, date, today);
        if status.range.end < created {
            break;
        }
        date = add_days(status.range.start, -1);
        history.push(status);
    }
    history
}

/// Consecutive successful periods ending now. An open current period doesn't break it,
/// excused periods are skipped, and a change of period type stops it.
pub fn streak(ctx: &TaskContext, today: LocalDate) -> u32 {
    let created = created_date(ctx);
    let period = period_for(ctx, today);
    let mut count = 0;
    let mut date = today;
    for i in 0..5000 {
        let status = period_status(ctx, date, today);
        if status.range.end < created || status.period != period {
            break;
        }
        if ctx.task.kind != TaskType::Track && status.target.is_none() {
            break;
        }
        match status.state {
            PeriodState::Success => count += 1,
            PeriodState::Excused => {}
            PeriodState::Open if i == 0 => {}
            _ => break,
        }
        date = add_days(status.range.start, -1);
    }
    count
}

pub fn summarize(ctx: &TaskContext, today: LocalDate) -> TaskSummary {
    TaskSummary {
        current: period_status(ctx, today, today),
        today: sum_events(&ctx.events, |e| e.local_date == today),
        total: sum_events(&ctx.events, |_| true),
        streak: streak(ctx, today),
    }
}

/// How much of its goal a task has met (0–1): accumulate by fraction, a limit fully while
/// within it. None when it has no goal or is excused.
pub fn task_fraction(task: &Task, current: &PeriodStatus) -> Option<f64> {
    let goal = current.goal?;
    if task.kind == TaskType::Track || current.state == PeriodState::Excused {
        return None;
    }
    if task.kind == TaskType::Limit {
        return Some(if current.state == PeriodState::Failure {
            0.0
        } else {
            1.0
        });
    }
    Some(if goal == 0.0 {
        1.0
    } else {
        (current.actual / goal).clamp(0.0, 1.0)
    })
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Overview {
    /// Average completion (0–1) across tasks with a goal that aren't excused.
    pub progress: f64,
    pub done: u32,
    pub remaining: u32,
    pub over: u32,
    pub counted: u32,
    pub excused: u32,
    /// Deadline passed with the goal unmet.
    pub overdue: u32,
}

/// Progress across tasks right now (track tasks are left out).
pub fn overview<'a>(statuses: impl IntoIterator<Item = (&'a Task, &'a PeriodStatus)>) -> Overview {
    let mut result = Overview::default();
    let mut sum = 0.0;
    for (task, current) in statuses {
        if task.kind == TaskType::Track || current.goal.is_none() {
            continue;
        }
        if current.state == PeriodState::Excused {
            result.excused += 1;
            continue;
        }
        result.counted += 1;
        sum += task_fraction(task, current).unwrap_or(0.0);
        if current
            .deadline
            .as_ref()
            .is_some_and(|d| d.state == DeadlineState::Missed)
        {
            result.overdue += 1;
        }
        match task.kind {
            TaskType::Accumulate if current.state == PeriodState::Success => result.done += 1,
            TaskType::Accumulate => result.remaining += 1,
            _ if current.state == PeriodState::Failure => result.over += 1,
            _ => result.done += 1,
        }
    }
    result.progress = if result.counted == 0 {
        0.0
    } else {
        sum / f64::from(result.counted)
    };
    result
}
