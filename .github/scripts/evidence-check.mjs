/**
 * evidence-check.mjs — fail a pull request that changes the UI without
 * carrying the evidence the playwright-evidence skill produces.
 *
 * The rule: touch the UI, show the UI. A PR that only edits CI, docs, or the
 * skill itself is exempt, because there is nothing to film.
 *
 * The PR body is attacker-controlled text, so it is read from the event
 * payload file rather than interpolated into a shell command by the workflow.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** A change under one of these has something visible to show. */
export const UI_PATHS = ['src/', 'index.html']

/** A bare user-attachments URL — GitHub renders these as an inline player. */
const VIDEO_ATTACHMENT =
  /^\s*https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}\s*$/im

/** A directly linked video file, for a hand-attached run. */
const VIDEO_FILE = /https?:\/\/\S+\.(?:mp4|webm|mov)\b/i

/** Markdown image — how the PR block embeds each screenshot. */
const SCREENSHOT = /!\[[^\]]*\]\(\s*\S+\s*\)/

/**
 * Drop HTML comments before matching. Without this, the commented-out
 * template a contributor left in the body counts as real evidence.
 */
export function stripHtmlComments(text = '') {
  return text.replace(/<!--[\s\S]*?-->/g, '')
}

export function touchesUi(files = []) {
  return files.some((f) => UI_PATHS.some((p) => f === p || f.startsWith(p)))
}

export function hasVideo(body = '') {
  const clean = stripHtmlComments(body)
  return VIDEO_ATTACHMENT.test(clean) || VIDEO_FILE.test(clean)
}

export function hasScreenshot(body = '') {
  return SCREENSHOT.test(stripHtmlComments(body))
}

export function evaluate({ files = [], body = '' } = {}) {
  const required = touchesUi(files)
  const video = hasVideo(body)
  const screenshot = hasScreenshot(body)

  const missing = []
  if (required && !video) missing.push('a video (webm or mp4)')
  if (required && !screenshot) missing.push('at least one screenshot')

  return { required, video, screenshot, missing, passed: missing.length === 0 }
}

export function buildSummary(result) {
  if (!result.required) {
    return [
      '## PR Evidence — not required',
      '',
      'No changes under `src/` or `index.html`, so there is no UI to show.',
    ].join('\n')
  }

  if (result.passed) {
    return [
      '## PR Evidence — ok',
      '',
      '- Video: found',
      '- Screenshots: found',
    ].join('\n')
  }

  return [
    '## PR Evidence — missing',
    '',
    `This PR changes the UI but the description is missing ${result.missing.join(' and ')}.`,
    '',
    'Record it with the `playwright-evidence` skill, then attach it:',
    '',
    '```bash',
    'npm run evidence:doctor',
    '# capture per .claude/skills/playwright-evidence/SKILL.md, then',
    '# see references/pr-attachment.md to upload and build the body block',
    '```',
  ].join('\n')
}

/**
 * Is the evidence already on disk for this branch? Used before a PR exists,
 * so the create-pr skill can stop rather than open a PR that CI will bounce.
 */
export function localEvidence(dir) {
  if (!existsSync(dir)) return { dir, video: false, screenshot: false }
  const files = readdirSync(dir)
  return {
    dir,
    video: files.some((f) => /\.(mp4|webm|mov)$/i.test(f)),
    screenshot: files.some((f) => /\.png$/i.test(f)),
  }
}

export function buildPreflight({ files, slug, evidence }) {
  const required = touchesUi(files)
  const missing = []
  if (required && !evidence.video) missing.push('a video')
  if (required && !evidence.screenshot) missing.push('a screenshot')

  const lines = required
    ? [
        `Evidence IS required — ${files.filter((f) => UI_PATHS.some((p) => f.startsWith(p))).length} UI file(s) changed.`,
        `Looked in: ${evidence.dir}`,
        `  video:      ${evidence.video ? 'found' : 'MISSING'}`,
        `  screenshot: ${evidence.screenshot ? 'found' : 'MISSING'}`,
      ]
    : [`Evidence not required — no changes under ${UI_PATHS.join(' or ')}.`]

  if (missing.length) {
    lines.push(
      '',
      `Run the playwright-evidence skill first; it writes to docs/evidence/${slug}/.`,
      'Opening the PR now would just spend a failed CI round.',
    )
  }

  return { required, missing, passed: missing.length === 0, report: lines.join('\n') }
}

/** Changed files against the base branch, including work not yet committed. */
function localChangedFiles(base) {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' })
  const committed = git(['diff', '--name-only', `${base}...HEAD`])
  const working = git(['status', '--porcelain']).replace(/^.{3}/gm, '')
  return [...new Set([...committed.split('\n'), ...working.split('\n')].filter(Boolean))]
}

export function runPreflight(base = 'main') {
  const slug = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' })
    .trim()
    .replace(/\//g, '-')
  const result = buildPreflight({
    files: localChangedFiles(base),
    slug,
    evidence: localEvidence(`docs/evidence/${slug}`),
  })
  process.stdout.write(`${result.report}\n`)
  if (!result.passed) process.exitCode = 1
}

function changedFiles(prNumber) {
  const out = execFileSync(
    'gh',
    ['pr', 'diff', String(prNumber), '--name-only'],
    { encoding: 'utf8' },
  )
  return out.split('\n').filter(Boolean)
}

export function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const pr = event.pull_request
  const result = evaluate({
    files: changedFiles(pr.number),
    body: pr.body ?? '',
  })

  const summary = buildSummary(result)
  process.stdout.write(`${summary}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' })
  }
  if (!result.passed) process.exitCode = 1
}

/**
 * Answer "does this file list touch the UI?" for a caller that is not Node —
 * the CI job deciding whether to spend a browser run on the contrast ratchet.
 * It lives here rather than inline in the workflow so it is covered by tests;
 * an inline `node -e` in YAML is exactly the code that never gets one.
 */
export function runTouchesUi(listPath) {
  const files = readFileSync(listPath, 'utf8').split('\n').filter(Boolean)
  process.stdout.write(`${touchesUi(files)}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const touchesUiFlag = process.argv.indexOf('--touches-ui')
  if (touchesUiFlag !== -1) {
    runTouchesUi(process.argv[touchesUiFlag + 1])
  } else if (process.argv.includes('--preflight')) {
    const baseFlag = process.argv.indexOf('--base')
    runPreflight(baseFlag === -1 ? 'main' : process.argv[baseFlag + 1])
  } else {
    run()
  }
}
