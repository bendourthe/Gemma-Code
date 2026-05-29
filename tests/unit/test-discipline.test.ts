import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve, join } from "path";

// See docs/archive/versions/v0/v0.5.0/test-pyramid.md (Smoke-Test Classification Rubric).
// This meta-test enforces:
//   1. No `it.skip(` or `describe.skip(` without an adjacent comment containing
//      `TODO(harness-bug)` or `TODO(missing_env)`.
//   2. No bare `if (!process.env...)` early returns; integration tests must
//      gate on `skipIfNoOllama()` / `skipIfMissingEnv()` from
//      tests/helpers/factories.ts (or use `describe.skipIf(...)`).
//
// Set SKIP_TEST_DISCIPLINE_LINT=1 to bypass the meta-test for emergency triage.

const repoRoot = resolve(__dirname, "../..");
const integrationRoot = resolve(repoRoot, "tests/integration");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const skipDiscipline = process.env["SKIP_TEST_DISCIPLINE_LINT"] === "1";

const SKIP_RE = /(?:^|[^.\w])(?:it|describe)\.skip\s*\(/;
const BARE_ENV_EARLY_RETURN_RE =
  /if\s*\(\s*!\s*process\.env(?:\.[A-Z_]+|\[\s*["'][A-Z_]+["']\s*\])\s*\)\s*(?:return\b|\{\s*return\b)/;

describe.skipIf(skipDiscipline)("test-discipline: integration tests obey the rubric", () => {
  const files = walk(integrationRoot);

  it("discovers at least one integration test (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains no bare `if (!process.env.X) return` early returns", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      if (BARE_ENV_EARLY_RETURN_RE.test(body)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `Use skipIfNoOllama() / skipIfMissingEnv() from tests/helpers/factories.ts ` +
        `or describe.skipIf(...) instead of bare process.env early returns. ` +
        `Offending files:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("uses `it.skip(` / `describe.skip(` only with a TODO(harness-bug) or TODO(missing_env) comment", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!SKIP_RE.test(lines[i] ?? "")) continue;
        const window = lines
          .slice(Math.max(0, i - 2), Math.min(lines.length, i + 2))
          .join("\n");
        if (
          !window.includes("TODO(harness-bug)") &&
          !window.includes("TODO(missing_env)")
        ) {
          offenders.push(`${file}:${i + 1}`);
        }
      }
    }
    expect(
      offenders,
      `Tag every it.skip / describe.skip with an adjacent TODO(harness-bug) ` +
        `or TODO(missing_env) comment. Offenders:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
