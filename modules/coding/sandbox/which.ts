/**
 * Locate helper binaries without spawning (fast capability probes).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export function findOnPath(names: readonly string[]): string | null {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const name of names) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        try {
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
          // keep looking
        }
      }
    }
  }
  return null;
}

export function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
