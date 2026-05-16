/**
 * Integration test: numbered permission prompt routing through ChatMessageRouter.
 *
 * v0.8.0 Phase 0.4 (closes v0.7.0 10.O.2). Asserts that a webview-side
 * `permissionPromptResponse` message reaches the `ConfirmationGate` and
 * resolves the pending prompt with the user's choice. Exercises the real
 * router + gate; only the controller/conversation/plan/etc. side-effects are
 * stubbed because they are out of scope for this carryover.
 */

import { describe, it, expect, vi } from "vitest";
import { ChatMessageRouter } from "../../../src/panels/ChatMessageRouter.js";
import { ConfirmationGate } from "../../../src/tools/ConfirmationGate.js";
import type {
  ChatMessageRouterDeps,
} from "../../../src/panels/ChatMessageRouter.js";

function makeDeps(gate: ConfirmationGate): ChatMessageRouterDeps {
  // Minimal stubs for the fields the router exposes; the
  // `permissionPromptResponse` path only touches the gate.
  const stub = {} as unknown;
  return {
    controller: stub as never,
    status: stub as never,
    manager: stub as never,
    planMode: stub as never,
    promptBuilder: stub as never,
    commandRouter: stub as never,
    confirmationGate: gate,
    agentLoop: stub as never,
    gitSafetyNet: null,
    getSettings: vi.fn(() => stub as never),
    getCurrentEditMode: vi.fn(() => "auto" as const),
    setCurrentEditMode: vi.fn(),
    buildPromptContext: vi.fn(() => stub as never),
    postMessage: vi.fn(),
    getOutputChannel: vi.fn(
      () => ({ appendLine: vi.fn(), append: vi.fn(), dispose: vi.fn() }) as never,
    ),
  };
}

describe("ChatMessageRouter -> ConfirmationGate.resolvePrompt (v0.8.0 Phase 0.4)", () => {
  it("routes permissionPromptResponse 'yes' to the pending prompt", async () => {
    const postMessage = vi.fn();
    const gate = new ConfirmationGate(postMessage);
    const router = new ChatMessageRouter(makeDeps(gate));

    const pending = gate.requestPrompt("p1", "run_terminal", "Run npm test", "npm test");

    await router.handle({
      type: "permissionPromptResponse",
      id: "p1",
      value: "yes",
    });

    const result = await pending;
    expect(result).toEqual({ value: "yes", freeformText: undefined });
  });

  it("routes 'no' to the pending prompt", async () => {
    const gate = new ConfirmationGate(vi.fn());
    const router = new ChatMessageRouter(makeDeps(gate));

    const pending = gate.requestPrompt("p2", "delete_file", "Delete /tmp/x", null);

    await router.handle({ type: "permissionPromptResponse", id: "p2", value: "no" });

    expect(await pending).toEqual({ value: "no", freeformText: undefined });
  });

  it("routes 'yes-for-all' so callers can persist an override", async () => {
    const gate = new ConfirmationGate(vi.fn());
    const router = new ChatMessageRouter(makeDeps(gate));

    const pending = gate.requestPrompt("p3", "write_file", "Write /tmp/y", null);

    await router.handle({
      type: "permissionPromptResponse",
      id: "p3",
      value: "yes-for-all",
    });

    expect(await pending).toEqual({ value: "yes-for-all", freeformText: undefined });
  });

  it("routes 'freeform' with the user's instruction", async () => {
    const gate = new ConfirmationGate(vi.fn());
    const router = new ChatMessageRouter(makeDeps(gate));

    const pending = gate.requestPrompt("p4", "run_terminal", "Run rm -rf node_modules", "rm -rf node_modules");

    await router.handle({
      type: "permissionPromptResponse",
      id: "p4",
      value: "freeform",
      freeformText: "Use npm ci instead",
    });

    expect(await pending).toEqual({
      value: "freeform",
      freeformText: "Use npm ci instead",
    });
  });

  it("silently ignores responses for unknown prompt ids", async () => {
    const gate = new ConfirmationGate(vi.fn());
    const router = new ChatMessageRouter(makeDeps(gate));

    await expect(
      router.handle({ type: "permissionPromptResponse", id: "missing", value: "yes" }),
    ).resolves.toBeUndefined();
  });
});
