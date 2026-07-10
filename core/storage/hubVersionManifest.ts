/**
 * v1.10.0 -- Nexus-Hub catalog version manifest I/O.
 *
 * `nexus-hub-version.json` is the update-detection contract for the standardized
 * catalog subtree (`~/.nexus-ai/catalog/`). It records the installed catalog
 * `version`, the source repo + release URLs used to poll for updates, and the
 * `layout` map that every reader resolves subdir names from.
 *
 * The serialized form is deterministic -- stable key order, no timestamps, no
 * absolute paths -- so re-fetching the same release yields a byte-identical
 * file.
 *
 * This module performs filesystem I/O; the pure path helpers (root + layout
 * resolution) live in `core/storage/paths.ts`.
 */

import * as fs from "node:fs";
import { HUB_LAYOUT, hubVersionManifestPath, type HubLayout } from "./paths.js";

export const HUB_PRODUCT = "Nexus-Hub";
export const DEFAULT_HUB_SOURCE_REPO = "bendourthe/Nexus-Hub";

export interface HubVersionManifest {
  product: string;
  version: string;
  source_repo: string;
  releases_url: string;
  latest_release_api: string;
  layout: HubLayout;
}

function releasesUrl(repo: string): string {
  return `https://github.com/${repo}/releases`;
}

function latestReleaseApi(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

/**
 * Build the manifest object in canonical key order. Pure; used by both the
 * writer and by tests asserting determinism.
 */
export function buildHubVersionManifest(opts: {
  version: string;
  sourceRepo?: string;
}): HubVersionManifest {
  const repo = opts.sourceRepo ?? DEFAULT_HUB_SOURCE_REPO;
  return {
    product: HUB_PRODUCT,
    version: opts.version,
    source_repo: repo,
    releases_url: releasesUrl(repo),
    latest_release_api: latestReleaseApi(repo),
    layout: { ...HUB_LAYOUT },
  };
}

/**
 * Deterministic serialization: 2-space indent, canonical key order (from the
 * object built above), trailing newline. No timestamps or absolute paths.
 */
export function serializeHubVersionManifest(manifest: HubVersionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Read + normalize the manifest at `catalogRootDir`. Returns `null` when the
 * file is missing or unparseable (the offline / not-yet-synced state) or when
 * it lacks a string `version`. A partial `layout` is merged over `HUB_LAYOUT`
 * so an older or pre-coordination manifest still resolves every key.
 */
export function readHubVersionManifest(
  catalogRootDir: string,
): HubVersionManifest | null {
  let raw: string;
  try {
    raw = fs.readFileSync(hubVersionManifestPath(catalogRootDir), "utf8");
  } catch {
    return null;
  }

  let parsed: Partial<HubVersionManifest>;
  try {
    parsed = JSON.parse(raw) as Partial<HubVersionManifest>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed.version !== "string") {
    return null;
  }

  const repo =
    typeof parsed.source_repo === "string" ? parsed.source_repo : DEFAULT_HUB_SOURCE_REPO;
  return {
    product: typeof parsed.product === "string" ? parsed.product : HUB_PRODUCT,
    version: parsed.version,
    source_repo: repo,
    releases_url:
      typeof parsed.releases_url === "string" ? parsed.releases_url : releasesUrl(repo),
    latest_release_api:
      typeof parsed.latest_release_api === "string"
        ? parsed.latest_release_api
        : latestReleaseApi(repo),
    layout: { ...HUB_LAYOUT, ...(parsed.layout ?? {}) },
  };
}

/**
 * Write the manifest to `catalogRootDir` (creating the directory if needed) and
 * return the object written. Output is deterministic, so repeated writes of the
 * same version are byte-identical.
 */
export function writeHubVersionManifest(
  catalogRootDir: string,
  opts: { version: string; sourceRepo?: string },
): HubVersionManifest {
  const manifest = buildHubVersionManifest(opts);
  fs.mkdirSync(catalogRootDir, { recursive: true });
  fs.writeFileSync(
    hubVersionManifestPath(catalogRootDir),
    serializeHubVersionManifest(manifest),
    "utf8",
  );
  return manifest;
}

/**
 * Resolve the effective catalog layout at `catalogRootDir`: the manifest's
 * `layout` when a valid manifest is present, else `HUB_LAYOUT`. Read sites use
 * this to resolve subdir names without hardcoding them.
 */
export function resolveHubLayout(catalogRootDir: string): HubLayout {
  return readHubVersionManifest(catalogRootDir)?.layout ?? { ...HUB_LAYOUT };
}
