#!/usr/bin/env node
/**
 * Generate modules/coding/evaluation/goldenTasksYaml.generated.ts from the YAML
 * corpus under tests/golden/tasks/.
 *
 * Why this exists:
 * The in-process `GOLDEN_TASKS` array (modules/coding/evaluation/GoldenTaskSuite.ts)
 * is a small curated smoke set that runs inside the agent session. The
 * YAML corpus is a larger out-of-process harness with a different schema.
 * We emit a typed cross-reference module so tests can assert that the
 * two stay in sync (count, ids) without forcing schema unification.
 *
 * Inputs: tests/golden/tasks/*.yaml
 * Outputs: modules/coding/evaluation/goldenTasksYaml.generated.ts
 *
 * Parsing: the YAML files follow a conservative shape; we only need the
 * top-level `id` field, which we extract with a line-oriented regex so
 * we avoid introducing a runtime YAML dependency. If the harness format
 * ever grows, consider adopting `js-yaml` explicitly at that point.
 *
 * Run via: `npm run generate:golden-tasks` (wired as a `prebuild` step).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TASKS_DIR = join(REPO_ROOT, "tests", "golden", "tasks");
const OUTPUT_PATH = join(
  REPO_ROOT,
  "modules",
  "coding",
  "evaluation",
  "goldenTasksYaml.generated.ts",
);

function extractTaskId(filePath) {
  const text = readFileSync(filePath, "utf-8");
  const match = text.match(/^id:\s*(\S+)\s*$/m);
  if (!match) {
    throw new Error(`No top-level id field in ${filePath}`);
  }
  return match[1];
}

function collectTaskIds(dir) {
  const entries = readdirSync(dir).filter((name) => name.endsWith(".yaml"));
  entries.sort();
  return entries.map((name) => extractTaskId(join(dir, name)));
}

function emitModule(ids) {
  const idList = ids.map((id) => `  "${id}",`).join("\n");
  return `// GENERATED FILE. Do not edit by hand.
// Run \`npm run generate:golden-tasks\` to refresh; the \`prebuild\` script
// keeps it in sync automatically. Source corpus: tests/golden/tasks/.

/**
 * The number of YAML golden tasks under tests/golden/tasks/.
 * Use this from tests to ensure the in-process \`GOLDEN_TASKS\` array
 * and the YAML harness stay in sync in spirit, even though they have
 * different schemas.
 */
export const YAML_GOLDEN_TASK_COUNT = ${ids.length};

/**
 * Task ids as declared by the \`id:\` field in each YAML file, sorted by
 * filename for determinism.
 */
export const YAML_GOLDEN_TASK_IDS: readonly string[] = [
${idList}
] as const;
`;
}

function main() {
  const ids = collectTaskIds(TASKS_DIR);
  const module = emitModule(ids);
  writeFileSync(OUTPUT_PATH, module, "utf-8");
  // Single-line summary — suppressed from CI log noise in normal runs.
  process.stdout.write(
    `[generate-golden-tasks] wrote ${ids.length} ids to ${OUTPUT_PATH}\n`,
  );
}

main();
