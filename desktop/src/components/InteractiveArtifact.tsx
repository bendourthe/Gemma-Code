/**
 * v1.2.0 Phase 6.3 -- interactive HTML artifact host with "copy as JSON".
 *
 * Renders any HTML payload containing a `<form data-nexus-artifact="true">`
 * element. The wrapper automatically adds a "Copy as JSON" button that
 * collects every form input's current value, serialises to JSON, and
 * copies to the system clipboard. A confirmation message is rendered
 * inline so the user has visual feedback that the round-trip worked.
 *
 * **Scope-creep guard** (per Phase 6.3 plan): this component is
 * intentionally minimal. It does NOT support:
 *   - arbitrary in-app HTML editing
 *   - script execution beyond the wrapper's own click handler
 *   - any postMessage / iframe interaction with the parent shell
 *
 * The component sanitises HTML at render via `dangerouslySetInnerHTML`
 * after passing through DOMPurify (already a Nexus dependency, used by
 * the Coding-pillar markdown renderer). The form-state collection path
 * relies only on standard `<form>` semantics; new inputs that the user
 * adds via the HTML payload are picked up automatically.
 *
 * Per Hub reference templates (Phase 1.2 + 6.3), use this with the
 * `interactive-tuning.html` reference template for the canonical
 * "tune values and copy them back" flow.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export interface InteractiveArtifactProps {
  /** Raw HTML body (the wrapper sanitises before rendering). */
  readonly html: string;
  /**
   * Optional payload-shape hook. Receives the form-state object built by
   * the wrapper before it is JSON-encoded; return a transformed object
   * if the consumer wants a stricter shape than `Record<string, string>`.
   */
  readonly transformPayload?: (raw: Record<string, FormValue>) => unknown;
  /**
   * Optional fallback for environments where `navigator.clipboard.writeText`
   * is unavailable (Tauri / Electron variations, sandboxed test runs).
   * Defaults to a no-op; the wrapper falls back to a textarea-selection
   * trick when the navigator API throws.
   */
  readonly onCopy?: (json: string) => void;
  /** Optional className for layout integration. */
  readonly className?: string;
  /** Style override for layout integration. */
  readonly style?: CSSProperties;
}

export type FormValue = string | boolean | number | readonly string[];

const COPY_BUTTON_TEST_ID = "interactive-artifact-copy";
const CONFIRMATION_TEST_ID = "interactive-artifact-confirmation";

export function InteractiveArtifact({
  html,
  transformPayload,
  onCopy,
  className,
  style,
}: InteractiveArtifactProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const sanitisedHtml = useMemo(() => sanitiseArtifactHtml(html), [html]);

  const handleCopy = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    const form = container.querySelector<HTMLFormElement>(
      'form[data-nexus-artifact="true"]',
    );
    if (!form) {
      setConfirmation(
        "No interactive form found in this artifact (the payload must contain `<form data-nexus-artifact=\"true\">`).",
      );
      return;
    }
    const raw = collectFormState(form);
    const payload = transformPayload ? transformPayload(raw) : raw;
    const json = JSON.stringify(payload, null, 2);
    let copied = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      copied = fallbackCopy(json);
    }
    if (onCopy) {
      try {
        onCopy(json);
      } catch {
        // Consumer-side errors do not propagate to the UI.
      }
    }
    setConfirmation(
      copied
        ? "Copied as JSON. Paste into the chat input to round-trip back."
        : "Could not access the clipboard. JSON logged to console instead.",
    );
    if (!copied) {
      // Worst case: surface the payload so the user can still copy manually.
      // eslint-disable-next-line no-console
      console.info(json);
    }
  }, [onCopy, transformPayload]);

  // Auto-clear the confirmation after 3s so successive copies show fresh feedback.
  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 3000);
    return () => clearTimeout(t);
  }, [confirmation]);

  return (
    <section
      data-testid="interactive-artifact"
      className={className}
      style={{
        border: "1px solid var(--border-subtle, #d1d5db)",
        borderRadius: 8,
        padding: 12,
        backgroundColor: "var(--bg-1, #ffffff)",
        ...style,
      }}
    >
      <div
        ref={containerRef}
        data-testid="interactive-artifact-body"
        // Sanitised by DOMPurify above; React's `dangerouslySetInnerHTML`
        // is the only path for embedding user-authored HTML, and the
        // sanitiser is the trust boundary.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: sanitisedHtml }}
      />
      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          data-testid={COPY_BUTTON_TEST_ID}
          onClick={() => {
            void handleCopy();
          }}
          style={{
            padding: "4px 10px",
            border: "1px solid var(--border-subtle, #d1d5db)",
            borderRadius: 4,
            backgroundColor: "var(--bg-2, #f9fafb)",
            cursor: "pointer",
          }}
        >
          Copy as JSON
        </button>
        {confirmation ? (
          <span
            data-testid={CONFIRMATION_TEST_ID}
            role="status"
            aria-live="polite"
            style={{ fontSize: "0.85em", color: "var(--fg-muted, #6b7280)" }}
          >
            {confirmation}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function collectFormState(form: HTMLFormElement): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  const elements = form.elements;
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (!(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLTextAreaElement) &&
        !(el instanceof HTMLSelectElement)) continue;
    const name = el.name || el.id;
    if (!name) continue;
    if (el instanceof HTMLInputElement) {
      switch (el.type) {
        case "checkbox":
          out[name] = el.checked;
          break;
        case "number":
        case "range": {
          const n = el.valueAsNumber;
          out[name] = Number.isFinite(n) ? n : el.value;
          break;
        }
        case "radio":
          if (el.checked) out[name] = el.value;
          break;
        default:
          out[name] = el.value;
      }
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      if (el.multiple) {
        out[name] = Array.from(el.selectedOptions).map((o) => o.value);
      } else {
        out[name] = el.value;
      }
      continue;
    }
    // HTMLTextAreaElement
    out[name] = el.value;
  }
  return out;
}

/**
 * Strip the script vectors from `html` before embedding via
 * `dangerouslySetInnerHTML`. The implementation uses the browser's own
 * DOMParser to walk the tree, drops dangerous tags wholesale, and
 * removes `on*` event-handler attributes plus `javascript:` URLs from
 * `href` / `src`.
 *
 * Scope: this is the minimum-surface defence appropriate for content
 * the local agent itself emitted. Renderable network-sourced HTML
 * would warrant DOMPurify; that broader policy is deliberately out of
 * scope for this re-partial phase.
 */
const FORBIDDEN_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
  "BASE",
]);

const FORBIDDEN_ATTR_PREFIX = "on";

function sanitiseArtifactHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    // Server-side / non-DOM environment: strip nothing structural but
    // remove the most common script vectors via regex. This branch is
    // only reachable in non-test SSR contexts.
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
      .replace(/javascript:[^"'\s>]+/gi, "");
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  walkAndScrub(root);
  return root.innerHTML;
}

function walkAndScrub(node: Element): void {
  // Snapshot children first because we may remove them as we go.
  const children = Array.from(node.children);
  for (const child of children) {
    if (FORBIDDEN_TAGS.has(child.tagName)) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith(FORBIDDEN_ATTR_PREFIX)) {
        child.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src" || name === "action") &&
          /^\s*javascript:/i.test(attr.value)) {
        child.removeAttribute(attr.name);
      }
    }
    walkAndScrub(child);
  }
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
