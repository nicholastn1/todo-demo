# Troubleshooting an evidence run

Symptom-first. Find your symptom, apply the fix, rerun. Storyboard reruns are
free — each run is a fresh browser context against the still-running server.

## Nothing loads at all / connection refused

The dev server is not up, or not where you think it is.

1. Read the `Local:` line out of the log you backgrounded it into
   (`/tmp/todo-evidence-dev.log`). **Vite takes the next free port when 5173
   is busy**, so a second dev server from an earlier session pushes this one
   to 5174 and every hardcoded `localhost:5173` URL misses.
2. `curl -s -o /dev/null -w '%{http_code}\n' "$APP_URL"` must print 200
   before you spend a storyboard on it.
3. **Vite refuses to start on the wrong Node.** `vite@8` requires
   `>=22.12` and this machine's default is 22.5.1; `mise.toml` pins Node 24
   for the repo. Always launch through `mise x -- npm run dev`. The symptom
   is an engine error or a crash at startup, in the log — not a browser
   error.

## The page loads but renders blank / only the heading

A runtime error in React, which the storyboard cannot see. Re-run the DOM
dump (SKILL.md Step 4) and check the browser console:

```bash
npm run evidence -- javascript "$APP_URL" 'document.body.innerText'
```

An empty body with a clean HTTP 200 usually means a module-level throw — read
the dev-server log, which shows the transform error Vite reported.

## A storyboard scene times out on a selector

An authoring miss, not a broken environment. Re-dump the DOM **in the state
that scene runs against** (SKILL.md Step 4). The usual causes here:

- **A disabled button.** "Arquivar concluídas" carries `disabled` whenever no
  task is `done` — a click on it never lands and never errors. If the
  scenario archives, make sure a scene completes a task first, or that the
  seed still contains `done` rows.
- **An ambiguous bare-text selector.** `text=Concluídas` matches the filter
  tab, the archive button, the tally cell, and every completed row's status
  stamp — a strict-mode violation, not a missing element.
  **Scoping to `nav.filters` does not fix it**: the archive button
  ("Arquivar concluídas") is inside that nav and matches the same substring, so
  `nav.filters button:has-text("Concluídas")` still resolves to two elements.
  Scope by class instead — `.filters__tab:has-text("Concluídas")` for the tab,
  `.filters__archive` for the archive button, `.ledger__stamp--done` for a
  row's stamp. A storyboard that only ever clicked "Pendentes", "Todas", and
  "Arquivadas" will not have hit this; adding a "Concluídas" click is what
  surfaces it.
- **An exact-text locator on a filter tab.** The tabs render their count
  inside the button, so the text is `Pendentes8`. Use `has-text()` substring
  matching, or `aria-pressed`.
- **An element that only exists after an earlier interaction** — a task you
  add in scene 2 is not in the initial-load dump.
- **Accented text.** The UI is in Portuguese; `:has-text()` matching is
  exact on the accents, so `Arquivadas`/`concluídas` must be copied from the
  dump rather than retyped.

Fix the one selector, rerun the whole storyboard.

## A filter click appears to do nothing

The list is filtered but you asserted on the wrong thing. `filterTodos` in
`src/todos.ts` treats `all` as "everything except archived" — so switching
from "Todas" to "Pendentes" changes the list without changing its emptiness,
and a `wait_for` on a row that is visible in both states passes immediately
and proves nothing. Assert on the active filter instead:
`button[aria-pressed="true"]:has-text("Pendentes")`.

## Typing into the input has no effect

You used a `js:` value-set. Assigning `element.value` does not fire a React
controlled input's change handler, so `App.tsx`'s `setTitle` never runs and
the form submits an empty title, which `addTodo` then discards. Use `type:`
or `fill:`.

## The video is missing, or is webm-only with no mp4

`shot-scraper video --mp4` needs a **real** ffmpeg — Playwright's bundled one
cannot encode H.264. `npm run evidence:doctor` reports whether one is on
PATH; the setup script installs it via Homebrew or apt.

## State from a previous scene disappeared

Expected. The app has no persistence — a navigation resets it to the 20
seeded tasks in `src/todos.ts`. Keep a scenario's state changes inside one
continuous run of scenes with no reload, or change `seed` on the branch under
test.

## Mid-scenario failure

Capture the failure state as evidence, mark the step ❌ in `summary.md`, skip
the remaining steps, and still tear down normally. A failed run with honest
evidence beats a stalled one.
