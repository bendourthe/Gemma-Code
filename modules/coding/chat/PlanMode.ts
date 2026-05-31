export interface PlanStep {
  index: number;
  description: string;
  status: "pending" | "approved" | "done";
}

/**
 * v0.8.0 Phase 3.1 -- structured annotation produced by the user against the
 * current plan. Three types: `DELETION` removes a span, `COMMENT` attaches an
 * inline note to a span, `GLOBAL_COMMENT` applies to the whole plan.
 */
export interface PlanAnnotation {
  id: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  type: "DELETION" | "COMMENT" | "GLOBAL_COMMENT";
  text?: string;
  originalText: string;
  quickLabelTip?: string;
}

export interface PlanModeState {
  active: boolean;
  currentPlan: PlanStep[];
  currentStep: number;
  annotations: PlanAnnotation[];
}

/**
 * Additional system prompt injected when plan mode is active.
 * Appended as a separate system message so it can be added/removed cleanly.
 */
export const PLAN_MODE_SYSTEM_ADDENDUM =
  "## PLAN MODE\n\n" +
  "You are now in PLAN MODE. Before taking any action, you MUST produce a numbered plan " +
  "listing each step clearly. Wait for the user to approve each step before executing it. " +
  "As you complete each approved step, mark it with [DONE] at the start of the step line.\n\n" +
  "Format your plan as:\n" +
  "1. First step description\n" +
  "2. Second step description\n" +
  "3. …\n\n" +
  "Do not proceed beyond step 1 until the user approves it.";

/**
 * Plan-mode capabilities reminder. Lists the v0.7.0 Phase 4 webview render
 * primitives the model can reference inside its plans. Kept as a runtime
 * const so PromptBuilder can append it without fs at hot-path time; the
 * authoritative copy is `src/chat/prompts/planModeCapabilities.md`.
 */
export const PLAN_MODE_CAPABILITIES_REMINDER =
  "## Plan-mode rendering capabilities\n\n" +
  "When emitting a plan in PLAN MODE, you may use any of the v0.7.0 render primitives below. The Gemma-Code webview will detect and render them with structured UI affordances; using them is preferred over plain prose when the content fits.\n\n" +
  "- TODO_BLOCK: Emit numbered or bulleted task lists with `- [ ]` and `- [x]` checkboxes. The webview renders them as an interactive checklist. Use this for the plan itself; one checkbox per step.\n" +
  "- DIFF_CARD: When proposing a code change, emit a fenced ```diff block. The webview renders it as a side-by-side diff card.\n" +
  "- ACTION_TAG: Inline tags like `[action: read file `foo.ts`]` render as small clickable chips. Surface concrete next-step actions inside step descriptions.\n" +
  "- PERMISSION_PROMPT: When a step needs explicit user confirmation before running a tool, emit a permission-prompt block. The user can approve or deny inline.\n" +
  "- THOUGHT_META_ROW: One-line meta annotations such as `> meta: this step depends on step 2` render as a faint sidebar callout. Use sparingly.\n" +
  "- QUEUED_MESSAGE_FIELD: During streaming, the input row may be swapped for a queued-message field; you don't emit this directly, but assume the user may queue a follow-up while you stream.\n" +
  "- COMPLETION_REPORT: When all approved steps are `[DONE]`, emit a single completion-report block summarising what was accomplished and what was deferred.\n\n" +
  "Plans that use these primitives produce a richer review surface than plain prose. Prefer them when applicable.";

/**
 * Strong-directive denial template emitted as a system message when the user
 * denies a plan or step with feedback. The `{{feedback}}` placeholder is
 * replaced via `buildDenialMessage(feedback)`.
 */
export const PLAN_DENIAL_TEMPLATE =
  "YOUR PLAN WAS NOT APPROVED.\n\n" +
  "You MUST revise the plan to address ALL of the feedback below before re-submitting.\n\n" +
  "Rules:\n" +
  "- Do NOT resubmit the same plan unchanged.\n" +
  "- Do NOT change the plan title (first `#` heading) unless the user explicitly asks you to.\n\n" +
  "USER FEEDBACK:\n{{feedback}}";

/**
 * Approved-with-notes template: the user accepted the plan but attached
 * additional implementation notes for the executor. Emitted as a system
 * message when `PlanMode.approveWithNotes(notes)` is invoked. The
 * `{{notes}}` placeholder is replaced via `buildApprovedWithNotesMessage`.
 */
export const PLAN_APPROVED_WITH_NOTES_TEMPLATE =
  "Plan approved with notes! Execute the plan.\n\n" +
  "## Implementation Notes\n\n" +
  "The user approved your plan but added the following notes to consider during implementation:\n\n" +
  "{{notes}}\n\n" +
  "Proceed with implementation, incorporating these notes where applicable.";

/** Render the plan-denial template with the user's feedback inlined. */
export function buildDenialMessage(feedback: string): string {
  return PLAN_DENIAL_TEMPLATE.replace("{{feedback}}", feedback.trim());
}

/** Render the approved-with-notes template with the user's notes inlined. */
export function buildApprovedWithNotesMessage(notes: string): string {
  return PLAN_APPROVED_WITH_NOTES_TEMPLATE.replace("{{notes}}", notes.trim());
}

/**
 * Detects a numbered plan in a model response.
 * A response is considered a plan if it contains at least 2 numbered list items
 * within the first 500 characters.
 *
 * Returns the extracted step descriptions, or null if no plan is detected.
 */
export function detectPlan(response: string): string[] | null {
  const sample = response.slice(0, 500);
  const quickMatches = [...sample.matchAll(/^\d+\.\s+\S/gm)];
  if (quickMatches.length < 2) return null;

  // Extract all numbered steps from the full response.
  const allMatches = [...response.matchAll(/^\d+\.\s+(.+)$/gm)];
  if (allMatches.length < 2) return null;

  return allMatches.map((m) => (m[1] ?? "").trim());
}

export class PlanMode {
  private _state: PlanModeState = {
    active: false,
    currentPlan: [],
    currentStep: 0,
    annotations: [],
  };

  get active(): boolean {
    return this._state.active;
  }

  get state(): Readonly<PlanModeState> {
    return {
      active: this._state.active,
      currentPlan: this._state.currentPlan.map((s) => ({ ...s })),
      currentStep: this._state.currentStep,
      annotations: this._state.annotations.map((a) => ({ ...a })),
    };
  }

  /** Toggle plan mode. Returns the new active state. */
  toggle(): boolean {
    this._state.active = !this._state.active;
    if (!this._state.active) {
      this._state.currentPlan = [];
      this._state.currentStep = 0;
      this._state.annotations = [];
    }
    return this._state.active;
  }

  /** Record the current plan steps, resetting the step counter. */
  setPlan(steps: string[]): void {
    this._state.currentPlan = steps.map((description, index) => ({
      index,
      description,
      status: "pending",
    }));
    this._state.currentStep = 0;
    // Stale annotations from the prior plan version no longer apply once a
    // new plan is recorded; clear them so the webview overlay does not point
    // at offsets that no longer exist.
    this._state.annotations = [];
  }

  /** Mark step at stepIndex as approved and advance the current step pointer. */
  approveStep(stepIndex: number): void {
    const step = this._state.currentPlan[stepIndex];
    if (step) {
      step.status = "approved";
      this._state.currentStep = stepIndex + 1;
    }
  }

  /** Mark a step as done (called after the model completes it). */
  markStepDone(stepIndex: number): void {
    const step = this._state.currentPlan[stepIndex];
    if (step) {
      step.status = "done";
    }
  }

  /** Clear the current plan without changing the active flag. */
  resetPlan(): void {
    this._state.currentPlan = [];
    this._state.currentStep = 0;
    this._state.annotations = [];
  }

  /**
   * v0.8.0 Phase 3.1 -- append (or replace, if `id` already exists) an
   * annotation into the in-flight buffer. Returns the new buffer length.
   */
  addAnnotation(annotation: PlanAnnotation): number {
    const existing = this._state.annotations.findIndex(
      (a) => a.id === annotation.id,
    );
    if (existing >= 0) {
      this._state.annotations[existing] = { ...annotation };
    } else {
      this._state.annotations.push({ ...annotation });
    }
    return this._state.annotations.length;
  }

  /**
   * v0.8.0 Phase 3.1 -- remove a single annotation by id; no-op when the id
   * is not in the buffer. Returns `true` if a row was removed.
   */
  removeAnnotation(annotationId: string): boolean {
    const before = this._state.annotations.length;
    this._state.annotations = this._state.annotations.filter(
      (a) => a.id !== annotationId,
    );
    return this._state.annotations.length < before;
  }

  /** v0.8.0 Phase 3.1 -- snapshot the current annotation buffer. */
  getAnnotations(): readonly PlanAnnotation[] {
    return this._state.annotations.map((a) => ({ ...a }));
  }

  /** v0.8.0 Phase 3.1 -- drop every buffered annotation. */
  clearAnnotations(): void {
    this._state.annotations = [];
  }

  /**
   * v0.8.0 Phase 3.1 -- format the buffered annotations as a human-readable
   * feedback block suitable for the `planDeny` denial template. Skips empty
   * buffers and falls back to the caller-supplied free-form feedback.
   */
  formatAnnotationsAsFeedback(): string {
    if (this._state.annotations.length === 0) return "";
    const lines: string[] = [];
    for (const a of this._state.annotations) {
      const label =
        a.type === "DELETION"
          ? "Delete"
          : a.type === "GLOBAL_COMMENT"
            ? "Global comment"
            : "Comment";
      const target =
        a.originalText.length > 0 ? ` on "${a.originalText.trim()}"` : "";
      const body = a.text ?? a.quickLabelTip ?? "";
      lines.push(`- ${label}${target}: ${body}`.trim());
    }
    return lines.join("\n");
  }

  /**
   * Deny the current plan (or a specific step) with feedback. All pending steps
   * revert to `pending` and the step counter resets to 0 so the model produces
   * a revised plan from scratch. Returns the rendered denial message that the
   * caller should inject as a system message.
   */
  denyPlan(feedback: string): string {
    for (const step of this._state.currentPlan) {
      if (step.status !== "done") step.status = "pending";
    }
    this._state.currentStep = 0;
    return buildDenialMessage(feedback);
  }

  /**
   * Approve the plan as a whole with attached implementation notes. Transitions
   * every non-done step to `approved` (same as a full approve) and returns the
   * rendered "approved with notes" message for the caller to inject as a
   * system message.
   */
  approveWithNotes(notes: string): string {
    for (const step of this._state.currentPlan) {
      if (step.status !== "done") step.status = "approved";
    }
    this._state.currentStep = this._state.currentPlan.length;
    return buildApprovedWithNotesMessage(notes);
  }
}
