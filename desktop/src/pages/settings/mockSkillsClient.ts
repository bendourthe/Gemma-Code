/**
 * v1.0.0 Phase 10.4 -- mock SkillsSettings client.
 *
 * Used by the Settings page in dev/test until the real IPC client lands.
 * Persists state in-memory only (no disk roundtrip) so callers see the
 * effect of toggling auto-sync / approving quarantined skills immediately.
 */

import type { SkillsSettingsClient, SkillRowDto } from "./SkillsSettings";

const SAMPLE: SkillRowDto[] = [
  {
    id: "writing-editing",
    displayName: "Writing and Editing",
    category: "developer-experience",
    path: "/builtin/writing-editing/SKILL.md",
    active: true,
    provenance: { source: "builtin", contentHash: "b".repeat(64) },
  },
  {
    id: "devai-hub/code-quality",
    displayName: "Code Quality",
    category: "code-review",
    path: "/devai-hub/v1.3.2/code-quality/SKILL.md",
    active: true,
    provenance: { source: "devai-hub", tag: "v1.3.2", contentHash: "d".repeat(64) },
  },
  {
    id: "user/code-quality",
    displayName: "Code Quality",
    category: "code-review",
    path: "/user/code-quality/SKILL.md",
    active: false,
    diverged: true,
    provenance: { source: "user", contentHash: "u".repeat(64) },
  },
];

// The devai-hub copy also diverges; reflect that on its row.
SAMPLE[1]!.diverged = true;

export function createMockSkillsClient(): SkillsSettingsClient {
  let items = [...SAMPLE];
  let activeTag: string | null = "v1.3.2";
  let upstreamTag: string | null = "v1.4.0";
  let autoSync = false;

  return {
    list: async () => items,
    activeTag: async () => activeTag,
    upstreamLatestTag: async () => upstreamTag,
    autoSyncEnabled: async () => autoSync,
    setAutoSyncEnabled: async (enabled: boolean) => {
      autoSync = enabled;
    },
    syncNow: async () => {
      activeTag = upstreamTag ?? activeTag;
      return { tag: activeTag ?? "?", applied: true, summary: "+0 new, ~0 modified, -0 removed" };
    },
    approveQuarantined: async (id: string) => {
      items = items.map((it) => (it.id === id ? { ...it, quarantine: undefined } : it));
    },
    setActive: async (id: string, active: boolean) => {
      items = items.map((it) => (it.id === id ? { ...it, active } : it));
    },
    setDivergedPreference: async () => {
      // no-op in the mock; real client would write a config flag
    },
  };
}
