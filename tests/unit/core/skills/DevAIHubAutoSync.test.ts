/**
 * v1.1.0 Phase 8.2 -- weekly DevAI-Hub auto-sync worker tests.
 *
 * Asserts the factory returns the right shape and that the IdleScheduler
 * fires the worker after the documented 7-day cadence using a fast-clock
 * fixture.
 */

import { describe, it, expect } from "vitest";
import {
  createDevAIHubSyncTask,
  defaultSyncRunner,
  DEVAI_HUB_SYNC_CADENCE_MS,
  DEVAI_HUB_SYNC_IDLE_MS,
  DEVAI_HUB_SYNC_TASK_ID,
} from "../../../../core/skills/DevAIHubAutoSync.js";
import { IdleScheduler } from "../../../../desktop/sidecar/src/runtime/idleScheduler.js";

describe("DevAIHubAutoSync", () => {
  it("exposes the documented constants", () => {
    expect(DEVAI_HUB_SYNC_TASK_ID).toBe("nexus.skills.devai-hub-sync");
    expect(DEVAI_HUB_SYNC_CADENCE_MS).toBe(7 * 24 * 60 * 60_000);
    expect(DEVAI_HUB_SYNC_IDLE_MS).toBe(5 * 60_000);
  });

  it("createDevAIHubSyncTask returns the scheduler-ready shape with defaults", () => {
    const task = createDevAIHubSyncTask({ runner: async () => {} });
    expect(task.id).toBe(DEVAI_HUB_SYNC_TASK_ID);
    expect(task.idleThresholdMs).toBe(DEVAI_HUB_SYNC_IDLE_MS);
    expect(task.cadenceMs).toBe(DEVAI_HUB_SYNC_CADENCE_MS);
    expect(typeof task.run).toBe("function");
  });

  it("createDevAIHubSyncTask accepts overrides for cadence and idle threshold", () => {
    const task = createDevAIHubSyncTask({
      runner: async () => {},
      cadenceMs: 1000,
      idleThresholdMs: 50,
    });
    expect(task.cadenceMs).toBe(1000);
    expect(task.idleThresholdMs).toBe(50);
  });

  it("fast-clock fixture enforces the 7-day cadence between runs", async () => {
    let now = 0;
    const clock = {
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
    };
    let runs = 0;
    const scheduler = new IdleScheduler({ now: clock.now });
    scheduler.register(
      createDevAIHubSyncTask({
        runner: async () => {
          runs += 1;
        },
      }),
    );
    expect(scheduler.size()).toBe(1);

    // First tick after the idle threshold: the cadence gate skips for
    // lastRunAt=0, so the first run fires once idle elapses.
    clock.advance(10 * 60_000);
    await scheduler.tick();
    expect(runs).toBe(1);

    // Within the 7-day cadence window, more idle ticks do NOT re-fire.
    clock.advance(60 * 60_000);
    await scheduler.tick();
    clock.advance(24 * 60 * 60_000);
    await scheduler.tick();
    clock.advance(5 * 24 * 60 * 60_000);
    await scheduler.tick();
    expect(runs).toBe(1);

    // Just past the cadence boundary -> a second run.
    clock.advance(2 * 24 * 60 * 60_000);
    await scheduler.tick();
    expect(runs).toBe(2);
  });

  it("idle threshold gate blocks the first run until the user is idle long enough", async () => {
    let now = 0;
    const clock = {
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
    };
    let runs = 0;
    const scheduler = new IdleScheduler({ now: clock.now });
    scheduler.register(
      createDevAIHubSyncTask({
        runner: async () => {
          runs += 1;
        },
        idleThresholdMs: 60_000, // 1 minute -- easier to assert
      }),
    );
    // 30 s idle: below the threshold -> no fire.
    clock.advance(30_000);
    await scheduler.tick();
    expect(runs).toBe(0);
    // Past the threshold -> fires.
    clock.advance(60_000);
    await scheduler.tick();
    expect(runs).toBe(1);
  });

  it("defaultSyncRunner returns a function (production loader is lazy)", () => {
    const runner = defaultSyncRunner();
    expect(typeof runner).toBe("function");
  });

  it("toggling registration on / off is observable via scheduler.size()", async () => {
    let now = 0;
    const scheduler = new IdleScheduler({ now: () => now });
    scheduler.register(createDevAIHubSyncTask({ runner: async () => {} }));
    expect(scheduler.size()).toBe(1);
    scheduler.unregister(DEVAI_HUB_SYNC_TASK_ID);
    expect(scheduler.size()).toBe(0);
    scheduler.register(createDevAIHubSyncTask({ runner: async () => {} }));
    expect(scheduler.size()).toBe(1);
  });
});
