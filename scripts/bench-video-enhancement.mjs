#!/usr/bin/env node
/**
 * v2.3.0 Phase 5 -- deterministic video-enhancement quality/resource harness.
 *
 * Default `--backend fake` is the CI contract: it never launches Video2X,
 * never downloads a binary, and records GPU/VRAM as `not observed`.
 * `--backend real` is an explicit local hardware mode.
 *
 * Usage:
 *   node scripts/bench-video-enhancement.mjs
 *   node scripts/bench-video-enhancement.mjs --backend fake --output-dir <dir>
 *   node scripts/bench-video-enhancement.mjs --backend real --output-dir <dir>
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const FIXTURE_VERSION = "v1";
const FIXTURE_DIR = join(
  REPO_ROOT,
  "tests/fixtures/video-enhancement",
  FIXTURE_VERSION,
);
const MANIFEST_PATH = join(FIXTURE_DIR, "manifest.json");
const SUPPORT_PATH = join(
  REPO_ROOT,
  "core/video/video-enhancement-support.json",
);
const FIXTURE_HEADER = "NEXUS-VIDEO-ENHANCEMENT-FIXTURE-v1";
const DURATION_TOLERANCE = 0.1;
const PRESETS = Object.freeze({
  "animation-upscale-2x": { kind: "upscale", scaleFactor: 2 },
  "animation-upscale-4x": { kind: "upscale", scaleFactor: 4 },
  "general-upscale-4x": { kind: "upscale", scaleFactor: 4 },
  "smooth-2x": { kind: "interpolate", frameRateMultiplier: 2 },
});
const DEFAULT_PRESET = "animation-upscale-2x";

function parseArgs(argv) {
  const args = {
    backend: "fake",
    outputDir: null,
    preset: DEFAULT_PRESET,
    fixture: null,
    writeJson: null,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    switch (key) {
      case "--backend":
        args.backend = argv[++i];
        break;
      case "--output-dir":
        args.outputDir = argv[++i];
        break;
      case "--preset":
        args.preset = argv[++i];
        break;
      case "--fixture":
        args.fixture = argv[++i];
        break;
      case "--write-json":
        args.writeJson = argv[++i];
        break;
      case "--force":
        args.force = true;
        break;
      default:
        throw typedFailure(
          "invalid_arguments",
          `Unknown argument: ${key}`,
        );
    }
  }
  if (args.backend !== "fake" && args.backend !== "real") {
    throw typedFailure(
      "invalid_arguments",
      "Backend must be fake or real.",
    );
  }
  if (!(args.preset in PRESETS)) {
    throw typedFailure("invalid_arguments", `Unknown preset: ${args.preset}`);
  }
  return args;
}

function typedFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(path) {
  if (!existsSync(path)) {
    throw typedFailure("missing_fixture", `Missing file: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw typedFailure("malformed_fixture", `Malformed JSON: ${path}`);
  }
}

function parseFixtureFile(path) {
  if (!existsSync(path)) {
    throw typedFailure("missing_fixture", `Missing fixture: ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  const newline = raw.indexOf("\n");
  if (newline < 0 || raw.slice(0, newline).trim() !== FIXTURE_HEADER) {
    throw typedFailure("malformed_fixture", `Missing fixture header: ${path}`);
  }
  let body;
  try {
    body = JSON.parse(raw.slice(newline + 1));
  } catch {
    throw typedFailure("malformed_fixture", `Malformed fixture body: ${path}`);
  }
  for (const field of [
    "id",
    "contentClass",
    "width",
    "height",
    "frameCount",
    "durationSeconds",
  ]) {
    if (body[field] === undefined || body[field] === null) {
      throw typedFailure(
        "malformed_fixture",
        `Fixture ${path} is missing ${field}.`,
      );
    }
  }
  if (
    !Number.isFinite(body.width) ||
    !Number.isFinite(body.height) ||
    !Number.isFinite(body.frameCount) ||
    !Number.isFinite(body.durationSeconds) ||
    body.frameCount <= 0 ||
    body.durationSeconds <= 0
  ) {
    throw typedFailure(
      "malformed_fixture",
      `Fixture ${path} has a NaN or zero-frame geometry.`,
    );
  }
  return body;
}

function expectedGeometry(source, presetId) {
  const preset = PRESETS[presetId];
  const scale = preset.kind === "upscale" ? preset.scaleFactor : 1;
  const multiplier =
    preset.kind === "interpolate" ? preset.frameRateMultiplier : 1;
  return {
    width: source.width * scale,
    height: source.height * scale,
    frameRate: {
      numerator: source.frameRate.numerator * multiplier,
      denominator: source.frameRate.denominator,
    },
    durationSeconds: source.durationSeconds,
    frameCount: source.frameCount * multiplier,
  };
}

function notObserved() {
  return { status: "not observed" };
}

function peakRssKb() {
  try {
    const usage = process.resourceUsage();
    return typeof usage.maxRSS === "number" ? usage.maxRSS : "not observed";
  } catch {
    return "not observed";
  }
}

function validateInvariants(source, output, expected) {
  const failures = [];
  if (!output || output.bytes <= 0) {
    failures.push("output is not readable");
  }
  if (output.width !== expected.width || output.height !== expected.height) {
    failures.push(
      `expected ${expected.width}x${expected.height}, received ${output.width}x${output.height}`,
    );
  }
  if (
    output.frameRate.numerator !== expected.frameRate.numerator ||
    output.frameRate.denominator !== expected.frameRate.denominator
  ) {
    failures.push("frame rate did not match the expected transform");
  }
  const delta = Math.abs(output.durationSeconds - expected.durationSeconds);
  const allowed = expected.durationSeconds * DURATION_TOLERANCE;
  if (delta > allowed) {
    failures.push("duration is outside the allowed tolerance");
  }
  if (output.frameCount <= 0 || !Number.isFinite(output.frameCount)) {
    failures.push("output frame count is NaN or zero");
  }
  if (source.sha256After !== source.sha256Before) {
    failures.push("source bytes changed");
  }
  return failures;
}

function writeOutputFixture(path, source, expected, presetId) {
  const body = {
    id: `${source.id}-enhanced`,
    sourceId: source.id,
    contentClass: source.contentClass,
    preset: presetId,
    width: expected.width,
    height: expected.height,
    frameRate: expected.frameRate,
    frameCount: expected.frameCount,
    durationSeconds: expected.durationSeconds,
  };
  writeFileSync(
    path,
    `${FIXTURE_HEADER}\n${JSON.stringify(body, null, 2)}\n`,
    "utf8",
  );
}

function acquireLock(outputDir) {
  const lockPath = join(outputDir, "bench.lock");
  try {
    const fd = openSync(lockPath, "wx");
    closeSync(fd);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw typedFailure(
        "output_conflict",
        `Another benchmark holds ${lockPath}.`,
      );
    }
    throw error;
  }
  return lockPath;
}

async function runFakeCase(source, presetId, outputDir) {
  const started = process.hrtime.bigint();
  const sourceBytes = readFileSync(source.path);
  const shaBefore = sha256(sourceBytes);
  const expected = expectedGeometry(source, presetId);
  const outputPath = join(outputDir, `${source.id}.${presetId}.fixture`);
  writeOutputFixture(outputPath, source, expected, presetId);
  const shaAfter = sha256(readFileSync(source.path));
  const parsed = parseFixtureFile(outputPath);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const output = {
    path: outputPath,
    bytes: readFileSync(outputPath).byteLength,
    width: parsed.width,
    height: parsed.height,
    frameRate: parsed.frameRate,
    frameCount: parsed.frameCount,
    durationSeconds: parsed.durationSeconds,
    sha256: sha256(readFileSync(outputPath)),
  };
  const failures = validateInvariants(
    { sha256Before: shaBefore, sha256After: shaAfter },
    output,
    expected,
  );
  return {
    fixtureId: source.id,
    contentClass: source.contentClass,
    preset: presetId,
    backend: {
      id: "fake-deterministic",
      compatibilityId: "fake-deterministic-v1",
      version: "fake",
      model: null,
    },
    source: {
      path: source.path,
      width: source.width,
      height: source.height,
      frameRate: source.frameRate,
      frameCount: source.frameCount,
      durationSeconds: source.durationSeconds,
      sizeBytes: sourceBytes.byteLength,
      sha256: shaBefore,
    },
    output,
    wallTimeMs: elapsedMs,
    peakCpu: notObserved(),
    peakRamKb: peakRssKb(),
    peakGpu: notObserved(),
    peakVram: notObserved(),
    validation:
      failures.length === 0
        ? { ok: true, failures: [] }
        : { ok: false, failures },
    error: failures.length === 0 ? null : { code: "output_invalid", failures },
  };
}

function runRealCase(source, presetId, support) {
  const envPath = process.env[support.envKey]?.trim() ?? "";
  return {
    fixtureId: source.id,
    contentClass: source.contentClass,
    preset: presetId,
    backend: {
      id: "video2x",
      compatibilityId: support.compatibilityId,
      version: support.pinnedVersion,
      model: "not observed",
    },
    source: {
      path: source.path,
      width: source.width,
      height: source.height,
      frameRate: source.frameRate,
      frameCount: source.frameCount,
      durationSeconds: source.durationSeconds,
    },
    output: null,
    wallTimeMs: 0,
    peakCpu: notObserved(),
    peakRamKb: notObserved(),
    peakGpu: notObserved(),
    peakVram: notObserved(),
    validation: { ok: false, failures: ["real backend did not run"] },
    error: {
      code: envPath ? "backend_unavailable" : "missing_configuration",
      message: envPath
        ? "Real Video2X measurement is not proven in this harness invocation."
        : `Set ${support.envKey} to an absolute Video2X 6.4.0 executable before using --backend real.`,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const support = readJson(SUPPORT_PATH);
  const manifest = readJson(MANIFEST_PATH);
  if (manifest.kind !== "nexus-video-enhancement-fixtures") {
    throw typedFailure("malformed_fixture", "Unexpected fixture manifest kind.");
  }
  const selected = manifest.fixtures.filter(
    (fixture) => !args.fixture || fixture.id === args.fixture,
  );
  if (selected.length === 0) {
    throw typedFailure("missing_fixture", `No fixture matched ${args.fixture}.`);
  }
  const outputDir = args.outputDir
    ? resolve(args.outputDir)
    : await mkdtemp(join(tmpdir(), "nexus-video-enhancement-bench-"));
  if (args.outputDir) {
    mkdirSync(outputDir, { recursive: true });
  }
  acquireLock(outputDir);
  const jsonPath = args.writeJson
    ? resolve(args.writeJson)
    : join(outputDir, "results.json");
  if (existsSync(jsonPath) && !args.force) {
    throw typedFailure(
      "output_conflict",
      `Refusing to overwrite ${jsonPath}. Pass --force or a new --output-dir.`,
    );
  }
  const cases = [];
  for (const declared of selected) {
    const fixturePath = join(FIXTURE_DIR, `${declared.id}.fixture`);
    const parsed = parseFixtureFile(fixturePath);
    if (
      parsed.id !== declared.id ||
      parsed.width !== declared.width ||
      parsed.height !== declared.height
    ) {
      throw typedFailure(
        "malformed_fixture",
        `Fixture ${declared.id} does not match the versioned manifest.`,
      );
    }
    const source = { ...parsed, path: fixturePath };
    const result =
      args.backend === "fake"
        ? await runFakeCase(source, args.preset, outputDir)
        : runRealCase(source, args.preset, support);
    cases.push(result);
  }
  const report = {
    capturedAt: new Date().toISOString(),
    backendMode: args.backend,
    fixtureVersion: FIXTURE_VERSION,
    preset: args.preset,
    support: {
      envKey: support.envKey,
      settingKey: support.settingKey,
      compatibilityId: support.compatibilityId,
      pinnedVersion: support.pinnedVersion,
    },
    outputDir,
    cases,
  };
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().then(
    (report) => {
      const failed = report.cases.filter((item) => item.error);
      process.stdout.write(`${JSON.stringify({ outputDir: report.outputDir, cases: report.cases.length, failed: failed.length }, null, 2)}\n`);
      process.exit(failed.length > 0 && report.backendMode === "fake" ? 1 : 0);
    },
    (error) => {
      const payload = {
        ok: false,
        code: error.code ?? "internal_error",
        message: error.message,
      };
      process.stderr.write(`${JSON.stringify(payload)}\n`);
      process.exit(1);
    },
  );
}

export { main, parseArgs, expectedGeometry, parseFixtureFile };
