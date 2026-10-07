-- Synced app data. Each row is one app record (task, entry, category, …) stored as the
-- app's JSON. `seq` orders changes per user so devices can ask for "everything after N".

ALTER TABLE users ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sync_rows (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tbl        TEXT NOT NULL,
    id         TEXT NOT NULL,
    -- The record as JSON; NULL once permanently deleted (only the tombstone remains).
    data       TEXT,
    updated_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    seq        INTEGER NOT NULL,
    PRIMARY KEY (user_id, tbl, id)
);

CREATE INDEX sync_rows_seq ON sync_rows(user_id, seq);
