import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import {
  SkillsSettings,
  type SkillsSettingsClient,
  type SkillRowDto,
} from "../src/pages/settings/SkillsSettings";

function makeRows(): SkillRowDto[] {
  return [
    {
      id: "writing-editing",
      displayName: "Writing and Editing",
      category: "developer-experience",
      path: "/x/SKILL.md",
      active: true,
      provenance: { source: "builtin", contentHash: "b".repeat(64) },
    },
    {
      id: "nexus-hub/code-quality",
      displayName: "Code Quality",
      category: "code-review",
      path: "/d/SKILL.md",
      active: true,
      diverged: true,
      provenance: { source: "nexus-hub", tag: "v1.3.2", contentHash: "d".repeat(64) },
    },
    {
      id: "user/code-quality",
      displayName: "Code Quality",
      category: "code-review",
      path: "/u/SKILL.md",
      active: false,
      diverged: true,
      provenance: { source: "user", contentHash: "u".repeat(64) },
    },
    {
      id: "nexus-hub/evil",
      displayName: "Evil",
      category: "?",
      path: "/d/evil/SKILL.md",
      active: false,
      provenance: { source: "nexus-hub", tag: "v1.3.2", contentHash: "e".repeat(64) },
      quarantine: {
        decision: "block",
        findings: [
          {
            ruleId: "injection.jailbreak.ignore-previous",
            severity: "high",
            message: "attempt to override prior instructions",
            source: "evil/SKILL.md",
            line: 3,
            excerpt: "Ignore previous instructions",
          },
        ],
      },
    },
  ];
}

function makeClient(rows: SkillRowDto[]): SkillsSettingsClient & {
  toggled: string[];
  approved: string[];
  divergedPrefs: Array<{ name: string; pref: "user" | "nexus-hub" }>;
} {
  const toggled: string[] = [];
  const approved: string[] = [];
  const divergedPrefs: Array<{ name: string; pref: "user" | "nexus-hub" }> = [];
  let autoSync = false;
  return {
    list: async () => rows,
    activeTag: async () => "v1.3.2",
    upstreamLatestTag: async () => "v1.4.0",
    autoSyncEnabled: async () => autoSync,
    setAutoSyncEnabled: async (e) => {
      autoSync = e;
    },
    syncNow: async () => ({ tag: "v1.4.0", applied: true, summary: "+1 new, ~0 modified, -0 removed" }),
    approveQuarantined: async (id) => {
      approved.push(id);
    },
    setActive: async (id) => {
      toggled.push(id);
    },
    setDivergedPreference: async (name, pref) => {
      divergedPrefs.push({ name, pref });
    },
    toggled,
    approved,
    divergedPrefs,
  };
}

describe("SkillsSettings", () => {
  it("renders the active tag and upstream tag in the header", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("skills-active-tag").textContent).toBe("v1.3.2");
    expect(screen.getByTestId("skills-upstream-tag").textContent).toBe("v1.4.0");
  });

  it("groups rows by provenance namespace", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("section-builtin-count").textContent).toBe("(1)");
    // nexus-hub/code-quality is shown; nexus-hub/evil is quarantined so it
    // moves to the Quarantined section.
    expect(screen.getByTestId("section-nexus-hub-count").textContent).toBe("(1)");
    expect(screen.getByTestId("section-user-count").textContent).toBe("(1)");
    expect(screen.getByTestId("section-quarantined-count").textContent).toBe("(1)");
  });

  it("renders a diverged badge on conflicting display names", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("skills-diverged-nexus-hub/code-quality")).toBeTruthy();
    expect(screen.getByTestId("skills-diverged-user/code-quality")).toBeTruthy();
  });

  it("does not render a diverged badge on the non-diverged builtin row", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.queryByTestId("skills-diverged-writing-editing")).toBeNull();
  });

  it("Sync now button calls syncNow and renders status", async () => {
    const client = makeClient(makeRows());
    const spy = vi.spyOn(client, "syncNow");
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-sync-now"));
    });
    expect(spy).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("skills-sync-status").textContent ?? "").toContain("Synced v1.4.0"),
    );
  });

  it("Sync now with quarantined skills still shows Synced, not blocked", async () => {
    const client = makeClient(makeRows());
    client.syncNow = async () => ({
      tag: "v3.21.0",
      applied: true,
      summary: "+8 new, ~0 modified, -0 removed; quarantined 1",
    });
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-sync-now"));
    });
    await waitFor(() => {
      const status = screen.getByTestId("skills-sync-status").textContent ?? "";
      expect(status).toContain("Synced v3.21.0");
      expect(status).toContain("quarantined 1");
    });
    expect(screen.queryByRole("alert")?.textContent ?? "").not.toMatch(/blocked/i);
  });

  it("Auto-sync toggle calls setAutoSyncEnabled(true)", async () => {
    const client = makeClient(makeRows());
    const spy = vi.spyOn(client, "setAutoSyncEnabled");
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-auto-sync"));
    });
    expect(spy).toHaveBeenCalledWith(true);
  });

  it("labels auto-update as latest Nexus-Hub release", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("skills-auto-sync").closest("label")?.textContent ?? "").toMatch(
      /Auto-update to latest Nexus-Hub release/i,
    );
  });

  it("maps sidecar response timeout during Update now to Hub fetch copy", async () => {
    const client = makeClient(makeRows());
    client.syncNow = async () => {
      throw new Error("sidecar response timeout");
    };
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-sync-now"));
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/Hub fetch did not finish/i);
      expect(screen.getByRole("alert").textContent ?? "").not.toMatch(/sidecar response timeout/i);
    });
  });

  it("Quarantined skills are listed under a dedicated section with findings", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("section-quarantined")).toBeTruthy();
    expect(screen.getByTestId("skills-quarantine-finding-nexus-hub/evil-0").textContent).toMatch(
      /injection\.jailbreak\.ignore-previous/,
    );
  });

  it("Review and approve button calls approveQuarantined", async () => {
    const client = makeClient(makeRows());
    const spy = vi.spyOn(client, "approveQuarantined");
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-approve-nexus-hub/evil"));
    });
    expect(spy).toHaveBeenCalledWith("nexus-hub/evil");
  });

  it("Toggle button calls setActive with the inverted state", async () => {
    const client = makeClient(makeRows());
    const spy = vi.spyOn(client, "setActive");
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-toggle-nexus-hub/code-quality"));
    });
    // The row started active=true so the toggle should flip it to false.
    expect(spy).toHaveBeenCalledWith("nexus-hub/code-quality", false);
  });

  it("Diverged 'Use as default' button calls setDivergedPreference", async () => {
    const client = makeClient(makeRows());
    const spy = vi.spyOn(client, "setDivergedPreference");
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-set-default-nexus-hub/code-quality"));
    });
    expect(spy).toHaveBeenCalledWith("Code Quality", "nexus-hub");
  });

  it("surfaces an error message when list() rejects", async () => {
    const client: SkillsSettingsClient = {
      list: async () => {
        throw new Error("offline");
      },
      activeTag: async () => null,
      upstreamLatestTag: async () => null,
      autoSyncEnabled: async () => false,
      setAutoSyncEnabled: async () => {},
      syncNow: async () => ({ tag: "?", applied: false, summary: "" }),
      approveQuarantined: async () => {},
      setActive: async () => {},
    };
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByRole("alert").textContent).toMatch(/offline/);
  });
});
