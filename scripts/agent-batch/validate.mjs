// v0.9.0 Phase 5 sub-task 5.3 -- agent-batch validate sub-command.
//
// Loads a JSON spec from disk, runs it through the Zod schema, and prints a
// readable success / failure summary. Exit 0 on success, 1 on schema error,
// 2 on missing file / bad JSON.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { safeParseSpec } from "./schema.mjs";

export function formatZodIssues(issues) {
  return issues
    .map((iss) => {
      const path = iss.path.length > 0 ? iss.path.join(".") : "(root)";
      return `  - ${path}: ${iss.message}`;
    })
    .join("\n");
}

export function loadSpecFile(specPath) {
  const absPath = resolve(process.cwd(), specPath);
  if (!existsSync(absPath)) {
    throw new Error(`spec file not found: ${specPath}`);
  }
  const raw = readFileSync(absPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`spec file is not valid JSON: ${specPath} (${e.message})`);
  }
  return parsed;
}

export async function validateCommand(rest) {
  if (rest.length === 0) {
    process.stderr.write("[agent-batch validate] expected a spec file path\n");
    return 2;
  }
  const specPath = rest[0];

  let raw;
  try {
    raw = loadSpecFile(specPath);
  } catch (e) {
    process.stderr.write(`[agent-batch validate] ${e.message}\n`);
    return 2;
  }

  const result = safeParseSpec(raw);
  if (!result.success) {
    process.stderr.write(
      `[agent-batch validate] schema errors in ${specPath}:\n${formatZodIssues(result.error.issues)}\n`,
    );
    return 1;
  }
  const spec = result.data;
  process.stdout.write(
    `[agent-batch validate] ok: batchId=${spec.batchId} tasks=${spec.tasks.length}\n`,
  );
  return 0;
}
