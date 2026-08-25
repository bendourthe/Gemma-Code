/**
 * v1.10.0 Phase 6 (T033) -- production Skills client over the sidecar `skills.*`
 * IPC. Backs the update-detection surface: installed catalog version
 * (`skills.status`), the latest upstream release (`skills.upstreamLatest`), and
 * a one-click resync (`skills.sync`, which runs `NexusHubSyncer.sync`).
 *
 * v2.2.0 Phase 3 (3.2) closes NHC.P6.B and NHC.P6.C: `list()` now reads the
 * installed catalog through `skills.list`, and the weekly auto-sync toggle is
 * backed by a persisted setting (`skills.autoSync.*`) that `codingBootstrap`
 * already honors when registering the idle worker.
 *
 * Enable/disable and quarantine approval remain unimplemented server-side, so
 * they still reject with a clear message rather than shipping dead buttons -
 * the UI hides those affordances.
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
interface SkillsListDto {
  skills: SkillRowDto[];
  error: string | null;
}
interface SkillsSyncDto {
  tag: string;
  applied: boolean;
  alreadyUpToDate: boolean;
  blocked: boolean;
  summary: string;
  quarantinedCount?: number;
}

const NOT_WIRED =
  "Skill management is not available in this build (the catalog is read-only here).";

export function createIpcSkillsClient(): SkillsSettingsClient {
  return {
    async list(): Promise<readonly SkillRowDto[]> {
      const reply = await ipcCall<SkillsListDto>("skills.list", {});
      if (!reply.ok) throw new Error(reply.message);
      if (reply.value.error) {
        // The catalog exists but could not be parsed: surface it rather than
        // rendering an empty page that implies nothing is installed.
        throw new Error(`catalog unreadable: ${reply.value.error}`);
      }
      return reply.value.skills;
    },
    async activeTag(): Promise<string | null> {
      const reply = await ipcCall<SkillsStatusDto>("skills.status", {});
      // v2.2.0 Phase 2 (2.2): do NOT swallow the IPC error. Returning null on
      // failure made a dead backend indistinguishable from an unsynced
      // catalog, so the page told the user to press "Sync now" -- which could
      // never work, because the very same backend performs the sync. Null now
      // means only "the backend answered and no catalog version is installed".
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.installedVersion;
    },
    async upstreamLatestTag(): Promise<string | null> {
      const reply = await ipcCall<SkillsUpstreamDto>("skills.upstreamLatest", {});
      // Upstream lookup is best-effort by design (offline / rate-limited hosts
      // report "unknown"), so this one stays non-throwing.
      return reply.ok ? reply.value.latestTag : null;
    },
    async autoSyncEnabled(): Promise<boolean> {
      const reply = await ipcCall<{ enabled: boolean }>("skills.autoSync.get", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value.enabled;
    },
    async setAutoSyncEnabled(enabled: boolean): Promise<void> {
      const reply = await ipcCall<{ enabled: boolean }>("skills.autoSync.set", { enabled });
      if (!reply.ok) throw new Error(reply.message);
    },
    async syncNow(): Promise<{ tag: string; applied: boolean; summary: string }> {
      const reply = await ipcCall<SkillsSyncDto>("skills.sync", {});
      if (!reply.ok) throw new Error(reply.message);
      const { tag, applied, alreadyUpToDate, blocked, summary, quarantinedCount } = reply.value;
      // "Sync blocked" is only for fail-closed cases (apply did not happen).
      // A partial quarantine that still advanced Active is success copy.
      if (blocked && !applied) {
        throw new Error(`Sync blocked by the injection scanner: ${summary}`);
      }
      if (alreadyUpToDate) {
        return { tag, applied, summary: "already up to date" };
      }
      const withQuarantine =
        quarantinedCount && quarantinedCount > 0 && !/quarantined/i.test(summary)
          ? `${summary}; quarantined ${quarantinedCount}`
          : summary;
      return { tag, applied, summary: withQuarantine };
    },
    async approveQuarantined(): Promise<void> {
      throw new Error(NOT_WIRED);
    },
    async setActive(): Promise<void> {
      throw new Error(NOT_WIRED);
    },
  };
}
