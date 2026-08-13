import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildPreflight,
  buildSummary,
  evaluate,
  hasScreenshot,
  hasVideo,
  localEvidence,
  stripHtmlComments,
  touchesUi,
} from '../evidence-check.mjs'

const VIDEO_URL =
  'https://github.com/user-attachments/assets/fd8d1c7f-2e0d-4bf2-a148-891703570699'
const SHOT_URL =
  'https://github.com/user-attachments/assets/eefa5e05-c569-4df2-9c86-72d299450618'

test('touchesUi fires on src and index.html, not on CI or the skill', () => {
  assert.equal(touchesUi(['src/App.tsx']), true)
  assert.equal(touchesUi(['index.html']), true)
  assert.equal(touchesUi(['.github/workflows/pr-tests.yml']), false)
  assert.equal(touchesUi(['.claude/skills/playwright-evidence/SKILL.md']), false)
  assert.equal(touchesUi([]), false)
})

test('a bare user-attachments URL counts as video, a linked image does not', () => {
  assert.equal(hasVideo(`**Video:**\n\n${VIDEO_URL}`), true)
  // the same URL wrapped as a markdown image is a screenshot, not a video
  assert.equal(hasVideo(`![shot.png](${SHOT_URL})`), false)
})

test('a directly linked video file counts too', () => {
  assert.equal(hasVideo('see https://example.com/demo.mp4 for the run'), true)
  assert.equal(hasVideo('https://example.com/demo.webm'), true)
})

test('hasScreenshot wants a markdown image', () => {
  assert.equal(hasScreenshot(`![01-initial.png](${SHOT_URL})`), true)
  assert.equal(hasScreenshot(`a plain link [shot](${SHOT_URL})`), false)
})

test('commented-out evidence does not count', () => {
  const body = `<!--\n${VIDEO_URL}\n![shot.png](${SHOT_URL})\n-->`
  assert.equal(hasVideo(body), false)
  assert.equal(hasScreenshot(body), false)
  assert.equal(stripHtmlComments(body).trim(), '')
})

test('a UI change with full evidence passes', () => {
  const result = evaluate({
    files: ['src/App.tsx'],
    body: `${VIDEO_URL}\n\n![01.png](${SHOT_URL})`,
  })
  assert.deepEqual(result, {
    required: true,
    video: true,
    screenshot: true,
    missing: [],
    passed: true,
  })
})

test('a UI change with no evidence fails and names what is missing', () => {
  const result = evaluate({ files: ['src/App.css'], body: 'just a tweak' })
  assert.equal(result.passed, false)
  assert.deepEqual(result.missing, [
    'a video (webm or mp4)',
    'at least one screenshot',
  ])
  assert.match(buildSummary(result), /missing a video .* and at least one/)
})

test('a UI change with only screenshots names just the video', () => {
  const result = evaluate({
    files: ['src/App.tsx'],
    body: `![01.png](${SHOT_URL})`,
  })
  assert.equal(result.passed, false)
  assert.deepEqual(result.missing, ['a video (webm or mp4)'])
})

test('a CI-only PR is exempt, even with an empty body', () => {
  const result = evaluate({ files: ['.github/workflows/pr-tests.yml'], body: '' })
  assert.equal(result.required, false)
  assert.equal(result.passed, true)
  assert.match(buildSummary(result), /not required/)
})

function makeEvidenceDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'))
  for (const name of files) writeFileSync(join(dir, name), 'x')
  return dir
}

test('localEvidence reports what is on disk, and tolerates a missing folder', () => {
  const dir = makeEvidenceDir(['demo.mp4', '01-a.png'])
  assert.deepEqual(localEvidence(dir), { dir, video: true, screenshot: true })

  const shotsOnly = makeEvidenceDir(['01-a.png'])
  assert.equal(localEvidence(shotsOnly).video, false)

  const absent = join(tmpdir(), 'does-not-exist-preflight')
  assert.deepEqual(localEvidence(absent), {
    dir: absent,
    video: false,
    screenshot: false,
  })
})

test('preflight passes when a UI change already has local evidence', () => {
  const result = buildPreflight({
    files: ['src/App.tsx'],
    slug: 'my-branch',
    evidence: { dir: 'docs/evidence/my-branch', video: true, screenshot: true },
  })
  assert.equal(result.passed, true)
  assert.match(result.report, /Evidence IS required — 1 UI file/)
})

test('preflight stops a UI change with no recording yet', () => {
  const result = buildPreflight({
    files: ['src/App.css', 'README.md'],
    slug: 'my-branch',
    evidence: { dir: 'docs/evidence/my-branch', video: false, screenshot: false },
  })
  assert.equal(result.passed, false)
  assert.deepEqual(result.missing, ['a video', 'a screenshot'])
  assert.match(result.report, /video:      MISSING/)
  assert.match(result.report, /would just spend a failed CI round/)
})

test('preflight is silent about evidence for a non-UI change', () => {
  const result = buildPreflight({
    files: ['.claude/rules/comments.md'],
    slug: 'my-branch',
    evidence: { dir: 'docs/evidence/my-branch', video: false, screenshot: false },
  })
  assert.equal(result.required, false)
  assert.equal(result.passed, true)
  assert.match(result.report, /not required/)
})
