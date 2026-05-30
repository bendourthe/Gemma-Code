/**
 * v1.3.0 Phase 7 (adoption-skill-cleaner T020) -- audit-only RSS probe.
 *
 * Runs `runSkillsAudit` once (output discarded) and prints the process peak RSS
 * so the benchmark harness can record memory footprint without the harness's own
 * child-process and timing overhead inflating the number. Invoked by
 * `run-benchmark.mjs`; not a standalone deliverable.
 */

import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(__dirname, "..", "..", "..", "..");
const cliUrl = pathToFileURL(resolvePath(repoRoot, "bin", "nexus.mjs")).href;

const { runSkillsAudit } = await import(cliUrl);

// Discard the report output -- we only care about the process's memory peak.
const sink = { write() { return true; } };
await runSkillsAudit({}, sink, sink);

process.stdout.write(String(process.resourceUsage().maxRSS));
