#!/usr/bin/env node
/**
 * v1.0.0 Phase 2.4 -- one-cycle backwards-compat alias.
 *
 * The deterministic-checks CLI was renamed `gemma-check` -> `nexus-check`
 * in v1.0.0. This shim is exposed under the npm `bin` field as
 * `gemma-check` so existing `npm scripts`, pre-commit hooks, and CI
 * pipelines continue to work without a flag day. It forwards all
 * arguments to `nexus-check.mjs` and prints a one-line deprecation
 * warning on stderr. Removed in v1.1.0.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "nexus-check.mjs");

process.stderr.write(
  "[nexus] gemma-check is deprecated -- use nexus-check. Removed in v1.1.0.\n",
);

const result = spawnSync(
  process.execPath,
  [target, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
