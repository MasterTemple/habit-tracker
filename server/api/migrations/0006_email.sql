-- Where to email this user (email reminders, reports, backups). '' = none.
ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
