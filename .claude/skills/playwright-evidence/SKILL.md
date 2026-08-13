---
name: playwright-evidence
description: Use when asked to record evidence that a feature or fix works, capture proof a branch's change behaves correctly, or via "/playwright-evidence [branch-or-PR]". Runs the Vite dev server, drives it with a shot-scraper storyboard, and saves numbered screenshots + a video + a markdown summary under docs/evidence/.
---

# Playwright Evidence

Turns a branch's diff into numbered screenshots, a video (webm + mp4), and a
`summary.md` under `docs/evidence/<branch-slug>/`. It never modifies
application source — with one user-approved exception, Step 4's
stable-test-id offer.

Run every command from the repo root. Read a reference file only when its
branch of the work fires:

| Situation | Read |
| --- | --- |
| Attaching the evidence to a pull request | [`references/pr-attachment.md`](references/pr-attachment.md) |
| A step fails, a screen never loads, a selector never resolves | [`references/troubleshooting.md`](references/troubleshooting.md) |

This app has **no authentication, no database, and no feature flags** — the
whole storyboard runs against a plain dev server. That is why this skill is
six short steps rather than an environment-provisioning exercise.

## Step 0 — Tooling check (read-only)

```bash
npm run evidence:doctor    # reports what's missing, installs nothing
```

Gaps → run the same script without `--check`:
`bash .claude/skills/playwright-evidence/scripts/setup-evidence-tooling.sh`.
It installs ffmpeg + shot-scraper (Playwright's bundled ffmpeg cannot encode
H.264, so `--mp4` needs a real one). Do not start the server yet — setup
begins only after Step 2's confirmation.

## Step 1 — Discover context

Run these in parallel — neither depends on the other:

1. `git diff main...HEAD --stat`, then the full diff of changed files.
2. `gh pr view --json title,body,url,headRefName` for the branch's open PR.
   No PR → proceed on the diff alone.

Evidencing a branch other than the current checkout? `git switch <branch>`
first — the dev server records whatever is checked out, and Vite's HMR picks
up a switch under a running server, which silently mixes two branches into
one recording. Switch first, then start the server.

## Step 2 — Plan the scenario, then stop for confirmation

From the diff + PR, write a concrete plan: which filter/route to exercise,
what actions to take, and what observable outcome proves the change works.
The app's state lives in `src/todos.ts` (`seed`, `addTodo`, `toggleTodo`,
`archiveDone`, `filterTodos`) and renders through `src/App.tsx` — read both
before planning, so the plan names outcomes the UI actually shows.

**Fatal precondition:** a diff with **no UI surface** — a change only to the
pure functions, with no visible consequence — has nothing to film. Stop and
ask the user for explicit steps; Vitest output may be the right deliverable
instead (`npm test`).

**Interactive session:** print the plan and wait for approval before Step 3.

**Unattended session** (a queued cloud task, an explicit `--auto`): proceed
with the inferred plan and mark it **"scenario inferred, not
user-confirmed"** in `summary.md` and any PR body. The precondition above
still stops the run in any mode.

## Step 3 — Dev server

```bash
mise x -- npm run dev > /tmp/todo-evidence-dev.log 2>&1 &
```

- Log to `/tmp`, **not** into the repo — a log inside `docs/evidence/` ends
  up in the deliverables.
- `mise x --` matters: `mise.toml` pins Node 24 because `vite@8` requires
  `>=22.12` and the machine default is older. Without it Vite may refuse to
  start.
- Wait for the `Local:` line in the log (a cold start is a few seconds), then
  confirm it actually serves before spending a storyboard on it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/    # expect 200
```

Vite takes the next free port when 5173 is busy — read the real URL off the
`Local:` line rather than assuming. Export it once:

```bash
APP_URL="$(grep -o 'http://localhost:[0-9]*' /tmp/todo-evidence-dev.log | head -1)"
```

**Ephemeral workspace.** Storyboard YAML and working files →
`/tmp/todo-evidence/`. Deliverables only (screenshots, video, summary) →
`docs/evidence/<branch-slug>/`, which is gitignored: evidence reaches a PR
as attachments, never as commits.

**State is in-memory.** The app has no persistence — every page load resets
to the 20 seeded tasks in `src/todos.ts`. That makes runs perfectly
repeatable, and it means a storyboard cannot rely on state from a previous
scene after a navigation. If a scenario needs a starting state the seed does
not cover, edit `seed` on the branch under test rather than scripting the UI
into position.

## Step 4 — Explore the real selectors

You cannot write a working storyboard blind. Dump the page's DOM inventory
(headings, buttons, links, inputs, test ids, with `title` / `aria-label` /
`placeholder`):

```bash
npm run evidence -- javascript "$APP_URL" \
  -i .claude/skills/playwright-evidence/scripts/dump-selectors.js
```

Inspect the page **in the state each selector will run against** — the
"Arquivar concluídas" button is `disabled` when no task is `done`, and a
disabled button never takes a click. The two selector mistakes that cause
most storyboard failures:

- **Icon-only buttons** carry their name in a `title` attribute, which
  `:has-text()` never matches — use `button[title="Ascending"]`.
- **Bare text is ambiguous, and badly so here.** The word "concluídas"
  appears in the filter tab, the archive button, the tally cell, **and** the
  per-row status stamp — four matches for `text=Concluídas`, a strict-mode
  violation every time. Scoping to `nav.filters` is **not enough**: the archive
  button lives in there too, so `nav.filters button:has-text("Concluídas")`
  still resolves to two elements. Scope by class:
  `.filters__tab:has-text("Concluídas")` for the tab,
  `.filters__archive` for the archive button, `.ledger__stamp--done` for a
  row's stamp.

This app's filter buttons carry `aria-pressed`, so
`button[aria-pressed="true"]` is a reliable way to assert which filter is
active — prefer it over reading the CSS class. Note the tabs also render
their count inside the button, so the accessible name is `Concluídas7`, not
`Concluídas` — `has-text()` substring matching still works, but an exact-text
locator will not.

**No stable selector at all?** In an interactive session, offer the user a
small source change: add a `data-testid` to the element, as part of the
branch itself. This is the skill's only application-source change and it
needs the user's approval. Unattended: use the best available selector and
note its fragility in `summary.md`.

## Step 5 — Storyboard and capture

One YAML file in `/tmp/todo-evidence/`, one scene per step of the confirmed
plan, a `screenshot:` wherever a numbered image is needed:

```yaml
output: docs/evidence/<branch-slug>/demo.webm
url: http://localhost:5173/
viewport: { width: 1280, height: 900 }
cursor: true
wait_for: 'h1:has-text("Todo")'
scenes:
  - name: Add a task
    do:
      - screenshot: docs/evidence/<branch-slug>/01-initial.png
      - click: 'input[aria-label="Nova tarefa"]'
      - type:
          into: 'input[aria-label="Nova tarefa"]'
          text: "Gravar a evidência"
          delay_ms: 40
      - click: 'button[type="submit"]'
      - wait_for: 'text=Gravar a evidência'
      - screenshot: docs/evidence/<branch-slug>/02-added.png
  - name: Archive the completed ones
    do:
      - click: 'button:has-text("Arquivar concluídas")'
      - click: '.filters__tab:has-text("Arquivadas")'
      - wait_for: '.filters__tab[aria-pressed="true"]:has-text("Arquivadas")'
      - screenshot: docs/evidence/<branch-slug>/03-archived.png
```

- **`output:` points at `docs/evidence/<branch-slug>/` directly**, same as
  the screenshots — `--mp4` writes the sibling `.mp4` next to it, so this one
  path covers both files. A scratch-path video silently falls outside the
  deliverables.
- **Use `type:`/`fill:`, never a `js:` value-set** — setting `element.value`
  does not fire a React controlled input's change handler, so `App.tsx`'s
  `setTitle` never runs and the form submits empty.
- **Hold each beat with `pause: <seconds>`.** shot-scraper drives the page as
  fast as it can, so a scene without pauses is unwatchable — a filter switch
  lands in well under a second, and a viewer sees the list flicker without
  reading what changed. Give any state worth understanding its own scene and
  **2–3 seconds** after the `wait_for`. A screenshot is not enough on its own:
  the video is what a reviewer actually plays. (`pause` is the action name;
  `wait` is not valid and fails the whole run.)
- **Verify the pacing instead of assuming it.** Sample the rendered video
  rather than trusting the YAML — one frame per second, checking which state is
  on screen:

  ```bash
  ffprobe -v error -show_entries format=duration -of default=nw=1 <video>.mp4
  ffmpeg -v error -ss <t> -i <video>.mp4 -frames:v 1 \
    -vf "crop=200:20:60:<y>,scale=1:1" -f rawvideo -pix_fmt rgb24 - | od -An -tu1
  ```

  The active filter tab is a dark block, so a low RGB sum at its row means it
  is the selected one — enough to prove each section actually stayed on screen.

Run it:

```bash
npm run evidence -- video /tmp/todo-evidence/storyboard.yml
```

The wrapper supplies the browsers path, the cert flag, and
`--mp4 --bypass-csp`. A failed scene names the selector that did not
resolve — fix it per Step 4 and rerun the whole storyboard; each run is a
fresh browser context against the still-running server, so retries are free.

If the scenario needs real branching a fixed YAML cannot express, dispatch a
subagent with interactive browser tooling against the same `$APP_URL`.

## Step 6 — Report and tear down

1. Write `docs/evidence/<branch-slug>/summary.md`: branch, PR link, the
   scenario steps with ✅/❌, references to the numbered screenshots and the
   video, any console/network errors. A mid-scenario failure still gets
   captured: mark the step ❌, stop remaining steps, write the summary.
2. Send the key screenshots (and the video when useful) to the user
   directly — not just a folder path.
3. Kill the dev server — always, success or failure. The evidence is already
   on disk.

```bash
pkill -f 'vite' || true      # or kill the backgrounded job by PID
```

Opening or updating a PR with this evidence → `references/pr-attachment.md`.
