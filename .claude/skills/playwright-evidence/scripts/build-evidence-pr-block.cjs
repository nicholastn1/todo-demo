#!/usr/bin/env node
/**
 * build-evidence-pr-block.cjs — assembles the ready-to-paste "Agent Evidence"
 * PR-body section from a playwright-evidence run's output folder
 * (docs/evidence/<branch-slug>/), instead of an agent hand-writing it.
 *
 * It lists the screenshots and video captured by the playwright-evidence
 * skill and inlines summary.md as log evidence.
 *
 * Usage: node build-evidence-pr-block.cjs [--slug <branch-slug>]
 * Default slug: the current git branch, with every "/" replaced by "-".
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('node:util');

const EVIDENCE_DIR_RELATIVE_PATH = path.join('docs', 'evidence');
const SUMMARY_FILE_NAME = 'summary.md';
const PNG_EXTENSION = '.png';
const MP4_EXTENSION = '.mp4';
const WEBM_EXTENSION = '.webm';
const NO_VIDEO_LINE = '**Video evidence:** n/a — no video captured; see log evidence below.';
const NO_SCREENSHOTS_LINE = 'n/a — no screenshots captured.';
const NO_SUMMARY_BLOCK = '_No summary.md found in the evidence folder._';

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function defaultSlug() {
  let branch;
  try {
    branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  } catch (error) {
    die(`Could not determine the current git branch: ${error.message}`);
  }

  if (!branch) {
    die(
      'Could not determine a branch slug: git branch --show-current returned nothing (detached HEAD?). Pass --slug explicitly.',
    );
  }

  return branch.replace(/\//g, '-');
}

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch (error) {
    die(`Could not resolve the repository root: ${error.message}`);
  }
  return undefined;
}

function collectScreenshots(evidenceDir) {
  return fs
    .readdirSync(evidenceDir)
    .filter((name) => name.toLowerCase().endsWith(PNG_EXTENSION))
    .sort((a, b) => a.localeCompare(b));
}

function findVideo(evidenceDir) {
  const entries = fs.readdirSync(evidenceDir);
  const mp4 = entries.find((name) => name.toLowerCase().endsWith(MP4_EXTENSION));
  if (mp4) return mp4;
  return entries.find((name) => name.toLowerCase().endsWith(WEBM_EXTENSION));
}

function readSummary(evidenceDir) {
  const summaryPath = path.join(evidenceDir, SUMMARY_FILE_NAME);
  if (!fs.existsSync(summaryPath)) return undefined;
  return fs.readFileSync(summaryPath, 'utf8');
}

/**
 * The video line.
 *
 * With an attachment URL the bare URL goes in on its own line: GitHub's
 * markdown renderer turns a `user-attachments/assets/<uuid>` link into an
 * inline <video> player. Without one — the upload endpoint is undocumented and
 * may fail — fall back to naming the local path for a human to drag in.
 */
function buildVideoLine(slug, video, attachmentUrlByFile = new Map()) {
  if (!video) return NO_VIDEO_LINE;

  const url = attachmentUrlByFile.get(video);
  if (!url) {
    return (
      `**Video evidence:** _upload \`docs/evidence/${slug}/${video}\` into this description ` +
      '(drag-and-drop) so it renders inline; the local file is at that path._'
    );
  }

  return `**Video evidence:**\n\n${url}`;
}

function buildScreenshotsSection(slug, screenshots, attachmentUrlByFile = new Map()) {
  if (screenshots.length === 0) return NO_SCREENSHOTS_LINE;

  const attached = screenshots.filter((name) => attachmentUrlByFile.has(name));
  const pending = screenshots.filter((name) => !attachmentUrlByFile.has(name));

  const sections = [];
  if (attached.length > 0) {
    sections.push(`\n\n${attached.map((name) => `![${name}](${attachmentUrlByFile.get(name)})`).join('\n\n')}`);
  }
  if (pending.length > 0) {
    const bullets = pending.map((name) => `- \`docs/evidence/${slug}/${name}\``).join('\n');
    sections.push(
      `${attached.length > 0 ? '\n\n_Not attached — upload these by hand:_\n' : 'upload the files below into this description:\n'}${bullets}`,
    );
  }
  return sections.join('');
}

/** Turn the upload script's JSON into a file -> URL map. */
function parseAttachments(rawJson) {
  if (!rawJson) return new Map();
  let payload;
  try {
    payload = JSON.parse(rawJson);
  } catch (error) {
    die(`--attachments is not valid JSON: ${error.message}`);
  }
  if (!payload || !Array.isArray(payload.uploads)) return new Map();
  return new Map(
    payload.uploads.filter((entry) => entry && entry.file && entry.url).map(({ file, url }) => [file, url]),
  );
}

function buildLogEvidenceSection(slug, summary) {
  if (summary === undefined) return NO_SUMMARY_BLOCK;

  return (
    '<details>\n' +
    `<summary>Evidence run summary (docs/evidence/${slug}/summary.md)</summary>\n\n` +
    `${summary}\n` +
    '</details>'
  );
}

function buildPrBlock({ slug, screenshots, video, summary, attachmentUrlByFile = new Map() }) {
  return (
    '## Agent Evidence\n\n' +
    '- [x] This PR was opened by an AI agent\n\n' +
    `${buildVideoLine(slug, video, attachmentUrlByFile)}\n\n` +
    `**Screenshots:** ${buildScreenshotsSection(slug, screenshots, attachmentUrlByFile)}\n\n` +
    '**Log evidence:**\n\n' +
    `${buildLogEvidenceSection(slug, summary)}\n`
  );
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: { slug: { type: 'string' }, attachments: { type: 'string' } },
      strict: true,
    }));
  } catch (error) {
    die(
      `Invalid arguments: ${error.message}. ` +
        'Usage: node build-evidence-pr-block.cjs [--slug <branch-slug>] [--attachments <upload-json>]',
    );
  }

  const root = repoRoot();
  const slug = values.slug || defaultSlug();

  const evidenceDir = path.join(root, EVIDENCE_DIR_RELATIVE_PATH, slug);
  if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) {
    die(`No evidence found at docs/evidence/${slug}/ — run the playwright-evidence skill first.`);
  }

  const screenshots = collectScreenshots(evidenceDir);
  const video = findVideo(evidenceDir);
  const summary = readSummary(evidenceDir);

  const attachmentUrlByFile = parseAttachments(values.attachments);

  process.stdout.write(buildPrBlock({ slug, screenshots, video, summary, attachmentUrlByFile }));
}

if (require.main === module) {
  main();
}

module.exports = {
  collectScreenshots,
  findVideo,
  parseAttachments,
  readSummary,
  buildVideoLine,
  buildScreenshotsSection,
  buildLogEvidenceSection,
  buildPrBlock,
};
