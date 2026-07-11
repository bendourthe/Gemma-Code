/**
 * v1.10.0 Phase 6 (T033) -- production Skills client over the sidecar `skills.*`
 * IPC. Backs the update-detection surface: installed catalog version
 * (`skills.status`), the latest upstream release (`skills.upstreamLatest`), and
 * a one-click resync (`skills.sync`, which runs `NexusHubSyncer.sync`).
 *
 * Full skill listing + management (enable/disable, quarantine approval,
 * divergence preference) is a separate SkillCatalog IPC surface not wired in
 * this plan (NHC.P6.B), so `list()` is empty and the mutation methods reject.
 * The weekly auto-sync toggle is likewise not yet wired to a settings IPC
 * (NHC.P6.C); it reports disabled.
 */

import { ipcCall } from "../../lib/ipc";
import type { SkillsSettingsClient, SkillRowDto } from "./SkillsSettings";

interface SkillsStatusDto {
  installedVersion: string | null;
  catalogPresent: boolean;
  sourceRepo: string;
}
interface SkillsUpstreamDto {
  latestTag: string | null;
}
interface SkillsSyncDto {
  tag: string;
  applied: boolean;
  alreadyUpToDate: boolean;
  blocked: boolean;
  summary: string;
}

const NOT_WIRED =
  "Skill management is not available in this build (the catalog is read-only here).";

export function createIpcSkillsClient(): SkillsSettingsClient {
  return {
    async list(): Promise<readonly SkillRowDto[]> {
      // Read-only update-detection surface; full catalog listing is deferred.
      return [];
    },
    async activeTag(): Promise<string | null> {
      const reply = await ipcCall<SkillsStatusDto>("skills.status", {});
      return reply.ok ? reply.value.installedVersion : null;
    },
    async upstreamLatestTag(): Promise<string | null> {
      const reply = await ipcCall<SkillsUpstreamDto>("skills.upstreamLatest", {});
      return reply.ok ? reply.value.latestTag : null;
    },
    async autoSyncEnabled(): Promise<boolean> {
      // Not wired to a settings IPC yet, and the weekly idle worker is not live.
      return false;
    },
    async setAutoSyncEnabled(): Promise<void> {
      // No-op until the settings IPC + live idle-scheduler wiring land.
    },
    async syncNow(): Promise<{ tag: string; applied: boolean; summary: string }> {
      const reply = await ipcCall<SkillsSyncDto>("skills.sync", {});
      if (!reply.ok) throw new Error(reply.message);
      const { tag, applied, alreadyUpToDate, blocked, summary } = reply.value;
      if (blocked) {
        throw new Error(`Sync blocked by the injection scanner: ${summary}`);
      }
      return { tag, applied, summary: alreadyUpToDate ? "already up to date" : summary };
    },
    async approveQuarantined(): Promise<void> {
      throw new Error(NOT_WIRED);
    },
    async setActive(): Promise<void> {
      throw new Error(NOT_WIRED);
    },
  };
}
