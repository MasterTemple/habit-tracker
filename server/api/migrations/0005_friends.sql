-- Friendships between accounts. One row per pair (user_a < user_b); pending until the
-- other person accepts. Alerts and shares only reach accepted friends.

CREATE TABLE friendships (
    user_a       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    requested_by TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    accepted_at  TEXT,
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b)
);
CREATE INDEX friendships_b ON friendships(user_b);
