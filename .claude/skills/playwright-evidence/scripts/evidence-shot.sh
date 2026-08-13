#!/usr/bin/env bash
#
# evidence-shot.sh — thin wrapper around `shot-scraper` so every invocation
# made while capturing playwright-evidence gets the right browsers path and
# the flags the evidence workflow always needs.
#
# Usage: evidence-shot.sh <shot-scraper subcommand> [args...]
#
# It:
#   1. Points PLAYWRIGHT_BROWSERS_PATH at the download-blocked-machine shim
#      built by setup-evidence-tooling.sh, when that shim exists.
#   2. Tolerates a self-signed certificate, so it works against a dev server
#      started with Vite's `--https` as well as plain http.
#   3. For `video`, defaults to an mp4 that ignores the app's CSP so the
#      recorder can inject its own overlay script.
#
# The app this skill records has no authentication, so there is no session
# state to attach. If you port it to an app that does, the hook is
# shot-scraper's `--auth <storageState.json>` on shot/video/javascript.
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants (no magic strings)
# ---------------------------------------------------------------------------
readonly SHIM_ROOT="${HOME}/.cache/playwright-evidence/pw-browsers"

readonly VIDEO_SUBCOMMAND="video"

readonly IGNORE_CERT_ERRORS_FLAG="--ignore-certificate-errors"
readonly BROWSER_ARG_FLAG="--browser-arg"
readonly MP4_FLAG="--mp4"
readonly BYPASS_CSP_FLAG="--bypass-csp"

readonly SETUP_SCRIPT_HINT=".claude/skills/playwright-evidence/scripts/setup-evidence-tooling.sh"

log() { printf '[evidence-shot] %s\n' "$*"; }
die() { printf '[evidence-shot] ERROR: %s\n' "$*" >&2; exit 1; }

if [ -d "$SHIM_ROOT" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$SHIM_ROOT"
  log "Using browser shim at ${SHIM_ROOT}."
fi

command -v shot-scraper >/dev/null 2>&1 \
  || die "shot-scraper is not on PATH. Run ${SETUP_SCRIPT_HINT} or 'uv tool install shot-scraper'."

if [ "$#" -eq 0 ]; then
  die "Usage: evidence-shot.sh <shot-scraper subcommand + args...>"
fi

subcommand="$1"
extra_args=()

contains_arg() {
  local needle="$1"
  shift
  local arg
  for arg in "$@"; do
    [ "$arg" = "$needle" ] && return 0
  done
  return 1
}

if ! contains_arg "$IGNORE_CERT_ERRORS_FLAG" "$@"; then
  extra_args+=("$BROWSER_ARG_FLAG" "$IGNORE_CERT_ERRORS_FLAG")
fi

if [ "$subcommand" = "$VIDEO_SUBCOMMAND" ]; then
  contains_arg "$MP4_FLAG" "$@" || extra_args+=("$MP4_FLAG")
  contains_arg "$BYPASS_CSP_FLAG" "$@" || extra_args+=("$BYPASS_CSP_FLAG")
fi

exec shot-scraper "$@" "${extra_args[@]+"${extra_args[@]}"}"
