import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { sampleVideoFramesFromDataUrl } from "../../../../core/chat/sampleVideoFrames.js";

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQA//Z",
  "base64",
);

function spawnWritesFrame(args: string[]) {
  const out = args[args.length - 1] ?? "";
  const dir = path.dirname(out);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "frame_001.jpg"), TINY_JPEG);
  const child = new EventEmitter() as EventEmitter & {
    stderr: { on: (ev: string, cb: (c: Buffer) => void) => void };
  };
  child.stderr = { on: () => undefined };
  queueMicrotask(() => child.emit("close", 0));
  return child;
}

describe("sampleVideoFramesFromDataUrl", () => {
  it("returns JPEG data URLs from a spawn that writes a frame", async () => {
    const dataUrl = `data:video/mp4;base64,${Buffer.from("fake").toString("base64")}`;
    const result = await sampleVideoFramesFromDataUrl(dataUrl, {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      spawnFn: ((_: string, args: readonly string[]) =>
        spawnWritesFrame([...args])) as unknown as typeof import("node:child_process").spawn,
    });
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(result.notice).toBeUndefined();
  });

  it("returns a notice when the data URL is not usable", async () => {
    const result = await sampleVideoFramesFromDataUrl("not-a-data-url", {
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
    });
    expect(result.frames).toHaveLength(0);
    expect(result.notice).toMatch(/data URL/i);
  });
});
