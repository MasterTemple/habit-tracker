//! Repeating schedules for reminders and scheduled actions, on local wall-clock time.
//! Mirrors `src/domain/schedule.ts`.

use chrono::{Datelike, Days, Months, NaiveDateTime, NaiveTime};

use crate::dates::parse_minutes;
use crate::types::{Repeat, Schedule};

const WEEKDAY_NAMES: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/// "18:05" → "6:05 PM".
pub fn format_time(time: &str) -> String {
    let minutes = parse_minutes(time);
    let (h, m) = (minutes / 60, minutes % 60);
    let h12 = if h % 12 == 0 { 12 } else { h % 12 };
    format!("{h12}:{m:02} {}", if h < 12 { "AM" } else { "PM" })
}

fn ordinal(n: u32) -> String {
    let suffix = match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("{n}{suffix}")
}

/// "Every day at 6:00 PM", "Sat, Sun at 9:00 AM", "Monthly on the 1st at 9:00 AM".
pub fn describe_schedule(s: &Schedule) -> String {
    let at = format!("at {}", format_time(&s.time));
    match s.repeat {
        Repeat::Daily => format!("Every day {at}"),
        Repeat::Weekly => {
            let mut days = s.weekdays.clone();
            days.sort_unstable();
            let joined = days
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            match (days.len(), joined.as_str()) {
                (0, _) => "Never (no days picked)".into(),
                (7, _) => format!("Every day {at}"),
                (_, "1,2,3,4,5") => format!("Weekdays {at}"),
                (_, "0,6") => format!("Weekends {at}"),
                _ => {
                    let names: Vec<&str> = days
                        .iter()
                        .filter_map(|&d| WEEKDAY_NAMES.get(d as usize).copied())
                        .collect();
                    format!("{} {at}", names.join(", "))
                }
            }
        }
        Repeat::Monthly => format!("Monthly on the {} {at}", ordinal(s.month_day)),
    }
}

fn time_of(s: &Schedule) -> NaiveTime {
    let minutes = parse_minutes(&s.time);
    NaiveTime::from_hms_opt(minutes / 60, minutes % 60, 0).expect("valid time")
}

/// The next local time the schedule fires strictly after `from`, or None if never.
pub fn next_run(s: &Schedule, from: NaiveDateTime) -> Option<NaiveDateTime> {
    let time = time_of(s);
    match s.repeat {
        Repeat::Monthly => {
            let first = from.date().with_day(1)?;
            (0..3).find_map(|i| {
                let month = first + Months::new(i);
                let last_day = (month + Months::new(1) - Days::new(1)).day();
                let run = month
                    .with_day(s.month_day.clamp(1, last_day))?
                    .and_time(time);
                (run > from).then_some(run)
            })
        }
        Repeat::Daily | Repeat::Weekly => {
            let days: Vec<u32> = if s.repeat == Repeat::Daily {
                (0..7).collect()
            } else {
                s.weekdays.clone()
            };
            if days.is_empty() {
                return None;
            }
            (0..8).find_map(|i| {
                let day = from.date() + Days::new(i);
                let run = day.and_time(time);
                (days.contains(&day.weekday().num_days_from_sunday()) && run > from).then_some(run)
            })
        }
    }
}
