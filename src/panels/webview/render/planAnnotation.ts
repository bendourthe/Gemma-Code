/**
 * v0.8.0 Phase 3.1 -- Plan-mode annotation render primitive (B1).
 *
 * Three annotation types overlay a plan rendered in the webview:
 *
 * - `DELETION`     -- the user wants the span removed; the original text is
 *                     rendered with a strikethrough.
 * - `COMMENT`      -- the user attaches an inline note anchored at a span.
 *                     Rendered as a sidebar callout linked to the annotated
 *                     range via a `data-anchor` attribute.
 * - `GLOBAL_COMMENT` -- a note that applies to the whole plan rather than a
 *                     span. Rendered as a callout at the top of the plan.
 *
 * Annotations are produced via UI handlers (clicks on selected text, the
 * quick-label dropdown, or the global-comment compose area) and submitted
 * back to the extension as a `planAnnotationsSubmit` message when the user
 * denies the plan. Submission is one-shot; the webview clears its draft
 * buffer after the message is posted.
 *
 * Safety: every dynamic string flows through `textContent`; no innerHTML.
 */

export type PlanAnnotationType = "DELETION" | "COMMENT" | "GLOBAL_COMMENT";

export interface PlanAnnotation {
  id: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  type: PlanAnnotationType;
  text?: string;
  originalText: string;
  quickLabelTip?: string;
}

export interface PlanAnnotationHandlers {
  onRemove: (annotationId: string) => void;
}

export const PLAN_ANNOTATION_FN_SOURCE = String.raw`
function renderPlanAnnotations(annotations, handlers) {
  var root = document.createElement('section');
  root.className = 'plan-annotation-layer';
  root.setAttribute('aria-label', 'Plan annotations');

  var globals = document.createElement('div');
  globals.className = 'plan-annotation-globals';
  root.appendChild(globals);

  var sidebar = document.createElement('div');
  sidebar.className = 'plan-annotation-sidebar';
  sidebar.setAttribute('aria-label', 'Inline comments');
  root.appendChild(sidebar);

  var deletions = document.createElement('div');
  deletions.className = 'plan-annotation-deletions';
  root.appendChild(deletions);

  for (var i = 0; i < annotations.length; i += 1) {
    var a = annotations[i];
    if (!a) continue;
    var callout = document.createElement('div');
    callout.className = 'plan-annotation plan-annotation-' + String(a.type).toLowerCase();
    callout.setAttribute('data-annotation-id', a.id);
    callout.setAttribute('data-block-id', a.blockId);
    callout.setAttribute('data-anchor', a.blockId + ':' + a.startOffset + '-' + a.endOffset);

    var label = document.createElement('span');
    label.className = 'plan-annotation-label';
    if (a.type === 'DELETION') {
      label.textContent = 'Delete';
    } else if (a.type === 'GLOBAL_COMMENT') {
      label.textContent = 'Global comment';
    } else {
      label.textContent = 'Comment';
    }
    callout.appendChild(label);

    if (a.type === 'DELETION') {
      var struck = document.createElement('span');
      struck.className = 'plan-annotation-struck';
      struck.textContent = a.originalText;
      callout.appendChild(struck);
    } else {
      var bodyText = a.text ? a.text : (a.quickLabelTip ? a.quickLabelTip : '');
      var body = document.createElement('p');
      body.className = 'plan-annotation-text';
      body.textContent = bodyText;
      callout.appendChild(body);

      if (a.type === 'COMMENT' && a.originalText) {
        var quote = document.createElement('blockquote');
        quote.className = 'plan-annotation-quote';
        quote.textContent = a.originalText;
        callout.appendChild(quote);
      }
    }

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'plan-annotation-remove';
    remove.setAttribute('aria-label', 'Remove annotation');
    remove.title = 'Remove';
    remove.textContent = 'x';
    (function (id) {
      remove.addEventListener('click', function () {
        if (handlers && typeof handlers.onRemove === 'function') {
          handlers.onRemove(id);
        }
      });
    })(a.id);
    callout.appendChild(remove);

    if (a.type === 'GLOBAL_COMMENT') {
      globals.appendChild(callout);
    } else if (a.type === 'DELETION') {
      deletions.appendChild(callout);
    } else {
      sidebar.appendChild(callout);
    }
  }

  return root;
}
`;

export function compilePlanAnnotations(
  documentRef: Document,
): (
  annotations: readonly PlanAnnotation[],
  handlers: PlanAnnotationHandlers,
) => HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    "document",
    `${PLAN_ANNOTATION_FN_SOURCE}\nreturn renderPlanAnnotations;`,
  );
  return factory(documentRef) as (
    annotations: readonly PlanAnnotation[],
    handlers: PlanAnnotationHandlers,
  ) => HTMLElement;
}
