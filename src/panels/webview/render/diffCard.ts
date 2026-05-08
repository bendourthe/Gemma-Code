/**
 * v0.7.0 Phase 4.1 -- Inline diff card render primitive (C21).
 *
 * Builds a side-by-side red-strikethrough / green-add diff card for
 * `edit_file`, `write_file`, `create_file` tool completions. The function
 * source is exported as a string so the runtime IIFE can inline it; the
 * `compileDiffCard` helper returns the same function under jsdom for tests.
 *
 * Safety: the renderer NEVER assigns user-supplied text to `innerHTML`. All
 * dynamic strings flow through `textContent`, satisfying the DOMPurify
 * requirement of ADR-0008 (DOMPurify not invoked because no untrusted HTML
 * is interpreted).
 */

const DIFF_LIB_FACTORY_SOURCE = String.raw`
  function __computeDiffLines(beforeText, afterText) {
    var before = beforeText.split('\n');
    var after = afterText.split('\n');
    var common = 0;
    var maxCommon = Math.min(before.length, after.length);
    while (common < maxCommon && before[common] === after[common]) common += 1;
    var beforeTail = [];
    var afterTail = [];
    for (var i = common; i < before.length; i += 1) beforeTail.push(before[i]);
    for (var j = common; j < after.length; j += 1) afterTail.push(after[j]);
    var lines = [];
    for (var k = 0; k < common; k += 1) lines.push({ kind: 'context', text: before[k] });
    for (var r = 0; r < beforeTail.length; r += 1) lines.push({ kind: 'removed', text: beforeTail[r] });
    for (var a = 0; a < afterTail.length; a += 1) lines.push({ kind: 'added', text: afterTail[a] });
    return { lines: lines, addedCount: afterTail.length, removedCount: beforeTail.length };
  }
`;

export const DIFF_CARD_FN_SOURCE = String.raw`
${DIFF_LIB_FACTORY_SOURCE}
function renderDiffCard(beforeText, afterText, filePath) {
  var card = document.createElement('div');
  card.className = 'diff-card';

  var header = document.createElement('div');
  header.className = 'diff-card-header';

  var pathEl = document.createElement('span');
  pathEl.className = 'diff-card-path';
  pathEl.textContent = filePath;
  header.appendChild(pathEl);

  var diff = __computeDiffLines(beforeText, afterText);

  var badge = document.createElement('span');
  badge.className = 'diff-card-badge';
  badge.textContent = 'Added ' + diff.addedCount + ' lines / Removed ' + diff.removedCount + ' lines';
  header.appendChild(badge);

  card.appendChild(header);

  var scroll = document.createElement('div');
  scroll.className = 'diff-card-scroll';

  for (var i = 0; i < diff.lines.length; i += 1) {
    var line = diff.lines[i];
    var lineEl = document.createElement('div');
    lineEl.className = 'diff-line ' + line.kind;
    lineEl.textContent = (line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  ') + line.text;
    scroll.appendChild(lineEl);
  }

  card.appendChild(scroll);
  return card;
}
`;

/**
 * Compile the runtime renderer against a host `document` (jsdom in tests, the
 * webview window in production). Used only by the unit-test suite -- the
 * webview itself inlines `DIFF_CARD_FN_SOURCE` into its IIFE.
 */
export function compileDiffCard(
  documentRef: Document,
): (before: string, after: string, filePath: string) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${DIFF_CARD_FN_SOURCE}\nreturn renderDiffCard;`,
  );
  return factory(documentRef) as (
    before: string,
    after: string,
    filePath: string,
  ) => HTMLElement;
}
