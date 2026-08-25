/**
 * v2.1.0 Phase 3 -- on-disk paths for the generation index and job queue.
 */

import * as path from "node:path";
import { nexusHome } from "../storage/paths.js";

export const GENERATIONS_DIRNAME = "generations";
export const STUDIO_DB_FILENAME = "studio.db";
/** v2.2.6 -- named Image/Video sessions; not the generation index. */
export const SESSIONS_DB_FILENAME = "sessions.db";

export function resolveStudioDbPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), GENERATIONS_DIRNAME, STUDIO_DB_FILENAME);
}

export function resolveSessionsDbPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), GENERATIONS_DIRNAME, SESSIONS_DB_FILENAME);
}
