import * as path from "node:path";

import { nexusHome } from "../../../core/storage/paths.js";

const PROFILE_DIRNAME = "browser-profiles";

const DEFAULT_PROFILE_MARKERS: readonly string[] = [
  "/google/chrome",
  "/google-chrome",
  "/microsoft/edge",
  "/chromium/user data",
  "/chromium/default",
  "/bravesoftware/brave-browser",
  "\\google\\chrome",
  "\\microsoft\\edge",
  "\\chromium\\user data",
];

/**
 * Dedicated Playwright user-data directory under `~/.nexus/browser-profiles/`.
 * Never the user's default Chrome/Edge profile (session-cookie exfiltration).
 */
export function resolveIsolatedProfileDir(
  sessionId = "default",
  homeDirFn?: () => string,
): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64) || "default";
  return path.join(nexusHome(homeDirFn), PROFILE_DIRNAME, safeId);
}

export function isDefaultBrowserProfilePath(dir: string): boolean {
  const normalized = dir.replace(/\\/g, "/").toLowerCase();
  return DEFAULT_PROFILE_MARKERS.some((marker) =>
    normalized.includes(marker.replace(/\\/g, "/")),
  );
}

/**
 * Refuse a profile path that is the user's default browser profile or that
 * escapes `~/.nexus/browser-profiles/`.
 */
export function assertIsolatedProfileDir(dir: string, homeDirFn?: () => string): string {
  const resolved = path.resolve(dir);
  if (isDefaultBrowserProfilePath(resolved)) {
    throw new Error(
      "Refusing to launch against a default browser profile (session-cookie exfiltration risk). " +
        "Nexus uses ~/.nexus/browser-profiles/<id>/ only.",
    );
  }
  const root = path.resolve(path.join(nexusHome(homeDirFn), PROFILE_DIRNAME));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Browser profile must live under ${root}. Refusing "${resolved}".`,
    );
  }
  return resolved;
}
