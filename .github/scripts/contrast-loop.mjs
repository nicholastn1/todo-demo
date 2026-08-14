/**
 * contrast-loop.mjs — the control loop for one measurable property: WCAG
 * colour-contrast violations in the rendered app.
 *
 * scan     → count violations in a real browser
 * select   → pick one bounded target for an agent iteration
 * boundary → assert an iteration touched only what it was allowed to
 * ratchet  → fail when a branch raises the count above its base
 *
 * Why a browser and not a static CSS parse: contrast depends on the *computed*
 * pair actually painted — which token won the cascade, what the ancestor
 * background resolved to, whether a rule applied at all. A static reading of
 * App.css cannot know that, and would both miss real failures and invent ones.
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PREVIEW_PORT = 4173
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`
const AXE_SOURCE_PATH = 'node_modules/axe-core/axe.min.js'
const EVIDENCE_SHOT = '.claude/skills/playwright-evidence/scripts/evidence-shot.sh'

/**
 * The ratchet compares against a committed number rather than re-scanning the
 * base branch. Re-scanning would mean a second checkout, a second build and a
 * second browser run on every pull request — minutes added to a job that
 * currently finishes in seconds. A committed baseline costs one scan, and a
 * hand-edited baseline is visible in review, which a recomputed one is not.
 */
export const BASELINE_PATH = '.github/contrast-baseline.json'

/**
 * The row-entry stagger runs for 900ms after load and blends every animating
 * row toward the background, so axe run before it settles reports contrast
 * pairs that never actually paint — colours like #b1aa9f that exist in no
 * token. Everything below waits this out; do not lower it without re-checking
 * that the reported foregrounds match the tokens in App.css.
 */
const SETTLE_MS = 2000

/**
 * The only files an iteration may touch. The baseline is in the set because a
 * successful repair must lower it in the same commit — otherwise the next PR
 * inherits a ratchet that no longer matches reality.
 */
export const ALLOWED_PATHS = ['src/App.css', BASELINE_PATH]

/** WCAG 2.2 AA. Large text is 18pt, or 14pt when bold. */
export const LARGE_TEXT_PT = 18
export const LARGE_BOLD_PT = 14
export const MIN_RATIO_NORMAL = 4.5
export const MIN_RATIO_LARGE = 3

export function requiredRatio({ fontSizePt, bold }) {
  const isLarge = fontSizePt >= LARGE_TEXT_PT || (bold && fontSizePt >= LARGE_BOLD_PT)
  return isLarge ? MIN_RATIO_LARGE : MIN_RATIO_NORMAL
}

/** Pull the numbers out of axe's prose failure summary. */
export function parseFailure(summary = '') {
  const match = summary.match(
    /contrast of ([\d.]+).*?foreground color: (#[0-9a-f]+), background color: (#[0-9a-f]+), font size: ([\d.]+)pt.*?font weight: (\w+)/is,
  )
  if (!match) return undefined
  const [, ratio, foreground, background, fontSizePt, weight] = match
  return {
    ratio: Number(ratio),
    foreground,
    background,
    fontSizePt: Number(fontSizePt),
    bold: weight.toLowerCase() === 'bold',
  }
}

/**
 * One target per violating element.
 *
 * Note the consequence, because it surprises: a repair is a token change in
 * App.css, and several elements usually share a token. Fixing one element
 * commonly clears its siblings in the same commit, so the count can fall by
 * more than one per iteration and a later iteration can find its target
 * already gone. That is a healthy outcome, not a bug — the loop is driven by
 * the scan, not by a fixed list drawn up in advance.
 */
export function parseNodes(nodes = []) {
  return nodes
    .map((node) => {
      const parsed = parseFailure(node.failureSummary)
      if (!parsed) return undefined
      return { target: node.target, ...parsed, required: requiredRatio(parsed) }
    })
    .filter(Boolean)
}

/** Worst shortfall first; target string breaks ties so two runs agree. */
export function rankNodes(parsed = []) {
  return [...parsed].sort((a, b) => {
    const shortfall = b.required - b.ratio - (a.required - a.ratio)
    if (Math.abs(shortfall) > 1e-9) return shortfall
    return a.target.localeCompare(b.target)
  })
}

export function selectNode(parsed = []) {
  const ranked = rankNodes(parsed)
  return ranked.length ? ranked[0] : undefined
}

/** Kept for the scan report: seeing the pairs explains *why* a count is what
 * it is, even though selection now works one element at a time. */
export function groupByColourPair(nodes = []) {
  const groups = new Map()
  for (const node of nodes) {
    const parsed = parseFailure(node.failureSummary)
    if (!parsed) continue
    const key = `${parsed.foreground}|${parsed.background}|${parsed.fontSizePt}|${parsed.bold}`
    if (!groups.has(key)) {
      groups.set(key, { ...parsed, required: requiredRatio(parsed), targets: [], nodes: 0 })
    }
    const group = groups.get(key)
    group.nodes += 1
    if (group.targets.length < 5) group.targets.push(node.target)
  }
  return [...groups.values()]
}

/**
 * Worst first: the largest shortfall against the ratio that pair actually
 * needs, then the widest blast radius, then colour for a stable tie-break.
 * Deterministic ordering matters — two runs on the same tree must pick the
 * same target, or the loop cannot be reasoned about.
 */
export function rankTargets(groups = []) {
  return [...groups].sort((a, b) => {
    const shortfall = b.required - b.ratio - (a.required - a.ratio)
    if (Math.abs(shortfall) > 1e-9) return shortfall
    if (b.nodes !== a.nodes) return b.nodes - a.nodes
    return `${a.foreground}${a.background}`.localeCompare(`${b.foreground}${b.background}`)
  })
}

export function selectTarget(groups = []) {
  const ranked = rankTargets(groups)
  return ranked.length ? ranked[0] : undefined
}

/**
 * A diff is in-boundary when every path it touches is allowed. Returns the
 * offending paths so the caller can name them rather than just failing.
 */
export function validateBoundary(changedPaths = [], allowed = ALLOWED_PATHS) {
  const outside = changedPaths.filter((p) => !allowed.includes(p))
  return { ok: outside.length === 0, outside, allowed }
}

export function compareCounts({ base, head }) {
  return {
    base,
    head,
    ok: head <= base,
    delta: head - base,
    stale: head < base,
  }
}

export function readBaselineNote() {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).note
}

export function readBaseline(raw) {
  const parsed = JSON.parse(raw)
  if (!Number.isInteger(parsed.violations) || parsed.violations < 0) {
    throw new Error(`${BASELINE_PATH}: "violations" must be a non-negative integer`)
  }
  return parsed.violations
}

// --------------------------------------------------------------- browser IO

const VITE_BIN = 'node_modules/vite/bin/vite.js'

/** Progress goes to stderr: stdout is the JSON result, and a step that
 * redirects stdout to a file has no other way to say where it got to. */
function progress(message) {
  process.stderr.write(`[contrast-loop] ${message}
`)
}

/**
 * Spawned through node directly, not npx: killing an npx wrapper does not
 * necessarily reach the vite process underneath, and a surviving child with
 * open pipes keeps this process alive after its work is done. stdio is
 * ignored for the same reason — nothing here reads those pipes.
 */
function startPreview() {
  return spawn(process.execPath, [VITE_BIN, 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
    stdio: 'ignore',
  })
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(PREVIEW_URL)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`vite preview did not answer on ${PREVIEW_URL} within ${timeoutMs}ms`)
}

/**
 * axe is injected from node_modules rather than a CDN: the sensor's reading
 * must not change because a CDN shipped a new minor, and CI may have no
 * outbound network from the page.
 */
function buildAxeScript(settleMs) {
  const axe = readFileSync(AXE_SOURCE_PATH, 'utf8')
  return `${axe}
;(async () => {
  await new Promise((r) => setTimeout(r, ${settleMs}));
  const result = await axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] });
  const violation = result.violations.find((v) => v.id === 'color-contrast');
  return {
    nodes: violation ? violation.nodes.map((n) => ({
      target: n.target.join(' '),
      failureSummary: n.failureSummary,
    })) : [],
  };
})()`
}

/** A hung browser must fail the step, not sit until the job timeout. */
const AXE_TIMEOUT_MS = 180000

export async function scan({ settleMs = SETTLE_MS } = {}) {
  progress('starting vite preview')
  const server = startPreview()
  const workdir = mkdtempSync(join(tmpdir(), 'contrast-loop-'))
  const scriptPath = join(workdir, 'axe-run.js')

  try {
    await waitForServer()
    progress(`preview answering on ${PREVIEW_URL}`)
    writeFileSync(scriptPath, buildAxeScript(settleMs))
    progress('running axe through shot-scraper')
    const raw = execFileSync('bash', [EVIDENCE_SHOT, 'javascript', PREVIEW_URL, '-i', scriptPath], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: AXE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    progress('axe finished')
    const { nodes } = JSON.parse(raw)
    return {
      count: nodes.length,
      nodes: rankNodes(parseNodes(nodes)),
      groups: rankTargets(groupByColourPair(nodes)),
    }
  } finally {
    server.kill('SIGKILL')
    server.unref()
    rmSync(workdir, { recursive: true, force: true })
    progress('preview stopped')
  }
}

function changedPathsAgainst(base) {
  const committed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  })
  const working = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).replace(
    /^.{3}/gm,
    '',
  )
  return [...new Set([...committed.split('\n'), ...working.split('\n')].filter(Boolean))]
}


/**
 * The pull-request body and metadata for one iteration.
 *
 * The workflow used to build these with inline node -e inside YAML, which is
 * the one place in this repo that gets no test. Two bugs shipped that way
 * before this moved here.
 */
export function buildTransfer({ selection, after, baseSha }) {
  const t = selection.target
  const prBody = [
    '## Summary',
    '',
    `Automated contrast-loop iteration: raises one colour pair above its required ratio in \`src/App.css\`.`,
    '',
    '## Alvo',
    '',
    '| Campo | Valor |',
    '| --- | --- |',
    `| Elemento | \`${t.target}\` |`,
    `| Cores | \`${t.foreground}\` sobre \`${t.background}\` |`,
    `| Medido | ${t.ratio}:1 |`,
    `| Exigido | ${t.required}:1 |`,
    '',
    '## Resultado',
    '',
    `Violações: ${selection.count} → ${after.count}. O baseline foi baixado para ${after.count} no mesmo commit.`,
    '',
    'Verificado no job: lint, build, Vitest, testes de script, a fronteira de',
    'alteração, e um re-scan provando que a contagem caiu.',
    '',
    '- [x] This PR was opened by an AI agent',
    '',
  ].join('\n')

  return {
    prBody,
    metadata: {
      baseSha,
      before: selection.count,
      after: after.count,
      element: t.target,
      foreground: t.foreground,
      background: t.background,
    },
  }
}

// ---------------------------------------------------------------------- CLI

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

async function main() {
  const command = process.argv[2]

  if (command === 'scan') {
    const result = await scan()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  if (command === 'select') {
    const { count, nodes } = await scan()
    const target = selectNode(nodes)
    if (!target) {
      process.stdout.write(`${JSON.stringify({ found: false, count: 0 }, null, 2)}\n`)
      return
    }
    process.stdout.write(`${JSON.stringify({ found: true, count, target }, null, 2)}\n`)
    return
  }

  if (command === 'transfer') {
    const dir = flag('dir', '.')
    const selection = JSON.parse(readFileSync('selection.json', 'utf8'))
    const after = JSON.parse(readFileSync('after.json', 'utf8'))
    const { prBody, metadata } = buildTransfer({ selection, after, baseSha: process.env.BASE_SHA })

    // The workflow owns the baseline, not the agent: it is arithmetic on a
    // number the scan already produced, and a model asked to do it can get it
    // wrong. Left unlowered, the ratchet reports every later UI branch stale.
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ violations: after.count, note: readBaselineNote() }, null, 2)}\n`)
    writeFileSync(join(dir, 'pr-body.md'), prBody)
    writeFileSync(join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`)
    progress(`transfer staged; baseline lowered to ${after.count}`)
    return
  }

  if (command === 'boundary') {
    const base = flag('base', 'main')
    const result = validateBoundary(changedPathsAgainst(base))
    if (!result.ok) {
      process.stderr.write(
        `Iteration touched paths outside its boundary:\n${result.outside.map((p) => `  ${p}`).join('\n')}\n` +
          `Allowed: ${result.allowed.join(', ')}\n`,
      )
      process.exitCode = 1
      return
    }
    process.stdout.write(`Boundary ok — only ${result.allowed.join(', ')} touched.\n`)
    return
  }

  if (command === 'ratchet') {
    const baseline = readBaseline(readFileSync(BASELINE_PATH, 'utf8'))
    const head = (await scan()).count
    const result = compareCounts({ base: baseline, head })

    process.stdout.write(
      `contrast violations — baseline ${result.base}, now ${result.head} ` +
        `(${result.delta >= 0 ? '+' : ''}${result.delta})\n`,
    )

    if (!result.ok) {
      process.stderr.write(
        `This branch adds ${result.delta} colour-contrast violation(s). Fix them, or run\n` +
          `  npm run --silent agent:contrast:scan\n` +
          `to see which pairs are failing. Raising ${BASELINE_PATH} is not a fix.\n`,
      )
      process.exitCode = 1
      return
    }

    if (result.stale) {
      process.stderr.write(
        `The count fell to ${result.head} but ${BASELINE_PATH} still says ${result.base}. ` +
          `Lower it in this branch so the ratchet holds the new floor.\n`,
      )
      process.exitCode = 1
    }
    return
  }

  process.stderr.write('Usage: contrast-loop.mjs <scan|select|boundary|ratchet> [--base <ref>]\n')
  process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
}
