/**
 * v1.18.0 Phase 5 (OI-A3) + Phase 4 (OW-A1) -- ACP gating parity.
 *
 * CONFIRM/DANGEROUS tools invoke the same classifier + tier map as the UI.
 * Unattended confirmation parks in the ask inbox when one is configured, and
 * fail-closes when it is not. Never auto-approve, never wait 60s on a webview.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AskInbox } from "../../modules/coding/autonomy/AskInbox.js";
import type { LLMChatRequest, LLMClient, LLMModel, LLMStreamChunk } from "../../modules/coding/llm/types";
import { ActionRisk } from "../../modules/coding/guardrails/ActionClassifier";
import { PermissionTier } from "../../modules/coding/runtime/headlessGuards";
import { createHeadlessTools } from "../../modules/coding/runtime/headlessTools";
import { AcpAgent } from "../sidecar/src/acp/AcpAgent";
import {
  ACP_FAIL_CLOSED_REASON,
  classifyAcpCall,
  createAcpConfirm,
  type AcpConfirmationRecord,
} from "../sidecar/src/acp/AcpConfirmation";
import { ServingGateway } from "../sidecar/src/serving/gateway";
import type { ServingConfig } from "../sidecar/src/serving/config";

const TOKEN = "acp-gate-token";

/** Gemma-native tool-call string (`key:<|"|>value<|"|>`), matching HeadlessAgentSession tests. */
function toolCallText(name: string, args: Record<string, string>): string {
  const body = Object.entries(args)
    .map(([k, v]) => `${k}:<|"|>${v}<|"|>`)
    .join("");
  return `<|tool_call>call:${name}{${body}}<tool_call|>`;
}

function scriptedLlm(first: string, rest = "ok"): LLMClient {
  let n = 0;
  return {
    async checkHealth() {
      return true;
    },
    async listModels(): Promise<LLMModel[]> {
      return [{ name: "gemma4:e4b", modified_at: "", size: 0 }];
    },
    async *streamChat(_request: LLMChatRequest) {
      n += 1;
      const text = n === 1 ? first : rest;
      yield { message: { role: "assistant", content: text }, done: false } satisfies LLMStreamChunk;
      yield { message: { role: "assistant", content: "" }, done: true } satisfies LLMStreamChunk;
    },
  };
}

const started: ServingGateway[] = [];

async function start(acp: AcpAgent): Promise<string> {
  const gateway = new ServingGateway({ listInstalled: async () => [], log: () => {} });
  gateway.surface.mount(acp.asRoute());
  acp.setEnabled(true);
  started.push(gateway);
  const config: ServingConfig = {
    enabled: false,
    acpEnabled: true,
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
  };
  await gateway.start(config);
  return `http://127.0.0.1:${gateway.boundPort}`;
}

async function rpc(base: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/acp`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()?.stop();
  }
});

describe("classifyAcpCall", () => {
  it("marks write_file as CONFIRM / destructive", () => {
    const c = classifyAcpCall("write_file", { path: "a.ts", content: "x" });
    expect(c.tier).toBe(PermissionTier.CONFIRM);
    expect(c.risk).toBe(ActionRisk.DESTRUCTIVE);
  });

  it("marks run_terminal rm -rf / as BLOCKED", () => {
    const c = classifyAcpCall("run_terminal", { command: "rm -rf /" });
    expect(c.risk).toBe(ActionRisk.BLOCKED);
    expect(c.tier).toBe(PermissionTier.DANGEROUS);
  });

  it("createAcpConfirm fail-closes when no inbox is configured", async () => {
    const records: AcpConfirmationRecord[] = [];
    const confirm = createAcpConfirm({ onRecord: (r) => records.push(r) });
    expect(await confirm("write_file", "Run write_file?", "tier CONFIRM")).toBe(false);
    expect(records[0]?.decided).toBe("fail-closed");
    expect(ACP_FAIL_CLOSED_REASON).toMatch(/ask inbox/i);
  });

  it("createAcpConfirm honors an explicit decide callback", async () => {
    const records: AcpConfirmationRecord[] = [];
    const confirm = createAcpConfirm({
      decide: async () => true,
      onRecord: (r) => records.push(r),
    });
    expect(await confirm("write_file", "Run write_file?", "tier CONFIRM")).toBe(true);
    expect(records[0]?.decided).toBe("approved");

    const denied = createAcpConfirm({ decide: async () => false });
    expect(await denied("write_file", "Run write_file?", "tier CONFIRM")).toBe(false);
  });

  it("createAcpConfirm parks when an inbox is supplied", async () => {
    const inbox = new AskInbox({ idFactory: () => "acp-park" });
    const records: AcpConfirmationRecord[] = [];
    const confirm = createAcpConfirm({
      inbox,
      onRecord: (r) => records.push(r),
    });
    const waiting = confirm("write_file", "Run write_file?", "tier CONFIRM", {
      path: "a.ts",
      content: "x",
    });
    const pending = await inbox.list("pending");
    expect(pending).toHaveLength(1);
    expect(records.some((r) => r.decided === "parked")).toBe(true);
    await inbox.approve("acp-park");
    expect(await waiting).toBe(true);
    expect(records.some((r) => r.decided === "approved")).toBe(true);
  });
});

describe("ACP unattended confirmation", () => {
  it("refuses write_file and does not create the file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-gate-"));
    const records: AcpConfirmationRecord[] = [];
    try {
      const llm = scriptedLlm(toolCallText("write_file", { path: "secret.txt", content: "nope" }));
      const acp = new AcpAgent({
        llm,
        confirmation: { onRecord: (r) => records.push(r) },
      });
      const base = await start(acp);
      await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
      const created = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd } });
      const sessionId = (created.result as { sessionId: string }).sessionId;
      await rpc(base, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "write a file" }] },
      });
      expect(records.some((r) => r.toolName === "write_file" && r.decided === "fail-closed")).toBe(
        true,
      );
      await expect(readFile(join(cwd, "secret.txt"), "utf8")).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("parks write_file until denied and does not create the file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-park-deny-"));
    const inbox = new AskInbox();
    const records: AcpConfirmationRecord[] = [];
    try {
      const llm = scriptedLlm(toolCallText("write_file", { path: "secret.txt", content: "nope" }));
      const acp = new AcpAgent({
        llm,
        inbox,
        confirmation: { onRecord: (r) => records.push(r) },
      });
      const base = await start(acp);
      await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
      const created = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd } });
      const sessionId = (created.result as { sessionId: string }).sessionId;
      const promptP = rpc(base, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "write a file" }] },
      });
      const startedAt = Date.now();
      while ((await inbox.pendingCount()) === 0) {
        if (Date.now() - startedAt > 4000) throw new Error("ask did not park");
        await new Promise((r) => setTimeout(r, 20));
      }
      const pending = await inbox.list("pending");
      const first = pending[0];
      if (!first) throw new Error("parked ask missing");
      await inbox.deny(first.id);
      await promptP;
      expect(records.some((r) => r.toolName === "write_file" && r.decided === "parked")).toBe(true);
      await expect(readFile(join(cwd, "secret.txt"), "utf8")).rejects.toThrow();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("replays an approved parked write_file and creates the file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-park-ok-"));
    const inbox = new AskInbox();
    try {
      const llm = scriptedLlm(toolCallText("write_file", { path: "secret.txt", content: "nope" }));
      const acp = new AcpAgent({ llm, inbox });
      const base = await start(acp);
      await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
      const created = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd } });
      const sessionId = (created.result as { sessionId: string }).sessionId;
      const promptP = rpc(base, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "write a file" }] },
      });
      const startedAt = Date.now();
      while ((await inbox.pendingCount()) === 0) {
        if (Date.now() - startedAt > 4000) throw new Error("ask did not park");
        await new Promise((r) => setTimeout(r, 20));
      }
      const pending = await inbox.list("pending");
      const first = pending[0];
      if (!first) throw new Error("parked ask missing");
      const replay = await inbox.approve(first.id);
      expect(replay.ok).toBe(true);
      expect(replay.replay?.floorClamped).toBe(false);
      await promptP;
      expect(await readFile(join(cwd, "secret.txt"), "utf8")).toBe("nope");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not spawn a blocked run_terminal command", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexus-acp-block-"));
    let spawned = false;
    try {
      const tools = createHeadlessTools({
        exec: async () => {
          spawned = true;
          return { code: 0, stdout: "ok", stderr: "" };
        },
        guards: { confirm: createAcpConfirm() },
      });
      const llm = scriptedLlm(toolCallText("run_terminal", { command: "rm -rf /" }));
      const acp = new AcpAgent({ llm, tools });
      const base = await start(acp);
      await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
      const created = await rpc(base, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd } });
      const sessionId = (created.result as { sessionId: string }).sessionId;
      const prompted = await rpc(base, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "wipe disk" }] },
      });
      expect(spawned).toBe(false);
      const updates = (prompted.result as { updates: Array<{ update: { status?: string } }> }).updates;
      expect(updates.some((u) => u.update.status === "failed")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
