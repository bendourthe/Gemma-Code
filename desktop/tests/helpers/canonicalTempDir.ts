import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Create a unique temp directory and return its realpath.
 * GitHub Windows runners often expose TMP as an 8.3 path (RUNNER~1);
 * macOS tmpdir is typically /var/folders, a prefix alias of /private/var.
 * Video enhancement intake treats the realpath as identity.
 */
export async function canonicalMkDtemp(prefix: string): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}
