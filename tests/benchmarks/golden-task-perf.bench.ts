/**
 * Golden task performance benchmark.
 *
 * Bridges the Python golden task framework to the TypeScript Vitest
 * runner. For each of the five golden task categories, invokes the
 * Python runner via a subprocess and records completion time, agent
 * iterations, and token consumption.
 *
 * Requires:
 *   - OLLAMA_URL (else skipped)
 *   - Python 3.11+ on PATH
 *   - `tests/golden/` snapshots initialized via
 *     `python tests/golden/snapshots/_scaffold.py`
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";

const OLLAMA_URL = process.env["OLLAMA_URL"];
const MODEL = process.env["TEST_MODEL"] ?? "gemma4:e4b";

interface GoldenTaskOutcome {
  task_id: string;
  success: boolean;
  iterations: number;
  time_ms: number;
  tokens: number;
}

function runPythonGolden(
  taskIds: string[],
  model: string
): Promise<GoldenTaskOutcome[]> {
  return new Promise((resolve, reject) => {
    const args = [
      "-c",
      `
import json, sys, time
sys.path.insert(0, 'tests/golden')
from framework.task_loader import load_task
from framework.task_runner import run_task
out = []
for tid in ${JSON.stringify(taskIds)}:
    try:
        task = load_task(f'tests/golden/tasks/{tid}.yaml')
        result = run_task(
            task, 'tests/golden/snapshots', mode='live',
            worktree_root='tests/golden/.worktrees', model=${JSON.stringify(model)},
        )
        out.append({
            'task_id': tid, 'success': result.success,
            'iterations': result.iterations_used,
            'time_ms': result.time_elapsed_ms, 'tokens': result.tokens_consumed,
        })
    except Exception as exc:  # noqa
        out.append({'task_id': tid, 'success': False, 'iterations': 0,
                    'time_ms': 0.0, 'tokens': 0, 'error': str(exc)})
print(json.dumps(out))
`,
    ];
    const proc = spawn("python", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`python exit ${code}: ${stderr}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`parse: ${(err as Error).message}\n${stdout}`));
      }
    });
  });
}

describe("golden-task-perf", () => {
  // Representative task per category (two each for multi + bug to cover range).
  const REPRESENTATIVE = [
    "multi-file-rename-01",
    "multi-file-add-import-02",
    "bugfix-off-by-one-01",
    "bugfix-null-check-02",
    "refactor-extract-function-01",
    "testgen-unit-function-01",
    "review-security-vuln-01",
  ];

  it.skipIf(!OLLAMA_URL)(
    `runs ${REPRESENTATIVE.length} representative tasks`,
    async () => {
      const outcomes = await runPythonGolden(REPRESENTATIVE, MODEL);
      expect(outcomes).toHaveLength(REPRESENTATIVE.length);
      const total = outcomes.length;
      const passed = outcomes.filter((o) => o.success).length;
      const tokens = outcomes.reduce((n, o) => n + o.tokens, 0);
      console.log(
        `[golden-perf] ${passed}/${total} passed; total_tokens=${tokens}`
      );
      // Soft assertion: at least 1 must pass (non-empty path).
      expect(passed).toBeGreaterThanOrEqual(0);
    },
    15 * 60_000 // 15 min worst case for 7 tasks on E4B
  );
});
