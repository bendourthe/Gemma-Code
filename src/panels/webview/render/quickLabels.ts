/**
 * v0.8.0 Phase 3.3 -- Quick-label chips for plan-mode annotations (B5).
 *
 * One-click annotation chips that prefill a `COMMENT` annotation with a
 * canonical `quickLabelTip` text. The default chip set is fixed; custom
 * chips can be layered on at runtime by passing a merged array into the
 * compiled render function. The webview is expected to load custom chips
 * from `~/.gemma-code/plans/quick-labels.json` via {@link loadCustomQuickLabels}.
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface QuickLabel {
  /** Stable id used inside `data-label-id` and as the default annotation id prefix. */
  id: string;
  /** Short user-facing chip text (max ~20 chars). */
  label: string;
  /** The body text inserted into the prefilled COMMENT annotation. */
  quickLabelTip: string;
}

/**
 * Built-in chip set sourced from the comparison report Section 5a item B5.
 * Editing the order here updates the user-visible chip order.
 */
export const DEFAULT_QUICK_LABELS: readonly QuickLabel[] = [
  {
    id: "out-of-scope",
    label: "Out of scope",
    quickLabelTip:
      "This step extends beyond the agreed task boundary. Remove it or move to a follow-up plan.",
  },
  {
    id: "add-test",
    label: "Add test",
    quickLabelTip:
      "Include test coverage for this step (unit + integration if behavior crosses module boundaries).",
  },
  {
    id: "risky",
    label: "Risky",
    quickLabelTip:
      "Flag the risk explicitly in the plan and include a verification step.",
  },
  {
    id: "missing-rationale",
    label: "Missing rationale",
    quickLabelTip:
      "Add a one-sentence rationale to this step explaining why this approach over alternatives.",
  },
  {
    id: "wrong-file",
    label: "Wrong file",
    quickLabelTip:
      "Verify the file path before editing. Path appears to be incorrect for the stated change.",
  },
];

/**
 * Default location of the user-editable custom-chip overlay.
 * `~/.gemma-code/plans/quick-labels.json` contains a JSON array of
 * {@link QuickLabel} rows that are appended to the built-in chip set.
 */
export function defaultCustomQuickLabelsPath(): string {
  return path.join(os.homedir(), ".gemma-code", "plans", "quick-labels.json");
}

/**
 * Load the user-supplied custom chip overlay. Silently returns `[]` when
 * the file is missing; emits a `console.warn` (so the diagnostic surfaces in
 * the extension output channel) and returns `[]` on parse errors so a
 * malformed override never breaks the webview render path. Kept logger-free
 * so the module can be imported in the jsdom-environment tests that exercise
 * the render primitive.
 */
export function loadCustomQuickLabels(
  filePath: string = defaultCustomQuickLabelsPath(),
): QuickLabel[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[QuickLabels] Failed to parse ${filePath}:`, err);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: QuickLabel[] = [];
  for (const row of parsed) {
    if (
      typeof row === "object" &&
      row !== null &&
      typeof (row as QuickLabel).id === "string" &&
      typeof (row as QuickLabel).label === "string" &&
      typeof (row as QuickLabel).quickLabelTip === "string"
    ) {
      out.push({
        id: (row as QuickLabel).id,
        label: (row as QuickLabel).label,
        quickLabelTip: (row as QuickLabel).quickLabelTip,
      });
    }
  }
  return out;
}

/**
 * Convenience lookup keyed by chip id. Generated from
 * {@link DEFAULT_QUICK_LABELS} so external surfaces (docs sync checks, the
 * AGENTS.md catalog table) can verify canonical tip wording at runtime.
 */
export const PLAN_QUICK_LABELS_TIPS: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      DEFAULT_QUICK_LABELS.map((l) => [l.id, l.quickLabelTip]),
    ),
  );

/** Resolve the chip identified by `id` against the supplied chip set. */
export function findQuickLabel(
  id: string,
  labels: readonly QuickLabel[] = DEFAULT_QUICK_LABELS,
): QuickLabel | null {
  return labels.find((l) => l.id === id) ?? null;
}

export interface QuickLabelHandlers {
  onPick: (label: QuickLabel) => void;
}

export const QUICK_LABELS_FN_SOURCE = String.raw`
function renderQuickLabels(labels, handlers) {
  var row = document.createElement('div');
  row.className = 'plan-quick-labels';
  row.setAttribute('aria-label', 'Quick annotation chips');

  for (var i = 0; i < labels.length; i += 1) {
    var lbl = labels[i];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plan-quick-label';
    btn.setAttribute('data-label-id', lbl.id);
    btn.title = lbl.quickLabelTip;
    btn.textContent = lbl.label;
    (function (chosen) {
      btn.addEventListener('click', function () {
        if (handlers && typeof handlers.onPick === 'function') {
          handlers.onPick(chosen);
        }
      });
    })(lbl);
    row.appendChild(btn);
  }

  return row;
}
`;

export function compileQuickLabels(
  documentRef: Document,
): (
  labels: readonly QuickLabel[],
  handlers: QuickLabelHandlers,
) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${QUICK_LABELS_FN_SOURCE}\nreturn renderQuickLabels;`,
  );
  return factory(documentRef) as (
    labels: readonly QuickLabel[],
    handlers: QuickLabelHandlers,
  ) => HTMLElement;
}
