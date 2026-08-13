const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  HARNESS,
  findMainTranscript,
  findParentTranscriptForForkedAgent,
  collectJsonlFiles,
  findCodexTranscript,
  accumulateUsage,
  accumulateCodexUsage,
  accumulateCodexThreadTree,
  formatSummary,
} = require('./token-usage.cjs');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-test-'));
}

function assistantLine({ id, model = 'claude-sonnet-5', input = 0, cacheCreation = 0, cacheRead = 0, output = 0 }) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model,
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        output_tokens: output,
      },
    },
  });
}

function codexLine(type, payload) {
  return JSON.stringify({ type, payload });
}

test('findMainTranscript locates the session file under whichever project dir encodes it', () => {
  const projectsDir = makeTmpDir();
  const projectDir = path.join(projectsDir, '-Users-someone-some-repo');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'session-123.jsonl'), '');

  const found = findMainTranscript('session-123', projectsDir);
  assert.equal(found, path.join(projectDir, 'session-123.jsonl'));
});

test('findMainTranscript returns null when no project dir has that session', () => {
  const projectsDir = makeTmpDir();
  fs.mkdirSync(path.join(projectsDir, 'some-project'), { recursive: true });
  assert.equal(findMainTranscript('missing-session', projectsDir), null);
});

test('collectJsonlFiles walks nested directories and ignores non-jsonl files', () => {
  const dir = makeTmpDir();
  fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'subagents', 'agent-1.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'subagents', 'agent-1.meta.json'), '{}');

  const files = collectJsonlFiles(dir);
  assert.deepEqual(files, [path.join(dir, 'subagents', 'agent-1.jsonl')]);
});

test('collectJsonlFiles returns an empty array for a missing directory', () => {
  assert.deepEqual(collectJsonlFiles('/does/not/exist'), []);
});

test('findParentTranscriptForForkedAgent resolves a forked-skill agent id to its enclosing parent session', () => {
  const projectsDir = makeTmpDir();
  const projectDir = path.join(projectsDir, '-Users-someone-some-repo');
  const parentDir = path.join(projectDir, 'parent-session-id');
  fs.mkdirSync(path.join(parentDir, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'parent-session-id.jsonl'), '');
  fs.writeFileSync(path.join(parentDir, 'subagents', 'agent-fork-abc123.jsonl'), '');

  const found = findParentTranscriptForForkedAgent('fork-abc123', projectsDir);
  assert.equal(found, path.join(projectDir, 'parent-session-id.jsonl'));
});

test('findParentTranscriptForForkedAgent returns null when no subagent transcript matches', () => {
  const projectsDir = makeTmpDir();
  const projectDir = path.join(projectsDir, 'some-project');
  fs.mkdirSync(path.join(projectDir, 'parent-session-id', 'subagents'), { recursive: true });
  assert.equal(findParentTranscriptForForkedAgent('unknown-agent', projectsDir), null);
});

test('findCodexTranscript locates active and archived rollout files by thread id', () => {
  const codexDir = makeTmpDir();
  const activeDir = path.join(codexDir, 'sessions', '2026', '07', '20');
  const archivedDir = path.join(codexDir, 'archived_sessions');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.mkdirSync(archivedDir, { recursive: true });
  const active = path.join(activeDir, 'rollout-2026-07-20-thread-active.jsonl');
  const archived = path.join(archivedDir, 'rollout-2026-07-19-thread-archived.jsonl');
  fs.writeFileSync(active, '');
  fs.writeFileSync(archived, '');

  assert.equal(findCodexTranscript('thread-active', codexDir), active);
  assert.equal(findCodexTranscript('thread-archived', codexDir), archived);
  assert.equal(findCodexTranscript('thread-missing', codexDir), null);
});

test('accumulateCodexUsage uses the latest cumulative snapshot and discovers child threads', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'root.jsonl');
  fs.writeFileSync(
    file,
    [
      codexLine('turn_context', { model: 'gpt-5.6-sol' }),
      codexLine('event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 80,
            cache_write_input_tokens: 4,
            output_tokens: 10,
          },
        },
      }),
      codexLine('event_msg', {
        type: 'sub_agent_activity',
        agent_thread_id: 'child-thread',
      }),
      codexLine('event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 160,
            cached_input_tokens: 120,
            cache_write_input_tokens: 6,
            output_tokens: 20,
          },
        },
      }),
    ].join('\n'),
  );

  const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
  const result = accumulateCodexUsage(file, totals);

  assert.deepEqual(result, { childThreadIds: ['child-thread'], foundUsage: true });
  assert.deepEqual(
    { ...totals, models: [...totals.models] },
    { rawInput: 40, cacheCreation: 6, cacheRead: 120, output: 20, models: ['gpt-5.6-sol'] },
  );
});

test('accumulateCodexThreadTree includes recursively linked subagent usage once', () => {
  const codexDir = makeTmpDir();
  const sessionDir = path.join(codexDir, 'sessions', '2026', '07', '20');
  fs.mkdirSync(sessionDir, { recursive: true });
  const root = path.join(sessionDir, 'rollout-root-thread.jsonl');
  const child = path.join(sessionDir, 'rollout-child-thread.jsonl');
  const usage = (input, cached, output) =>
    codexLine('event_msg', {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          cache_write_input_tokens: 0,
          output_tokens: output,
        },
      },
    });
  fs.writeFileSync(
    root,
    [
      usage(100, 70, 10),
      codexLine('event_msg', { type: 'sub_agent_activity', agent_thread_id: 'child-thread' }),
      codexLine('event_msg', { type: 'sub_agent_activity', agent_thread_id: 'child-thread' }),
    ].join('\n'),
  );
  fs.writeFileSync(child, usage(50, 40, 5));

  const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
  assert.equal(accumulateCodexThreadTree(root, codexDir, totals), 2);
  assert.deepEqual(
    { ...totals, models: [...totals.models] },
    { rawInput: 40, cacheCreation: 0, cacheRead: 110, output: 15, models: [] },
  );
});

test('accumulateUsage sums usage across assistant lines and skips non-assistant lines', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(
    file,
    [
      assistantLine({ id: 'msg_1', input: 2, cacheCreation: 100, cacheRead: 50, output: 10 }),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      assistantLine({ id: 'msg_2', input: 2, cacheCreation: 20, cacheRead: 5, output: 4 }),
    ].join('\n'),
  );

  const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
  const seen = new Set();
  accumulateUsage(file, totals, seen);

  assert.equal(totals.rawInput, 4);
  assert.equal(totals.cacheCreation, 120);
  assert.equal(totals.cacheRead, 55);
  assert.equal(totals.output, 14);
  assert.equal(seen.size, 2);
  assert.deepEqual([...totals.models], ['claude-sonnet-5']);
});

test('accumulateUsage dedups repeated lines by message id', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 't.jsonl');
  const line = assistantLine({ id: 'msg_dup', input: 2, cacheCreation: 100, cacheRead: 50, output: 10 });
  fs.writeFileSync(file, [line, line, line].join('\n'));

  const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
  const seen = new Set();
  accumulateUsage(file, totals, seen);

  assert.equal(totals.output, 10);
  assert.equal(seen.size, 1);
});

test('accumulateUsage dedups across multiple files sharing the seenMessageIds set', () => {
  const dir = makeTmpDir();
  const fileA = path.join(dir, 'a.jsonl');
  const fileB = path.join(dir, 'b.jsonl');
  const line = assistantLine({ id: 'msg_shared', input: 2, cacheCreation: 10, cacheRead: 5, output: 3 });
  fs.writeFileSync(fileA, line);
  fs.writeFileSync(fileB, line);

  const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
  const seen = new Set();
  accumulateUsage(fileA, totals, seen);
  accumulateUsage(fileB, totals, seen);

  assert.equal(totals.output, 3);
  assert.equal(seen.size, 1);
});

test('accumulateUsage tolerates a truncated trailing line', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${assistantLine({ id: 'msg_1', output: 5 })}\n{"type":"assistant","mess`);

  const totals = { rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() };
  const seen = new Set();
  accumulateUsage(file, totals, seen);

  assert.equal(totals.output, 5);
});

test('formatSummary reports grand total, the /cost-style breakdown, model list, and the coverage caveat', () => {
  const totals = {
    rawInput: 96_000,
    cacheCreation: 40,
    cacheRead: 500,
    output: 32_000,
    models: new Set(['claude-opus-4-8']),
  };
  const summary = formatSummary(totals);
  const [headline, blank, caveat] = summary.split('\n');
  assert.equal(blank, ''); // blank line, not a lone "\n" — GitHub Markdown would collapse that
  assert.equal(
    headline,
    'Total tokens: 128,540 (96,000 input / 32,000 output / 500 cache read / 40 cache write), model claude-opus-4-8',
  );
  assert.match(caveat, /excludes `advisor\(\)`/);
});

test('formatSummary joins multiple models and falls back when none seen', () => {
  const multi = formatSummary({
    rawInput: 0,
    cacheCreation: 0,
    cacheRead: 0,
    output: 1,
    models: new Set(['claude-sonnet-5', 'claude-opus-4-8']),
  });
  assert.match(multi, /model claude-sonnet-5, claude-opus-4-8/);

  const none = formatSummary({ rawInput: 0, cacheCreation: 0, cacheRead: 0, output: 0, models: new Set() });
  assert.match(none, /model unknown model/);
});

test('formatSummary describes Codex cumulative transcript evidence', () => {
  const summary = formatSummary(
    { rawInput: 10, cacheCreation: 0, cacheRead: 20, output: 5, models: new Set(['gpt-5.6-sol']) },
    HARNESS.CODEX,
  );
  assert.match(summary, /Total tokens: 35/);
  assert.match(summary, /From this Codex thread's transcript/);
  assert.match(summary, /cumulative usage snapshots/);
});
