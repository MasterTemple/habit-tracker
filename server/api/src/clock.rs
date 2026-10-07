use std::sync::Mutex;

use chrono::{DateTime, TimeDelta, Utc};

/// The current time, injectable so tests can control expiry, lockouts, and (later) schedules.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// A clock that only moves when told to.
pub struct FakeClock(Mutex<DateTime<Utc>>);

impl FakeClock {
    pub fn new(at: DateTime<Utc>) -> Self {
        Self(Mutex::new(at))
    }

    pub fn advance(&self, by: TimeDelta) {
        *self.0.lock().unwrap() += by;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap()
    }
}

/// RFC 3339 with milliseconds and `Z`, matching the web app's `toISOString()`.
pub fn timestamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
