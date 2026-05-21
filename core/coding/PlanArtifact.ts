/**
 * v1.1.0 Phase 11.2 -- Plan-Mode artifact projector.
 *
 * Both the desktop Coding module's `PlanPanel` and the extension's webview
 * render the *same* Plan-Mode artifact. To guarantee byte-equal output
 * (the Phase 11.9 parity tests assert exactly that) the artifact is built
 * by this single pure projector that takes the daemon-side
 * `PlanModeState`-shaped input and emits a deterministic
 * `PlanArtifact` shape the webview reducer consumes.
 *
 * The shape mirrors `src/chat/PlanMode.ts::PlanModeState` but is decoupled
 * from the VS Code-specific extension entry point so both consumers can
 * import it without a circular dependency.
 */

export type PlanStepStatus = "pending" | "approved" | "done";

export interface PlanStepInput {
  readonly index: number;
  readonly description: string;
  readonly status: PlanStepStatus;
}

export type PlanAnnotationType = "DELETION" | "COMMENT" | "GLOBAL_COMMENT";

export interface PlanAnnotationInput {
  readonly id: string;
  readonly blockId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly type: PlanAnnotationType;
  readonly text?: string;
  readonly originalText: string;
  readonly quickLabelTip?: string;
}

export interface PlanArtifactInput {
  readonly active: boolean;
  readonly currentPlan: readonly PlanStepInput[];
  readonly currentStep: number;
  readonly annotations: readonly PlanAnnotationInput[];
}

export interface PlanArtifactStep {
  readonly index: number;
  readonly description: string;
  readonly status: PlanStepStatus;
  readonly isCurrent: boolean;
}

export interface PlanArtifactAnnotation {
  readonly id: string;
  readonly blockId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly type: PlanAnnotationType;
  readonly text: string;
  readonly originalText: string;
  readonly quickLabelTip: string | null;
}

export interface PlanArtifact {
  readonly kind: "plan-mode";
  readonly active: boolean;
  readonly currentStep: number;
  readonly steps: readonly PlanArtifactStep[];
  readonly annotations: readonly PlanArtifactAnnotation[];
  /**
   * Deterministic fingerprint of the artifact contents. Phase 11.9 parity
   * tests compare fingerprints to assert byte-equal rendering between
   * desktop and extension webviews. The hash function is intentionally
   * tiny and pure (no platform crypto) so it runs identically in node,
   * jsdom, and browser contexts.
   */
  readonly fingerprint: string;
}

function normalizeStep(
  input: PlanStepInput,
  currentStepIndex: number,
): PlanArtifactStep {
  return Object.freeze({
    index: input.index,
    description: input.description,
    status: input.status,
    isCurrent: input.index === currentStepIndex,
  });
}

function normalizeAnnotation(
  input: PlanAnnotationInput,
): PlanArtifactAnnotation {
  return Object.freeze({
    id: input.id,
    blockId: input.blockId,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    type: input.type,
    text: input.text ?? "",
    originalText: input.originalText,
    quickLabelTip: input.quickLabelTip ?? null,
  });
}

/**
 * Tiny deterministic hash (FNV-1a 32-bit). Produces an 8-char hex string;
 * adequate for byte-equality assertions and parity snapshots.
 */
function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = (hash >>> 0) * 0x01000193;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Build the deterministic Plan-Mode artifact. The output shape is stable:
 * the same input always yields the same artifact (including fingerprint),
 * regardless of platform or runtime.
 */
export function buildPlanArtifact(input: PlanArtifactInput): PlanArtifact {
  const steps = input.currentPlan.map((step) =>
    normalizeStep(step, input.currentStep),
  );
  const annotations = input.annotations.map(normalizeAnnotation);
  const seed = JSON.stringify({
    active: input.active,
    currentStep: input.currentStep,
    steps,
    annotations,
  });
  return Object.freeze({
    kind: "plan-mode",
    active: input.active,
    currentStep: input.currentStep,
    steps: Object.freeze(steps),
    annotations: Object.freeze(annotations),
    fingerprint: fnv1a32(seed),
  });
}

/**
 * Render the artifact as a deterministic plain-text block. Used by the
 * extension's text-only fallback (when the webview cannot mount) and by
 * the parity test fixtures.
 */
export function renderPlanArtifactText(artifact: PlanArtifact): string {
  if (!artifact.active) return "Plan mode is inactive.";
  const lines: string[] = [];
  lines.push("# Plan Mode");
  for (const step of artifact.steps) {
    const marker = step.status === "done"
      ? "[x]"
      : step.status === "approved"
        ? "[~]"
        : "[ ]";
    const cursor = step.isCurrent ? " <-" : "";
    lines.push(`${step.index}. ${marker} ${step.description}${cursor}`);
  }
  if (artifact.annotations.length > 0) {
    lines.push("");
    lines.push("## Annotations");
    for (const a of artifact.annotations) {
      lines.push(`- ${a.type} on ${a.blockId}: ${a.text || a.originalText}`);
    }
  }
  return lines.join("\n");
}
