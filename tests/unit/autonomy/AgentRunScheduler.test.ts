import { describe, expect, it } from "vitest";

import { AskInbox } from "../../../modules/coding/autonomy/AskInbox.js";
import {
  AgentRunScheduler,
  builtinMorningBrief,
  createScheduledRun,
} from "../../../modules/coding/autonomy/AgentRunScheduler.js";
import { AutoApproveForbiddenError } from "../../../modules/coding/autonomy/noAutoApprove.js";
import { MORNING_BRIEF_PROMPT_SOURCE } from "../../../modules/coding/autonomy/morningBrief.js";
import { MORNING_BRIEF_SCHEDULE_ID } from "../../../modules/coding/autonomy/types.js";

describe("AgentRunScheduler", () => {
  it("wires morning-brief to the Hub preset and keeps it off by default", () => {
    const spec = builtinMorningBrief("/tmp/ws");
    expect(spec.id).toBe(MORNING_BRIEF_SCHEDULE_ID);
    expect(spec.enabled).toBe(false);
    expect(spec.promptSource).toBe(MORNING_BRIEF_PROMPT_SOURCE);
  });

  it("refuses to construct an auto-approved scheduled action", () => {
    expect(() =>
      createScheduledRun({
        id: "bad",
        name: "bad",
        enabled: true,
        kind: "interval",
        intervalMs: 1,
        prompt: "x",
        autoApprove: true,
      }),
    ).toThrow(AutoApproveForbiddenError);
  });

  it("fires a headless run that parks asks and checkpoints first", async () => {
    const inbox = new AskInbox();
    const checkpoints: string[] = [];
    let sawConfirm = false;
    const scheduler = new AgentRunScheduler({
      inbox,
      workspacePath: "/tmp/ws",
      createCheckpoint: async (cwd) => {
        checkpoints.push(cwd);
        return { headSha: "abc", stashCreated: false, timestamp: 1 };
      },
      runHeadless: async (run) => {
        expect(run.checkpoint?.headSha).toBe("abc");
        const waiting = run.confirm("write_file", "Run write_file?", "tier CONFIRM", {
          path: "a.ts",
          content: "x",
        });
        const pending = await inbox.list("pending");
        expect(pending).toHaveLength(1);
        expect(pending[0].runMode).toBe("scheduled");
        await inbox.deny(pending[0].id);
        expect(await waiting).toBe(false);
        sawConfirm = true;
      },
      schedules: [
        {
          id: "tick-me",
          name: "Tick",
          enabled: true,
          kind: "interval",
          intervalMs: 1,
          prompt: "hello",
        },
      ],
    });
    await scheduler.fireNow("tick-me");
    expect(checkpoints).toEqual(["/tmp/ws"]);
    expect(sawConfirm).toBe(true);
  });

  it("persists the enabled flag and reloads it", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "nexus-sched-"));
    const filePath = join(dir, "agent-schedules.json");
    const inbox = new AskInbox();
    try {
      const first = new AgentRunScheduler({
        inbox,
        workspacePath: "/tmp/ws",
        filePath,
        createCheckpoint: async () => null,
        runHeadless: async () => undefined,
      });
      await first.setEnabled(MORNING_BRIEF_SCHEDULE_ID, true);
      const second = await AgentRunScheduler.loadFromFile(filePath, {
        inbox,
        workspacePath: "/tmp/ws",
        createCheckpoint: async () => null,
        runHeadless: async () => undefined,
      });
      expect(second.list().find((s) => s.id === MORNING_BRIEF_SCHEDULE_ID)?.enabled).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tick fires an enabled interval schedule then advances nextFireAt", async () => {
    let clock = 0;
    let fired = 0;
    const scheduler = new AgentRunScheduler({
      inbox: new AskInbox(),
      workspacePath: "/tmp/ws",
      now: () => clock,
      tickIntervalMs: 5,
      setInterval: (cb) => {
        void cb();
        return 1;
      },
      clearInterval: () => undefined,
      createCheckpoint: async () => null,
      runHeadless: async () => {
        fired += 1;
      },
      schedules: [
        {
          id: "t",
          name: "t",
          enabled: true,
          kind: "interval",
          intervalMs: 10,
          prompt: "p",
        },
      ],
    });
    scheduler.start();
    clock = 20;
    await scheduler.tick();
    expect(fired).toBe(1);
    scheduler.stop();
  });

  it("captures an immutable workspace root snapshot for a scheduled run", async () => {
    const roots = ["/tmp/primary", "/tmp/secondary"];
    let firedRoots: readonly string[] = [];
    const scheduler = new AgentRunScheduler({
      inbox: new AskInbox(),
      workspacePath: roots[0]!,
      workspaceRoots: roots,
      primaryRoot: roots[0],
      createCheckpoint: async () => null,
      runHeadless: async (run) => {
        firedRoots = run.workspaceRoots ?? [];
      },
      schedules: [{ id: "snapshot", name: "snapshot", enabled: true, kind: "interval", intervalMs: 1, prompt: "p" }],
    });
    roots.push("/tmp/added-later");
    await scheduler.fireNow("snapshot");
    expect(firedRoots).toEqual(["/tmp/primary", "/tmp/secondary"]);
    expect(Object.isFrozen(firedRoots)).toBe(true);
  });
});
