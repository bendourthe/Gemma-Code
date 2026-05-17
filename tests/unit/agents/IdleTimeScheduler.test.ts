import { describe, it, expect, vi } from "vitest";
import {
  IdleTimeScheduler,
  type IdleActivitySource,
  type IdleScheduledTask,
} from "../../../src/agents/IdleTimeScheduler.js";

/**
 * v0.9.0 Phase 6.1 -- IdleTimeScheduler unit tests.
 *
 * The scheduler exposes injectable clock + injectable timers, so every test
 * here is deterministic with no real `setInterval`. The activity source is
 * also injectable; production wires it to `vscode.workspace.onDidChange*`.
 */

interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

function fakeClock(start: number = 1_000_000): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

function makeScheduler(now: () => number) {
  return new IdleTimeScheduler({
    now,
    // Use a no-op timer; tests drive `tick()` directly.
    setInterval: () => 1,
    clearInterval: () => undefined,
    tickIntervalMs: 30_000,
  });
}

describe("IdleTimeScheduler", () => {
  it("registers tasks idempotently", () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    const task: IdleScheduledTask = {
      id: "alpha",
      idleThresholdMs: 1000,
      cadenceMs: 5000,
      run: async () => undefined,
    };
    sched.register(task);
    sched.register(task);
    expect(sched.size()).toBe(1);
    sched.register({ ...task, id: "beta" });
    expect(sched.size()).toBe(2);
    sched.unregister("alpha");
    expect(sched.size()).toBe(1);
  });

  it("rejects negative thresholds", () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    expect(() =>
      sched.register({
        id: "bad",
        idleThresholdMs: -1,
        cadenceMs: 10,
        run: async () => undefined,
      }),
    ).toThrow(/negative thresholds/);
    expect(() =>
      sched.register({
        id: "bad2",
        idleThresholdMs: 10,
        cadenceMs: -1,
        run: async () => undefined,
      }),
    ).toThrow(/negative thresholds/);
  });

  it("does not fire before the idle threshold elapses", async () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    const spy = vi.fn(async () => undefined);
    sched.register({
      id: "task",
      idleThresholdMs: 1000,
      cadenceMs: 0,
      run: spy,
    });
    sched.notifyActivity();
    clock.advance(500);
    await sched.tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it("fires once the idle threshold elapses", async () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    const spy = vi.fn(async () => undefined);
    sched.register({
      id: "task",
      idleThresholdMs: 1000,
      cadenceMs: 0,
      run: spy,
    });
    sched.notifyActivity();
    clock.advance(1500);
    await sched.tick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("blocks subsequent fires until the cadence is satisfied", async () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    const spy = vi.fn(async () => undefined);
    sched.register({
      id: "task",
      idleThresholdMs: 100,
      cadenceMs: 10_000,
      run: spy,
    });
    sched.notifyActivity();
    clock.advance(500);
    await sched.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    // Time passes but cadence still unmet.
    clock.advance(5000);
    await sched.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    // Cadence now satisfied.
    clock.advance(6000);
    await sched.tick();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resets idle clock on activity, blocking imminent fires", async () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    const spy = vi.fn(async () => undefined);
    sched.register({
      id: "task",
      idleThresholdMs: 1000,
      cadenceMs: 0,
      run: spy,
    });
    sched.notifyActivity();
    clock.advance(900);
    sched.notifyActivity();
    clock.advance(500); // <1000 since last activity
    await sched.tick();
    expect(spy).not.toHaveBeenCalled();
    clock.advance(700); // now 1200 since last activity
    await sched.tick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not advance cadence cursor when task throws", async () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    let calls = 0;
    sched.register({
      id: "task",
      idleThresholdMs: 100,
      cadenceMs: 10_000,
      run: async () => {
        calls += 1;
        throw new Error("boom");
      },
    });
    sched.notifyActivity();
    clock.advance(500);
    await sched.tick();
    expect(calls).toBe(1);
    // Idle still satisfied; cadence cursor was NOT advanced so a retry can fire.
    clock.advance(1);
    await sched.tick();
    expect(calls).toBe(2);
  });

  it("wires activity events from the injected source", () => {
    const clock = fakeClock();
    const textListeners: Array<() => void> = [];
    const editorListeners: Array<() => void> = [];
    const source: IdleActivitySource = {
      onDidChangeTextDocument: (l) => {
        textListeners.push(l);
        return { dispose: () => undefined };
      },
      onDidChangeActiveTextEditor: (l) => {
        editorListeners.push(l);
        return { dispose: () => undefined };
      },
    };
    const sched = new IdleTimeScheduler({
      now: clock.now,
      setInterval: () => 1,
      clearInterval: () => undefined,
      activitySource: source,
    });
    expect(textListeners.length).toBe(1);
    expect(editorListeners.length).toBe(1);
    clock.advance(5000);
    // Initial activity was at construction time; advance and fire an event.
    textListeners[0]!();
    expect(sched.lastUserActivityAt()).toBe(clock.now());
    clock.advance(2000);
    editorListeners[0]!();
    expect(sched.lastUserActivityAt()).toBe(clock.now());
  });

  it("start() + stop() are idempotent", () => {
    const clock = fakeClock();
    let setCount = 0;
    let clearCount = 0;
    const sched = new IdleTimeScheduler({
      now: clock.now,
      setInterval: () => {
        setCount += 1;
        return setCount;
      },
      clearInterval: () => {
        clearCount += 1;
      },
    });
    sched.start();
    sched.start();
    expect(setCount).toBe(1);
    sched.stop();
    sched.stop();
    expect(clearCount).toBe(1);
  });

  it("supports curator + reflect side-by-side with different thresholds", async () => {
    const clock = fakeClock();
    const sched = makeScheduler(clock.now);
    const curatorSpy = vi.fn(async () => undefined);
    const reflectSpy = vi.fn(async () => undefined);
    sched.register({
      id: "curator-worker",
      idleThresholdMs: 5 * 60 * 1000,
      cadenceMs: 12 * 60 * 60 * 1000,
      run: curatorSpy,
    });
    sched.register({
      id: "reflect-worker",
      idleThresholdMs: 10 * 60 * 1000,
      cadenceMs: 24 * 60 * 60 * 1000,
      run: reflectSpy,
    });
    sched.notifyActivity();
    // 6 minutes idle -- curator fires, reflect does not.
    clock.advance(6 * 60 * 1000);
    await sched.tick();
    expect(curatorSpy).toHaveBeenCalledTimes(1);
    expect(reflectSpy).not.toHaveBeenCalled();
    // Bring total idle to 11 minutes -- reflect now fires (curator blocked by cadence).
    clock.advance(5 * 60 * 1000);
    await sched.tick();
    expect(curatorSpy).toHaveBeenCalledTimes(1);
    expect(reflectSpy).toHaveBeenCalledTimes(1);
  });
});
