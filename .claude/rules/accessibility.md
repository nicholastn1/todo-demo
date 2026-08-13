---
paths:
  - 'src/**/*.tsx'
  - 'src/**/*.css'
  - 'index.html'
---

# Rule: Accessibility

No component library here — every primitive is hand-rolled, so nothing is
handled for you. Target: **WCAG 2.2 AA**.

The video-call constraint and accessibility mostly pull the same direction:
high contrast, no state signalled by colour alone, large targets. Where they
seem to conflict, accessibility wins.

## ARIA & semantic HTML

| Element | Requirement |
| --- | --- |
| Icon-only / text-less controls | `aria-label` describing the action |
| Decorative elements | `aria-hidden="true"` — e.g. the masthead dot, the row index |
| Custom toggle buttons | `aria-pressed` reflecting state (the filter tabs) |
| Custom interactive elements | a real `<button>`/`<a>`, not a clickable `<div>` |
| Heading hierarchy | no skipped levels |
| Lists | a real `<ol>`/`<ul>`; the ledger is an `<ol>` because order is meaningful |

An element that conveys nothing to a screen reader must say so. The row index
is a visual aid duplicated by list position, so it is `aria-hidden`; the status
stamp is *not* — it names state the strike-through only implies visually.

## Forms

- Every input has an associated `<label>`, or an `aria-label` when no visible
  label exists (the compose input).
- A native `<input type="checkbox">` with a wrapping `<label>` beats a styled
  `<div>` with a click handler. `appearance: none` restyles it without costing
  the semantics, keyboard behaviour, or announced state.
- `disabled` on a control that genuinely cannot act (an archived row's
  checkbox, the archive button at zero) — not a click handler that silently
  no-ops.

## Colour & contrast

- Normal text **4.5:1**; large text (18px+ bold, 24px+) **3:1**; borders and
  UI components **3:1**.
- **Never colour alone.** A completed row carries the strike-through, the
  checked box, *and* the stamp text — three signals, one of which survives
  monochrome.
- Both themes must be checked. A token redefined only in the dark block, or
  only on `:root`, is the usual way one theme silently drops below ratio.

## Keyboard & focus

- Visible `:focus-visible` styling on every interactive element — `:focus`
  alone fires on mouse clicks too.
- Nothing interactive may be pointer-only.
- Minimum target **24×24px**; the 26px checkbox is sized for this as much as
  for the codec.
- Respect `prefers-reduced-motion` — the entry stagger and the strike
  transition are both disabled under it.

## Checklist for new UI

- [ ] Every input has a label or `aria-label`
- [ ] Toggle controls expose state (`aria-pressed` / `aria-checked`), not just a class
- [ ] Decorative elements are `aria-hidden="true"`
- [ ] No state communicated by colour alone
- [ ] `:focus-visible` is visible, in both themes
- [ ] Contrast checked in light **and** dark
- [ ] Heading levels don't skip
- [ ] `prefers-reduced-motion` disables new animation

## Verifying

Assert accessible behaviour, not markup. The `playwright-evidence` selector
dump reports `aria-label`, `title`, and `placeholder` for exactly this reason —
if a selector can only find an element by CSS class, assistive tech cannot find
it at all. Prefer `button[aria-pressed="true"]` over reading a class name, in
tests and storyboards alike.
