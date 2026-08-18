/**
 * v1.16.0 Phase 4 (adoption item A6) -- headless security guards.
 *
 * Two properties matter most and are asserted first:
 *
 *   1. The secret-path denylist is enforced UNCONDITIONALLY. It costs nothing
 *      legitimate, so there is no reason to make it opt-in.
 *   2. Tier enforcement is opt-in via `confirm`. Enforcing it without a prompt
 *      would refuse write_file / run_terminal -- i.e. disable the headless agent
 *      entirely -- so a host that supplies no callback keeps its pre-v1.16.0
 *      behavior, and one that does gets the same rules as the VS Code registry.
 */

import { describe, it, expect, vi } from "vitest";

import {
  PermissionTier,
  resolveTier,
  screenHeadlessCall,
} from "../../../modules/coding/runtime/headlessGuards.js";

describe("secret-path enforcement (always on)", () => {
  it("refuses a denylisted path with no allow_secrets, even with no confirm callback", async () => {
    const decision = await screenHeadlessCall("read_file", { path: ".env" });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/secret-path denylist/);
  });

  it("refuses a denylisted path with allow_secrets but no way to prompt", async () => {
    const decision = await screenHeadlessCall("read_file", {
      path: ".env",
      allow_secrets: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/cannot prompt/);
  });

  it("allows a denylisted path when allow_secrets is set and the host approves", async () => {
    const confirm = vi.fn(async () => true);
    const decision = await screenHeadlessCall(
      "read_file",
      { path: ".env", allow_secrets: true },
      { confirm },
    );
    expect(decision.allowed).toBe(true);
    expect(confirm).toHaveBeenCalled();
  });

  it("refuses when the host declines the secret-path prompt", async () => {
    const decision = await screenHeadlessCall(
      "read_file",
      { path: ".env", allow_secrets: true },
      { confirm: async () => false },
    );
    expect(decision.allowed).toBe(false);
  });

  it("screens parse_document's path parameter too", async () => {
    const decision = await screenHeadlessCall("parse_document", { path: ".env" });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/secret-path denylist/);
  });

  it("ignores a tool with no path parameter", async () => {
    const decision = await screenHeadlessCall("grep_codebase", { pattern: "x" });
    expect(decision.allowed).toBe(true);
  });

  it("honours extra denylist globs", async () => {
    const decision = await screenHeadlessCall(
      "read_file",
      { path: "config/custom.pem" },
      { secretPathDenyExtra: ["**/*.pem"] },
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("tier enforcement (opt-in via confirm)", () => {
  it("allows a CONFIRM tool when no confirm callback is supplied", async () => {
    // Preserves pre-v1.16.0 headless behavior. Refusing here would disable
    // write_file / run_terminal and with them the whole headless agent.
    const decision = await screenHeadlessCall("write_file", { path: "a.ts", content: "x" });
    expect(decision.allowed).toBe(true);
  });

  it("prompts for a CONFIRM tool once a callback exists", async () => {
    const confirm = vi.fn(async () => true);
    const decision = await screenHeadlessCall("write_file", { path: "a.ts" }, { confirm });
    expect(decision.allowed).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      "write_file",
      expect.stringContaining("write_file"),
      expect.stringContaining("CONFIRM"),
      { path: "a.ts" },
    );
  });

  it("refuses when the host declines", async () => {
    const decision = await screenHeadlessCall(
      "run_terminal",
      { command: "ls" },
      { confirm: async () => false },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/rejected/);
  });

  it("does not prompt for an AUTO_APPROVE tool", async () => {
    const confirm = vi.fn(async () => true);
    const decision = await screenHeadlessCall("read_file", { path: "a.ts" }, { confirm });
    expect(decision.allowed).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("prompts for parse_document, which is CONFIRM", async () => {
    const confirm = vi.fn(async () => true);
    await screenHeadlessCall("parse_document", { path: "a.pdf" }, { confirm });
    expect(confirm).toHaveBeenCalled();
  });
});

describe("resolveTier", () => {
  it("reads the shared map", () => {
    expect(resolveTier("read_file")).toBe(PermissionTier.AUTO_APPROVE);
    expect(resolveTier("write_file")).toBe(PermissionTier.CONFIRM);
    expect(resolveTier("run_terminal")).toBe(PermissionTier.DANGEROUS);
    expect(resolveTier("parse_document")).toBe(PermissionTier.CONFIRM);
  });

  it("treats an unknown tool as DANGEROUS", () => {
    expect(resolveTier("mcp:server/whatever")).toBe(PermissionTier.DANGEROUS);
  });

  it("lets an override RAISE a tier", () => {
    expect(resolveTier("read_file", { read_file: PermissionTier.DANGEROUS })).toBe(
      PermissionTier.DANGEROUS,
    );
  });

  it("REFUSES to let an override drop a CONFIRM baseline to AUTO_APPROVE", () => {
    // The pen-test F-003 clamp, mirrored from getPermissionTier.
    expect(resolveTier("write_file", { write_file: PermissionTier.AUTO_APPROVE })).toBe(
      PermissionTier.CONFIRM,
    );
    expect(resolveTier("run_terminal", { run_terminal: 0 })).toBe(PermissionTier.DANGEROUS);
  });

  it("ignores a malformed override", () => {
    expect(resolveTier("write_file", { write_file: 99 })).toBe(PermissionTier.CONFIRM);
    expect(resolveTier("write_file", { write_file: -1 })).toBe(PermissionTier.CONFIRM);
  });
});
