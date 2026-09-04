/**
 * v2.4.6 Phase 4 -- filesystem half of InstalledProbe for the VS Code host.
 *
 * Mirrors the sidecar weights scan so the extension can intersect the owned
 * agentic allowlist with on-disk presence without importing `desktop/`.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { InstalledProbe } from "./installedProbe.js";
import { nexusHome } from "../storage/paths.js";

export const MODEL_ID_MARKER = ".nexus-model-id";

export function modelsRoot(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), "models");
}

export async function scanWeightsIds(root: string): Promise<Set<string>> {
  const weightsDir = path.join(root, "weights");
  try {
    const entries = await fs.readdir(weightsDir, { withFileTypes: true });
    return new Set(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    );
  } catch {
    return new Set();
  }
}

export async function scanWeightsMarkerIds(root: string): Promise<Set<string>> {
  const weightsDir = path.join(root, "weights");
  const ids = new Set<string>();
  let dirNames: string[];
  try {
    const entries = await fs.readdir(weightsDir, { withFileTypes: true });
    dirNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return ids;
  }
  await Promise.all(
    dirNames.map(async (dirName) => {
      try {
        const raw = await fs.readFile(
          path.join(weightsDir, dirName, MODEL_ID_MARKER),
          "utf8",
        );
        const id = raw.trim();
        if (id) ids.add(id);
      } catch {
        // Pre-v2.2.0 dirs have no marker; directory-name matching covers them.
      }
    }),
  );
  return ids;
}

export async function collectWeightsProbe(
  root: string,
  ollamaTags: ReadonlySet<string> = new Set(),
): Promise<InstalledProbe> {
  const [weightsIds, weightsMarkerIds] = await Promise.all([
    scanWeightsIds(root),
    scanWeightsMarkerIds(root),
  ]);
  return { ollamaTags, weightsIds, weightsMarkerIds };
}
