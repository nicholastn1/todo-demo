#!/usr/bin/env bash
#
# Stop hook — refuses to end a turn while the test suites are red.
#
# Exit 0 lets the turn end. Exit 2 blocks it and feeds stderr back to Claude as
# the reason, so the failure is acted on instead of being reported as done.
#
# Two escape hatches, both deliberate:
#   1. stop_hook_active — Claude Code sets this when the turn was already
#      resumed by a Stop hook. Blocking again there would loop forever on a
#      failure the model cannot fix, so this pass lets it end and say so.
#   2. No node_modules — a fresh clone has nothing to run; failing there would
#      block every turn before the first install.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR" || exit 0

PAYLOAD="$(cat)"

if printf '%s' "$PAYLOAD" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

[ -d node_modules ] || exit 0

# mise pins Node 24 for this repo; vite refuses to build on the older default.
if command -v mise > /dev/null 2>&1; then
  RUN=(mise x -- npm)
else
  RUN=(npm)
fi

OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

FAILED=""
for SUITE in test test:scripts; do
  if ! "${RUN[@]}" run "$SUITE" > "$OUTPUT_FILE" 2>&1; then
    FAILED="$SUITE"
    break
  fi
done

[ -z "$FAILED" ] && exit 0

{
  echo "Tests are failing (npm run $FAILED), so this turn is not finished."
  echo
  echo "--- last 40 lines ---"
  tail -40 "$OUTPUT_FILE"
  echo "--- end ---"
  echo
  echo "Fix the failures and re-run:  npm run test && npm run test:scripts"
  echo "If a test is failing for a reason you cannot fix, say so explicitly"
  echo "rather than describing the work as complete."
} >&2

exit 2
