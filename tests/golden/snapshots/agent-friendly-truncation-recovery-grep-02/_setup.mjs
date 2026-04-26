#!/usr/bin/env node
// Generate 5 source files with 220 TODO lines total. Even-indexed TODOs
// mention "performance"; odd-indexed mention unrelated concerns. Run from
// the repo root. Idempotent.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "src");
mkdirSync(srcDir, { recursive: true });

const TOPICS_PERF = [
  "tighten loop performance on the inner aggregation",
  "investigate performance regression introduced by the cache layer",
  "add performance instrumentation around the hot path",
  "performance: avoid the redundant JSON parse",
  "rework this routine to improve performance under contention",
];
const TOPICS_OTHER = [
  "rename this helper to match new conventions",
  "drop the legacy v0 fallback once consumers migrate",
  "audit for missing null-check on the upstream payload",
  "consider extracting this into a shared module",
  "double check the error message wording for parity with logs",
];

const TOTAL = 220;
const PER_FILE = Math.ceil(TOTAL / 5);

for (let f = 0; f < 5; f++) {
  const lines = [
    `// File ${f}. Auto-generated. Regenerate via _setup.mjs.`,
    "",
  ];
  const start = f * PER_FILE;
  const end = Math.min(TOTAL, start + PER_FILE);
  for (let i = start; i < end; i++) {
    const isPerf = i % 2 === 0;
    const phrase = isPerf
      ? TOPICS_PERF[i % TOPICS_PERF.length]
      : TOPICS_OTHER[i % TOPICS_OTHER.length];
    lines.push(`// TODO(${i}): ${phrase}`);
  }
  lines.push(""); // trailing newline
  writeFileSync(join(srcDir, `module${f}.ts`), lines.join("\n"));
}
console.log(`generated ${TOTAL} TODOs across 5 files`);
