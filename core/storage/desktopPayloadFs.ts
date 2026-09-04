/**
 * v2.4.6 Phase 1 / Phase 8 -- Node-only desktop payload identity reader.
 *
 * Filesystem I/O stays out of `desktopPayload.ts` so the Vite renderer can
 * import `formatDesktopPayloadLabel` without pulling `node:fs`.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import {
  DESKTOP_PAYLOAD_FILENAME,
  parseDesktopPayloadIdentity,
  type DesktopPayloadIdentity,
} from "./desktopPayload.js";
import { nexusHome } from "./paths.js";

export function desktopPayloadPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), DESKTOP_PAYLOAD_FILENAME);
}

/** Tolerant read: null when the file is absent, unreadable, or malformed. */
export function readDesktopPayloadIdentity(
  filePath: string = desktopPayloadPath(),
): DesktopPayloadIdentity | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return parseDesktopPayloadIdentity(parsed);
  } catch {
    return null;
  }
}
