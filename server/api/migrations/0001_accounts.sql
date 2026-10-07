-- Accounts and sessions. Timestamps are RFC 3339 UTC strings, like the app's.

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    -- Lowercase, 3–32 of [a-z0-9_.-]; unique.
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    -- IANA zone last reported by a device; deadlines and reminders use it. '' = unknown (UTC).
    time_zone     TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
    -- SHA-256 (hex) of the bearer token; the token itself is never stored.
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    user_agent   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX sessions_user ON sessions(user_id);
