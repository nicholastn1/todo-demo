'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  IMAGE_SIZE_LIMIT_BYTES,
  UPLOAD_ENDPOINT,
  VIDEO_SIZE_LIMIT_PAID_BYTES,
  collectUploadableFiles,
  contentTypeFor,
  handoffMessage,
  isVideo,
  sizeRejection,
  uploadEvidence,
  uploadOne,
} = require('../upload-evidence-attachments.cjs');

const ATTACHMENT_URL = 'https://github.com/user-attachments/assets/1124c588-104f-4767-8ff4-e1950b048770';
const REPOSITORY_ID = '1131361623';
const TOKEN = 'test-token';

function makeEvidenceDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

function okFetch(recorder = []) {
  return async (url, init) => {
    recorder.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ url: ATTACHMENT_URL }) };
  };
}

test('contentTypeFor maps the media GitHub renders inline, and nothing else', () => {
  assert.equal(contentTypeFor('demo.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('01-step.PNG'), 'image/png');
  assert.equal(contentTypeFor('clip.webm'), 'video/webm');
  assert.equal(contentTypeFor('trace.zip'), undefined);
  assert.equal(contentTypeFor('summary.md'), undefined);
});

test('isVideo distinguishes a recording from a screenshot', () => {
  assert.equal(isVideo('demo.mov'), true);
  assert.equal(isVideo('01-step.png'), false);
});

test('collectUploadableFiles lists the video first and drops non-media', () => {
  const dir = makeEvidenceDir({
    '02-second.png': 'x',
    '01-first.png': 'x',
    'demo.mp4': 'x',
    'summary.md': 'x',
    'trace.zip': 'x',
  });
  assert.deepEqual(collectUploadableFiles(dir), ['demo.mp4', '01-first.png', '02-second.png']);
});

test('collectUploadableFiles accepts an arbitrary basename', () => {
  // No part of the pipeline guarantees demo.mp4 / NN-*.png, so the collector
  // must not filter on a name pattern.
  const dir = makeEvidenceDir({ 'walkthrough.mp4': 'x', 'search-results.png': 'x' });
  assert.deepEqual(collectUploadableFiles(dir), ['walkthrough.mp4', 'search-results.png']);
});

test('sizeRejection applies the image limit and the plan-dependent video limit', () => {
  const dir = makeEvidenceDir({
    'big.png': Buffer.alloc(IMAGE_SIZE_LIMIT_BYTES + 1),
    'small.png': Buffer.alloc(16),
    'big.mp4': Buffer.alloc(IMAGE_SIZE_LIMIT_BYTES + 1),
  });
  assert.match(
    sizeRejection(path.join(dir, 'big.png'), 'big.png', VIDEO_SIZE_LIMIT_PAID_BYTES),
    /exceeds GitHub's 10 MB/,
  );
  assert.equal(sizeRejection(path.join(dir, 'small.png'), 'small.png', VIDEO_SIZE_LIMIT_PAID_BYTES), undefined);
  // The same byte count passes as a video on a paid plan.
  assert.equal(sizeRejection(path.join(dir, 'big.mp4'), 'big.mp4', VIDEO_SIZE_LIMIT_PAID_BYTES), undefined);
});

test('uploadOne posts to the documented shape and returns the attachment URL', async () => {
  const dir = makeEvidenceDir({ 'demo.mp4': 'bytes' });
  const calls = [];
  const url = await uploadOne({
    filePath: path.join(dir, 'demo.mp4'),
    fileName: 'demo.mp4',
    token: TOKEN,
    repoId: REPOSITORY_ID,
    fetchImpl: okFetch(calls),
  });

  assert.equal(url, ATTACHMENT_URL);
  assert.equal(calls.length, 1);
  const requested = new URL(calls[0].url);
  assert.equal(`${requested.origin}${requested.pathname}`, UPLOAD_ENDPOINT);
  assert.equal(requested.searchParams.get('name'), 'demo.mp4');
  assert.equal(requested.searchParams.get('content_type'), 'video/mp4');
  assert.equal(requested.searchParams.get('repository_id'), REPOSITORY_ID);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('uploadOne reports an HTTP failure instead of returning a URL', async () => {
  const dir = makeEvidenceDir({ 'demo.mp4': 'bytes' });
  await assert.rejects(
    uploadOne({
      filePath: path.join(dir, 'demo.mp4'),
      fileName: 'demo.mp4',
      token: TOKEN,
      repoId: REPOSITORY_ID,
      fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found' }),
    }),
    /HTTP 404 Not Found/,
  );
});

test('uploadEvidence returns a URL per file when every upload succeeds', async () => {
  const dir = makeEvidenceDir({ 'demo.mp4': 'x', '01-first.png': 'x', 'summary.md': 'x' });
  const result = await uploadEvidence({
    evidenceDir: dir,
    token: TOKEN,
    repoId: REPOSITORY_ID,
    videoLimitBytes: VIDEO_SIZE_LIMIT_PAID_BYTES,
    fetchImpl: okFetch(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.uploads.map((entry) => entry.file),
    ['demo.mp4', '01-first.png'],
  );
  assert.equal(result.failures.length, 0);
});

test('a single failed upload does not lose the files that did upload', async () => {
  // The endpoint is undocumented; a partial outage must degrade, not throw.
  const dir = makeEvidenceDir({ 'demo.mp4': 'x', '01-first.png': 'x' });
  const result = await uploadEvidence({
    evidenceDir: dir,
    token: TOKEN,
    repoId: REPOSITORY_ID,
    videoLimitBytes: VIDEO_SIZE_LIMIT_PAID_BYTES,
    fetchImpl: async (url) =>
      url.includes('demo.mp4')
        ? { ok: false, status: 503, statusText: 'Service Unavailable' }
        : { ok: true, status: 201, json: async () => ({ url: ATTACHMENT_URL }) },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.uploads, [{ file: '01-first.png', url: ATTACHMENT_URL }]);
  assert.equal(result.failures[0].file, 'demo.mp4');
  assert.match(result.failures[0].reason, /503/);
});

test('an oversized file is rejected before the request is spent', async () => {
  const dir = makeEvidenceDir({ 'huge.png': Buffer.alloc(IMAGE_SIZE_LIMIT_BYTES + 1) });
  const calls = [];
  const result = await uploadEvidence({
    evidenceDir: dir,
    token: TOKEN,
    repoId: REPOSITORY_ID,
    videoLimitBytes: VIDEO_SIZE_LIMIT_PAID_BYTES,
    fetchImpl: okFetch(calls),
  });

  assert.equal(calls.length, 0);
  assert.equal(result.ok, false);
  assert.match(result.failures[0].reason, /exceeds GitHub's 10 MB limit/);
});

test('a response without a url field is a failure, not a silent success', async () => {
  const dir = makeEvidenceDir({ '01-first.png': 'x' });
  const result = await uploadEvidence({
    evidenceDir: dir,
    token: TOKEN,
    repoId: REPOSITORY_ID,
    videoLimitBytes: VIDEO_SIZE_LIMIT_PAID_BYTES,
    fetchImpl: async () => ({ ok: true, status: 201, json: async () => ({}) }),
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0].reason, /no url field/);
});

test('handoffMessage names the files and forbids the banned workarounds', () => {
  const message = handoffMessage('my-branch', [{ file: 'demo.mp4', reason: 'HTTP 404' }]);
  assert.match(message, /demo\.mp4: HTTP 404/);
  assert.match(message, /docs\/evidence\/my-branch\//);
  assert.match(message, /Release, tag, Gist, or evidence branch/);
});
