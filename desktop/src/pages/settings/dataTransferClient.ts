/**
 * v2.2.0 Phase 8 (DF-16) -- IPC adapter for Settings > Data.
 *
 * Phase 7 shipped the transfer runtime and the page, but nothing connected
 * them, so the page could only ever report the backend as unreachable. This is
 * that connection.
 */

import { ipcCall } from "../../lib/ipc";
import { tauriAvailable } from "../../modules/chat/ipcChatExplorerClient";

import type { DataSettingsClient, TransferCategoryDto } from "./DataSettings";

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const reply = await ipcCall<T>(method as never, params);
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

/**
 * Where an export lands when the user does not name somewhere else.
 *
 * The name carries a timestamp because the common case is exporting more than
 * once, and silently overwriting the previous archive would destroy a backup
 * the user may still need.
 */
export function defaultExportPath(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `nexus-export-${stamp}.tar.gz`;
}

/** Null outside the desktop shell: the browser dev server has no sidecar. */
export function createDataTransferClient(): DataSettingsClient | null {
  if (!tauriAvailable()) return null;

  return {
    categories: async (): Promise<readonly TransferCategoryDto[]> => {
      const res = await call<{ categories: TransferCategoryDto[] }>("data.categories");
      return res.categories;
    },
    export: (input) =>
      call<{ path: string; bytes: number; empty: readonly string[] }>("data.export", {
        categories: input.categories,
        outPath: input.outPath ?? defaultExportPath(),
        // Passed explicitly, never left to a default: this flag decides
        // whether API tokens end up in a file that gets emailed and forgotten.
        includeCredentials: input.includeCredentials,
      }),
    importDryRun: (archivePath) =>
      call<{ applied: readonly string[]; skipped: readonly string[] }>("data.import", {
        archivePath,
        dryRun: true,
      }),
    importApply: (archivePath) =>
      call<{ applied: readonly string[]; backupPath: string | null }>("data.import", {
        archivePath,
        dryRun: false,
      }),
  };
}
