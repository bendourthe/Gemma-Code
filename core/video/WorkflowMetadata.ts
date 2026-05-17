/**
 * v1.0.0 Phase 7.3 -- MP4 workflow metadata embed / extract.
 *
 * Analog of `core/image/WorkflowMetadata.ts` for the video pillar.
 * Where the image side writes a `tEXt` chunk inside the PNG container,
 * the video side writes a `comment` tag inside the MP4 container via
 * `ffmpeg -metadata comment=...` and reads it back via `ffprobe`.
 *
 * The schema mirrors the image-side `WorkflowMetadata` plus four
 * video-only fields (`mode: "text2video" | "image2video"`,
 * `durationSeconds`, `fps`, optional `sourceImageHash`). Workflow JSON
 * is sorted-keys so the embed is reproducible.
 *
 * The ffmpeg / ffprobe binaries are bundled with the desktop installer
 * (Phase 9); the path resolver is injected so tests can stub it and the
 * production caller can route to `~/.nexus/runtimes/ffmpeg/`.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

export const NEXUS_VIDEO_WORKFLOW_KEY = "nexus_video_workflow";

export type VideoMode = "text2video" | "image2video";

export interface VideoWorkflowMetadata {
  readonly tool: string;
  readonly version: string;
  readonly kind: "video";
  readonly mode: VideoMode;
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly steps: number;
  readonly cfgScale: number;
  readonly sampler: string;
  readonly seed: number;
  readonly timestamp: string;
  readonly sourceImageHash?: string;
  readonly [extension: string]: unknown;
}

export interface FfmpegContext {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  /** Test seam: spawn override. Defaults to node:child_process.spawn. */
  readonly spawnFn?: typeof spawn;
}

/**
 * Embed a video workflow object as the MP4 `comment` metadata tag.
 *
 * Runs `ffmpeg -i <in> -c copy -metadata comment=<json> <out>` to a
 * sibling temp file and then renames it over the input. The input is
 * mutated in place from the caller's perspective; on failure the temp
 * file is cleaned up and the original is untouched.
 */
export async function embedWorkflow(
  mp4Path: string,
  workflow: VideoWorkflowMetadata,
  ctx: FfmpegContext,
): Promise<void> {
  const json = JSON.stringify(workflow, sortKeys);
  const tempPath = `${mp4Path}.nexus-tmp.mp4`;
  const args = [
    "-y",
    "-i",
    mp4Path,
    "-c",
    "copy",
    "-metadata",
    `comment=${json}`,
    tempPath,
  ];
  await runFfmpeg(ctx, args);
  try {
    await fs.rename(tempPath, mp4Path);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Extract a previously-embedded video workflow from an MP4. Uses
 * `ffprobe -show_format -of json <in>` and parses the `tags.comment`
 * value (or `format_tags.comment` depending on ffprobe version) as JSON.
 *
 * Returns `null` when no workflow blob is present, the comment is not
 * JSON, or the parsed object does not match the video schema. Callers
 * that need to surface a parse failure should check `null` and fall
 * back to the raw comment string via `extractCommentRaw`.
 */
export async function extractWorkflow(
  mp4Path: string,
  ctx: FfmpegContext,
): Promise<VideoWorkflowMetadata | null> {
  const raw = await extractCommentRaw(mp4Path, ctx);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isVideoWorkflow(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Read the raw `comment` metadata tag from an MP4 without JSON parsing.
 * Returns `null` when ffprobe finds no comment tag.
 */
export async function extractCommentRaw(
  mp4Path: string,
  ctx: FfmpegContext,
): Promise<string | null> {
  const args = [
    "-v",
    "error",
    "-show_format",
    "-of",
    "json",
    mp4Path,
  ];
  const stdout = await runFfprobe(ctx, args);
  let parsed: { format?: { tags?: Record<string, string> } };
  try {
    parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
  } catch {
    return null;
  }
  const tags = parsed.format?.tags ?? {};
  return tags.comment ?? tags.COMMENT ?? null;
}

function isVideoWorkflow(value: unknown): value is VideoWorkflowMetadata {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "video" &&
    typeof v.modelId === "string" &&
    typeof v.prompt === "string" &&
    typeof v.durationSeconds === "number" &&
    typeof v.fps === "number" &&
    (v.mode === "text2video" || v.mode === "image2video")
  );
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {});
  }
  return value;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function runFfmpeg(ctx: FfmpegContext, args: readonly string[]): Promise<RunResult> {
  const result = await runCommand(ctx.ffmpegPath, args, ctx.spawnFn ?? spawn);
  if (result.code !== 0) {
    throw new Error(`ffmpeg failed (${result.code}): ${result.stderr}`);
  }
  return result;
}

async function runFfprobe(ctx: FfmpegContext, args: readonly string[]): Promise<string> {
  const result = await runCommand(ctx.ffprobePath, args, ctx.spawnFn ?? spawn);
  if (result.code !== 0) {
    throw new Error(`ffprobe failed (${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}

function runCommand(
  command: string,
  args: readonly string[],
  spawnFn: typeof spawn,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawnFn(command, args as string[], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        code: code ?? -1,
      });
    });
  });
}
