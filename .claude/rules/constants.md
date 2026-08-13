---
paths:
  - 'src/**/*.ts'
  - 'src/**/*.tsx'
  - '.github/scripts/**/*.mjs'
  - '.claude/skills/**/scripts/**/*.cjs'
---

# Rule: No Magic Strings or Numbers

Never inline a literal that represents a state, a category, a threshold, or a
path convention. Name it once and reference the name.

## Rules

1. **A value from a finite set gets a type.** This repo's established pattern
   is a string union plus a `const` array, not a TypeScript `enum` — see
   `Status` and `Filter` in `src/todos.ts`, and the `FILTERS` / `TALLY` arrays
   in `src/App.tsx`. Follow the established pattern; do not introduce `enum`
   into a file that uses unions.
2. **A number with meaning gets a name.** Thresholds, limits, delays, size
   ceilings. `IMAGE_SIZE_LIMIT_BYTES` and `VIDEO_SIZE_LIMIT_FREE_BYTES` in the
   upload script are the reference; a bare `10 * 1024 * 1024` in a comparison
   is not.
3. **A repeated path or magic filename gets a constant** — `UI_PATHS`,
   `EVIDENCE_DIR_RELATIVE_PATH`, `SUMMARY_FILE_NAME`. A path convention
   duplicated across two files is how the CI gate and a skill drift apart.
4. **Design tokens live in CSS custom properties**, never as repeated literals.
   `--rule`, `--ink`, `--mark` are defined once on `:root` and redefined in the
   dark block. A hardcoded `#cc3311` in a rule body is a bug waiting for the
   next palette change.

## Shared rules get one home

When the same rule has to hold in two places, export it and import it —
do not restate it. `touchesUi` in `.github/scripts/evidence-check.mjs` is the
single definition of "this change needs evidence"; the CI job and the
`create-pr` skill's preflight both call it. Copying the path list into the
skill would let the gate and the skill disagree, which is worse than either
being wrong.

## Example

```ts
// ❌ the same rule, restated
if (file.startsWith('src/') || file === 'index.html') { … }

// ✅
import { touchesUi } from '../../.github/scripts/evidence-check.mjs'
if (touchesUi(files)) { … }
```
