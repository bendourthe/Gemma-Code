/**
 * Skill-loading benchmark.
 *
 * Measures the time to load 10, 50, and 100 skills from disk using SkillLoader.
 * Temporary directories are used so the benchmark does not depend on the built-in
 * catalog size.
 *
 * Target: p99 < 200ms for 100 skills.
 *
 * Run: npx vitest bench --config configs/vitest.config.ts tests/benchmarks/skill-loading.bench.ts
 */

import { bench, describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SkillLoader } from "../../src/skills/SkillLoader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_TEMPLATE = (name: string) => `---
name: ${name}
description: A benchmark skill named ${name}
argument-hint: "[args]"
---

You are a helpful assistant. Your task is related to ${name}.
Follow the user's instructions carefully and produce high-quality output.
$ARGUMENTS
`;

/**
 * Creates a temporary skills directory with `count` SKILL.md files and
 * returns the directory path.
 */
function createSkillsDir(count: number, prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gemma-skills-${prefix}-`));
  for (let i = 0; i < count; i++) {
    const name = `skill-${String(i).padStart(4, "0")}`;
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), SKILL_TEMPLATE(name), "utf-8");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Directories pre-created once for the whole bench run
// ---------------------------------------------------------------------------

let dir10: string;
let dir50: string;
let dir100: string;

beforeAll(() => {
  dir10 = createSkillsDir(10, "10");
  dir50 = createSkillsDir(50, "50");
  dir100 = createSkillsDir(100, "100");
});

afterAll(() => {
  for (const dir of [dir10, dir50, dir100]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Latency gate
// ---------------------------------------------------------------------------

const P99_LIMIT_MS = 200;
const ITERATIONS = 30;

function p99(sorted: number[]): number {
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function measureLoad(userDir: string, n: number): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    // Each measurement creates a fresh loader so we exercise disk reads.
    const loader = new SkillLoader(userDir);
    loader.listSkills();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b);
}

describe("SkillLoader latency gate", () => {
  it(`loads 100 skills in under ${P99_LIMIT_MS}ms at p99`, async () => {
    const times = await measureLoad(dir100, ITERATIONS);
    expect(p99(times)).toBeLessThan(P99_LIMIT_MS);
  });
});

// ---------------------------------------------------------------------------
// Throughput benchmarks
// ---------------------------------------------------------------------------

describe("SkillLoader throughput", () => {
  bench("load 10 skills", () => {
    const loader = new SkillLoader(dir10);
    loader.listSkills();
  });

  bench("load 50 skills", () => {
    const loader = new SkillLoader(dir50);
    loader.listSkills();
  });

  bench("load 100 skills", () => {
    const loader = new SkillLoader(dir100);
    loader.listSkills();
  });
});
