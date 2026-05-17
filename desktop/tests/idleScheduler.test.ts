import { describe, expect, it } from "vitest";
import {
  bootstrapIdleScheduler,
  CURATOR_CADENCE_MS,
  CURATOR_IDLE_MS,
  CURATOR_TASK_ID,
  IdleScheduler,
  REFLECT_CADENCE_MS,
  REFLECT_IDLE_MS,
  REFLECT_TASK_ID,
} from "../sidecar/src/runtime/idleScheduler";

function makeClock(startMs = 0): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = startMs;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("IdleScheduler", () => {
  it("rejects negative thresholds at registration", () => {
    const sched = new IdleScheduler({ now: () => 0 });
    expect(() =>
      sched.register({ id: "x", idleThresholdMs: -1, cadenceMs: 1, run: async () => {} }),
    ).toThrow(/negative thresholds/);
    expect(() =>
      sched.register({ id: "x", idleThresholdMs: 1, cadenceMs: -1, run: async () => {} }),
    ).toThrow(/negative thresholds/);
  });

  it("fires a task only after the idle threshold passes", async () => {
    const clock = makeClock(0);
    const sched = new IdleScheduler({ now: clock.now });
    let runs = 0;
    sched.register({
      id: "x",
      idleThresholdMs: 1000,
      cadenceMs: 5000,
      run: async () => {
        runs += 1;
      },
    });
    await sched.tick();
    expect(runs).toBe(0);
    clock.advance(1500);
    await sched.tick();
    expect(runs).toBe(1);
  });

  it("enforces the cadence gate on subsequent runs", async () => {
    const clock = makeClock(0);
    const sched = new IdleScheduler({ now: clock.now });
    let runs = 0;
    sched.register({
      id: "x",
      idleThresholdMs: 100,
      cadenceMs: 10000,
      run: async () => {
        runs += 1;
      },
    });
    clock.advance(200);
    await sched.tick();
    expect(runs).toBe(1);
    clock.advance(500);
    await sched.tick();
    expect(runs).toBe(1); // cadence not satisfied
    clock.advance(15000);
    await sched.tick();
    expect(runs).toBe(2);
  });

  it("resets the idle clock when activity is reported", async () => {
    const clock = makeClock(0);
    const sched = new IdleScheduler({ now: clock.now });
    let runs = 0;
    sched.register({
      id: "x",
      idleThresholdMs: 1000,
      cadenceMs: 1,
      run: async () => {
        runs += 1;
      },
    });
    clock.advance(500);
    sched.notifyActivity();
    clock.advance(700);
    await sched.tick();
    expect(runs).toBe(0);
    clock.advance(500);
    await sched.tick();
    expect(runs).toBe(1);
  });

  it("does not advance the cadence cursor when a task throws", async () => {
    const clock = makeClock(0);
    const sched = new IdleScheduler({ now: clock.now });
    let attempts = 0;
    sched.register({
      id: "x",
      idleThresholdMs: 10,
      cadenceMs: 1000,
      run: async () => {
        attempts += 1;
        throw new Error("boom");
      },
    });
    clock.advance(20);
    await sched.tick();
    clock.advance(20);
    await sched.tick();
    expect(attempts).toBe(2);
  });

  it("unregister removes the task", async () => {
    const sched = new IdleScheduler({ now: () => 0 });
    sched.register({ id: "x", idleThresholdMs: 0, cadenceMs: 0, run: async () => {} });
    expect(sched.size()).toBe(1);
    sched.unregister("x");
    expect(sched.size()).toBe(0);
  });

  it("start / stop install and clear the tick interval", () => {
    let installed: (() => void) | null = null;
    let handle: object | null = null;
    let cleared: object | null = null;
    const sched = new IdleScheduler({
      now: () => 0,
      setInterval: (cb) => {
        installed = cb;
        handle = {};
        return handle;
      },
      clearInterval: (h) => {
        cleared = h as object;
      },
    });
    sched.start();
    expect(installed).not.toBeNull();
    sched.start(); // idempotent
    sched.stop();
    expect(cleared).toBe(handle);
  });

  it("subscribes to activitySource and disposes on stop", () => {
    const disposes: number[] = [];
    let bound: (() => void) | null = null;
    const sched = new IdleScheduler({
      now: () => 0,
      activitySource: {
        onActivity: (listener) => {
          bound = listener;
          return { dispose: () => disposes.push(1) };
        },
      },
    });
    expect(bound).not.toBeNull();
    sched.stop();
    expect(disposes).toEqual([1]);
  });

  it("bootstrapIdleScheduler registers curator + reflect with the documented thresholds", async () => {
    const clock = makeClock(0);
    let curatorRuns = 0;
    let reflectRuns = 0;
    const sched = bootstrapIdleScheduler(
      {
        curator: async () => {
          curatorRuns += 1;
        },
        reflect: async () => {
          reflectRuns += 1;
        },
      },
      { now: clock.now },
    );
    expect(sched.size()).toBe(2);
    // Within 30 minutes: curator (5min idle) fires; reflect (10min idle) also fires.
    clock.advance(30 * 60_000);
    await sched.tick();
    expect(curatorRuns).toBe(1);
    expect(reflectRuns).toBe(1);
    // Within the same window, cadence (12h / 24h) prevents re-fire.
    clock.advance(60 * 60_000);
    await sched.tick();
    expect(curatorRuns).toBe(1);
    expect(reflectRuns).toBe(1);
  });

  it("integration: 30-minute synthetic idle window fires curator exactly once", async () => {
    const clock = makeClock(0);
    let curatorRuns = 0;
    const sched = bootstrapIdleScheduler(
      {
        curator: async () => {
          curatorRuns += 1;
        },
        reflect: async () => {},
      },
      { now: clock.now },
    );
    // Drive 30 ticks of 1-minute each.
    for (let i = 0; i < 30; i++) {
      clock.advance(60_000);
      await sched.tick();
    }
    expect(curatorRuns).toBe(1);
  });

  it("exposes documented constants for downstream consumers", () => {
    expect(CURATOR_TASK_ID).toMatch(/^nexus\.coding\.curator$/);
    expect(REFLECT_TASK_ID).toMatch(/^nexus\.coding\.reflect$/);
    expect(CURATOR_IDLE_MS).toBe(5 * 60_000);
    expect(CURATOR_CADENCE_MS).toBe(12 * 60 * 60_000);
    expect(REFLECT_IDLE_MS).toBe(10 * 60_000);
    expect(REFLECT_CADENCE_MS).toBe(24 * 60 * 60_000);
  });
});
