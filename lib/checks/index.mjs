/**
 * Rule registry for gemma-check. Each rule exports `id`, `severity`, and
 * `scan(filePath, contents): Finding[]` -- see lib/checks/helpers.mjs for
 * the Finding shape. Ordering controls report ordering when several rules
 * fire on the same file.
 */

import * as noConsoleLog from "./no-committed-console-log.mjs";
import * as noMathRandom from "./no-math-random-for-tokens.mjs";
import * as noEnvLeakage from "./no-env-file-leakage.mjs";
import * as noSecretPatterns from "./no-secret-patterns.mjs";
import * as noBarePromiseRejection from "./no-bare-promise-rejection.mjs";
import * as promptNoAsciiViolation from "./prompt-no-ascii-violation.mjs";
import * as promptOversized from "./prompt-oversized.mjs";
import * as promptTrailingWhitespace from "./prompt-trailing-whitespace.mjs";
import * as promptBom from "./prompt-bom.mjs";
import * as skillDuplicateName from "./skill-duplicate-name.mjs";

export const RULES = Object.freeze([
  noSecretPatterns,
  noMathRandom,
  noConsoleLog,
  noEnvLeakage,
  noBarePromiseRejection,
  promptNoAsciiViolation,
  promptOversized,
  promptTrailingWhitespace,
  promptBom,
  skillDuplicateName,
]);

export const RULE_BY_ID = Object.freeze(
  Object.fromEntries(RULES.map((rule) => [rule.id, rule])),
);
