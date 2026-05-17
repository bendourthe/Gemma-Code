#!/usr/bin/env node
/**
 * nexus-video CLI (Phase 7.3).
 *
 * Currently exposes one subcommand:
 *
 *   nexus-video extract-workflow <file.mp4>
 *
 * Runs `ffprobe -show_format -of json <file.mp4>`, parses the `comment`
 * metadata tag as JSON, validates it is a Nexus video workflow, and
 * prints the JSON to stdout. Exits 0 on success, 1 if the file does
 * not embed a workflow, 2 on argument or I/O errors.
 *
 * The TypeScript implementation lives at `core/video/WorkflowMetadata.ts`
 * and is compiled to `out/core/video/WorkflowMetadata.js` by `npm run
 * build`. To keep this CLI runnable from a source checkout without a TS
 * build step, the script falls back to an inline ffprobe wrapper when
 * the compiled module is absent.
 *
 * The ffprobe binary is resolved via the `NEXUS_FFPROBE_PATH` env var
 * (preferred -- set by the installer in Phase 9) and falls back to the
 * generic `ffprobe` name on `$PATH`.
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


function ffprobePath() {
  return process.env.NEXUS_FFPROBE_PATH || "ffprobe";
}


function runFfprobe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobePath(),
      ["-v", "error", "-show_format", "-of", "json", file],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(new Error(`ffprobe failed (${code}): ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}


async function inlineExtract(file) {
  let stdout;
  try {
    stdout = await runFfprobe(file);
  } catch (err) {
    throw new Error(`ffprobe call failed: ${err && err.message ? err.message : err}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const tags = (parsed && parsed.format && parsed.format.tags) || {};
  const raw = tags.comment ?? tags.COMMENT ?? null;
  if (!raw) return null;
  try {
    const workflow = JSON.parse(raw);
    if (
      workflow &&
      typeof workflow === "object" &&
      workflow.kind === "video" &&
      (workflow.mode === "text2video" || workflow.mode === "image2video")
    ) {
      return workflow;
    }
    return null;
  } catch {
    return null;
  }
}


async function loadExtractor() {
  const compiled = resolvePath(
    __dirname,
    "..",
    "out",
    "core",
    "video",
    "WorkflowMetadata.js",
  );
  if (existsSync(compiled)) {
    const mod = await import(compiled);
    return async (file) =>
      mod.extractWorkflow(file, {
        ffmpegPath: process.env.NEXUS_FFMPEG_PATH || "ffmpeg",
        ffprobePath: ffprobePath(),
      });
  }
  return inlineExtract;
}


function usage() {
  process.stderr.write("usage: nexus-video extract-workflow <file.mp4>\n");
  process.exit(2);
}


async function main() {
  const [, , subcommand, fileArg] = process.argv;
  if (subcommand === "--help" || subcommand === "-h") {
    process.stdout.write("usage: nexus-video extract-workflow <file.mp4>\n");
    return 0;
  }
  if (subcommand !== "extract-workflow" || !fileArg) {
    usage();
    return 2;
  }
  const extract = await loadExtractor();
  let workflow;
  try {
    workflow = await extract(fileArg);
  } catch (err) {
    process.stderr.write(
      `nexus-video: cannot read ${fileArg}: ${err && err.message ? err.message : err}\n`,
    );
    return 2;
  }
  if (!workflow) {
    process.stderr.write(
      `nexus-video: no workflow metadata found in ${fileArg}\n`,
    );
    return 1;
  }
  process.stdout.write(JSON.stringify(workflow, null, 2) + "\n");
  return 0;
}


main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `nexus-video: ${err && err.stack ? err.stack : err}\n`,
    );
    process.exit(2);
  });
