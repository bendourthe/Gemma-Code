import { describe, expect, it } from "vitest";

import { createHandlerContext, dispatch } from "../sidecar/src/handlers";
import { AuditLog } from "../../core/audit/AuditLog";
import { InProcessTelemetryBus } from "../../core/telemetry/TelemetryBus";
import { IPC_METHODS, METHOD_SCHEMAS } from "../sidecar/src/protocol";

describe("audit IPC", () => {
  it("declares audit.list and audit.status", () => {
    expect(IPC_METHODS).toContain("audit.list");
    expect(IPC_METHODS).toContain("audit.status");
    expect(METHOD_SCHEMAS["audit.list"]?.implemented).toBe(true);
    expect(METHOD_SCHEMAS["audit.status"]?.implemented).toBe(true);
  });

  it("lists signed events and reports dropped count", async () => {
    const log = new AuditLog({ dbPath: ":memory:" });
    const bus = new InProcessTelemetryBus();
    log.attach(bus);
    const ctx = createHandlerContext({ pid: 1, platform: process.platform });
    ctx.audit = log;
    ctx.telemetry = bus;
    await log.append({
      actor: "planner",
      pillar: "coding",
      kind: "routing.decision",
      payload: { role: "planner" },
    });
    const listed = (await dispatch("audit.list", { actor: "planner" }, ctx)) as {
      events: { actor: string; trusted: boolean }[];
    };
    expect(listed.events).toHaveLength(1);
    expect(listed.events[0]?.trusted).toBe(true);
    const status = (await dispatch("audit.status", {}, ctx)) as {
      eventCount: number;
      droppedCount: number;
      vaultAvailable: boolean;
    };
    expect(status.eventCount).toBe(1);
    expect(status.droppedCount).toBe(0);
    expect(typeof status.vaultAvailable).toBe("boolean");
    log.close();
  });

  it("publishes tool.call when a coding session emits a tool header", async () => {
    const bus = new InProcessTelemetryBus();
    const seen: string[] = [];
    bus.subscribe({ kinds: ["tool.call"] }, (event) => {
      seen.push(event.kind);
    });
    const ctx = createHandlerContext({ pid: 1, platform: process.platform });
    ctx.telemetry = bus;
    const started = (await dispatch(
      "coding.session.start",
      { modelId: "qwen2.5-coder:7b" },
      ctx,
    )) as { sessionId: string };
    await dispatch(
      "coding.session.sendMessage",
      { sessionId: started.sessionId, message: "hi" },
      ctx,
    );
    expect(seen).toContain("tool.call");
  });
});
