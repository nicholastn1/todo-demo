import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOWED_PATHS,
  BASELINE_PATH,
  buildTransfer,
  compareCounts,
  groupByColourPair,
  madeProgress,
  parseFailure,
  parseNodes,
  rankNodes,
  rankTargets,
  readBaseline,
  requiredRatio,
  selectNode,
  selectTarget,
  validateBoundary,
} from '../contrast-loop.mjs'

const summary = (ratio, fg, bg, pt, weight) =>
  `Fix any of the following:\n  Element has insufficient color contrast of ${ratio} (foreground color: ${fg}, background color: ${bg}, font size: ${pt}pt (13px), font weight: ${weight}). Expected contrast ratio of 4.5:1`

test('requiredRatio follows the WCAG large-text thresholds', () => {
  assert.equal(requiredRatio({ fontSizePt: 11.3, bold: true }), 4.5)
  assert.equal(requiredRatio({ fontSizePt: 14, bold: true }), 3)
  assert.equal(requiredRatio({ fontSizePt: 14, bold: false }), 4.5)
  assert.equal(requiredRatio({ fontSizePt: 18, bold: false }), 3)
})

test('parseFailure pulls the numbers out of axe prose', () => {
  assert.deepEqual(parseFailure(summary('3.88', '#cc3311', '#e7dece', '11.3', 'bold')), {
    ratio: 3.88,
    foreground: '#cc3311',
    background: '#e7dece',
    fontSizePt: 11.3,
    bold: true,
  })
})

test('parseFailure returns undefined rather than guessing', () => {
  assert.equal(parseFailure('some other violation entirely'), undefined)
  assert.equal(parseFailure(''), undefined)
  assert.equal(parseFailure(undefined), undefined)
})

test('nodes sharing a colour pair collapse into one target', () => {
  const nodes = Array.from({ length: 5 }, (_, i) => ({
    target: `.stamp:nth-child(${i})`,
    failureSummary: summary('4.41', '#f2ece1', '#cc3311', '9.8', 'bold'),
  }))
  const groups = groupByColourPair(nodes)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].nodes, 5)
  assert.equal(groups[0].required, 4.5)
})

test('the same colours at a different size stay separate targets', () => {
  const groups = groupByColourPair([
    { target: '.a', failureSummary: summary('4.41', '#f2ece1', '#cc3311', '9.8', 'bold') },
    { target: '.b', failureSummary: summary('4.41', '#f2ece1', '#cc3311', '12', 'bold') },
  ])
  assert.equal(groups.length, 2)
})

test('unparseable nodes are dropped, not counted as a pair', () => {
  assert.deepEqual(groupByColourPair([{ target: '.a', failureSummary: 'garbage' }]), [])
})

test('the worst shortfall against its own required ratio ranks first', () => {
  // 3.88 needs 4.5 (shortfall 0.62); 2.9 needs 3 (shortfall 0.10) despite the
  // lower absolute ratio — ranking on raw ratio would invert these.
  const groups = groupByColourPair([
    { target: '.small', failureSummary: summary('3.88', '#cc3311', '#e7dece', '11.3', 'bold') },
    { target: '.large', failureSummary: summary('2.90', '#aaaaaa', '#ffffff', '20', 'normal') },
  ])
  assert.equal(selectTarget(groups).targets[0], '.small')
})

test('a tie on shortfall breaks on blast radius, then deterministically', () => {
  const wide = groupByColourPair([
    { target: '.a', failureSummary: summary('4.41', '#f2ece1', '#cc3311', '9.8', 'bold') },
    { target: '.b', failureSummary: summary('4.41', '#f2ece1', '#cc3311', '9.8', 'bold') },
  ])
  const narrow = groupByColourPair([
    { target: '.c', failureSummary: summary('4.41', '#000000', '#111111', '9.8', 'bold') },
  ])
  const ranked = rankTargets([...narrow, ...wide])
  assert.equal(ranked[0].nodes, 2)
  // same input, same order — two runs must agree or the loop is unreasonable
  assert.deepEqual(rankTargets([...wide, ...narrow]), ranked)
})

test('selectTarget on a clean tree reports nothing to do', () => {
  assert.equal(selectTarget([]), undefined)
})

test('the boundary allows the stylesheet and the baseline, nothing else', () => {
  // The baseline is in the set because a repair must lower it in the same
  // commit, or the next branch inherits a ratchet that no longer matches.
  assert.deepEqual(ALLOWED_PATHS, ['src/App.css', BASELINE_PATH])
  assert.equal(validateBoundary(['src/App.css', BASELINE_PATH]).ok, true)
  assert.equal(validateBoundary([]).ok, true)
})

test('the boundary names what escaped it', () => {
  const result = validateBoundary(['src/App.css', 'src/todos.ts', '.github/workflows/x.yml'])
  assert.equal(result.ok, false)
  assert.deepEqual(result.outside, ['src/todos.ts', '.github/workflows/x.yml'])
})

test('the ratchet allows a drop or a hold, never a rise', () => {
  assert.equal(compareCounts({ base: 7, head: 7 }).ok, true)
  assert.equal(compareCounts({ base: 7, head: 8 }).ok, false)
  assert.equal(compareCounts({ base: 7, head: 8 }).delta, 1)
  assert.equal(compareCounts({ base: 0, head: 0 }).ok, true)
})

test('a drop is allowed but flagged stale until the baseline follows it down', () => {
  const dropped = compareCounts({ base: 7, head: 6 })
  assert.equal(dropped.ok, true)
  assert.equal(dropped.stale, true)
  assert.equal(compareCounts({ base: 7, head: 7 }).stale, false)
})

test('readBaseline accepts a non-negative integer and rejects the rest', () => {
  assert.equal(readBaseline('{"violations": 7}'), 7)
  assert.equal(readBaseline('{"violations": 0}'), 0)
  for (const bad of ['{"violations": -1}', '{"violations": 1.5}', '{"violations": "7"}', '{}']) {
    assert.throws(() => readBaseline(bad), /non-negative integer/)
  }
})

test('selection now works one element at a time', () => {
  const parsed = parseNodes([
    { target: '.b', failureSummary: summary('4.41', '#f2ece1', '#cc3311', '9.8', 'bold') },
    { target: '.a', failureSummary: summary('4.41', '#f2ece1', '#cc3311', '9.8', 'bold') },
    { target: '.worst', failureSummary: summary('3.88', '#cc3311', '#e7dece', '11.3', 'bold') },
  ])
  assert.equal(parsed.length, 3)
  assert.equal(selectNode(parsed).target, '.worst')
  // identical shortfall falls back to the target string, so reordering the
  // input cannot change which element an iteration picks
  assert.deepEqual(
    rankNodes(parsed).map((n) => n.target),
    ['.worst', '.a', '.b'],
  )
})

test('an element whose summary cannot be parsed is not selectable', () => {
  assert.deepEqual(parseNodes([{ target: '.x', failureSummary: 'garbage' }]), [])
  assert.equal(selectNode([]), undefined)
})

test('the transfer body carries the target, the drop, and the agent checkbox', () => {
  const { prBody, metadata } = buildTransfer({
    selection: {
      count: 7,
      target: {
        target: '.masthead__kicker',
        ratio: 3.88,
        required: 4.5,
        foreground: '#cc3311',
        background: '#e7dece',
      },
    },
    after: { count: 5 },
    baseSha: 'abc1234',
  })

  assert.match(prBody, /\.masthead__kicker/)
  assert.match(prBody, /3\.88:1/)
  assert.match(prBody, /4\.5:1/)
  assert.match(prBody, /7 → 5/)
  assert.match(prBody, /- \[x\] This PR was opened by an AI agent/)
  assert.deepEqual(metadata, {
    baseSha: 'abc1234',
    before: 7,
    after: 5,
    element: '.masthead__kicker',
    foreground: '#cc3311',
    background: '#e7dece',
  })
})

test('an iteration must lower the count to be publishable', () => {
  assert.equal(madeProgress({ before: 7, after: 6 }).ok, true)
  assert.equal(madeProgress({ before: 7, after: 7 }).ok, false)
  assert.equal(madeProgress({ before: 7, after: 8 }).ok, false)
  assert.match(madeProgress({ before: 7, after: 7 }).message, /refusing to publish/)
  assert.match(madeProgress({ before: 7, after: 6 }).message, /7 -> 6/)
})
