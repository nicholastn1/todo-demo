---
name: fix-contrast
description: Repair one colour-contrast target selected by the contrast loop. Adjusts the palette in src/App.css so the pair meets WCAG 2.2 AA, without weakening the design or touching anything else. Invoked by the agent-contrast workflow; also usable by hand.
---

# Fix Contrast

One iteration repairs **one violating element**. You are given a target from
`npm run agent:contrast:select`; you change `src/App.css` so that pair meets
its required ratio, and you change nothing else.

## Hard boundaries

These are enforced by `npm run agent:contrast:boundary`, which runs after you
and fails the iteration if you cross them:

- **`src/App.css` is the only file you may edit.** Not `App.tsx`, not the
  rules, not the tests, not the workflow.
- **Never suppress instead of fixing.** No `axe` exclusions, no
  `oxlint-disable`, no wrapping the element to hide it from the scanner, no
  removing the element or its text.
- **Never lower the bar.** Do not raise `font-size` purely to cross the
  large-text threshold and dodge 4.5:1. Enlarging text is a real fix only when
  the size was wrong on its own terms — say so explicitly if you claim it.
- **Never commit, push, or open a pull request.** The workflow does that in a
  separate job that you do not run in.
- **Report SKIPPED rather than force an unsound repair.** A pair that cannot
  be fixed without redesigning the palette is a legitimate skip. Say what you
  tried and what it would cost.

## Step 1 — Understand the target

The selector gives you one element: its `target` selector, `foreground`,
`background`, `fontSizePt`, `bold`, the measured `ratio` and the `required`
ratio.

A repair is a token change, and tokens are shared, so fixing this element will
often clear others in the same edit. That is fine and expected — the scan
count, not a per-element tally, is what the iteration is judged on. Do not
contrive a narrower change just to affect exactly one element.

Find which tokens produce that pair. The palette lives at the top of
`src/App.css` as custom properties on `:root`, redefined under
`@media (prefers-color-scheme: dark)`. `#cc3311` is `--mark` in light,
`#e7dece` is `--paper-deep`, `#16130f` is `--ink`, `#4a4238` is `--ink-soft`.

Read `.claude/rules/accessibility.md` before deciding. It, not this file, owns
the project's contrast policy.

## Step 2 — Choose the smallest sound repair

In order of preference:

1. **Darken or lighten the token** so every use of the pair passes. Best when
   the token is already close and the shift is imperceptible.
2. **Introduce a paired variant** — e.g. a `--mark-on-paper` used only where
   the mark sits on the deep paper — when moving the base token would hurt the
   pairs that currently pass.
3. **Change which token that element uses**, when the element was simply
   assigned the wrong one.

Whatever you pick, **the design intent must survive**. This palette is
deliberate: ink-on-newsprint, flat fills, hard rules, one vermillion accent,
built so H.264 compression on a video call does not destroy it. A repair that
turns the accent muddy or grey has traded one defect for another — prefer
option 2 in that case.

Both themes are in scope. A token you change in `:root` may also need its dark
counterpart adjusted; a token you change *only* under the dark media query
leaves light untouched, which is usually wrong.

## Step 3 — Verify before you report

```bash
npm run build
npm run --silent agent:contrast:scan
```

The scan count must be **lower** than it was, and your target's colour pair
must be gone from the groups. If the count went up, you introduced a new
failure elsewhere — that is a failed iteration, not a partial win.

Then confirm you broke nothing else:

```bash
npm run lint && npm test && npm run test:scripts
npm run agent:contrast:boundary --base main
```

## Step 4 — Report

State, in this order:

1. The pair you repaired, with before/after ratios.
2. The exact token change, and why that option over the other two.
3. Whether the dark theme needed a matching change, and the evidence either way.
4. The scan count before and after.
5. Anything you deliberately left — a pair you judged unfixable without a
   redesign belongs here, named, not silently skipped.

Do not describe the change as complete on the strength of the diff alone. The
scan count is the claim; everything else is commentary.
