---
name: create-pr
description: Create a GitHub pull request from the current branch's changes. Commits what is staged, pushes, attaches evidence, and opens a PR with the project's body template. Use when the user wants to open a PR for their current work.
user_invocable: true
user_input: optional
disable-model-invocation: true
---

# Create Pull Request

Commit → preflight → push → attach evidence → open the PR. No confirmation
prompts along the way; the user invoking this skill *is* the confirmation.

**Repository:** `nicholastn1/todo-demo` · **Base branch:** `main`

Always pass `--repo nicholastn1/todo-demo` so a stray git remote cannot send
the PR somewhere else.

## Language rule

Commit messages, PR titles, and PR bodies are written in **English**,
whatever language the user asked in. Conversation with the user stays in their
language.

## Step 0 — The account trap, before anything else

This repo belongs to the personal account `nicholastn1`, but the machine's
active `gh` account is usually the work one. Two different failure modes:

- `gh pr create` run through the shell's `gh` wrapper function picks the right
  token automatically (it routes on the `origin` owner).
- `upload-evidence-attachments.cjs` shells out to the **`gh` binary**, which
  bypasses that wrapper and uses the *active* account — a token with no access
  to this repo, failing with an opaque HTTP error.

So export the token explicitly for the whole run:

```bash
export GH_TOKEN="$(gh auth token -u nicholastn1)"
gh auth status   # confirm before continuing
```

Never run `gh auth switch` to fix this: it changes global state for every
terminal the user has open.

## Step 1 — Verify `gh`

`gh --version` and `gh auth status` in parallel. Not installed or not
authenticated → **stop**, tell the user (`brew install gh`, then
`gh auth login`), and wait. Do not attempt the PR.

## Step 2 — Analyze the changes

Run in parallel: `git status`, `git diff --cached --stat`,
`git log main..HEAD --oneline`. Then pick the change source, in this order:

1. **Staged files** → those are the change.
2. **Commits ahead of `main`** with a clean tree → already committed, skip to
   Step 4.
3. **Only unstaged changes** → tell the user to stage first, and stop.
4. **Nothing at all** → say so and stop.

Read the real diff (`git diff --cached`, or `git diff main..HEAD`) before
writing any prose about it.

## Step 3 — Evidence preflight

The `PR Evidence` check fails any PR touching `src/` or `index.html` without a
video and a screenshot in the body. Find that out **now**, not from a red
check:

```bash
node .github/scripts/evidence-check.mjs --preflight
```

This calls the same `touchesUi` rule the CI job uses — the skill cannot drift
from the gate, because there is only one copy of the rule. It reports whether
evidence is required and whether `docs/evidence/<branch-slug>/` already holds
a video and a screenshot. Exit code 1 means required-but-missing.

**On exit 1: stop. Do not commit, push, or open the PR.** Tell the user to run
`/playwright-evidence` first, then re-invoke this skill. Capturing after the
PR exists spends a failed CI round and leaves a red check on the thread.

## Step 4 — Commit

Commit staged work automatically — do not ask.

This repo's history uses a plain imperative subject line, **not** Conventional
Commits prefixes (`git log --oneline` to confirm before you break the
pattern). Subject under ~70 chars, then a body explaining *why*, and what a
reviewer should look at.

```bash
git commit -F - <<'EOF'
<imperative subject line>

<why this change, what it affects, anything non-obvious a reviewer needs>
EOF
```

If a hook rejects the commit, fix the cause, re-stage, and make a **new**
commit — never amend, so the fix stays visible in review.

## Step 5 — Push

```bash
git push -u origin "$(git branch --show-current)"
```

## Step 6 — Build the body

**The body is an inventory of what is in the diff. Nothing else.**

A reviewer opens it to answer three questions: what changed, how do I run it,
and what proves it works. Everything that does not serve those is noise, and
noise is what makes a description stop being read.

### Write

- **What each file does**, as a table. One row per file, one line per row.
- **The commands the change adds or changes**, as a table.
- **Facts about the current state** — counts, selected targets, what is
  configured, what does not run yet and why, in one line each.
- **Verification**, as pasted command output. Real output, copied, not
  described.

Prefer a table to a paragraph whenever the content is a list of things.

### Do not write

- **Why alternatives were rejected.** A table of options you did not take
  belongs in the conversation, not the PR.
- **Rationale essays.** "Decisions worth reviewing", "why this approach" —
  if a decision genuinely needs defending, one sentence next to the file it
  affects, not a section.
- **Hypotheticals.** What could have been done, what should happen if
  something else were true, what would break under a scenario not in this
  diff.
- **Caveats about things outside the diff** — how a tool behaves under load,
  what a future PR will need, advice for the reader's process.
- **Narrative.** How a bug was found, what was tried first, what surprised
  you. The commit message can carry that; the PR body is not a diary.
- **Restating the diff in prose.** If the table says a file adds a flag, do
  not also write a paragraph saying the file adds a flag.

### Verify every number before you write it

Counts, file lists, and versions get checked against the repo, not recalled:

```bash
gh pr diff <n> --repo nicholastn1/todo-demo --name-only    # the real file list
grep -c '^test(' <test-file>                               # the real test count
```

A wrong number in a description is worse than an absent one — it is the part a
reviewer trusts without checking.

### Keep it current

If you push after writing the body, re-read it. A body written for the first
commit and left alone will describe behaviour the later commits removed, and
the worst case is a description that argues *for* what was deleted. Re-run the
verification block too; its numbers move.

### Template

```markdown
## O que entra

| Arquivo | Função |
|---|---|
| ... | ... |

## Comandos

| Comando | O que faz |
|---|---|
| ... | ... |

## Estado atual

- <facts, one line each>

## Verificação

\`\`\`
<pasted command output>
\`\`\`

<Agent Evidence section — see below>
```

Drop any section with nothing to put in it. A PR that changes one file needs
one table and a verification block, not five empty headings.

**When `docs/evidence/<branch-slug>/` exists**, generate the whole Agent
Evidence section rather than writing it by hand:

```bash
mkdir -p /tmp/todo-evidence
node .claude/skills/playwright-evidence/scripts/upload-evidence-attachments.cjs \
  > /tmp/todo-evidence/uploads.json
node .claude/skills/playwright-evidence/scripts/build-evidence-pr-block.cjs \
  --attachments "$(cat /tmp/todo-evidence/uploads.json)"
```

The first uploads each file and returns `user-attachments` URLs that GitHub
renders inline; the second builds the section around them, inlines the run's
`summary.md` as log evidence, and appends the computed token usage. Use the
output **verbatim**.

If a file fails to upload, the block names its local path instead — deliver
that file to the user and say in the body that its attachment is pending their
drag-in. Never route it through a Release, tag, Gist, or evidence branch.

**When there is no evidence folder** (a non-UI change), write the section by
hand: `**Video evidence:** n/a — non-UI change, see log evidence below.`, then
paste real gate output as log evidence, then the token usage from:

```bash
node .claude/skills/create-pr/scripts/token-usage.cjs
```

Paste both of its lines verbatim, including the blank line between them — it
matters for Markdown. **Compute it, never estimate.** Write `n/a` with a
one-line reason only when the script itself fails. If the session leaned on
`advisor()`, also run `/cost` and note that total alongside, since the script
reads only the transcript's own API usage.

## Step 7 — Open it

```bash
gh pr create --repo nicholastn1/todo-demo --base main \
  --head "$(git branch --show-current)" \
  --title "<title>" --body-file /tmp/todo-evidence/pr-body.md
```

Prefer `--body-file` over `--body "$(...)"`: the body contains backticks and
`$` from pasted log output, and a heredoc through a shell argument will mangle
some of it.

## Step 8 — Confirm

Report the PR number, title, and URL. Then check the gates actually went
green rather than assuming:

```bash
sleep 25 && gh pr checks <number> --repo nicholastn1/todo-demo
```

Both `validate` and `PR Evidence` must pass. If one fails, read its log and
say what broke — do not leave the user to discover it.
