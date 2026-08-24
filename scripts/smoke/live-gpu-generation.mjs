#!/usr/bin/env node
/**
 * v2.2.0 Phase 2 (2.5) -- LIVE GPU generation smoke. NOT part of CI.
 *
 * Runs one real image render and one short video render against the installed
 * weights, through the built sidecar, and asserts non-empty output files. This
 * is the leg that a mocked test cannot cover: real weights, real VRAM, real
 * diffusion runtime. It is gated behind NEXUS_LIVE_GPU=1 so it can never be
 * mistaken for a CI pass.
 *
 * Usage (from the repo root, on the GPU host, after an install):
 *   NEXUS_LIVE_GPU=1 node scripts/smoke/live-gpu-generation.mjs
 *
 * Exit codes: 0 all requested renders produced output; 1 a render failed or
 * produced nothing; 2 the smoke was skipped (gate not set / sidecar missing).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const GATE = process.env.NEXUS_LIVE_GPU === "1";
const IMAGE_MODEL = process.env.NEXUS_SMOKE_IMAGE_MODEL ?? "sana-1.6b-2k";
const VIDEO_MODEL = process.env.NEXUS_SMOKE_VIDEO_MODEL ?? "ltx-video";
const TIMEOUT_MS = Number(process.env.NEXUS_SMOKE_TIMEOUT_MS ?? 600_000);

function skip(reason) {
  process.stdout.write(`SKIP live-gpu smoke: ${reason}\n`);
  process.exit(2);
}

if (!GATE) {
  skip("NEXUS_LIVE_GPU is not 1 (this smoke never runs by default)");
}

const sidecarScript = path.resolve("desktop/sidecar/dist/main.js");
if (!existsSync(sidecarScript)) {
  skip(`sidecar bundle not built at ${sidecarScript} (run npm run build:sidecar)`);
}

// Resolve the same runtime contract the shell uses, so this smoke exercises
// the installed configuration rather than a bespoke one.
const runtimeConfigPath = path.join(homedir(), ".nexus", "runtime.json");
let runtimeConfig = {};
if (existsSync(runtimeConfigPath)) {
  try {
    runtimeConfig = JSON.parse(readFileSync(runtimeConfigPath, "utf8"));
  } catch {
    skip(`runtime.json at ${runtimeConfigPath} is unreadable`);
  }
} else {
  process.stdout.write(`note: no runtime.json at ${runtimeConfigPath}; using env/PATH\n`);
}

const nodeBin = runtimeConfig.nodePath && existsSync(runtimeConfig.nodePath)
  ? runtimeConfig.nodePath
  : process.execPath;

const child = spawn(nodeBin, [sidecarScript], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

let nextId = 1;
const pending = new Map();
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line.startsWith("{")) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = pending.get(msg.id);
    if (!entry) continue;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message ?? "rpc error"));
    else entry.resolve(msg.result);
  }
});

function rpc(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, TIMEOUT_MS).unref?.();
  });
}

async function drainUntilTerminal(jobId, label) {
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`${label}: timed out`);
    const drained = await rpc("diffusion.drainEvents", { jobId });
    for (const event of drained?.events ?? []) {
      if (event.kind === "error") throw new Error(`${label}: ${event.message ?? "failed"}`);
      if (event.kind === "complete" || event.kind === "result") return event;
    }
    if (drained?.done) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const failures = [];

try {
  const health = await rpc("diffusion.health", {});
  process.stdout.write(`diffusion health: ${JSON.stringify(health)}\n`);

  process.stdout.write(`rendering one image with ${IMAGE_MODEL}...\n`);
  const image = await rpc("diffusion.txt2img", {
    modelId: IMAGE_MODEL,
    prompt: "a lighthouse at dusk, cinematic",
    width: 512,
    height: 512,
    steps: 8,
    cfgScale: 4.5,
    seed: 7,
  });
  const imageResult = await drainUntilTerminal(image.jobId, "image");
  if (!imageResult) failures.push("image render produced no terminal event");
  else process.stdout.write("image render: OK\n");

  process.stdout.write(`rendering one short clip with ${VIDEO_MODEL}...\n`);
  const video = await rpc("diffusion.video.text2video", {
    modelId: VIDEO_MODEL,
    prompt: "waves rolling onto a beach",
    width: 512,
    height: 320,
    numFrames: 25,
    steps: 8,
    cfgScale: 3.5,
    seed: 7,
  });
  const videoResult = await drainUntilTerminal(video.jobId, "video");
  if (!videoResult) failures.push("video render produced no terminal event");
  else process.stdout.write("video render: OK\n");
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
} finally {
  child.kill();
}

if (failures.length > 0) {
  process.stderr.write(`LIVE GPU SMOKE FAILED:\n - ${failures.join("\n - ")}\n`);
  process.exit(1);
}
process.stdout.write("LIVE GPU SMOKE PASSED\n");
process.exit(0);
