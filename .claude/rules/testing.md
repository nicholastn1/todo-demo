---
paths:
  - 'src/**/*.ts'
  - 'src/**/*.tsx'
  - 'src/**/*.test.ts'
  - '.github/scripts/**'
  - '.claude/skills/**/scripts/**'
  - 'vite.config.ts'
  - 'package.json'
---

# Rule: Testing

Two runners, deliberately. Know which one owns the file you are touching.

| Code | Runner | Command |
| --- | --- | --- |
| App code under `src/` | Vitest | `npm test` |
| Repo scripts (`.github/scripts/`, skill scripts) | `node:test` | `npm run test:scripts` |

Scripts stay on `node:test` because they are plain `.cjs`/`.mjs` that must run
with nothing installed — in a CI job, or on a machine that never ran
`npm install`. Adding them to Vitest would couple a repo script to the app's
build tooling.

## The dotdir trap

Vitest scans dot-directories, so `.claude/**` and `.github/**` are excluded in
`vite.config.ts`. Without that it collects the script suites, finds no Vitest
suite inside them, and fails. **Adding a script suite under a new dot-directory
means adding that directory to the exclude list**, or `npm test` breaks for
reasons that look nothing like the change.

## Method

- **Test the logic, not the rendering.** State transitions live as pure
  functions in `src/todos.ts` (`addTodo`, `toggleTodo`, `archiveDone`,
  `filterTodos`) precisely so they can be asserted directly, with no jsdom, no
  Testing Library, no component harness. Keep new logic there and the test
  stays a one-liner.
- **A component is a thin shell.** If `App.tsx` grows logic worth testing,
  that is the signal to move it into `todos.ts`, not to add a rendering test.
- **Assert behaviour, not implementation.** `filterTodos(sample, 'all')`
  returning the right ids, not which array method it used.
- **One runnable check per branch of real logic.** A parser, a guard, a money
  or security path, a regex that classifies input — each leaves behind the
  smallest test that fails if it breaks. Trivial one-liners need none.
- **Name the test after the claim**: `'"all" esconde arquivadas'`, not
  `'test filterTodos'`. A failing name should tell you what broke.

## What gets a test without argument

- Anything the CI gate depends on. `evidence-check.mjs` decides whether a PR
  can merge, so its exemption path, its required path, its partial-evidence
  path, and its HTML-comment stripping are all covered — a false exemption
  there would let an unproven UI change through.
- Anything with a documented external contract: GitHub's attachment size
  ceilings, the `user-attachments` URL shape that renders inline.
- Any regression a human found. The `visible.length` section-count bug is now
  pinned by a before/after assertion.

## Verifying a change to test infrastructure

Run all of it, not the part you touched:

```bash
npm run lint && npm run build && npm test && npm run test:scripts
```
