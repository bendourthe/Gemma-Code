/**
 * v2.0.0 Phase 4.2 -- project-keyed durable exec root.
 *
 * Installed tooling survives sessions for one project id. Contents are
 * untrusted, excluded from memory indexing, and resettable in one call.
 * This is the sandbox directory contract; process confinement stays in
 * `modules/coding/sandbox/`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export const SANDBOX_MARKER = "NEXUS_UNTRUSTED_SANDBOX";

export function sandboxRootFor(projectId: string, nexusHome: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(nexusHome, "project-sandboxes", safe);
}

export function isSandboxPath(target: string, nexusHome: string): boolean {
  const root = path.resolve(path.join(nexusHome, "project-sandboxes"));
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export async function ensureSandbox(projectId: string, nexusHome: string): Promise<string> {
  const root = sandboxRootFor(projectId, nexusHome);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, SANDBOX_MARKER), "untrusted\n", "utf8");
  return root;
}

export async function resetSandbox(projectId: string, nexusHome: string): Promise<void> {
  const root = sandboxRootFor(projectId, nexusHome);
  await fs.rm(root, { recursive: true, force: true });
  await ensureSandbox(projectId, nexusHome);
}

export async function createSandboxSeam(
  projectId: string,
  nexusHome: string,
): Promise<{ readonly projectId: string; readonly root: string; reset(): Promise<void> }> {
  const root = await ensureSandbox(projectId, nexusHome);
  return {
    projectId,
    root,
    reset: async () => {
      await resetSandbox(projectId, nexusHome);
    },
  };
}
