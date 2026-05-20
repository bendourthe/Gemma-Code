/**
 * v1.1.0 Phase 8.1 -- SkillsReloader fixture tests.
 *
 * Drives the `nexus skills sync --apply` write-tmp-then-rename pattern
 * against a fixture skills root and asserts that `reload()` fires once
 * per pointer rotation thanks to the 200 ms debounce.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SkillsReloader,
  type ReloadableCatalog,
} from "../../../../core/skills/SkillsReloader.js";
import { activeTagPointerPath } from "../../../../core/skills/DevAIHubSyncer.js";

class CountingCatalog implements ReloadableCatalog {
  count = 0;
  lastResolved: Promise<void> | null = null;
  reload(): Promise<void> {
    this.count += 1;
    this.lastResolved = Promise.resolve();
    return this.lastResolved;
  }
}

function makeTimerPair() {
  type Pending = { handle: object; cb: () => void };
  const pending: Pending[] = [];
  const setTimeoutFn = (cb: () => void, _ms: number): unknown => {
    const handle = {};
    pending.push({ handle, cb });
    return handle;
  };
  const clearTimeoutFn = (h: unknown): void => {
    const idx = pending.findIndex((p) => p.handle === h);
    if (idx !== -1) pending.splice(idx, 1);
  };
  const flush = (): void => {
    const drain = pending.splice(0, pending.length);
    for (const { cb } of drain) cb();
  };
  return { setTimeoutFn, clearTimeoutFn, flush, pending };
}

function mktmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexus-reloader-"));
}

describe("SkillsReloader", () => {
  let root: string;
  beforeEach(() => {
    root = mktmp();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("debounces a write-tmp-then-rename burst into a single reload", async () => {
    // We do NOT rely on fs.watch firing here -- Windows occasionally
    // throws EPERM when watching a freshly-renamed file, and the OS
    // schedule is non-deterministic. The watcher is unit-tested via the
    // `triggerForTest` surface, which calls into the same `_scheduleReload`
    // path the real callback uses. Production hits this path via the OS
    // event.
    const skillsRoot = path.join(root, "skills");
    const pointer = activeTagPointerPath(skillsRoot);
    fs.mkdirSync(path.dirname(pointer), { recursive: true });
    fs.writeFileSync(pointer, "v1.3.1", "utf-8");

    const catalog = new CountingCatalog();
    const timers = makeTimerPair();
    const reloader = new SkillsReloader({
      skillsRoot,
      catalog,
      debounceMs: 200,
      setTimeout: timers.setTimeoutFn,
      clearTimeout: timers.clearTimeoutFn,
    });
    // Do not call start() -- we drive scheduling directly to avoid the
    // OS file-watcher dependency on Windows.

    // Burst: two scheduling calls back-to-back simulate the syncer's
    // write-tmp-then-rename rotation pattern.
    reloader.triggerForTest();
    reloader.triggerForTest();

    // Debounce keeps at most one pending timer.
    expect(timers.pending.length).toBe(1);
    timers.flush();
    await catalog.lastResolved;
    expect(catalog.count).toBe(1);
  });

  it("reloadNow fires immediately and increments reloadCount", async () => {
    const skillsRoot = path.join(root, "skills");
    const pointer = activeTagPointerPath(skillsRoot);
    fs.mkdirSync(path.dirname(pointer), { recursive: true });
    fs.writeFileSync(pointer, "v1.4.0", "utf-8");
    const catalog = new CountingCatalog();
    const reloader = new SkillsReloader({ skillsRoot, catalog });
    // Skip start() -- the unit test verifies reloadNow() in isolation.
    await reloader.reloadNow();
    expect(catalog.count).toBe(1);
    expect(reloader.reloadCount).toBe(1);
  });

  it("stop() detaches watchers and drops a pending debounce timer", () => {
    const skillsRoot = path.join(root, "skills");
    fs.mkdirSync(skillsRoot, { recursive: true });
    let timersCleared = 0;
    const reloader = new SkillsReloader({
      skillsRoot,
      catalog: new CountingCatalog(),
      setTimeout: () => ({}),
      clearTimeout: () => {
        timersCleared += 1;
      },
    });
    // triggerForTest queues a pending timer without needing fs.watch.
    reloader.triggerForTest();
    reloader.stop();
    // No exception; idempotent.
    reloader.stop();
    expect(timersCleared).toBeGreaterThanOrEqual(1);
  });

  it("onReload callback receives the active tag", async () => {
    const skillsRoot = path.join(root, "skills");
    const pointer = activeTagPointerPath(skillsRoot);
    fs.mkdirSync(path.dirname(pointer), { recursive: true });
    fs.writeFileSync(pointer, "v1.5.0", "utf-8");
    let observed: string | null = "";
    const catalog = new CountingCatalog();
    const reloader = new SkillsReloader({
      skillsRoot,
      catalog,
      onReload: (tag) => {
        observed = tag;
      },
    });
    await reloader.reloadNow();
    expect(observed).toBe("v1.5.0");
  });

  it("reports an error via onError when reload throws", async () => {
    const skillsRoot = path.join(root, "skills");
    fs.mkdirSync(path.dirname(activeTagPointerPath(skillsRoot)), { recursive: true });
    const errors: unknown[] = [];
    const reloader = new SkillsReloader({
      skillsRoot,
      catalog: {
        reload(): Promise<void> {
          return Promise.reject(new Error("boom"));
        },
      },
      onError: (e) => {
        errors.push(e);
      },
    });
    await reloader.reloadNow();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
  });
});
