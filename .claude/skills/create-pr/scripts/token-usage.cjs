#!/usr/bin/env node
/**
 * Computes token usage for the current supported agent session by reading its
 * own local transcript, instead of the agent hand-typing a remembered/guessed
 * number. Claude Code and Codex are supported today.
 *
 * Every ordinary assistant turn Claude Code writes to disk already carries
 * an Anthropic API `usage` object (input_tokens, cache_creation_input_tokens,
 * cache_read_input_tokens, output_tokens). This script sums those across:
 *
 *   1. The main session transcript:
 *      ~/.claude/projects/<escaped-cwd>/<CLAUDE_CODE_SESSION_ID>.jsonl
 *   2. Every nested transcript under that session's own directory:
 *      ~/.claude/projects/<escaped-cwd>/<CLAUDE_CODE_SESSION_ID>/**\/*.jsonl
 *      (subagent transcripts live under a `subagents/` folder there — this
 *      walks recursively rather than hardcoding that name, so it also picks
 *      up any future nested-transcript layout without edits.)
 *
 * It never guesses the `<escaped-cwd>` encoding: it scans one level of
 * `~/.claude/projects/*` for a directory containing `<sessionId>.jsonl`,
 * which is robust to however the harness escapes the path.
 *
 * Dedup: streaming and mid-task snapshots can write the same assistant
 * message to the transcript more than once. Anthropic's `message.id` is
 * stable per API call, so usage is summed once per unique message id.
 *
 * Breakdown, not a single blended number: real sessions are dominated by
 * `cache_read_input_tokens` (a long conversation re-reads its full cached
 * context every turn), which is billed at a fraction of a fresh input
 * token's rate. Collapsing everything into one "input" figure makes the
 * total look inflated relative to actual cost. This mirrors `/cost`'s own
 * per-model vocabulary instead: input / output / cache read / cache write.
 *
 * KNOWN GAP — this is an approximation, not full `/cost` parity: `/cost`'s
 * total also includes internal calls this transcript never records with a
 * usable `message.usage`, notably `advisor()` (routed to a separate model,
 * confirmed by inspection to be absent from this session's own transcript
 * despite `/cost` reporting real spend on it) and auto title-generation.
 * On a session that leans on `advisor()` a lot, this script's total can
 * undercount `/cost` by a material fraction. Cross-check with `/cost` when
 * that matters; the printed line says so explicitly.
 *
 * FORKED SKILL CONTEXTS (`context: fork` in a SKILL.md's frontmatter, as
 * the create-pr skill itself uses): Claude Code's sub-agent docs confirm a
 * forked skill runs as a genuine subagent, with its transcript nested as
 * `<parent-session-id>/subagents/agent-<agentId>.jsonl` — NOT as its own
 * top-level `<id>.jsonl` session. Empirically confirmed (spawned a probe
 * subagent and echoed the var): `CLAUDE_CODE_SESSION_ID` inside a subagent
 * resolves to the *parent's* session id, not the subagent's own agent id —
 * so the plain top-level lookup below already finds the full parent
 * transcript with no special-casing needed. As a defense-in-depth fallback
 * for the theoretical alternate case (the var resolving to the subagent's
 * own agent id instead), this script *also* checks for a nested
 * `**\/subagents/agent-<sessionId>.jsonl` and, if found, widens to that
 * match's enclosing parent session — because a fork's own turns alone would
 * only be the mechanical PR-creation steps, not the task that produced the
 * diff being shipped. If neither resolves, it fails loudly rather than
 * silently reporting a near-empty transcript as if it were the task's total.
 *
 * Usage:
 *   node token-usage.cjs
 *
 * Prints two lines to stdout in the format the Agent Evidence PR section
 * expects, e.g.:
 *   Total tokens: 128,540 (96,000 input / 32,000 output / 500 cache read / 40 cache write), model claude-sonnet-5
 *   _From this session's transcript (main + subagents); excludes advisor()/internal calls — cross-check `/cost` if used heavily._
 *
 * Codex records cumulative usage snapshots per thread. For Codex, this script
 * reads the latest snapshot from the main thread and each recursively linked
 * subagent thread, then maps cached input into the same input / output / cache
 * read / cache write vocabulary used for Claude Code.
 *
 * Exits non-zero with a diagnostic on stderr (and prints nothing to stdout)
 * when the harness or session transcript can't be located or read — callers
 * should fall back to `n/a` with that reason rather than inventing a number.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const HARNESS = Object.freeze({
  CLAUDE_CODE: 'Claude Code',
  CODEX: 'Codex',
});
const SESSION_ENV = Object.freeze({
  CLAUDE_CODE: 'CLAUDE_CODE_SESSION_ID',
  CODEX: 'CODEX_THREAD_ID',
});
const CODEX_EVENT_TYPE = Object.freeze({
  SUB_AGENT_ACTIVITY: 'sub_agent_activity',
  TOKEN_COUNT: 'token_count',
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Scan one level of projectsDir for a directory containing `<sessionId>.jsonl`. */
function findMainTranscript(sessionId, projectsDir) {
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Fallback for a forked-skill invocation: `sessionId` may be a subagent's own
 * agent id rather than a top-level session id. Search each project dir for
 * `<parentId>/subagents/agent-<sessionId>.jsonl`; if found, return the
 * *enclosing parent's* top-level transcript path (its own `<parentId>.jsonl`),
 * not the subagent's file — the parent's transcript is what carries the
 * actual task's turns, and its own recursive walk already includes this
 * subagent's file too.
 */
function findParentTranscriptForForkedAgent(sessionId, projectsDir) {
  for (const projectEntry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) continue;
    const projectDir = path.join(projectsDir, projectEntry.name);
    for (const maybeSession of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!maybeSession.isDirectory()) continue;
      const candidate = path.join(projectDir, maybeSession.name, 'subagents', `agent-${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) {
        const parentTranscript = path.join(projectDir, `${maybeSession.name}.jsonl`);
        if (fs.existsSync(parentTranscript)) return parentTranscript;
      }
    }
  }
  return null;
}

/** Recursively collect every *.jsonl path under dir (missing dir -> []). */
function collectJsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectJsonlFiles(full));
    else if (entry.name.endsWith('.jsonl')) results.push(full);
  }
  return results;
}

/** Locate a Codex rollout by thread id in active or archived session storage. */
function findCodexTranscript(threadId, codexDir) {
  const roots = [path.join(codexDir, 'sessions'), path.join(codexDir, 'archived_sessions')];
  const suffix = `${threadId}.jsonl`;
  for (const root of roots) {
    for (const file of collectJsonlFiles(root)) {
      if (path.basename(file).endsWith(suffix)) return file;
    }
  }
  return null;
}

/** Add the latest cumulative Codex usage snapshot and return linked child thread ids. */
function accumulateCodexUsage(filePath, totals) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const childThreadIds = new Set();
  let latestUsage = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = entry && entry.payload;
    if (entry.type === 'turn_context' && payload && payload.model) {
      totals.models.add(payload.model);
    }
    if (
      entry.type === 'event_msg' &&
      payload &&
      payload.type === CODEX_EVENT_TYPE.SUB_AGENT_ACTIVITY &&
      payload.agent_thread_id
    ) {
      childThreadIds.add(payload.agent_thread_id);
    }
    if (
      entry.type === 'event_msg' &&
      payload &&
      payload.type === CODEX_EVENT_TYPE.TOKEN_COUNT &&
      payload.info &&
      payload.info.total_token_usage
    ) {
      latestUsage = payload.info.total_token_usage;
    }
  }

  if (latestUsage) {
    const input = latestUsage.input_tokens || 0;
    const cacheRead = latestUsage.cached_input_tokens || 0;
    totals.rawInput += Math.max(0, input - cacheRead);
    totals.cacheCreation += latestUsage.cache_write_input_tokens || 0;
    totals.cacheRead += cacheRead;
    totals.output += latestUsage.output_tokens || 0;
  }

  return { childThreadIds: [...childThreadIds], foundUsage: Boolean(latestUsage) };
}

/** Resolve and accumulate a Codex main thread plus recursively linked subagents. */
function accumulateCodexThreadTree(mainTranscript, codexDir, totals) {
  const pending = [mainTranscript];
  const seenFiles = new Set();
  let usageFiles = 0;

  while (pending.length > 0) {
    const file = pending.shift();
    if (!file || seenFiles.has(file)) continue;
    seenFiles.add(file);

    const { childThreadIds, foundUsage } = accumulateCodexUsage(file, totals);
    if (foundUsage) usageFiles += 1;
    for (const childThreadId of childThreadIds) {
      const childTranscript = findCodexTranscript(childThreadId, codexDir);
      if (childTranscript && !seenFiles.has(childTranscript)) pending.push(childTranscript);
    }
  }

  return usageFiles;
}

/** Sum usage from one transcript file into the running totals, deduped by message id. */
function accumulateUsage(filePath, totals, seenMessageIds) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // tolerate a truncated last line (e.g. transcript still being written)
    }
    const message = entry && entry.message;
    const usage = message && message.usage;
    if (entry.type !== 'assistant' || !usage || !message.id) continue;
    if (seenMessageIds.has(message.id)) continue;
    seenMessageIds.add(message.id);

    totals.rawInput += usage.input_tokens || 0;
    totals.cacheCreation += usage.cache_creation_input_tokens || 0;
    totals.cacheRead += usage.cache_read_input_tokens || 0;
    totals.output += usage.output_tokens || 0;
    if (message.model) totals.models.add(message.model);
  }
}

/** Build the "Total tokens: ..." summary from accumulated totals, /cost-style (input/output/cache read/cache write). */
function formatSummary(totals, harness = HARNESS.CLAUDE_CODE) {
  const fmt = (n) => NUMBER_FORMAT.format(n);
  const grandTotal = totals.rawInput + totals.cacheCreation + totals.cacheRead + totals.output;
  const modelList = [...totals.models].join(', ') || 'unknown model';

  const headline =
    `Total tokens: ${fmt(grandTotal)} ` +
    `(${fmt(totals.rawInput)} input / ${fmt(totals.output)} output / ` +
    `${fmt(totals.cacheRead)} cache read / ${fmt(totals.cacheCreation)} cache write), ` +
    `model ${modelList}`;

  const caveat =
    harness === HARNESS.CODEX
      ? "_From this Codex thread's transcript (main + subagents); uses Codex's recorded cumulative usage snapshots._"
      : "_From this Claude Code session's transcript (main + subagents); excludes `advisor()` and other " +
        'internal-model calls — cross-check `/cost` if those were used heavily._';

  // Blank line, not a single "\n" — GitHub Markdown collapses a lone newline into the
  // same paragraph, which would run the caveat into the headline.
  return `${headline}\n\n${caveat}`;
}

function main() {
  const claudeSessionId = process.env[SESSION_ENV.CLAUDE_CODE];
  const codexThreadId = process.env[SESSION_ENV.CODEX];
  if (!claudeSessionId && !codexThreadId) {
    fail(
      `${SESSION_ENV.CLAUDE_CODE} and ${SESSION_ENV.CODEX} are both unset — ` +
        'no supported agent session was detected.',
    );
  }

  if (codexThreadId && !claudeSessionId) {
    const codexDir = path.join(os.homedir(), '.codex');
    let mainTranscript;
    try {
      mainTranscript = findCodexTranscript(codexThreadId, codexDir);
    } catch (error) {
      fail(`Cannot read ${codexDir}: ${error.message}`);
    }
    if (!mainTranscript) {
      fail(`No Codex transcript found for thread ${codexThreadId} under ${codexDir}.`);
    }

    const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
    const usageFiles = accumulateCodexThreadTree(mainTranscript, codexDir, totals);
    if (usageFiles === 0) {
      fail(`Codex transcript(s) found but no cumulative usage snapshots were readable (thread ${codexThreadId}).`);
    }
    console.log(formatSummary(totals, HARNESS.CODEX));
    return;
  }

  const sessionId = claudeSessionId;

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  let mainTranscript;
  try {
    mainTranscript = findMainTranscript(sessionId, projectsDir);
    if (!mainTranscript) {
      // Not a top-level session id — maybe we're inside a `context: fork` skill
      // whose own agent id was exposed instead. Widen to the enclosing parent.
      mainTranscript = findParentTranscriptForForkedAgent(sessionId, projectsDir);
    }
  } catch (error) {
    fail(`Cannot read ${projectsDir}: ${error.message}`);
  }
  if (!mainTranscript) {
    fail(
      `No transcript found for session/agent ${sessionId} under ${projectsDir}/* ` +
        '(checked both top-level sessions and forked-skill subagent transcripts).',
    );
  }

  // sessionId in the "resolved to a parent" branch belongs to a nested agent-<id>.jsonl,
  // not to mainTranscript's own basename — always derive the walk dir from the resolved
  // transcript's own name, not the raw input id, so the recursive walk targets the right tree.
  const resolvedSessionId = path.basename(mainTranscript, '.jsonl');
  const sessionDir = path.join(path.dirname(mainTranscript), resolvedSessionId);
  const files = [mainTranscript, ...collectJsonlFiles(sessionDir)];

  const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
  const seenMessageIds = new Set();
  for (const file of files) {
    accumulateUsage(file, totals, seenMessageIds);
  }

  if (seenMessageIds.size === 0) {
    fail(`Transcript(s) found but no assistant usage entries were readable (session ${sessionId}).`);
  }

  console.log(formatSummary(totals));
}

if (require.main === module) {
  main();
}

module.exports = {
  HARNESS,
  findMainTranscript,
  findParentTranscriptForForkedAgent,
  collectJsonlFiles,
  findCodexTranscript,
  accumulateUsage,
  accumulateCodexUsage,
  accumulateCodexThreadTree,
  formatSummary,
};
