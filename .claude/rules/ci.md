---
paths:
  - '.github/workflows/**'
  - '.github/scripts/**'
  - 'package.json'
  - 'vite.config.ts'
---

# Rule: Pull Request CI Topology

Testing method lives in `.claude/rules/testing.md`; this rule owns the workflow
architecture that enforces it.

## Required architecture

- **`pr-tests.yml`** publishes one check, `validate`: lint → typecheck+build →
  Vitest → script tests. One job, one setup, no matrix.
- **`pr-evidence.yml`** publishes one check, `PR Evidence`: a UI change must
  ship a video and a screenshot in the PR body.
- **Do not add a third PR workflow**, or split either job, without a measured
  reason the current one cannot satisfy. The full suite runs in under a second;
  changed-file selection and coverage sharding would cost more to maintain than
  they could save.
- `npm run build` is `tsc -b && vite build`, so it *is* the typecheck. Do not
  add a separate `tsc` step.

## Every gate must be able to fail

A step that cannot fail is worse than no step: it reads as coverage while
providing none.

- **`oxlint` exits 0 on warnings.** `npm run lint` is `oxlint --deny-warnings`
  for exactly this reason. Verify a lint config change in both directions —
  clean tree exits 0, a file with a planted violation exits non-zero.
- **The evidence gate fails closed.** An empty changed-file list would read as
  "no UI touched" and waive the requirement, so a failure to resolve the file
  list must fail the check rather than pass it.
- When adding a gate, run it once against known-bad input and confirm the
  non-zero exit. Green on a clean tree proves nothing.

## Untrusted input

PR title, body, branch name, and commit messages are attacker-controlled.
Never interpolate them into a `run:` block with `${{ }}` — read them from
`GITHUB_EVENT_PATH`, or pass them through `env:` and quote the variable. The
evidence check reads the body from the event payload for this reason.

Grant the narrowest `permissions:` the job needs. `pr-evidence.yml` is
`contents: read` + `pull-requests: read`; it writes a step summary rather than
a PR comment, which is what keeps it out of `pull-requests: write`.

## One copy of a shared rule

`touchesUi` in `.github/scripts/evidence-check.mjs` defines what counts as a UI
change. The CI job and the `create-pr` skill's `--preflight` both call it. If a
new consumer needs that rule, import it — a second copy is how the local
preflight starts passing PRs that CI then rejects.

## Validating a CI change

```bash
npm run lint && npm run build && npm test && npm run test:scripts
node .github/scripts/evidence-check.mjs --preflight
```

A change to `evidence-check.mjs` also gets exercised against a real PR before
merging, since the pure-function tests do not cover the `gh` and event-payload
wiring:

```bash
gh pr view <n> --repo nicholastn1/todo-demo --json number,body \
  | node -e "…build an event payload…" > /tmp/event.json
GITHUB_EVENT_PATH=/tmp/event.json node .github/scripts/evidence-check.mjs
```
