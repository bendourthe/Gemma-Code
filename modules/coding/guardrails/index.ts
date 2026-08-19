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
export type { ActionClassification, ClassifyActionOptions } from "./ActionClassifier.js";
export { GitSafetyNet } from "./GitSafetyNet.js";
export type { GitCheckpoint } from "./GitSafetyNet.js";
export { LoopDetector } from "./LoopDetector.js";
export { LoopGuards, HARD_AGENT_ITERATION_CEILING, DEFAULT_LOOP_GUARDS, clampAgentIterations } from "./LoopGuards.js";
export type { LoopGuardVerdict, LoopGuardName, LoopGuardsConfig } from "./LoopGuards.js";
export {
  parseSecurityPosture,
  getSecurityPosturePolicy,
  confirmationRequiredForPosture,
  SECURITY_POSTURE_POLICIES,
} from "./SecurityPosture.js";
export type { SecurityPostureId, SecurityPosturePolicy } from "./SecurityPosture.js";
export { originForTool, TOOL_RESULT_ORIGINS } from "./toolResultOrigin.js";
export type { ToolResultOrigin } from "./toolResultOrigin.js";
export {
  PermissionTier,
  getPermissionTier,
  shouldRequireConfirmation,
  getDangerousWarning,
} from "./PermissionTiers.js";
export { BLOCKED_PATTERNS, HARD_DENIALS } from "./policy.js";
export type { HardDenial, HardDenialFamily } from "./policy.js";
export {
  introspectShellCommand,
  detectShellDialect,
  normalizeTouchedPath,
} from "./shellIntrospection.js";
export type {
  ShellDialect,
  PathOperation,
  TouchedPath,
  CommandIntrospection,
} from "./shellIntrospection.js";
