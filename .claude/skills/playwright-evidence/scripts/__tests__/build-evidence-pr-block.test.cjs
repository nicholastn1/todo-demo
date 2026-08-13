'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildLogEvidenceSection,
  buildPrBlock,
  buildScreenshotsSection,
  buildVideoLine,
  collectScreenshots,
  findVideo,
  parseAttachments,
  readSummary,
} = require('../build-evidence-pr-block.cjs');

const SLUG = 'my-branch';
const VIDEO_URL = 'https://github.com/user-attachments/assets/1124c588-104f-4767-8ff4-e1950b048770';
const SHOT_URL = 'https://github.com/user-attachments/assets/1659d323-6dc0-43f9-acce-f8ec59e57b98';

function makeEvidenceDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-block-'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

test('collectScreenshots returns the png files in order', () => {
  const dir = makeEvidenceDir({ '02-b.png': 'x', '01-a.png': 'x', 'demo.mp4': 'x' });
  assert.deepEqual(collectScreenshots(dir), ['01-a.png', '02-b.png']);
});

test('findVideo prefers an mp4 and falls back to a webm', () => {
  assert.equal(findVideo(makeEvidenceDir({ 'demo.webm': 'x', 'demo.mp4': 'x' })), 'demo.mp4');
  assert.equal(findVideo(makeEvidenceDir({ 'demo.webm': 'x' })), 'demo.webm');
  assert.equal(findVideo(makeEvidenceDir({ '01-a.png': 'x' })), undefined);
});

test('readSummary returns the summary text, or undefined when absent', () => {
  assert.equal(readSummary(makeEvidenceDir({ 'summary.md': 'ran the flow' })), 'ran the flow');
  assert.equal(readSummary(makeEvidenceDir({})), undefined);
});

test('parseAttachments turns the upload JSON into a file to URL map', () => {
  const map = parseAttachments(JSON.stringify({ ok: true, uploads: [{ file: 'demo.mp4', url: VIDEO_URL }] }));
  assert.equal(map.get('demo.mp4'), VIDEO_URL);
});

test('parseAttachments tolerates absent, empty, and failed upload payloads', () => {
  assert.equal(parseAttachments(undefined).size, 0);
  assert.equal(parseAttachments(JSON.stringify({ ok: false, uploads: [], failures: [{ file: 'x' }] })).size, 0);
  assert.equal(parseAttachments(JSON.stringify({ uploads: [{ file: 'demo.mp4' }] })).size, 0);
});

test('an attached video renders as a bare URL so GitHub embeds a player', () => {
  const line = buildVideoLine(SLUG, 'demo.mp4', new Map([['demo.mp4', VIDEO_URL]]));
  assert.equal(line, `**Video evidence:**\n\n${VIDEO_URL}`);
  // A markdown image/link wrapper would stop GitHub building the <video> tag.
  assert.doesNotMatch(line, /\[.*\]\(/);
});

test('an unattached video falls back to the human drag-in instruction', () => {
  const line = buildVideoLine(SLUG, 'demo.mp4', new Map());
  assert.match(line, /docs\/evidence\/my-branch\/demo\.mp4/);
  assert.match(line, /drag-and-drop/);
});

test('no video at all is stated plainly', () => {
  assert.match(buildVideoLine(SLUG, undefined, new Map()), /n\/a — no video captured/);
});

test('attached screenshots render inline as markdown images', () => {
  const section = buildScreenshotsSection(SLUG, ['01-a.png'], new Map([['01-a.png', SHOT_URL]]));
  assert.match(section, /!\[01-a\.png\]\(https:\/\/github\.com\/user-attachments\/assets\//);
});

test('a partly attached run shows the uploads and names the leftovers', () => {
  const section = buildScreenshotsSection(SLUG, ['01-a.png', '02-b.png'], new Map([['01-a.png', SHOT_URL]]));
  assert.match(section, /!\[01-a\.png\]/);
  assert.match(section, /Not attached — upload these by hand/);
  assert.match(section, /docs\/evidence\/my-branch\/02-b\.png/);
  assert.doesNotMatch(section, /docs\/evidence\/my-branch\/01-a\.png/);
});

test('no screenshots is stated plainly', () => {
  assert.equal(buildScreenshotsSection(SLUG, [], new Map()), 'n/a — no screenshots captured.');
});

test('buildLogEvidenceSection folds the summary into a details block', () => {
  assert.match(buildLogEvidenceSection(SLUG, 'it worked'), /<details>[\s\S]*it worked[\s\S]*<\/details>/);
  assert.match(buildLogEvidenceSection(SLUG, undefined), /No summary\.md found/);
});

test('the assembled block carries the agent checkbox, the video, and the token usage', () => {
  const block = buildPrBlock({
    slug: SLUG,
    screenshots: ['01-a.png'],
    video: 'demo.mp4',
    summary: 'it worked',
    tokenUsage: 'Total tokens: 128,540',
    attachmentUrlByFile: new Map([
      ['demo.mp4', VIDEO_URL],
      ['01-a.png', SHOT_URL],
    ]),
  });

  assert.match(block, /- \[x\] This PR was opened by an AI agent/);
  assert.match(block, new RegExp(VIDEO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(block, /!\[01-a\.png\]/);
  assert.match(block, /### Token Usage/);
  assert.match(block, /Total tokens: 128,540/);
});

test('a failed token-usage read is reported in the block, not fatal', () => {
  const block = buildPrBlock({
    slug: SLUG,
    screenshots: ['01-a.png'],
    video: 'demo.mp4',
    summary: undefined,
    tokenUsage: 'n/a — token-usage script failed: no transcript',
  });

  assert.match(block, /drag-and-drop/);
  assert.match(block, /docs\/evidence\/my-branch\/01-a\.png/);
  assert.match(block, /n\/a — token-usage script failed/);
});
