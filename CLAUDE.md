# todo-demo

A todo list built to be demoed live, over a video call. That framing decides
more than it looks like it should — see `.claude/rules/accessibility.md` and
the header of `src/App.css`.

## Layout

| Path | What |
| --- | --- |
| `src/todos.ts` | All state logic, as pure functions. The seed lives here. |
| `src/App.tsx` | A thin `useState` shell over those functions. |
| `src/App.css` | Ink-on-newsprint tokens and layout. |
| `.github/workflows/` | Two PR checks: `validate` and `PR Evidence`. |
| `.github/scripts/evidence-check.mjs` | The evidence gate, and its `--preflight` mode. |
| `.claude/skills/playwright-evidence/` | Records screenshots + video of a change. |
| `.claude/skills/create-pr/` | Commit → preflight → push → attach evidence → open PR. |
| `docs/evidence/` | Deliverables, gitignored. They reach a PR as attachments. |

## Rules

Path-scoped, in `.claude/rules/` — they load when you touch a matching file:

- `comments.md` — don't comment logic; what the four allowed categories are
- `constants.md` — no magic strings/numbers; one home for a shared rule
- `accessibility.md` — WCAG 2.2 AA, hand-rolled primitives, both themes
- `testing.md` — two runners, which owns what, and the Vitest dotdir trap
- `ci.md` — workflow topology; every gate must be able to fail

## Commands

```bash
mise x -- npm run dev     # :5173
npm run lint              # oxlint --deny-warnings
npm run build             # tsc -b && vite build — this is the typecheck
npm test                  # Vitest, app code
npm run test:scripts      # node:test, repo + skill scripts
```

**Always `mise x --` for dev and build.** `mise.toml` pins Node 24 because
`vite@8` needs `>=22.12` and this machine's default is older; without it Vite
may refuse to start.

## Two things that will bite you

**The `gh` account.** This repo is `nicholastn1/todo-demo` (personal), but the
machine's active `gh` account is usually the work one. The shell's `gh` wrapper
routes on the `origin` owner and gets it right; anything calling the `gh`
**binary** directly — including `upload-evidence-attachments.cjs` — bypasses
that and uses the active account, failing with an opaque HTTP error. Export the
token for the run: `export GH_TOKEN="$(gh auth token -u nicholastn1)"`. Never
`gh auth switch`; it changes global state for every open terminal.

**The evidence gate.** Any PR touching `src/` or `index.html` needs a video and
a screenshot in its body or CI fails it. Check before you push:
`node .github/scripts/evidence-check.mjs --preflight`.
