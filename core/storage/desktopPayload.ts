/**
 * v2.4.6 Phase 1 -- installer-written desktop payload identity.
 *
 * The wizard writes `~/.nexus/desktop-payload.json` after it installs the
 * embedded Tauri NSIS bundle. Settings shows the same version + short hash
 * so an operator can tell the running app matches the installer they just
 * ran. A missing or unreadable file is "unknown", never a guessed 2.4.1.
 *
 * This module performs filesystem I/O; the home path helper is `nexusHome()`.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { nexusHome } from "./paths.js";

export const DESKTOP_PAYLOAD_FILENAME = "desktop-payload.json";

export interface DesktopPayloadIdentity {
  version: string;
  sha256: string;
  originalName?: string;
}

export function desktopPayloadPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), DESKTOP_PAYLOAD_FILENAME);
}

export function formatDesktopPayloadLabel(
  identity: DesktopPayloadIdentity | null,
): string {
  if (!identity?.version || !identity.sha256) {
    return "Desktop payload unknown";
  }
  return `Desktop payload ${identity.version} (${identity.sha256.slice(0, 12).toLowerCase()})`;
}

export function parseDesktopPayloadIdentity(
  raw: unknown,
): DesktopPayloadIdentity | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const version = typeof record.version === "string" ? record.version.trim() : "";
  const sha256 = typeof record.sha256 === "string" ? record.sha256.trim() : "";
  if (!version || !sha256) return null;
  const originalName =
    typeof record.original_name === "string"
      ? record.original_name
      : typeof record.originalName === "string"
        ? record.originalName
        : undefined;
  return { version, sha256: sha256.toLowerCase(), originalName };
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
