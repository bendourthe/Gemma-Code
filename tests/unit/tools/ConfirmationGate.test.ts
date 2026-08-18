import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import type { ExtensionToWebviewMessage } from "../../../src/panels/messages.js";

describe("ConfirmationGate", () => {
  let posted: ExtensionToWebviewMessage[];
  let gate: ConfirmationGate;

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    gate = new ConfirmationGate((msg) => { posted.push(msg); });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a confirmationRequest with correct shape", async () => {
    const promise = gate.request("id1", "Edit file?", "diff here");
    gate.resolve("id1", true);
    await promise;

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: "confirmationRequest",
      id: "id1",
      description: "Edit file?",
      detail: "diff here",
    });
  });

  it("resolves true when user approves", async () => {
    const promise = gate.request("id1", "Run command?");
    gate.resolve("id1", true);
    expect(await promise).toBe(true);
  });

  it("resolves false when user rejects", async () => {
    const promise = gate.request("id1", "Run command?");
    gate.resolve("id1", false);
    expect(await promise).toBe(false);
  });

  it("resolves false after 60-second timeout", async () => {
    const promise = gate.request("id1", "Edit file?");
    vi.advanceTimersByTime(60_001);
    expect(await promise).toBe(false);
  });

  it("does not throw when resolve is called with an unknown id", () => {
    expect(() => gate.resolve("unknown", true)).not.toThrow();
  });

  it("handles two concurrent requests independently", async () => {
    const p1 = gate.request("a", "First?");
    const p2 = gate.request("b", "Second?");

    gate.resolve("b", true);
    gate.resolve("a", false);

    expect(await p1).toBe(false);
    expect(await p2).toBe(true);
  });

  it("does nothing on a second resolve for the same id (already resolved)", async () => {
    const promise = gate.request("id1", "Edit?");
    gate.resolve("id1", true);
    await promise;
    // Second resolve should be a no-op (pending map is empty)
    expect(() => gate.resolve("id1", false)).not.toThrow();
  });

  // ---- peer attribution (pen-test F-004) -----------------------------------

  describe("peer attribution", () => {
    it("does not prefix when source is local-agent or undefined", () => {
      void gate.request("a", "Run command?", undefined, "local-agent");
      void gate.request("b", "Run command?");
      expect(posted[0]).toMatchObject({ description: "Run command?" });
      expect(posted[1]).toMatchObject({ description: "Run command?" });
    });

    it("prefixes with 'External MCP client' when source is mcp", () => {
      void gate.request("c", "delete file foo.txt", undefined, "mcp");
      expect(posted[0]).toMatchObject({
        description: "External MCP client wants to: delete file foo.txt",
      });
    });

    it("prefixes with 'verification sub-agent' when source is sub-agent", () => {
      void gate.request("d", "run a check", undefined, "sub-agent");
      expect(posted[0]).toMatchObject({
        description: "The verification sub-agent wants to: run a check",
      });
    });
  });

  describe("unattended park (v1.18.0 Phase 4)", () => {
    it("parks instead of posting a 60s webview prompt", async () => {
      vi.useRealTimers();
      const { AskInbox } = await import("../../../modules/coding/autonomy/AskInbox.js");
      const inbox = new AskInbox({ idFactory: () => "parked-1" });
      let posts = 0;
      const parkedGate = new ConfirmationGate(() => {
        posts += 1;
      }, undefined, {
        host: inbox,
        runMode: "headless",
        runId: "run-park",
        toolName: "write_file",
        args: { path: "a.ts", content: "x" },
      });
      const waiting = parkedGate.request("id1", "Edit file?", "diff here");
      const pending = await inbox.list("pending");
      expect(pending).toHaveLength(1);
      expect(pending[0].toolName).toBe("write_file");
      await inbox.approve("parked-1");
      expect(await waiting).toBe(true);
      expect(posts).toBe(0);
    });

    it("still times out on the interactive path", async () => {
      const promise = gate.request("id-timeout", "Edit file?");
      vi.advanceTimersByTime(60_001);
      expect(await promise).toBe(false);
      expect(posted.some((m) => m.type === "confirmationRequest")).toBe(true);
    });
  });
});
