/**
 * v1.3.0 Phase 7 (adoption-skill-cleaner T020) -- skills-audit benchmark harness.
 *
 * Measures the `nexus skills audit` command against the live skill catalog on
 * this host and writes `results.json` in the same directory. Three measurement
 * families are captured:
 *
 *   (a) wall-clock time for `node bin/nexus.mjs skills audit` (child process,
 *       1 warmup discarded + N timed runs; median + p95 reported);
 *   (b) peak RSS of the audit process (a dedicated child probe runs ONLY the
 *       audit and reports `process.resourceUsage().maxRSS`);
 *   (c) the content-similarity detection runtime in isolation (the O(N^2)
 *       `findSimilarPairs` pass, timed over repeated iterations) so a future
 *       cycle can decide whether a MinHash/LSH pre-filter is warranted
 *       (carryforward open item T013.P3.D);
 *
 * plus the deterministic report contents (budget pressure at the default 2%
 * envelope and the top-5 description-compaction candidates by potential token
 * savings). The deterministic fields reproduce byte-for-byte; the timing
 * fields are captured-at-run and recorded as informational, never gated.
 *
 * Reproduce with: `node tests/fixtures/skills-audit-benchmark-results/2026-05-28/run-benchmark.mjs`
 * (requires a prior `npm run build` -- the harness imports the compiled `out/` modules).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join as joinPath, resolve as resolvePath } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(__dirname, "..", "..", "..", "..");
const outDir = joinPath(repoRoot, "out");

const TIMED_RUNS = 10; // >= the plan's 3-run floor; gives a meaningful median + p95.
const SIMILARITY_ITERATIONS = 25; // repeat the O(N^2) pass to stabilise the median.

// --- compiled-module imports (require `npm run build`) -------------------------
const auditorMod = await import(pathToFileURL(joinPath(outDir, "core", "skills", "SkillAuditor.js")).href);
const catalogMod = await import(pathToFileURL(joinPath(outDir, "core", "skills", "SkillCatalog.js")).href);
const registryMod = await import(pathToFileURL(joinPath(outDir, "core", "registry", "ModelRegistry.js")).href);
const similarityMod = await import(pathToFileURL(joinPath(outDir, "core", "skills", "SkillSimilarity.js")).href);

// --- live catalog build (mirrors bin/nexus.mjs skillRootsFor + buildLiveCatalog) --
function nexusHomeDir() {
  const home = process.env.USERPROFILE || process.env.HOME || repoRoot;
  return joinPath(home, ".nexus");
}

function skillRootsFor() {
  const roots = [{ dir: joinPath(repoRoot, "src", "skills", "catalog"), source: "builtin" }];
  const skillsRoot = joinPath(nexusHomeDir(), "skills");
  roots.push({ dir: joinPath(skillsRoot, "user"), source: "user" });
  try {
    const tag = readFileSync(joinPath(skillsRoot, "devai-hub", "ACTIVE"), "utf8").trim();
    if (tag) roots.push({ dir: joinPath(skillsRoot, "devai-hub", tag), source: "devai-hub" });
  } catch {
    // no active devai-hub tag
  }
  return roots;
}

function parseSkillFrontmatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!m) return null;
  const meta = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }
  return { meta, body: (m[2] ?? "").trim() };
}

function walkSkillFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = joinPath(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkSkillFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") out.push(full);
  }
}

function buildLiveSkills() {
  const skills = [];
  const rootCounts = {};
  for (const { dir, source } of skillRootsFor()) {
    const files = [];
    walkSkillFiles(dir, files);
    let count = 0;
    for (const file of files) {
      let content;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const parsed = parseSkillFrontmatter(content);
      if (!parsed || !parsed.meta.name) continue;
      const name = parsed.meta.name;
      const contentHash = createHash("sha256").update(content).digest("hex");
      skills.push({
        id: catalogMod.canonicalSkillId(source, name),
        displayName: name,
        path: file,
        provenance: { source, contentHash },
        frontmatter: { name, description: parsed.meta.description ?? "" },
        body: parsed.body,
      });
      count += 1;
    }
    rootCounts[source] = count;
  }
  return { skills, rootCounts };
}

// --- statistics helpers --------------------------------------------------------
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length - 1, Math.max(0, rank - 1))];
}

function round(value, dp = 2) {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// --- (a) wall-clock of the real CLI child process ------------------------------
function measureWallClock() {
  const cliPath = joinPath(repoRoot, "bin", "nexus.mjs");
  const args = [cliPath, "skills", "audit"];
  // warmup (filesystem cache, module graph) -- discarded
  spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
  const samples = [];
  for (let i = 0; i < TIMED_RUNS; i += 1) {
    const t0 = performance.now();
    const res = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
    const t1 = performance.now();
    if (res.status !== 0) {
      throw new Error(`skills audit exited ${res.status}: ${res.stderr}`);
    }
    samples.push(t1 - t0);
  }
  return {
    runs: TIMED_RUNS,
    samplesMs: samples.map((s) => round(s, 1)),
    medianMs: round(median(samples), 1),
    p95Ms: round(percentile(samples, 95), 1),
    minMs: round(Math.min(...samples), 1),
    maxMs: round(Math.max(...samples), 1),
  };
}

// --- (b) peak RSS of an audit-only child process -------------------------------
function measurePeakRss() {
  const probe = joinPath(__dirname, "rss-probe.mjs");
  const res = spawnSync(process.execPath, [probe], { cwd: repoRoot, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`rss-probe exited ${res.status}: ${res.stderr}`);
  }
  const maxRssKb = Number.parseInt(res.stdout.trim(), 10);
  return {
    maxRssKb,
    peakRssMb: round(maxRssKb / 1024, 2),
    note: "process.resourceUsage().maxRSS; kilobytes on win32/linux (peak working set on win32)",
  };
}

// --- (c) similarity-detection runtime in isolation ----------------------------
function measureSimilarity(skills) {
  const threshold = 0.85;
  const n = skills.length;
  const comparisons = (n * (n - 1)) / 2;
  // warmup
  similarityMod.findSimilarPairs(skills, threshold);
  const samples = [];
  let pairs = 0;
  for (let i = 0; i < SIMILARITY_ITERATIONS; i += 1) {
    const t0 = performance.now();
    const result = similarityMod.findSimilarPairs(skills, threshold);
    const t1 = performance.now();
    pairs = result.length;
    samples.push(t1 - t0);
  }
  return {
    threshold,
    skillCount: n,
    comparisons,
    iterations: SIMILARITY_ITERATIONS,
    medianMs: round(median(samples), 3),
    p95Ms: round(percentile(samples, 95), 3),
    pairsFound: pairs,
  };
}

// --- (d) deterministic report contents ----------------------------------------
async function captureReport(skills) {
  const catalog = new catalogMod.InMemorySkillCatalog(skills);
  const registry = new registryMod.InMemoryModelRegistry();
  registry.setActiveModel("gemma4:e4b");
  // Pass the primary skill root so the Unused section runs its usage scan,
  // mirroring exactly what `node bin/nexus.mjs skills audit` does (it sets
  // opts.skillsRoot = skillRootsFor(flags)[0].dir).
  const primaryRoot = skillRootsFor()[0].dir;
  const report = await auditorMod.auditSkills({
    catalog,
    modelRegistry: registry,
    skillsRoot: primaryRoot,
  });
  const MAX_DESCRIPTION_TOKENS = 50; // auditor default candidate threshold
  const top5 = report.descriptions.slice(0, 5).map((d, i) => {
    const isUser = d.id.startsWith("user:") || d.id.includes("/user/");
    return {
      // anonymise user-authored skills (PII guard per the plan); builtin ids are public.
      id: isUser ? `<user-skill-${i + 1}>` : d.id,
      lineTokens: d.lineTokens,
      potentialSavingsTokens: Math.max(0, d.lineTokens - MAX_DESCRIPTION_TOKENS),
    };
  });
  return {
    budget: report.budget,
    descriptionCandidateCount: report.descriptions.length,
    top5DescriptionCandidates: top5,
    duplicatesByName: report.duplicates.byName.length,
    duplicatesBySimilarity: report.duplicates.bySimilarity.length,
    unusedCandidateCount: report.unused.length,
    rootCount: report.roots.length,
  };
}

// --- run all -------------------------------------------------------------------
const { skills, rootCounts } = buildLiveSkills();
const wallClock = measureWallClock();
const peakRss = measurePeakRss();
const similarity = measureSimilarity(skills);
const reportContents = await captureReport(skills);

const results = {
  capturedAt: "2026-05-28",
  host: { platform: process.platform, arch: process.arch, nodeVersion: process.version },
  catalog: {
    totalSkills: skills.length,
    byRoot: rootCounts,
    note: "Live catalog on this host is the builtin-only root; the ~213 Nexus-Hub skills await the upstream-release sync tracked by carryforward 1.1.P3.B.",
  },
  wallClock,
  peakRss,
  similarity,
  reportContents,
};

const outPath = joinPath(__dirname, "results.json");
writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(results, null, 2) + "\n");
