// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- failure
// diagnoser built on the existing `ReflexionEngine`.
//
// For each failing trajectory in a minibatch it asks the resident
// `ReflexionEngine` "why did this task fail and what should change", then
// aggregates the analyses + extracted negative constraints into a single
// diagnosis string handed to the `SkillEditProposer`. Trajectory text is an
// untrusted-input boundary (the Fusion F5 discipline), so failure strings are
// run through `redactSecrets` before they reach the model.
//
// Boundary: vscode-free; the LLM is reached only through the injected
// `ReflexionEngine` (which itself holds the `OllamaClient` port).
// ---------------------------------------------------------------------------

import { redactSecrets } from "../../../core/observability/redactSecrets.js";
import type { ReflexionEngine } from "../orchestration/ReflexionEngine.js";
import type { TaskNode } from "../orchestration/TaskDAG.js";
import type { FailingTrajectory, FailureDiagnoser } from "./types.js";

/**
 * Synthesize a failed `TaskNode` from a normalized trajectory for
 * `ReflexionEngine.reflect`. The node's text is embedded in the reflection
 * prompt, so its title + description are redacted here (untrusted-input
 * boundary) -- not only the error/context the diagnoser builds separately.
 */
function toTaskNode(t: FailingTrajectory): TaskNode {
  return {
    id: t.taskId,
    title: redactSecrets(t.taskName),
    description: redactSecrets(t.taskDescription),
    type: "code",
    dependencies: [],
    status: "failed",
    retryCount: 0,
    maxRetries: 0,
  };
}

/**
 * Composes `ReflexionEngine` to diagnose a minibatch of failing trajectories.
 * The aggregated diagnosis is a redacted, model-derived account of what went
 * wrong -- the signal the proposer turns into a bounded skill edit.
 */
export class ReflexionDiagnoser implements FailureDiagnoser {
  constructor(private readonly _reflexion: ReflexionEngine) {}

  async diagnose(failures: readonly FailingTrajectory[]): Promise<string> {
    if (failures.length === 0) return "";

    const sections: string[] = [];
    for (const t of failures) {
      const error = redactSecrets(t.failures.join("; ")) || "(no failure detail recorded)";
      const context = redactSecrets(t.taskDescription);
      const reflection = await this._reflexion.reflect(toTaskNode(t), error, context);
      const constraintText =
        reflection.constraints.length > 0
          ? `\n  Constraints: ${reflection.constraints.join("; ")}`
          : "";
      sections.push(`- [${t.taskId}] ${reflection.analysis}${constraintText}`);
    }

    return [
      `Diagnosis of ${failures.length} failing task(s) under the skill being optimized:`,
      ...sections,
    ].join("\n");
  }
}
