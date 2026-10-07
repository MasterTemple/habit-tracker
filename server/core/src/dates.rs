//! Calendar helpers on local dates and wall-clock times. Mirrors `src/domain/dates.ts`.

use chrono::{Datelike, Days, Months, NaiveDate, NaiveDateTime, TimeDelta};
use serde::{Deserialize, Serialize};

use crate::types::{LocalDate, Period};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DateRange {
    pub start: LocalDate,
    /// Inclusive.
    pub end: LocalDate,
}

impl DateRange {
    pub fn contains(&self, date: LocalDate) -> bool {
        date >= self.start && date <= self.end
    }

    /// Number of days, counting both ends.
    pub fn len_days(&self) -> i64 {
        (self.end - self.start).num_days() + 1
    }
}

pub fn add_days(date: LocalDate, days: i64) -> LocalDate {
    date + TimeDelta::days(days)
}

/// The day a wall-clock moment counts toward, shifting early-morning hours back when
/// `day_start_hour` > 0.
pub fn to_local_date(moment: NaiveDateTime, day_start_hour: u32) -> LocalDate {
    (moment - TimeDelta::hours(day_start_hour.into())).date()
}

/// Parses "HH:MM" into minutes since midnight; malformed input counts as midnight.
pub fn parse_minutes(time: &str) -> u32 {
    let mut parts = time.split(':').map(|p| p.parse::<u32>().unwrap_or(0));
    let h = parts.next().unwrap_or(0);
    let m = parts.next().unwrap_or(0);
    (h * 60 + m) % (24 * 60)
}

/// Minutes since the day began, where the day begins at `day_start_hour`. With a 3 AM
/// day start, 01:00 is late in the day (1320), not early.
pub fn minutes_into_day(time: &str, day_start_hour: u32) -> u32 {
    (parse_minutes(time) + 24 * 60 - (day_start_hour % 24) * 60) % (24 * 60)
}

fn first_of_month(date: NaiveDate) -> NaiveDate {
    date.with_day(1).expect("day 1 exists")
}

fn last_of_month(date: NaiveDate) -> NaiveDate {
    first_of_month(date) + Months::new(1) - Days::new(1)
}

pub fn period_range(period: Period, date: LocalDate, week_starts_on: u8) -> DateRange {
    match period {
        Period::Day => DateRange {
            start: date,
            end: date,
        },
        Period::Week => {
            let back =
                (date.weekday().num_days_from_sunday() + 7 - u32::from(week_starts_on % 7)) % 7;
            let start = add_days(date, -i64::from(back));
            DateRange {
                start,
                end: add_days(start, 6),
            }
        }
        Period::Month => DateRange {
            start: first_of_month(date),
            end: last_of_month(date),
        },
    }
}

pub fn previous_period_range(period: Period, range: DateRange, week_starts_on: u8) -> DateRange {
    period_range(period, add_days(range.start, -1), week_starts_on)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DurationUnit {
    Day,
    Week,
    Month,
}

/// Inclusive end of a span starting on `start`: 3 days from Oct 6 ends Oct 8; 1 month ends Nov 5.
pub fn end_of_duration(start: LocalDate, count: f64, unit: DurationUnit) -> LocalDate {
    let n = count.floor().max(1.0) as u32;
    match unit {
        DurationUnit::Day => add_days(start, i64::from(n) - 1),
        DurationUnit::Week => add_days(start, 7 * i64::from(n) - 1),
        // Like date-fns addMonths: clamps to the target month's last day.
        DurationUnit::Month => start + Months::new(n) - Days::new(1),
    }
}
