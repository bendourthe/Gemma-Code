// GENERATED FILE. Do not edit by hand.
// Run `npm run generate:golden-tasks` to refresh; the `prebuild` script
// keeps it in sync automatically. Source corpus: tests/golden/tasks/.

/**
 * The number of YAML golden tasks under tests/golden/tasks/.
 * Use this from tests to ensure the in-process `GOLDEN_TASKS` array
 * and the YAML harness stay in sync in spirit, even though they have
 * different schemas.
 */
export const YAML_GOLDEN_TASK_COUNT = 28;

/**
 * Task ids as declared by the `id:` field in each YAML file, sorted by
 * filename for determinism.
 */
export const YAML_GOLDEN_TASK_IDS: readonly string[] = [
  "agent-friendly-dry-run-then-execute-03",
  "agent-friendly-truncation-recovery-grep-02",
  "agent-friendly-truncation-recovery-read-01",
  "bugfix-async-await-03",
  "bugfix-import-path-04",
  "bugfix-null-check-02",
  "bugfix-off-by-one-01",
  "bugfix-race-condition-05",
  "memory-hygiene-missed-fact-01",
  "multi-file-add-import-02",
  "multi-file-api-endpoint-04",
  "multi-file-config-update-03",
  "multi-file-rename-01",
  "multi-file-type-propagation-05",
  "refactor-callback-to-async-03",
  "refactor-class-to-module-02",
  "refactor-deduplicate-04",
  "refactor-extract-function-01",
  "refactor-rename-pattern-05",
  "review-code-quality-04",
  "review-error-handling-03",
  "review-performance-02",
  "review-security-vuln-01",
  "testgen-edge-cases-02",
  "testgen-error-handling-05",
  "testgen-integration-api-04",
  "testgen-mock-dependency-03",
  "testgen-unit-function-01",
] as const;
