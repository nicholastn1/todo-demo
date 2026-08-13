#!/usr/bin/env bash
#
# setup-evidence-tooling.sh — install everything the playwright-evidence
# skill needs, on a developer machine (Linux or macOS) and in a cloud session
# alike. `npm run evidence` depends on it having run.
#
# It is idempotent and safe to re-run. It:
#   1. Ensures a real ffmpeg (playwright's bundled ffmpeg cannot encode H.264,
#      so `shot-scraper video --mp4` needs a real one). Prefers the version
#      pinned in mise.toml, falling back to Homebrew or apt.
#   2. Ensures shot-scraper with its `video` subcommand — again from mise when
#      available, otherwise via uv.
#   3. Ensures a usable browser: on a machine with a preinstalled,
#      download-blocked browsers dir ($PLAYWRIGHT_BROWSERS_PATH) it builds a
#      symlink "shim" remapping the revision shot-scraper's bundled playwright
#      pins onto the binaries already on disk; elsewhere it lets shot-scraper
#      download its own.
#   4. Prints the effective PLAYWRIGHT_BROWSERS_PATH to use.
#
# Pass --check to report readiness without installing or downloading anything;
# it exits non-zero when something is missing.
#
# It never starts a server and never touches a database. No revision numbers
# are hardcoded — required revisions are read from the installed playwright's
# browsers.json and on-disk revisions are globbed from the browsers dir.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants (no magic strings)
# ---------------------------------------------------------------------------
readonly DEFAULT_BROWSERS_PATH="/opt/pw-browsers"
readonly ON_DISK_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$DEFAULT_BROWSERS_PATH}"
readonly SHIM_ROOT="${HOME}/.cache/playwright-evidence/pw-browsers"
# shot-scraper bundles its own Playwright, whose browsers.json pins the browser
# revisions the shim has to satisfy. Where that file lands depends on how
# shot-scraper was installed — mise's pipx backend and uv use different layouts
# — so it is resolved from the actual binary rather than hardcoded to one
# installer's directory. The uv path stays as a fallback.
readonly UV_SHOT_SCRAPER_TOOL_DIR="${HOME}/.local/share/uv/tools/shot-scraper"
readonly BROWSERS_JSON_RELATIVE_GLOB="lib/python*/site-packages/playwright/driver/package/browsers.json"

# A managed browsers dir that already exists means the machine ships browsers
# and blocks the Playwright CDN — that is what makes the shim necessary.
readonly HAS_MANAGED_BROWSERS_DIR="$([ -d "$ON_DISK_BROWSERS_PATH" ] && echo true || echo false)"

readonly CHECK_FLAG="--check"
readonly MACOS_PLATFORM="Darwin"
readonly FFMPEG_BREW_FORMULA="ffmpeg"
readonly FFMPEG_APT_PACKAGE="ffmpeg"
readonly SHOT_SCRAPER_MISE_TOOL="pipx:shot-scraper"

CHECK_ONLY=false
[ "${1:-}" = "$CHECK_FLAG" ] && CHECK_ONLY=true
readonly CHECK_ONLY

has() { command -v "$1" > /dev/null 2>&1; }

# True when mise manages this tool in this repo, i.e. it is pinned in
# mise.toml and already installed.
mise_provides() {
  has mise && mise which "$1" > /dev/null 2>&1
}

# Browser identifiers as they appear in playwright's browsers.json.
readonly CHROMIUM_BROWSER_NAME="chromium"
readonly HEADLESS_SHELL_BROWSER_NAME="chromium-headless-shell"
readonly FFMPEG_BROWSER_NAME="ffmpeg"

# On-disk directory-name prefixes (playwright uses underscores in the
# headless-shell directory name, dashes elsewhere).
readonly CHROMIUM_DIR_PREFIX="chromium"
readonly HEADLESS_SHELL_DIR_PREFIX="chromium_headless_shell"
readonly FFMPEG_DIR_PREFIX="ffmpeg"

# Inner layout names for the headless shell.
readonly NEW_HS_INNER_DIR="chrome-headless-shell-linux64"
readonly NEW_HS_BINARY_NAME="chrome-headless-shell"
readonly OLD_HS_INNER_DIR="chrome-linux"
readonly OLD_HS_BINARY_NAME="headless_shell"

# Playwright's per-revision "ready" marker files.
readonly INSTALL_MARKER="INSTALLATION_COMPLETE"
readonly DEPS_MARKER="DEPENDENCIES_VALIDATED"

readonly VIDEO_SUBCOMMAND="video"

log() { printf '[setup-evidence-tooling] %s\n' "$*"; }
warn() { printf '[setup-evidence-tooling] WARNING: %s\n' "$*" >&2; }
die() { printf '[setup-evidence-tooling] ERROR: %s\n' "$*" >&2; exit 1; }

# Expand a glob and print the first match, or nothing if none matched.
first_glob() {
  local pattern="$1"
  local match
  local -a matches=()
  shopt -s nullglob
  # shellcheck disable=SC2206  # deliberate word-split glob expansion
  matches=( $pattern )
  shopt -u nullglob
  # `${matches[@]+...}` keeps an empty result safe under `set -u` on bash 3.2,
  # which macOS still ships as /bin/bash.
  for match in "${matches[@]+"${matches[@]}"}"; do
    printf '%s\n' "$match"
    return 0
  done
}

# Follow a symlink chain to the real file. Hand-rolled because `readlink -f`
# is GNU-only and macOS ships the BSD one.
resolve_symlink() {
  local path="$1" target
  while [ -L "$path" ]; do
    target="$(readlink "$path")"
    case "$target" in
      /*) path="$target" ;;
      *) path="$(dirname "$path")/$target" ;;
    esac
  done
  printf '%s\n' "$path"
}

# Absolute path to the shot-scraper executable. Asks mise first, since a
# mise-managed tool resolves even when its shim is not on the active PATH.
shot_scraper_binary() {
  if has mise && mise which shot-scraper 2> /dev/null; then
    return 0
  fi
  command -v shot-scraper 2> /dev/null
}

# browsers.json of whichever playwright shot-scraper bundles. Derived from the
# resolved binary (`<venv>/bin/shot-scraper` → `<venv>`) so it works whether
# mise's pipx backend or uv did the install, with uv's layout as a fallback.
find_browsers_json() {
  local binary venv candidate
  binary="$(shot_scraper_binary)" || true

  if [ -n "${binary:-}" ]; then
    venv="$(dirname "$(dirname "$(resolve_symlink "$binary")")")"
    candidate="$(first_glob "${venv}/${BROWSERS_JSON_RELATIVE_GLOB}")"
    if [ -n "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  first_glob "${UV_SHOT_SCRAPER_TOOL_DIR}/${BROWSERS_JSON_RELATIVE_GLOB}"
}

# Revision suffix of a browser directory name (everything after the last "-").
revision_of() {
  local name
  name="$(basename "$1")"
  printf '%s\n' "${name##*-}"
}

# ---------------------------------------------------------------------------
# Step 1 — system ffmpeg
# ---------------------------------------------------------------------------
ensure_ffmpeg() {
  if mise_provides ffmpeg; then
    log "ffmpeg provided by mise ($(mise which ffmpeg)); nothing to install."
    return 0
  fi
  if has ffmpeg; then
    log "ffmpeg already on PATH ($(command -v ffmpeg)); skipping install."
    return 0
  fi

  if [ "$CHECK_ONLY" = true ]; then
    warn "ffmpeg is missing; 'shot-scraper video --mp4' cannot encode without it."
    return 1
  fi

  # mise.toml pins ffmpeg, so the happy path on both platforms is a
  # sudo-free `mise install`; these remain as fallbacks for machines
  # without mise.
  if [ "$(uname -s)" = "$MACOS_PLATFORM" ]; then
    if ! has brew; then
      warn "ffmpeg missing and neither mise nor Homebrew is available; install mise (preferred) or run: brew install $FFMPEG_BREW_FORMULA"
      return 1
    fi
    log "Installing ffmpeg via Homebrew..."
    brew install "$FFMPEG_BREW_FORMULA"
    log "ffmpeg installed."
    return 0
  fi

  if ! has apt-get; then
    warn "ffmpeg missing and neither mise nor apt-get is available; 'shot-scraper video --mp4' will fail until a real ffmpeg is installed."
    return 1
  fi
  local sudo_prefix=""
  if [ "$(id -u)" -ne 0 ]; then
    sudo_prefix="sudo"
  fi
  log "Installing system ffmpeg via apt-get..."
  # Headless/cloud bootstrap: keep apt non-interactive so a package
  # configuration prompt (timezone, locale) can't hang the install waiting
  # for input. Matches scripts/bootstrap.sh's convention.
  export DEBIAN_FRONTEND=noninteractive
  $sudo_prefix apt-get update -qq
  $sudo_prefix apt-get install -y "$FFMPEG_APT_PACKAGE"
  log "ffmpeg installed."
}

# ---------------------------------------------------------------------------
# Step 2 — shot-scraper (with the video subcommand)
# ---------------------------------------------------------------------------
ensure_shot_scraper() {
  local need_install=false
  # Mirror ensure_ffmpeg: consult mise first, so a mise-managed shot-scraper
  # whose shim is not on the active PATH is not mistaken for missing and
  # needlessly reinstalled.
  if ! has shot-scraper && ! mise_provides shot-scraper; then
    need_install=true
  elif ! shot-scraper --help 2>/dev/null | grep -q "$VIDEO_SUBCOMMAND"; then
    log "shot-scraper present but lacks the '$VIDEO_SUBCOMMAND' subcommand; reinstalling."
    need_install=true
  fi

  if ! $need_install; then
    log "shot-scraper already installed with the '$VIDEO_SUBCOMMAND' subcommand; skipping install."
    return 0
  fi

  if [ "$CHECK_ONLY" = true ]; then
    warn "shot-scraper (with its '$VIDEO_SUBCOMMAND' subcommand) is not installed."
    return 1
  fi

  # mise.toml pins shot-scraper, which is the reproducible path on both
  # platforms; uv is the fallback for machines without mise.
  if has mise; then
    log "Installing the pinned $SHOT_SCRAPER_MISE_TOOL via mise..."
    if PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 mise install "$SHOT_SCRAPER_MISE_TOOL"; then
      log "shot-scraper installed."
      return 0
    fi
    warn "mise could not install $SHOT_SCRAPER_MISE_TOOL; falling back to uv."
  fi

  has uv || die "Installing shot-scraper needs mise or uv, and neither is on PATH. Install mise (https://mise.jdx.dev) and re-run this script."
  log "Installing shot-scraper via uv (browser download skipped)..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 uv tool install shot-scraper
  log "shot-scraper installed."
}

# ---------------------------------------------------------------------------
# Step 2b — a browser to drive
# ---------------------------------------------------------------------------
# On a managed machine the browsers are preinstalled and the CDN is blocked,
# so the shim (step 3) is what makes them usable. Everywhere else — a
# developer's own Linux box or Mac — shot-scraper downloads its own.
ensure_browser() {
  if [ "$HAS_MANAGED_BROWSERS_DIR" = true ]; then
    log "Managed browsers dir present at ${ON_DISK_BROWSERS_PATH}; skipping browser download."
    return 0
  fi

  if shot-scraper install --help > /dev/null 2>&1 && [ "$CHECK_ONLY" = false ]; then
    log "Ensuring shot-scraper's browser is installed..."
    shot-scraper install
    return 0
  fi

  if [ "$CHECK_ONLY" = true ]; then
    log "No managed browsers dir; assuming shot-scraper manages its own browser."
  fi
}

# ---------------------------------------------------------------------------
# Step 3 — browser-revision shim
# ---------------------------------------------------------------------------

# Read the pinned revision of a browser from playwright's browsers.json.
required_revision() {
  local browsers_json="$1" browser_name="$2"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const entry = data.browsers.find((b) => b.name === process.argv[2]);
    if (!entry) { process.exit(3); }
    process.stdout.write(String(entry.revision));
  ' "$browsers_json" "$browser_name"
}

# Build the headless-shell revision directory inside the shim: a real dir with
# a real inner chrome-headless-shell-linux64/ dir, the renamed binary symlink,
# per-file symlinks to every sibling, and the two ready markers.
build_headless_shell_shim() {
  local src_rev_dir="$1" target_rev_dir="$2"

  local src_inner src_binary
  if [ -d "${src_rev_dir}/${OLD_HS_INNER_DIR}" ] && [ -e "${src_rev_dir}/${OLD_HS_INNER_DIR}/${OLD_HS_BINARY_NAME}" ]; then
    # Old layout: chrome-linux/headless_shell
    src_inner="${src_rev_dir}/${OLD_HS_INNER_DIR}"
    src_binary="${src_inner}/${OLD_HS_BINARY_NAME}"
  elif [ -d "${src_rev_dir}/${NEW_HS_INNER_DIR}" ] && [ -e "${src_rev_dir}/${NEW_HS_INNER_DIR}/${NEW_HS_BINARY_NAME}" ]; then
    # Already-new layout: chrome-headless-shell-linux64/chrome-headless-shell
    src_inner="${src_rev_dir}/${NEW_HS_INNER_DIR}"
    src_binary="${src_inner}/${NEW_HS_BINARY_NAME}"
  else
    die "Could not locate a headless-shell binary under ${src_rev_dir} (neither ${OLD_HS_INNER_DIR}/${OLD_HS_BINARY_NAME} nor ${NEW_HS_INNER_DIR}/${NEW_HS_BINARY_NAME})."
  fi

  local target_inner="${target_rev_dir}/${NEW_HS_INNER_DIR}"
  mkdir -p "$target_inner"

  # The renamed binary the new playwright expects.
  ln -sfn "$src_binary" "${target_inner}/${NEW_HS_BINARY_NAME}"

  # Every sibling of the binary (resource .pak files, icudtl.dat, libs,
  # locales, etc.) needs a symlink under the same inner dir name.
  local src_binary_base
  src_binary_base="$(basename "$src_binary")"
  local entry base
  shopt -s nullglob
  for entry in "${src_inner}"/*; do
    base="$(basename "$entry")"
    [ "$base" = "$src_binary_base" ] && continue
    ln -sfn "$entry" "${target_inner}/${base}"
  done
  shopt -u nullglob

  touch "${target_rev_dir}/${INSTALL_MARKER}" "${target_rev_dir}/${DEPS_MARKER}"
}

# Returns 0 (shim built/refreshed) or 1 (no shim needed). On a built shim,
# sets the global EFFECTIVE_BROWSERS_PATH to the shim; otherwise leaves the
# on-disk path.
EFFECTIVE_BROWSERS_PATH="$ON_DISK_BROWSERS_PATH"
build_shim_if_needed() {
  # Without a managed, download-blocked browsers dir there is nothing to
  # remap: shot-scraper's own playwright fetches the revision it pins.
  if [ "$HAS_MANAGED_BROWSERS_DIR" != true ]; then
    log "No managed browsers dir at ${ON_DISK_BROWSERS_PATH}; shot-scraper uses its own browsers."
    return 1
  fi

  local browsers_json
  browsers_json="$(find_browsers_json)"
  # A warning rather than `die`: this runs from setup, and `exit`
  # inside a function is not something the caller's `|| true` can catch, so
  # dying here would abort the whole setup over an evidence-only problem.
  if [ -z "$browsers_json" ]; then
    warn "Could not find playwright's browsers.json for the installed shot-scraper; skipping the browser shim. Evidence recording may not work until shot-scraper is reinstalled."
    return 1
  fi
  log "Reading required browser revisions from ${browsers_json}"

  local req_chromium req_headless req_ffmpeg
  req_chromium="$(required_revision "$browsers_json" "$CHROMIUM_BROWSER_NAME")"
  req_headless="$(required_revision "$browsers_json" "$HEADLESS_SHELL_BROWSER_NAME")"
  req_ffmpeg="$(required_revision "$browsers_json" "$FFMPEG_BROWSER_NAME")"

  local disk_chromium_dir disk_headless_dir disk_ffmpeg_dir
  disk_chromium_dir="$(first_glob "${ON_DISK_BROWSERS_PATH}/${CHROMIUM_DIR_PREFIX}-*")"
  disk_headless_dir="$(first_glob "${ON_DISK_BROWSERS_PATH}/${HEADLESS_SHELL_DIR_PREFIX}-*")"
  disk_ffmpeg_dir="$(first_glob "${ON_DISK_BROWSERS_PATH}/${FFMPEG_DIR_PREFIX}-*")"

  [ -n "$disk_chromium_dir" ] || die "No ${CHROMIUM_DIR_PREFIX}-* directory found in ${ON_DISK_BROWSERS_PATH}."
  [ -n "$disk_headless_dir" ] || die "No ${HEADLESS_SHELL_DIR_PREFIX}-* directory found in ${ON_DISK_BROWSERS_PATH}."
  [ -n "$disk_ffmpeg_dir" ] || die "No ${FFMPEG_DIR_PREFIX}-* directory found in ${ON_DISK_BROWSERS_PATH}."

  local disk_chromium disk_headless disk_ffmpeg
  disk_chromium="$(revision_of "$disk_chromium_dir")"
  disk_headless="$(revision_of "$disk_headless_dir")"
  disk_ffmpeg="$(revision_of "$disk_ffmpeg_dir")"

  log "Required revisions:  chromium=${req_chromium} headless-shell=${req_headless} ffmpeg=${req_ffmpeg}"
  log "On-disk revisions:   chromium=${disk_chromium} headless-shell=${disk_headless} ffmpeg=${disk_ffmpeg}"

  if [ "$req_chromium" = "$disk_chromium" ] && \
     [ "$req_headless" = "$disk_headless" ] && \
     [ "$req_ffmpeg" = "$disk_ffmpeg" ]; then
    log "Required revisions match the on-disk browsers; no shim needed."
    return 1
  fi

  log "Revision mismatch detected; building shim at ${SHIM_ROOT}"
  mkdir -p "$SHIM_ROOT"

  # Headed chromium: a plain directory symlink is enough.
  ln -sfn "$disk_chromium_dir" "${SHIM_ROOT}/${CHROMIUM_DIR_PREFIX}-${req_chromium}"

  # Headless shell: needs its inner layout remapped (see build_headless_shell_shim).
  build_headless_shell_shim \
    "$disk_headless_dir" \
    "${SHIM_ROOT}/${HEADLESS_SHELL_DIR_PREFIX}-${req_headless}"

  # ffmpeg: plain directory symlink under the required revision name.
  ln -sfn "$disk_ffmpeg_dir" "${SHIM_ROOT}/${FFMPEG_DIR_PREFIX}-${req_ffmpeg}"

  EFFECTIVE_BROWSERS_PATH="$SHIM_ROOT"
  log "Shim ready."
  return 0
}

# ---------------------------------------------------------------------------
main() {
  local failures=0

  ensure_ffmpeg || failures=$((failures + 1))
  ensure_shot_scraper || failures=$((failures + 1))

  # Both remaining steps need a working shot-scraper; skip them when it is
  # absent so the output names the real problem instead of a cascade. Same
  # mise-aware check as above, so a shim that is not on PATH still counts.
  if has shot-scraper || mise_provides shot-scraper; then
    ensure_browser
    build_shim_if_needed || true
  fi

  echo
  if [ "$failures" -gt 0 ]; then
    warn "evidence tooling is incomplete ($failures missing). Run this script without --check to install it."
    return 1
  fi

  # Only advertise a browsers path when one is actually in play. With no
  # managed dir the default here is Linux's /opt/pw-browsers, which does not
  # exist on a developer machine — telling someone to export it would point
  # shot-scraper at nothing and break the very thing this script sets up.
  if [ "$EFFECTIVE_BROWSERS_PATH" = "$ON_DISK_BROWSERS_PATH" ] && [ "$HAS_MANAGED_BROWSERS_DIR" != true ]; then
    log "Evidence tooling ready. shot-scraper manages its own browsers here — leave PLAYWRIGHT_BROWSERS_PATH unset."
    return 0
  fi

  log "Evidence tooling ready. Use this browsers path for every shot-scraper invocation:"
  echo "PLAYWRIGHT_BROWSERS_PATH=${EFFECTIVE_BROWSERS_PATH}"
}

main "$@"
