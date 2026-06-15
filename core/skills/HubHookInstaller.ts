/**
 * v1.5.0 Phase 7 (HUB.P3.HOOK) -- consume the Nexus-Hub hook scripts.
 *
 * The Hub ships hook scripts under `catalog/hooks/` (diff-review, formatters,
 * guards, session-capture; `.sh` / `.ps1` / `.py`). They are now sparse-cloned
 * by the skills syncer (HUB.P3.HOOK). This installer lists them from a synced
 * bundle and copies a chosen hook into a target directory, marking shell hooks
 * executable. Installation is always an explicit caller action -- nothing is
 * installed automatically.
 *
 * Pure + offline: reads the bundle's hooks dir and writes only into the
 * caller-provided target dir.
 */

import * as fs from "fs";
import * as path from "path";

export type HookPlatform = "sh" | "ps1" | "py" | "other";

export interface HubHookEntry {
  /** File name including extension (e.g. `git-guardrails.sh`). */
  readonly file: string;
  /** Hook name without extension (e.g. `git-guardrails`). */
  readonly name: string;
  readonly platform: HookPlatform;
}

function classify(file: string): HookPlatform {
  if (file.endsWith(".sh")) return "sh";
  if (file.endsWith(".ps1")) return "ps1";
  if (file.endsWith(".py")) return "py";
  return "other";
}

/**
 * Lists and installs Hub hook scripts from a synced bundle's `catalog/hooks/`
 * directory. Inert (empty list, no-op install) when the directory is null or
 * absent.
 */
export class HubHookInstaller {
  constructor(private readonly _hooksDir: string | null) {}

  /** List the available hook scripts (sorted by file name). */
  list(): HubHookEntry[] {
    if (!this._hooksDir) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this._hooksDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: HubHookEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (![".sh", ".ps1", ".py"].includes(ext)) continue;
      out.push({
        file: entry.name,
        name: entry.name.slice(0, -ext.length),
        platform: classify(entry.name),
      });
    }
    out.sort((a, b) => a.file.localeCompare(b.file));
    return out;
  }

  /**
   * Install the hook whose file name is `file` into `targetDir`, creating the
   * directory if needed. Shell hooks (`.sh`) are marked executable. Returns the
   * written path, or `null` when the source hook does not exist.
   */
  install(file: string, targetDir: string): string | null {
    if (!this._hooksDir) return null;
    // Guard against path traversal: only a bare file name is accepted.
    if (file !== path.basename(file)) return null;
    const src = path.join(this._hooksDir, file);
    if (!fs.existsSync(src)) return null;
    fs.mkdirSync(targetDir, { recursive: true });
    const dest = path.join(targetDir, file);
    fs.copyFileSync(src, dest);
    if (file.endsWith(".sh")) {
      try {
        fs.chmodSync(dest, 0o755);
      } catch {
        // chmod is best-effort (no-op / unsupported on some filesystems).
      }
    }
    return dest;
  }
}
