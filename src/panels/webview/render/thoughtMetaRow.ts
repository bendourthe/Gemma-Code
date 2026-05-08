/**
 * v0.7.0 Phase 4.5 -- Thought-for-Xs meta-row render primitive (C25).
 *
 * Replaces the legacy three-bouncing-dots indicator with a subdued meta-row
 * that flips from "Thinking..." to "Thought for Ns" once the thinking
 * phase completes.
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

export const THOUGHT_META_ROW_FN_SOURCE = String.raw`
function renderThoughtMetaRow(status, durationMs) {
  var row = document.createElement('div');
  row.className = 'thought-meta-row thought-meta-' + status;
  row.setAttribute('role', 'status');

  var bullet = document.createElement('span');
  bullet.className = 'thought-meta-bullet';
  bullet.setAttribute('aria-hidden', 'true');
  bullet.textContent = status === 'thinking' ? '...' : '•';
  row.appendChild(bullet);

  var label = document.createElement('span');
  label.className = 'thought-meta-label';
  if (status === 'thinking') {
    label.textContent = 'Thinking...';
  } else {
    var ms = (typeof durationMs === 'number' && durationMs >= 0) ? durationMs : 0;
    var seconds = Math.round(ms / 100) / 10;
    label.textContent = 'Thought for ' + seconds + 's';
  }
  row.appendChild(label);

  return row;
}
`;

export function compileThoughtMetaRow(
  documentRef: Document,
): (status: "thinking" | "complete", durationMs: number | null) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${THOUGHT_META_ROW_FN_SOURCE}\nreturn renderThoughtMetaRow;`,
  );
  return factory(documentRef) as (
    status: "thinking" | "complete",
    durationMs: number | null,
  ) => HTMLElement;
}
