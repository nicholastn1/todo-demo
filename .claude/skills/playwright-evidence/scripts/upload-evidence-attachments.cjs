#!/usr/bin/env node
/**
 * upload-evidence-attachments.cjs — uploads a playwright-evidence run's video
 * and screenshots to GitHub as pull-request attachments, and prints the
 * resulting URLs as JSON.
 *
 * This is what lets an agent satisfy the video-evidence requirement without a
 * human drag-and-drop. `POST https://uploads.github.com/user-attachments/assets`
 * accepts a Bearer token and returns the same
 * `https://github.com/user-attachments/assets/<uuid>` URL that dragging a file
 * into a description produces, which GitHub's markdown renderer turns into an
 * inline <video> or <img>.
 *
 * IMPORTANT: that endpoint is undocumented and carries no SLA. Every failure
 * here is therefore reported loudly and non-fatally: the caller falls back to
 * the human hand-off ("the files are at docs/evidence/<slug>/, please drag them
 * in") rather than blocking the pull request.
 *
 * Usage: node upload-evidence-attachments.cjs [--slug <branch-slug>] [--dir <path>]
 * Output: JSON on stdout — { ok, uploads: [{ file, url }], failures: [{ file, reason }] }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('node:util');

const UPLOAD_ENDPOINT = 'https://uploads.github.com/user-attachments/assets';
const EVIDENCE_DIR_RELATIVE_PATH = path.join('docs', 'evidence');
const SUMMARY_FILE_NAME = 'summary.md';

// GitHub's documented ceilings for an attachment (docs.github.com — "Attaching
// files"). Videos get the higher limit only on a paid plan; the check below
// uses the conservative value unless the org plan says otherwise.
const IMAGE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
const VIDEO_SIZE_LIMIT_FREE_BYTES = 10 * 1024 * 1024;
const VIDEO_SIZE_LIMIT_PAID_BYTES = 100 * 1024 * 1024;
const PAID_PLAN_NAMES = new Set(['team', 'enterprise', 'business']);

// Only the media types GitHub renders inline are worth uploading.
const CONTENT_TYPE_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
]);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);

class UploadError extends Error {}

function gitOutput(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function repoRoot() {
  try {
    return gitOutput(['rev-parse', '--show-toplevel']);
  } catch (error) {
    throw new UploadError(`Could not resolve the repository root: ${error.message}`);
  }
}

function defaultSlug() {
  let branch;
  try {
    branch = gitOutput(['branch', '--show-current']);
  } catch (error) {
    throw new UploadError(`Could not determine the current git branch: ${error.message}`);
  }
  if (!branch) {
    throw new UploadError('git branch --show-current returned nothing (detached HEAD?). Pass --slug explicitly.');
  }
  return branch.replace(/\//g, '-');
}

/** Read the gh CLI's token. Never hard-code or log it. */
function githubToken() {
  try {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
    if (!token) throw new UploadError('gh auth token returned nothing.');
    return token;
  } catch (error) {
    throw new UploadError(`Could not read a GitHub token from the gh CLI: ${error.message}`);
  }
}

/**
 * Resolve the numeric repository id the upload endpoint requires.
 * `gh repo view --json id` returns the GraphQL node id, not this one, so the
 * REST API is the only source.
 */
function repositoryId() {
  try {
    return execFileSync('gh', ['api', 'repos/{owner}/{repo}', '--jq', '.id'], { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new UploadError(`Could not resolve the numeric repository id: ${error.message}`);
  }
}

/**
 * The owner's plan decides the video ceiling: 100 MB on a paid plan, 10 MB
 * otherwise. A user-owned repository has no org to ask, which is a legitimate
 * "assume the lower limit"; any other failure is worth naming, because a
 * wrongly low ceiling rejects a valid video with a misleading reason.
 */
function videoSizeLimitBytes() {
  let owner;
  try {
    owner = execFileSync('gh', ['repo', 'view', '--json', 'owner', '--jq', '.owner.login'], {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    process.stderr.write(`Could not read the repository owner (${error.message}); assuming the 10 MB video limit.\n`);
    return VIDEO_SIZE_LIMIT_FREE_BYTES;
  }

  try {
    const plan = execFileSync('gh', ['api', `orgs/${owner}`, '--jq', '.plan.name'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .toLowerCase();
    return PAID_PLAN_NAMES.has(plan) ? VIDEO_SIZE_LIMIT_PAID_BYTES : VIDEO_SIZE_LIMIT_FREE_BYTES;
  } catch {
    // A user-owned repository 404s here. Both that and a plan the API will not
    // disclose mean the same thing for us: use the conservative ceiling.
    return VIDEO_SIZE_LIMIT_FREE_BYTES;
  }
}

function contentTypeFor(fileName) {
  return CONTENT_TYPE_BY_EXTENSION.get(path.extname(fileName).toLowerCase());
}

function isVideo(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/**
 * Files worth uploading, video first so the PR block can lead with it.
 * summary.md stays local: it is inlined as log evidence, not attached.
 */
function collectUploadableFiles(evidenceDir) {
  return fs
    .readdirSync(evidenceDir)
    .filter((name) => name !== SUMMARY_FILE_NAME)
    .filter((name) => contentTypeFor(name) !== undefined)
    .sort((a, b) => {
      if (isVideo(a) !== isVideo(b)) return isVideo(a) ? -1 : 1;
      return a.localeCompare(b);
    });
}

/** Reject a file GitHub would refuse, before spending the upload. */
function sizeRejection(filePath, fileName, videoLimitBytes) {
  const { size } = fs.statSync(filePath);
  const limit = isVideo(fileName) ? videoLimitBytes : IMAGE_SIZE_LIMIT_BYTES;
  if (size > limit) {
    return `${(size / 1024 / 1024).toFixed(1)} MB exceeds GitHub's ${(limit / 1024 / 1024).toFixed(0)} MB limit`;
  }
  return undefined;
}

async function uploadOne({ filePath, fileName, token, repoId, fetchImpl }) {
  const query = new URLSearchParams({
    name: fileName,
    content_type: contentTypeFor(fileName),
    repository_id: repoId,
  });

  const response = await fetchImpl(`${UPLOAD_ENDPOINT}?${query}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': contentTypeFor(fileName),
    },
    body: fs.readFileSync(filePath),
  });

  if (!response.ok) {
    throw new UploadError(`HTTP ${response.status} ${response.statusText || ''}`.trim());
  }

  const payload = await response.json();
  if (!payload || typeof payload.url !== 'string') {
    throw new UploadError('the response carried no url field');
  }
  return payload.url;
}

/**
 * Upload every renderable file in an evidence folder.
 * Never throws for a single file: a failure is collected so the caller can
 * fall back to the human hand-off for that one file.
 */
async function uploadEvidence({ evidenceDir, token, repoId, videoLimitBytes, fetchImpl = globalThis.fetch }) {
  const files = collectUploadableFiles(evidenceDir);
  const uploads = [];
  const failures = [];

  for (const fileName of files) {
    const filePath = path.join(evidenceDir, fileName);
    const rejection = sizeRejection(filePath, fileName, videoLimitBytes);
    if (rejection) {
      failures.push({ file: fileName, reason: rejection });
      continue;
    }
    try {
      uploads.push({ file: fileName, url: await uploadOne({ filePath, fileName, token, repoId, fetchImpl }) });
    } catch (error) {
      failures.push({ file: fileName, reason: error.message });
    }
  }

  return { ok: failures.length === 0 && uploads.length > 0, uploads, failures };
}

/** The message the agent shows when an upload could not be made. */
function handoffMessage(slug, failures) {
  const list = failures.map(({ file, reason }) => `  - ${file}: ${reason}`).join('\n');
  return (
    `Could not attach ${failures.length} evidence file(s) through the GitHub upload endpoint:\n${list}\n` +
    `Fall back to the human hand-off: deliver docs/evidence/${slug}/ to the user and ask them to drag the ` +
    'files into the PR description. Do not create a Release, tag, Gist, or evidence branch to work around this.'
  );
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: { slug: { type: 'string' }, dir: { type: 'string' } },
      strict: true,
    }));
  } catch (error) {
    process.stderr.write(`Invalid arguments: ${error.message}\n`);
    process.exit(1);
  }

  let result;
  let slug = values.slug;
  try {
    const evidenceDir = values.dir
      ? path.resolve(values.dir)
      : (() => {
          slug = slug || defaultSlug();
          return path.join(repoRoot(), EVIDENCE_DIR_RELATIVE_PATH, slug);
        })();

    if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) {
      throw new UploadError(`No evidence found at ${evidenceDir} — run the playwright-evidence skill first.`);
    }

    result = await uploadEvidence({
      evidenceDir,
      token: githubToken(),
      repoId: repositoryId(),
      videoLimitBytes: videoSizeLimitBytes(),
    });
  } catch (error) {
    // A setup failure is still not fatal to the PR: report it and let the
    // caller hand off to a human.
    process.stdout.write(
      `${JSON.stringify({ ok: false, uploads: [], failures: [{ file: '*', reason: error.message }] }, null, 2)}\n`,
    );
    process.stderr.write(`${handoffMessage(slug || '<slug>', [{ file: '*', reason: error.message }])}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failures.length > 0) {
    process.stderr.write(`${handoffMessage(slug || '<slug>', result.failures)}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CONTENT_TYPE_BY_EXTENSION,
  IMAGE_SIZE_LIMIT_BYTES,
  UPLOAD_ENDPOINT,
  VIDEO_SIZE_LIMIT_FREE_BYTES,
  VIDEO_SIZE_LIMIT_PAID_BYTES,
  collectUploadableFiles,
  contentTypeFor,
  handoffMessage,
  isVideo,
  sizeRejection,
  uploadEvidence,
  uploadOne,
};
