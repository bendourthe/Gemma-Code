/**
 * Guardrails module: the cohesive surface for all pre-execution safety checks
 * that the agent loop and tool registry consult.
 *
 * Consumers should import named primitives from here (e.g. `LoopDetector`,
 * `GitSafetyNet`, `classifyAction`) rather than reaching into the sub-files.
 * Individual sub-files are kept as distinct modules so the implementation
 * detail stays visible to readers and imports remain tree-shakeable.
 */
export { classifyAction, ActionRisk } from "./ActionClassifier.js";
export type { ActionClassification } from "./ActionClassifier.js";
export { GitSafetyNet } from "./GitSafetyNet.js";
export type { GitCheckpoint } from "./GitSafetyNet.js";
export { LoopDetector } from "./LoopDetector.js";
export {
  PermissionTier,
  getPermissionTier,
  shouldRequireConfirmation,
  getDangerousWarning,
} from "./PermissionTiers.js";
export { BLOCKED_PATTERNS } from "./policy.js";
