/* dump-selectors.js — storyboard authoring helper.
 *
 * Run against a live page to enumerate interactive/landmark elements and
 * their identifying attributes, so a playwright-evidence storyboard scene
 * can be authored against real selectors instead of guesses:
 *
 *   shot-scraper javascript <url> -i .claude/skills/playwright-evidence/scripts/dump-selectors.js
 *
 * The page is given time to settle before anything is collected. In a
 * client-rendered app the server response is an empty shell, so a synchronous
 * pass returns `[]` (or the login page's controls) no matter how correct the
 * selectors are — which reads as "no elements here" rather than "too early".
 *
 * shot-scraper prints whatever this file's final expression evaluates to as
 * JSON, and awaits it when it is a promise, so the file's last statement must
 * be a single expression — here, an async IIFE that returns an array of plain
 * objects describing each element:
 *
 *   { tag, text, title, ariaLabel, placeholder, testId, id, name, type, href }
 *
 * Fields that are empty/undefined are omitted so the JSON output stays
 * readable. The array is deduplicated (identical entries collapse to one)
 * and capped so a very dense page doesn't flood the output.
 *
 * Framework-free: plain DOM APIs only, no dependency on the app under test.
 */
(async () => {
  const SELECTOR = 'h1, h2, h3, button, a[href], input, select, textarea, [role="button"], [role="tab"], [data-testid]';
  const TEXT_MAX_LENGTH = 80;
  const MAX_ENTRIES = 400;
  // Poll until the matched-element count stops growing for two consecutive
  // checks, or the ceiling is hit. Cheap on an already-rendered page (one extra
  // poll interval) and enough for a cold client render behind a dev server.
  const SETTLE_POLL_MS = 400;
  const SETTLE_STABLE_POLLS = 2;
  const SETTLE_MAX_MS = 15_000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForDomToSettle() {
    const deadline = Date.now() + SETTLE_MAX_MS;
    let previousCount = -1;
    let stablePolls = 0;

    while (Date.now() < deadline) {
      const count = document.querySelectorAll(SELECTOR).length;
      stablePolls = count === previousCount && count > 0 ? stablePolls + 1 : 0;
      if (stablePolls >= SETTLE_STABLE_POLLS) return;
      previousCount = count;
      await sleep(SETTLE_POLL_MS);
    }
  }

  await waitForDomToSettle();

  function truncate(value) {
    const trimmed = value.trim();
    return trimmed.length > TEXT_MAX_LENGTH ? `${trimmed.slice(0, TEXT_MAX_LENGTH)}…` : trimmed;
  }

  function describe(element) {
    const entry = {
      tag: element.tagName.toLowerCase(),
    };

    const text = truncate(element.innerText || '');
    if (text) entry.text = text;

    const title = element.getAttribute('title');
    if (title) entry.title = title;

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) entry.ariaLabel = ariaLabel;

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) entry.placeholder = placeholder;

    const testId = element.getAttribute('data-testid');
    if (testId) entry.testId = testId;

    if (element.id) entry.id = element.id;

    const name = element.getAttribute('name');
    if (name) entry.name = name;

    const type = element.getAttribute('type');
    if (type) entry.type = type;

    const href = element.getAttribute('href');
    if (href) entry.href = href;

    return entry;
  }

  const seen = new Set();
  const results = [];

  for (const element of document.querySelectorAll(SELECTOR)) {
    const entry = describe(element);
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(entry);
    if (results.length >= MAX_ENTRIES) break;
  }

  return results;
})();
