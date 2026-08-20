/**
 * Sample still frames from a chat video attachment via ffmpeg.
 * Bytes stay on this host; the caller receives JPEG data URLs.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { FfmpegContext } from "../video/WorkflowMetadata.js";

export interface SampledVideoFrames {
  readonly frames: string[];
  readonly notice?: string;
}

export interface SampleVideoFramesOptions {
  readonly maxFrames?: number;
  readonly fps?: number;
}

function decodeDataUrl(dataUrl: string): { bytes: Buffer; ext: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match || !match[1] || !match[2]) return null;
  const mime = match[1].toLowerCase();
  const ext = mime.includes("webm")
    ? "webm"
    : mime.includes("mp4")
      ? "mp4"
      : mime.includes("quicktime")
        ? "mov"
        : "bin";
  try {
    return { bytes: Buffer.from(match[2], "base64"), ext };
  } catch {
    return null;
  }
}

async function runFfmpeg(
  ctx: FfmpegContext,
  args: readonly string[],
): Promise<{ code: number; stderr: string }> {
  const spawnFn = ctx.spawnFn ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnFn(ctx.ffmpegPath, [...args], { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/**
 * Decode a `data:` video URL, sample up to `maxFrames` JPEGs, return data URLs.
 * Missing ffmpeg or a failed spawn returns an empty list plus a notice.
 */
export async function sampleVideoFramesFromDataUrl(
  dataUrl: string,
  ctx: FfmpegContext,
  opts: SampleVideoFramesOptions = {},
): Promise<SampledVideoFrames> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) {
    return { frames: [], notice: "Video was not sent: the clip is not a usable data URL." };
  }
  const maxFrames = Math.min(24, Math.max(1, opts.maxFrames ?? 8));
  const fps = opts.fps ?? 1;
  const root = await mkdtemp(path.join(os.tmpdir(), "nexus-vf-"));
  const inputPath = path.join(root, `clip.${decoded.ext}`);
  const pattern = path.join(root, "frame_%03d.jpg");
  try {
    await writeFile(inputPath, decoded.bytes);
    const result = await runFfmpeg(ctx, [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `fps=${fps}`,
      "-frames:v",
      String(maxFrames),
      pattern,
    ]);
    if (result.code !== 0) {
      return {
        frames: [],
        notice: "Video was not sent: frame sampling failed. Attach a still image instead.",
      };
    }
    const names = (await readdir(root))
      .filter((name) => /^frame_\d+\.jpg$/i.test(name))
      .sort();
    const frames: string[] = [];
    for (const name of names) {
      const bytes = await readFile(path.join(root, name));
      frames.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
    }
    if (frames.length === 0) {
      return {
        frames: [],
        notice: "Video was not sent: no frames could be sampled. Attach a still image instead.",
      };
    }
    return { frames };
  } catch {
    return {
      frames: [],
      notice: "Video was not sent: ffmpeg is unavailable. Attach a still image instead.",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
