# Agent memory — contrast loop

What iterations have learned. Append findings that would otherwise be
rediscovered; keep it short enough to stay read.

## Scope

- Sensor: `npm run agent:contrast:scan` — axe-core `color-contrast` against the
  production build served by `vite preview`.
- Repairs land in `src/App.css` only.
- Policy owner: `.claude/rules/accessibility.md` (WCAG 2.2 AA).

## Palette map

| Token | Light | Dark |
| --- | --- | --- |
| `--paper` | `#f2ece1` | `#16130f` |
| `--paper-deep` | `#e7dece` | `#201b15` |
| `--ink` | `#16130f` | `#f2ece1` |
| `--ink-soft` | `#4a4238` | `#b3a794` |
| `--mark` | `#cc3311` | `#ff5c3d` |

## Findings

- **The scan must wait out the entry animation.** Rows stagger in for 900ms
  and blend toward the background while animating, so an early scan reports
  pairs like `#b1aa9f` on `#f2ece1` that correspond to no token and vanish on
  re-run. `SETTLE_MS` in `contrast-loop.mjs` is 2000ms for this reason. A
  reported foreground that matches nothing in the palette map above is the
  signature of this artefact, not a real finding.
- **`--mark` is the source of every violation in the first backlog.** Both
  directions fail: `--mark` as text on `--paper-deep` (3.88), and `--paper` as
  text on a `--mark` fill (4.41). Darkening `--mark` helps the first and hurts
  the second, so the two are not one repair despite sharing a token.
- **Small bold text is the trap.** WCAG's large-text relief starts at 14pt for
  bold, and the stamps and kicker sit at 9.8–12pt — just under it, so they need
  the full 4.5:1 rather than 3:1. Nothing in the CSS hints at this.
