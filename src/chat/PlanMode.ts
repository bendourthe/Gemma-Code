export interface PlanStep {
  index: number;
  description: string;
  status: "pending" | "approved" | "done";
}

export interface PlanModeState {
  active: boolean;
  currentPlan: PlanStep[];
  currentStep: number;
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
  };

  get active(): boolean {
    return this._state.active;
  }

  get state(): Readonly<PlanModeState> {
    return {
      active: this._state.active,
      currentPlan: this._state.currentPlan.map((s) => ({ ...s })),
      currentStep: this._state.currentStep,
    };
  }

  /** Toggle plan mode. Returns the new active state. */
  toggle(): boolean {
    this._state.active = !this._state.active;
    if (!this._state.active) {
      this._state.currentPlan = [];
      this._state.currentStep = 0;
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
  }
}
