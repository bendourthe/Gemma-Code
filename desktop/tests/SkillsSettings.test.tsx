import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import {
  SkillsSettings,
  SYNC_STAGE_INSTALLING_DELAY_MS,
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
  it("renders the active tag and upstream tag in the header (canonical, no leading v)", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("skills-active-tag").textContent).toBe("1.3.2");
    expect(screen.getByTestId("skills-upstream-tag").textContent).toBe("1.4.0");
  });

  it("header does not imply an update when 3.21.0 equals v3.21.0 (normalized)", async () => {
    const client = makeClient(makeRows());
    client.activeTag = async () => "3.21.0";
    client.upstreamLatestTag = async () => "v3.21.0";
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("skills-active-tag").textContent).toBe("3.21.0");
    expect(screen.queryByTestId("skills-upstream-tag")).toBeNull();
    expect(screen.queryByTestId("skills-update-available")).toBeNull();
  });

  it("update banner still shows when tags truly differ", async () => {
    const client = makeClient(makeRows());
    client.activeTag = async () => "3.21.0";
    client.upstreamLatestTag = async () => "v3.22.0";
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    expect(screen.getByTestId("skills-update-available").textContent ?? "").toContain(
      "Update available: 3.21.0 to 3.22.0",
    );
  });

  it("Sync now + auto-update row is the first control, directly under the header", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    const page = screen.getByTestId("settings-skills");
    const children = Array.from(page.children);
    expect(children[0]?.tagName).toBe("HEADER");
    expect(children[1]?.getAttribute("data-testid")).toBe("skills-controls-row");
    expect(children[1]?.querySelector('[data-testid="skills-sync-now"]')).toBeTruthy();
    expect(children[1]?.querySelector('[data-testid="skills-auto-sync"]')).toBeTruthy();
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

  it("Sync now button calls syncNow and renders the up-to-date status", async () => {
    const client = makeClient(makeRows());
    const spy = vi.spyOn(client, "syncNow");
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-sync-now"));
    });
    expect(spy).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("skills-sync-status").textContent ?? "").toContain(
        "Harness up-to-date with Nexus-Hub version 1.4.0",
      ),
    );
  });

  it("while syncing shows the orb and staged status copy, never claiming install finished early", async () => {
    const client = makeClient(makeRows());
    let resolveSync!: (r: { tag: string; applied: boolean; summary: string }) => void;
    client.syncNow = () =>
      new Promise((res) => {
        resolveSync = res;
      });
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByTestId("skills-sync-now"));
      });
      // Upstream (1.4.0) was observed at load time and differs from active
      // (1.3.2): "New version found" is an honest first stage.
      expect(screen.getByTestId("skills-sync-orb")).toBeTruthy();
      expect(screen.getByTestId("skills-sync-status").textContent).toBe("New version found");
      act(() => {
        vi.advanceTimersByTime(SYNC_STAGE_INSTALLING_DELAY_MS);
      });
      expect(screen.getByTestId("skills-sync-status").textContent).toBe(
        "Installing version 1.4.0 now",
      );
      // Not done until the RPC result says so.
      expect(screen.getByTestId("skills-sync-status").textContent ?? "").not.toContain(
        "up-to-date",
      );
      await act(async () => {
        resolveSync({ tag: "v1.4.0", applied: true, summary: "+1 new, ~0 modified, -0 removed" });
      });
      expect(screen.getByTestId("skills-sync-status").textContent ?? "").toContain(
        "Harness up-to-date with Nexus-Hub version 1.4.0",
      );
      expect(screen.queryByTestId("skills-sync-orb")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows Checking for updates while syncing when no newer upstream is known", async () => {
    const client = makeClient(makeRows());
    client.activeTag = async () => "3.21.0";
    client.upstreamLatestTag = async () => "v3.21.0";
    let resolveSync!: (r: { tag: string; applied: boolean; summary: string }) => void;
    client.syncNow = () =>
      new Promise((res) => {
        resolveSync = res;
      });
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-sync-now"));
    });
    expect(screen.getByTestId("skills-sync-status").textContent).toBe("Checking for updates...");
    await act(async () => {
      resolveSync({ tag: "v3.21.0", applied: false, summary: "+0 new, ~0 modified, -0 removed" });
    });
    // Already up to date: applied=false but the tag matches the active one.
    expect(screen.getByTestId("skills-sync-status").textContent ?? "").toContain(
      "Harness up-to-date with Nexus-Hub version 3.21.0",
    );
  });

  it("shows Sync blocked plus the summary when the sync did not apply a different tag", async () => {
    const client = makeClient(makeRows());
    client.syncNow = async () => ({
      tag: "v1.4.0",
      applied: false,
      summary: "+1 new, ~0 modified, -0 removed",
    });
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByTestId("skills-sync-now"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("skills-sync-status").textContent ?? "").toBe(
        "Sync blocked: +1 new, ~0 modified, -0 removed",
      ),
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
      expect(status).toContain("Harness up-to-date with Nexus-Hub version 3.21.0");
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

  it("Quarantined section explains the scanner block and the trust decision", async () => {
    const client = makeClient(makeRows());
    render(<SkillsSettings client={client} />);
    await waitFor(() => expect(screen.queryByTestId("skills-loading")).toBeNull());
    const copy = screen.getByTestId("section-quarantined-description").textContent ?? "";
    expect(copy).toMatch(/not enabled/i);
    expect(copy).toMatch(/prompt-injection scanner found a high-severity pattern/i);
    expect(copy).toMatch(/explicit trust decision/i);
    // The finding text itself stays visible on the row.
    expect(
      screen.getByTestId("skills-quarantine-finding-nexus-hub/evil-0").textContent ?? "",
    ).toContain("[high] injection.jailbreak.ignore-previous");
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
