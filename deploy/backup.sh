#!/bin/sh
# Daily consistent copy of the database (safe while the server runs), keeping 14 days.
# These live on the same disk; turn on Hetzner's server backups too for off-machine copies.
set -eu
mkdir -p /data/backups
while true; do
  if [ -f /data/habits.db ]; then
    file="/data/backups/habits-$(date -u +%Y-%m-%d).db"
    sqlite3 /data/habits.db ".backup '$file'" && echo "backup: wrote $file"
    find /data/backups -name 'habits-*.db' -mtime +14 -delete
  fi
  sleep 86400
done
