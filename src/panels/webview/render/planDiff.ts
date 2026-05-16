/**
 * v0.8.0 Phase 3.2 -- Plan diff render primitive (A8 + B6).
 *
 * Renders the diff between two plan versions in one of three modes:
 *
 * - `clean`   -- inline markdown with additions and deletions in-place; the
 *                consumer is expected to pass the pre-formatted markdown
 *                string (this primitive renders it as `textContent` so the
 *                webview's markdown renderer can later transform `**...**` /
 *                `~~...~~` into the visual diff if desired).
 * - `classic` -- line-by-line block diff with `+` / `-` / ` ` prefixes; each
 *                line is its own DOM row carrying a status class.
 * - `raw`     -- unified diff (the standard `createPatch` output); rendered
 *                as a single preformatted block so the user can copy/paste.
 *
 * The user-visible header shows the slug + the version range. A mode-toggle
 * row underneath lets the consumer wire the three buttons to a state update.
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

export type PlanDiffMode = "clean" | "classic" | "raw";

export interface PlanDiffPayload {
  planSlug: string;
  fromVersion: number;
  toVersion: number;
  clean: string;
  classic: string;
  raw: string;
}

export interface PlanDiffHandlers {
  onModeChange?: (mode: PlanDiffMode) => void;
}

export const PLAN_DIFF_FN_SOURCE = String.raw`
function renderPlanDiff(payload, mode, handlers) {
  var root = document.createElement('section');
  root.className = 'plan-diff';
  root.setAttribute('aria-label', 'Plan revision diff');

  var header = document.createElement('div');
  header.className = 'plan-diff-header';

  var title = document.createElement('span');
  title.className = 'plan-diff-title';
  title.textContent = payload.planSlug + ': v' + String(payload.fromVersion) + ' -> v' + String(payload.toVersion);
  header.appendChild(title);

  var modes = ['clean', 'classic', 'raw'];
  var toggle = document.createElement('div');
  toggle.className = 'plan-diff-toggle';
  for (var i = 0; i < modes.length; i += 1) {
    var m = modes[i];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plan-diff-mode-btn plan-diff-mode-' + m;
    if (m === mode) btn.classList.add('plan-diff-mode-active');
    btn.textContent = m;
    btn.setAttribute('data-mode', m);
    (function (chosen) {
      btn.addEventListener('click', function () {
        if (handlers && typeof handlers.onModeChange === 'function') {
          handlers.onModeChange(chosen);
        }
      });
    })(m);
    toggle.appendChild(btn);
  }
  header.appendChild(toggle);
  root.appendChild(header);

  var body = document.createElement('div');
  body.className = 'plan-diff-body plan-diff-body-' + mode;

  if (mode === 'classic') {
    var lines = payload.classic.split('\n');
    for (var j = 0; j < lines.length; j += 1) {
      var line = lines[j];
      var row = document.createElement('div');
      row.className = 'plan-diff-line';
      var cls = ' ';
      if (line.length > 0) {
        cls = line.charAt(0);
        if (cls === '+') row.classList.add('plan-diff-line-add');
        else if (cls === '-') row.classList.add('plan-diff-line-del');
        else row.classList.add('plan-diff-line-ctx');
      } else {
        row.classList.add('plan-diff-line-ctx');
      }
      row.textContent = line;
      body.appendChild(row);
    }
  } else if (mode === 'raw') {
    var pre = document.createElement('pre');
    pre.className = 'plan-diff-raw';
    pre.textContent = payload.raw;
    body.appendChild(pre);
  } else {
    var clean = document.createElement('div');
    clean.className = 'plan-diff-clean';
    clean.textContent = payload.clean;
    body.appendChild(clean);
  }

  root.appendChild(body);
  return root;
}
`;

export function compilePlanDiff(
  documentRef: Document,
): (
  payload: PlanDiffPayload,
  mode: PlanDiffMode,
  handlers: PlanDiffHandlers,
) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${PLAN_DIFF_FN_SOURCE}\nreturn renderPlanDiff;`,
  );
  return factory(documentRef) as (
    payload: PlanDiffPayload,
    mode: PlanDiffMode,
    handlers: PlanDiffHandlers,
  ) => HTMLElement;
}
