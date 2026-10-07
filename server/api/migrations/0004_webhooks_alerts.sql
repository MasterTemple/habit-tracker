-- When the server received each row (alerts wait a minute after receipt, regardless of
-- device clocks), and fast lookup of incoming webhooks by token.

ALTER TABLE sync_rows ADD COLUMN received_at TEXT;

CREATE INDEX sync_rows_webhook_token ON sync_rows (json_extract(data, '$.token'))
    WHERE tbl = 'automations' AND deleted = 0;

CREATE INDEX sync_rows_received ON sync_rows (user_id, tbl, seq);
