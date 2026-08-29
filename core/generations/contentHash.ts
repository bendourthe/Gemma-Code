import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function contentHash(bytes: Buffer | Uint8Array | string): string {
  const buf =
    typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return createHash("sha256").update(buf).digest("hex");
}

export interface ContentHashFileOptions {
  readonly signal?: AbortSignal;
  readonly highWaterMark?: number;
}

/** Hash a file incrementally without retaining its media bytes in memory. */
export async function contentHashFile(
  filePath: string,
  opts: ContentHashFileOptions = {},
): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, {
    highWaterMark: opts.highWaterMark ?? 1024 * 1024,
    signal: opts.signal,
  });
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
