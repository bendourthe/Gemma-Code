/**
 * v1.1.0 Phase 8.1 -- SkillsReloader fixture tests.
 * v1.10.0 Phase 3 -- retargeted to the `nexus-hub-version.json` sentinel under
 * `~/.nexus-ai/catalog/`. The watcher fires a debounced reload() when the
 * catalog version manifest changes (rewritten on every `sync --apply`).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SkillsReloader,
  type ReloadableCatalog,
} from "../../../../core/skills/SkillsReloader.js";
import { writeHubVersionManifest } from "../../../../core/storage/hubVersionManifest.js";

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
  let catalogRoot: string;
  beforeEach(() => {
    root = mktmp();
    catalogRoot = path.join(root, "catalog");
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("debounces a burst into a single reload", async () => {
    // Drive scheduling directly via `triggerForTest` to avoid the OS
    // file-watcher dependency (Windows occasionally throws EPERM on a
    // freshly-renamed file); production hits the same `_scheduleReload` path.
    const catalog = new CountingCatalog();
    const timers = makeTimerPair();
    const reloader = new SkillsReloader({
      catalogRoot,
      catalog,
      debounceMs: 200,
      setTimeout: timers.setTimeoutFn,
      clearTimeout: timers.clearTimeoutFn,
    });

    reloader.triggerForTest();
    reloader.triggerForTest();

    expect(timers.pending.length).toBe(1);
    timers.flush();
    await catalog.lastResolved;
    expect(catalog.count).toBe(1);
  });

  it("reloadNow fires immediately and increments reloadCount", async () => {
    const catalog = new CountingCatalog();
    const reloader = new SkillsReloader({ catalogRoot, catalog });
    await reloader.reloadNow();
    expect(catalog.count).toBe(1);
    expect(reloader.reloadCount).toBe(1);
  });

  it("stop() detaches watchers and drops a pending debounce timer", () => {
    fs.mkdirSync(catalogRoot, { recursive: true });
    let timersCleared = 0;
    const reloader = new SkillsReloader({
      catalogRoot,
      catalog: new CountingCatalog(),
      setTimeout: () => ({}),
      clearTimeout: () => {
        timersCleared += 1;
      },
    });
    reloader.triggerForTest();
    reloader.stop();
    reloader.stop(); // idempotent
    expect(timersCleared).toBeGreaterThanOrEqual(1);
  });

  it("onReload callback receives the installed catalog version", async () => {
    writeHubVersionManifest(catalogRoot, { version: "v1.5.0" });
    let observed: string | null = "";
    const catalog = new CountingCatalog();
    const reloader = new SkillsReloader({
      catalogRoot,
      catalog,
      onReload: (version) => {
        observed = version;
      },
    });
    await reloader.reloadNow();
    expect(observed).toBe("v1.5.0");
  });

  it("reports an error via onError when reload throws", async () => {
    const errors: unknown[] = [];
    const reloader = new SkillsReloader({
      catalogRoot,
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
