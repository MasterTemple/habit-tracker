-- Push subscriptions, the inbox, the delivery queue, and scheduler bookkeeping.

-- Server-wide keys (e.g. the VAPID key pair push services use to identify this server).
CREATE TABLE server_keys (
    name  TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- One per device that turned notifications on.
CREATE TABLE push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

-- Everything a user is notified about, kept so the app can show it later.
CREATE TABLE inbox (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    -- JSON with details (task ids, who sent it, …).
    data       TEXT NOT NULL DEFAULT '{}',
    -- The event this is about, so it's only ever recorded once.
    dedupe_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    read_at    TEXT
);
CREATE INDEX inbox_user ON inbox(user_id, created_at);

-- Deliveries to make (push, email, webhook), retried with backoff.
CREATE TABLE outbox (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL,
    -- Where to (push endpoint, email address, webhook URL).
    target          TEXT NOT NULL,
    payload         TEXT NOT NULL,
    -- Makes the same event never queue twice (e.g. "reminder:<id>:<when>:<endpoint>").
    dedupe_key      TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error      TEXT,
    created_at      TEXT NOT NULL,
    sent_at         TEXT
);
CREATE INDEX outbox_due ON outbox(status, next_attempt_at);

-- Per-user scheduler memory, e.g. when each reminder last fired.
CREATE TABLE job_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
