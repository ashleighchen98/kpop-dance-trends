#!/usr/bin/env bash
# Runs the full pipeline: scrape -> filter/rank -> dashboard.
# Written to be safe to run from cron, which uses a minimal PATH that
# often can't find `node`/`npm` — so PATH is set explicitly below rather
# than assumed from the calling shell.
#
# Usage:
#   ./scripts/weekly-run.sh          (manual run)
#   crontab entry runs this same way — see README.md for the line to add.

set -uo pipefail
# Note: deliberately no `-e` here — failures are checked explicitly below
# via `&&` chaining so a mid-pipeline failure is never silently masked by
# a later command's exit status (a real bug caught while writing this).

# Cron's default PATH is typically just "/usr/bin:/bin". Prepend the common
# locations for node/npm so this works unattended, not just interactively.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/current/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

mkdir -p logs
LOG_FILE="logs/weekly-$(date +%Y-%m-%d_%H-%M-%S).log"

{
  echo "=== Weekly run started: $(date) ==="
  echo "node: $(command -v node || echo NOT FOUND)"
  echo "npm:  $(command -v npm || echo NOT FOUND)"
  echo
} >>"$LOG_FILE" 2>&1

if npm run scrape:youtube >>"$LOG_FILE" 2>&1 \
  && npm run process >>"$LOG_FILE" 2>&1 \
  && npm run dashboard >>"$LOG_FILE" 2>&1
then
  STATUS=0
  echo "=== Weekly run finished successfully: $(date) ===" >>"$LOG_FILE"
else
  STATUS=$?
  echo "=== Weekly run FAILED (exit $STATUS): $(date) ===" >>"$LOG_FILE"
fi

if [ "$STATUS" -eq 0 ]; then
  echo "Weekly run succeeded. Log: $LOG_FILE"
else
  echo "Weekly run FAILED (exit $STATUS). Check $LOG_FILE"
fi
exit "$STATUS"
