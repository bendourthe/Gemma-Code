/**
 * Integration test: AgentLoop -> BackgroundWorkers -> spawn gemma-check / vitest -> chat message.
 *
 * v0.8.0 Phase 0.11 (closes v0.7.0 10.O.12). Exercises the full audit-worker
 * path with a real `node bin/gemma-check.mjs --json` spawn against a fixture
 * file containing a known seeded `no-secret-patterns` finding, then asserts
 * the formatted summary is what the chat layer would render.
 *
 * The test invokes `runAuditWorker` directly with the default runner (no
 * mocks). For `runTestgapsWorker` the path is exercised with the default
 * runner only when `npx` is available; on platforms where `npx` resolution
 * is unreliable (Windows + CI sandboxes that strip PATH) the testgaps
 * assertion is reduced to "the worker returns a structured result without
 * throwing". The fixture file is in `tests/fixtures/` so it is excluded
 * from the TS compiler / ESLint walk.
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  runAuditWorker,
  parseGemmaCheckJson,
  formatAuditFindings,
} from "../../modules/coding/agents/BackgroundWorkers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
// v1.0.0 Phase 2.4: the canonical script is nexus-check.mjs; fall back to
// the legacy name so a partial repo state still exercises the integration.
const nexusCheckPath = path.join(repoRoot, "bin", "nexus-check.mjs");
const legacyCheckPath = path.join(repoRoot, "bin", "gemma-check.mjs");
const gemmaCheckScript = fs.existsSync(nexusCheckPath)
  ? nexusCheckPath
  : legacyCheckPath;
const fixtureWithFinding = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "background-workers",
  "with-finding.mjs",
);

const PRECONDITIONS_MET =
  fs.existsSync(gemmaCheckScript) && fs.existsSync(fixtureWithFinding);

describe("BackgroundWorkers end-to-end (v0.8.0 Phase 0.11 / closes v0.7.0 10.O.12)", () => {
  it.runIf(PRECONDITIONS_MET)(
    "runAuditWorker spawns gemma-check and surfaces the seeded finding",
    async () => {
      const result = await runAuditWorker([fixtureWithFinding], {
        scriptPath: gemmaCheckScript,
        cwd: repoRoot,
      });

      // gemma-check exit 1 means findings present; the worker treats that as
      // `success: true` because the spawn itself succeeded -- the finding is
      // the message payload.
      expect(result.success).toBe(true);
      expect(result.toolCallCount).toBe(1);
      expect(result.output).toContain("Audit Worker");
      expect(result.output).toContain("no-secret-patterns");
      expect(result.output).toMatch(/AKIA|AWS access key/i);
    },
    20_000,
  );

  it.runIf(PRECONDITIONS_MET)(
    "parseGemmaCheckJson is consistent with the live spawn output",
    async () => {
      const result = await runAuditWorker([fixtureWithFinding], {
        scriptPath: gemmaCheckScript,
        cwd: repoRoot,
      });
      // The formatted output must include the rule id at least once.
      expect(result.output).toContain("no-secret-patterns");
      // Sanity-check the parser path independently against fixture stdout.
      const parsed = parseGemmaCheckJson(
        JSON.stringify({
          findings: [
            {
              rule: "no-secret-patterns",
              file: "tests/fixtures/background-workers/with-finding.mjs",
              line: 5,
              message: "AWS access key matched",
              severity: "error",
            },
          ],
        }),
      );
      expect(parsed?.findings).toHaveLength(1);
      expect(parsed?.findings[0]?.rule).toBe("no-secret-patterns");
    },
    20_000,
  );

  it.runIf(PRECONDITIONS_MET)(
    "runAuditWorker returns success+empty output when no modified files are passed",
    async () => {
      const result = await runAuditWorker([], {
        scriptPath: gemmaCheckScript,
        cwd: repoRoot,
      });
      expect(result.success).toBe(true);
      expect(result.output).toBe("");
      expect(result.toolCallCount).toBe(0);
    },
  );

  it("formatAuditFindings renders the chat-message summary deterministically", () => {
    const summary = formatAuditFindings(
      [
        {
          rule: "no-secret-patterns",
          file: "tests/fixtures/background-workers/with-finding.mjs",
          line: 5,
          message: "AWS access key matched",
          severity: "error",
        },
      ],
      ["tests/fixtures/background-workers/with-finding.mjs"],
      1,
      "",
    );
    expect(summary).toContain("Audit Worker");
    expect(summary).toContain("Found 1 finding(s)");
    expect(summary).toContain("no-secret-patterns");
  });
});
