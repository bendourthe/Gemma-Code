import * as fs from "fs";
import { getLogger } from "../utils/logger.js";
import { formatForLog } from "../utils/errors.js";

/**
 * Set POSIX mode 0600 on the SQLite database file so other users on the same
 * host cannot read it. No-op on Windows: permissions there are ACL-based and
 * are documented in SECURITY.md rather than enforced from Node.
 *
 * Known callers (each opens its own SQLite file and invokes this helper):
 *   - chat-history.db        (ChatHistoryStore, global storage)
 *   - memory.db              (MemoryStore, global storage)
 *   - traces.sqlite          (TraceStore, global storage)
 *   - graph.sqlite           (GraphMemory, global storage)
 *   - tool-output-cache.sqlite (ToolOutputCache, workspace .nexus/)
 */
export function secureDbPermissions(dbPath: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch (err) {
    // Non-fatal: log at debug and continue. Missing the chmod does not prevent
    // SQLite from opening the DB; it only weakens the file permission posture.
    getLogger().debug(
      `[dbPermissions] chmod 0600 failed for "${dbPath}":`,
      formatForLog(err),
    );
  }
}
