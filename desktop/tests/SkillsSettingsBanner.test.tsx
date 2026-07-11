/**
 * v1.10.0 Phase 6 (T036) -- SkillsSettings update-detection banner tests.
 *
 * Drives the component with a fake client and asserts the "not yet synced"
 * empty state and the "update available" banner render on the right states.
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import {
  SkillsSettings,
  type SkillsSettingsClient,
} from "../src/pages/settings/SkillsSettings";

function client(overrides: Partial<SkillsSettingsClient>): SkillsSettingsClient {
  return {
    list: async () => [],
    activeTag: async () => null,
    upstreamLatestTag: async () => null,
    autoSyncEnabled: async () => false,
    setAutoSyncEnabled: async () => {},
    syncNow: async () => ({ tag: "v1", applied: true, summary: "" }),
    approveQuarantined: async () => {},
    setActive: async () => {},
    ...overrides,
  };
}

describe("SkillsSettings update detection", () => {
  it("shows the not-synced banner when no catalog is installed", async () => {
    render(<SkillsSettings client={client({ activeTag: async () => null })} />);
    expect(await screen.findByTestId("skills-not-synced")).toBeTruthy();
    expect(screen.queryByTestId("skills-update-available")).toBeNull();
  });

  it("shows the update-available banner when upstream is newer", async () => {
    render(
      <SkillsSettings
        client={client({
          activeTag: async () => "v1.0.0",
          upstreamLatestTag: async () => "v2.0.0",
        })}
      />,
    );
    expect(await screen.findByTestId("skills-update-available")).toBeTruthy();
    expect(screen.queryByTestId("skills-not-synced")).toBeNull();
  });

  it("shows neither banner when the catalog is up to date", async () => {
    render(
      <SkillsSettings
        client={client({
          activeTag: async () => "v2.0.0",
          upstreamLatestTag: async () => "v2.0.0",
        })}
      />,
    );
    await screen.findByTestId("settings-skills");
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.queryByTestId("skills-update-available")).toBeNull();
    expect(screen.queryByTestId("skills-not-synced")).toBeNull();
  });
});
