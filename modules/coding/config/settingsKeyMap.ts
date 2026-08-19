/**
 * v1.0.0 Phase 2.1: Settings key rename map.
 *
 * Maps every new `nexus.*` setting key to the legacy `gemma-code.*` key it
 * replaces. The compat shim in `SettingsCompat.ts` consults this map so a
 * user with only legacy keys in their `settings.json` continues to get the
 * documented behaviour, with a one-line deprecation warning per key per
 * session. Removed in v1.1.0.
 *
 * Grouping rules:
 *  - Coding-engine specific keys move under `nexus.coding.*`.
 *  - LLM-runtime keys move under `nexus.llm.*`.
 *  - Memory layer keys move under `nexus.memory.*`.
 *  - MCP keys move under `nexus.mcp.*`.
 *  - Workers / curator / audit / testgaps / reflect move under
 *    `nexus.workers.*`.
 *  - Cross-cutting keys (operationLog, secretPathDenyExtra, otlp*) stay at
 *    the top level under `nexus.*`.
 */

export const SETTINGS_KEY_MAP: Readonly<Record<string, string>> = Object.freeze({
  // -- Coding engine (runs inside the Coding module) ------------------------
  "nexus.coding.editMode": "gemma-code.editMode",
  "nexus.coding.toolConfirmationMode": "gemma-code.toolConfirmationMode",
  "nexus.coding.securityPosture": "gemma-code.securityPosture",
  "nexus.coding.compactionUserMessageTail": "gemma-code.compactionUserMessageTail",
  "nexus.coding.maxAgentIterations": "gemma-code.maxAgentIterations",
  "nexus.coding.systemPromptBudgetPercent": "gemma-code.systemPromptBudgetPercent",
  "nexus.coding.compactionKeepRecent": "gemma-code.compactionKeepRecent",
  "nexus.coding.compactionToolResultsKeep": "gemma-code.compactionToolResultsKeep",
  "nexus.coding.compactionProtectedTools": "gemma-code.compactionProtectedTools",
  "nexus.coding.compactionErrorPurgeTurns": "gemma-code.compactionErrorPurgeTurns",
  "nexus.coding.compactionProtectedFilePatterns":
    "gemma-code.compactionProtectedFilePatterns",
  "nexus.coding.compactExperimentalMessageMode":
    "gemma-code.compactExperimentalMessageMode",
  "nexus.coding.promptStyle": "gemma-code.promptStyle",
  "nexus.coding.verificationEnabled": "gemma-code.verificationEnabled",
  "nexus.coding.verificationThreshold": "gemma-code.verificationThreshold",
  "nexus.coding.subAgentMaxIterations": "gemma-code.subAgentMaxIterations",
  "nexus.coding.permissionOverrides": "gemma-code.permissionOverrides",
  "nexus.coding.passStateGating": "gemma-code.passStateGating",
  "nexus.coding.passStateGating.subAgentCredit":
    "gemma-code.passStateGating.subAgentCredit",
  "nexus.coding.preToolCompression": "gemma-code.preToolCompression",
  "nexus.coding.cacheEvictionStrategy": "gemma-code.cacheEvictionStrategy",
  "nexus.coding.thinkingMode": "gemma-code.thinkingMode",
  "nexus.coding.thinkingModePreset": "gemma-code.thinkingModePreset",
  "nexus.coding.contextLimitsPerModel": "gemma-code.contextLimitsPerModel",

  // -- LLM runtime (cross-module) -------------------------------------------
  "nexus.llm.backend": "gemma-code.llm.backend",
  "nexus.llm.modelName": "gemma-code.modelName",
  "nexus.llm.ollamaUrl": "gemma-code.ollamaUrl",
  "nexus.llm.maxTokens": "gemma-code.maxTokens",
  "nexus.llm.temperature": "gemma-code.temperature",
  "nexus.llm.topP": "gemma-code.topP",
  "nexus.llm.topK": "gemma-code.topK",
  "nexus.llm.requestTimeout": "gemma-code.requestTimeout",
  "nexus.llm.lmstudio.baseUrl": "gemma-code.lmstudio.baseUrl",

  // -- Memory (cross-module) ------------------------------------------------
  "nexus.memory.enabled": "gemma-code.memoryEnabled",
  "nexus.memory.embeddingModel": "gemma-code.embeddingModel",
  "nexus.memory.maxEntries": "gemma-code.memoryMaxEntries",
  "nexus.memory.corroborationThreshold": "gemma-code.memoryCorroborationThreshold",
  "nexus.memory.ollamaEmbeddingThreshold": "gemma-code.ollamaEmbeddingThreshold",
  "nexus.memory.heuristicEmbeddingThreshold":
    "gemma-code.heuristicEmbeddingThreshold",
  "nexus.memory.snapshotMode": "gemma-code.memorySnapshotMode",
  "nexus.memory.autoArchive": "gemma-code.memoryAutoArchive",
  "nexus.memory.hnswThreshold": "gemma-code.memoryHnswThreshold",
  "nexus.memory.scoringMethod": "gemma-code.memory.scoringMethod",
  "nexus.memory.scoringDefault": "gemma-code.memory.scoringDefault",
  "nexus.memory.anticipatoryCache": "gemma-code.memory.anticipatoryCache",
  "nexus.memory.promotionMapping": "gemma-code.memory.promotionMapping",

  // -- MCP ------------------------------------------------------------------
  "nexus.mcp.enabled": "gemma-code.mcpEnabled",
  "nexus.mcp.serverMode": "gemma-code.mcpServerMode",
  "nexus.mcp.exposedTools": "gemma-code.mcpExposedTools",

  // -- Skills ---------------------------------------------------------------
  "nexus.skills.harvest": "gemma-code.skills.harvest",
  "nexus.skills.harvestMinRecurrence": "gemma-code.skills.harvestMinRecurrence",
  "nexus.skills.harvestWindowDays": "gemma-code.skills.harvestWindowDays",

  // -- Hooks ----------------------------------------------------------------
  "nexus.hooks.scanInjection": "gemma-code.hooks.scanInjection",

  // -- Workers --------------------------------------------------------------
  "nexus.workers.audit.enabled": "gemma-code.workers.audit.enabled",
  "nexus.workers.testgaps.enabled": "gemma-code.workers.testgaps.enabled",
  "nexus.workers.curator.enabled": "gemma-code.workers.curator.enabled",
  "nexus.workers.reflect.enabled": "gemma-code.workers.reflect.enabled",

  // -- Telemetry / tracing --------------------------------------------------
  "nexus.trace.autoEnable": "gemma-code.trace.autoEnable",
  "nexus.otlp.enabled": "gemma-code.otlpEnabled",
  "nexus.otlp.endpoint": "gemma-code.otlpEndpoint",
  "nexus.otlp.headers": "gemma-code.otlpHeaders",
  "nexus.operationLog.enabled": "gemma-code.operationLog.enabled",

  // -- Hardware / GPU -------------------------------------------------------
  "nexus.autoDetectGpu": "gemma-code.autoDetectGpu",
  "nexus.gpuTierOverride": "gemma-code.gpuTierOverride",

  // -- Filesystem / secrets -------------------------------------------------
  "nexus.secretPathDenyExtra": "gemma-code.secretPathDenyExtra",
});

/**
 * Reverse lookup: legacy key -> new namespaced key. Useful for emitting the
 * deprecation warning ("you set X, migrate to Y").
 */
export const LEGACY_TO_NEW: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SETTINGS_KEY_MAP).map(([newKey, oldKey]) => [oldKey, newKey]),
  ),
);

/**
 * Split a fully-qualified setting key into its section and leaf parts. The
 * section is the dotted prefix passed to `vscode.workspace.getConfiguration`;
 * the leaf is the suffix used in `config.get(leaf)`. We split at the LAST
 * dot so legacy keys like `gemma-code.operationLog.enabled` resolve as
 * section `gemma-code.operationLog`, leaf `enabled` -- which matches the way
 * VS Code stores nested settings.
 */
export function splitSettingKey(fullKey: string): { section: string; leaf: string } {
  const lastDot = fullKey.lastIndexOf(".");
  if (lastDot === -1) {
    return { section: "", leaf: fullKey };
  }
  return {
    section: fullKey.slice(0, lastDot),
    leaf: fullKey.slice(lastDot + 1),
  };
}
