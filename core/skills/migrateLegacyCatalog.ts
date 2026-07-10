/**
 * v1.10.0 Phase 4 (T023/T024) -- one-shot cleanup of the legacy DevAI-Hub
 * catalog cache.
 *
 * Pre-v1.10.0 installs kept the Hub catalog at `~/.nexus/skills/devai-hub/<tag>/`.
 * v1.10.0 moved it to the isolated subtree `~/.nexus-ai/catalog/` (repopulated by
 * a fresh `NexusHubSyncer` fetch). Because the old location is a pure cache, no
 * content move is needed -- this migration only removes the stale cache.
 *
 * SAFETY: the only paths this may remove are `<nexusHome>/skills/devai-hub/` and
 * (if it becomes empty) `<nexusHome>/skills/`. It is guarded against an empty or
 * filesystem-root home, one-way, and idempotent (a second run is a no-op).
 * Nothing else under `~/.nexus/` (settings.json, mcp.json, models/,
 * session-artifacts/, credentials, skills/user, skills/proposed) is ever touched.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface LegacyCatalogCleanupResult {
  /** `true` when the legacy `devai-hub` cache was removed this run. */
  readonly removedLegacyCatalog: boolean;
  /** `true` when `<nexusHome>/skills` was also removed (it was empty afterward). */
  readonly removedEmptySkillsRoot: boolean;
  readonly reason: string;
}

/**
 * Refuse an empty or filesystem-root `nexusHome` so a misconfigured call can
 * never escalate into deleting the home directory or a drive root. The removal
 * target is always derived as `<nexusHome>/skills/devai-hub`, so a sane home
 * keeps the target at least three levels deep.
 */
function assertSafeNexusHome(nexusHome: string): void {
  if (!nexusHome || nexusHome.trim() === "") {
    throw new Error("migrateLegacyCatalog: nexusHome must not be empty");
  }
  const resolved = path.resolve(nexusHome);
  if (resolved === path.parse(resolved).root || path.dirname(resolved) === resolved) {
    throw new Error(
      `migrateLegacyCatalog: refusing to operate on a filesystem root: ${resolved}`,
    );
  }
}

/**
 * Remove the legacy `~/.nexus/skills/devai-hub/` catalog cache, and the
 * `~/.nexus/skills/` directory if it becomes empty. `nexusHome` is the `~/.nexus`
 * root (NOT `~/.nexus-ai`). Best-effort and idempotent: a missing legacy cache
 * is a no-op, not an error.
 */
export function migrateLegacyCatalogCleanup(nexusHome: string): LegacyCatalogCleanupResult {
  assertSafeNexusHome(nexusHome);
  const skillsRoot = path.join(nexusHome, "skills");
  const legacyCatalog = path.join(skillsRoot, "devai-hub");

  if (!fs.existsSync(legacyCatalog)) {
    return {
      removedLegacyCatalog: false,
      removedEmptySkillsRoot: false,
      reason: "no legacy devai-hub cache",
    };
  }

  fs.rmSync(legacyCatalog, { recursive: true, force: true });

  let removedEmptySkillsRoot = false;
  try {
    if (fs.existsSync(skillsRoot) && fs.readdirSync(skillsRoot).length === 0) {
      fs.rmdirSync(skillsRoot);
      removedEmptySkillsRoot = true;
    }
  } catch {
    // Leave the skills root in place if it is non-empty or not removable.
  }

  return {
    removedLegacyCatalog: true,
    removedEmptySkillsRoot,
    reason: "removed legacy devai-hub cache",
  };
}
