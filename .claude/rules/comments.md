---
paths:
  - 'src/**/*.ts'
  - 'src/**/*.tsx'
  - '.github/scripts/**/*.mjs'
  - '.claude/skills/**/scripts/**/*.cjs'
  - '.claude/skills/**/scripts/**/*.js'
---

# Rule: Comments — Don't Explain Logic

**Do not comment logic.** If code needs a comment to be understood, rename the
variable or extract a function — the comment is a symptom, not the fix. A
comment that restates the code is pure liability: it duplicates what the
compiler already checks, and it becomes a lie the first time someone edits the
line above it without editing the comment.

## Never write these

```ts
// ❌ restates the code
// Filter the todos by status
const visible = filterTodos(todos, filter)

// ❌ section headers inside a function
// --- validation ---

// ❌ describes what a well-named thing already says
/** Adds a todo. */
export function addTodo(todos: Todo[], title: string) {}

// ❌ narrates a change or a decision that belongs in the commit message / PR
// Changed this to gate on intro instead of animating every render

// ❌ commented-out code — delete it, git remembers
// const oldCount = todos.length
```

## The only comments allowed

1. **A constraint that is invisible in the code.** This repo's UI is demoed
   live over a video call, so several choices exist to survive H.264 rather
   than for taste — the 3px rule floor, the struck rule instead of a faded
   grey, the load-only row stagger. Nothing in the code says "codec", so those
   comments carry real information. Same for the browser and harness facts:
   why `type:` beats a `js:` value-set on a React input, why Vitest needs
   `.claude/**` excluded.
2. **A reference to a fact outside this repo** — an undocumented endpoint's
   behaviour, a GitHub size ceiling, a tool's exit-code quirk. State the fact
   and where it came from, not how the code works.
3. **A security reason.** Why the PR body is read from `GITHUB_EVENT_PATH`
   instead of a `${{ }}` interpolation is not inferable from the code.
4. **Deferred work, with an owner** — `// TODO(nicholas): …`. A bare `TODO` is
   a comment nobody owns.
5. **Directives the tooling reads** — `oxlint-disable-next-line` (with its
   reason), `@ts-expect-error`, `@vitest-environment`.
6. **`ponytail:` markers** naming a deliberate shortcut and its ceiling.

Keep an allowed comment to one line where it fits. A file-header block
explaining a script's whole purpose and contract is fine — that is orientation,
not logic narration.

## Applying it

This rule governs code **you write or edit**. Delete offending comments on
lines you are already changing; leave the rest alone. Do not open a
comment-stripping PR.
