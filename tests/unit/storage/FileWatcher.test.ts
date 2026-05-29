/**
 * v1.2.0 Phase 6.1 -- unit tests for the FileWatcher abstraction.
 *
 * The tests inject the underlying subscribe impl so they do not depend
 * on real fs.watch behavior (which is non-deterministic across
 * platforms). The debounce window is dialed down to 50 ms.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { FileWatcher, type NativeEventKind } from "../../../core/storage/FileWatcher.js";

interface FakeSubscriber {
  readonly subscribe: NonNullable<
    ConstructorParameters<typeof FileWatcher>[1]
  >["subscribe"];
  emit(kind: NativeEventKind, relPath: string): void;
  callCount(): number;
}

function makeFakeSubscriber(): FakeSubscriber {
  let active: ((kind: NativeEventKind, relPath: string) => void) | null = null;
  let calls = 0;
  return {
    subscribe: (_root, onEvent) => {
      active = onEvent;
      return () => {
        active = null;
      };
    },
    emit(kind, relPath) {
      if (active) {
        calls += 1;
        active(kind, relPath);
      }
    },
    callCount() {
      return calls;
    },
  };
}

describe("FileWatcher", () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-fw-"));
  });

  it("debounces a burst of native events into one callback fire", async () => {
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 25,
      subscribe: fake.subscribe,
      honorIgnoreFiles: false,
    });
    let fires = 0;
    let lastBatch: readonly { path: string; kind: string }[] = [];
    watcher.watch((changes) => {
      fires += 1;
      lastBatch = changes;
    });
    // Emit 100 events in tight succession.
    for (let i = 0; i < 100; i += 1) {
      fake.emit("modify", `src/file-${i}.ts`);
    }
    // pendingChanges should reflect dedup-by-path (no duplicates here, so 100).
    expect(watcher.pendingChanges()).toHaveLength(100);
    // Force the timer.
    await watcher.flushForTest();
    expect(fires).toBe(1);
    expect(lastBatch).toHaveLength(100);
    watcher.stop();
  });

  it("dedups repeated events for the same path (last-write-wins)", async () => {
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 25,
      subscribe: fake.subscribe,
      honorIgnoreFiles: false,
    });
    let batch: readonly { path: string; kind: string }[] = [];
    watcher.watch((changes) => {
      batch = changes;
    });
    fake.emit("create", "src/x.ts");
    fake.emit("modify", "src/x.ts");
    fake.emit("modify", "src/x.ts");
    expect(watcher.pendingChanges()).toHaveLength(1);
    await watcher.flushForTest();
    expect(batch).toHaveLength(1);
    expect(batch[0]?.path).toBe("src/x.ts");
    // last-write-wins: the most recent kind was `modify`.
    expect(batch[0]?.kind).toBe("modified");
    watcher.stop();
  });

  it("delete supersedes modify for the same path", async () => {
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 25,
      subscribe: fake.subscribe,
      honorIgnoreFiles: false,
    });
    let batch: readonly { path: string; kind: string }[] = [];
    watcher.watch((changes) => {
      batch = changes;
    });
    fake.emit("modify", "src/y.ts");
    fake.emit("delete", "src/y.ts");
    // A spurious follow-up modify after delete must not downgrade to modify.
    fake.emit("modify", "src/y.ts");
    await watcher.flushForTest();
    expect(batch).toHaveLength(1);
    expect(batch[0]?.kind).toBe("removed");
    watcher.stop();
  });

  it("honors .nexusignore exclusions", async () => {
    fs.writeFileSync(path.join(tmpRoot, ".nexusignore"), "secrets/\n*.log\n");
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 25,
      subscribe: fake.subscribe,
      honorIgnoreFiles: true,
    });
    let batch: readonly { path: string; kind: string }[] = [];
    watcher.watch((changes) => {
      batch = changes;
    });
    fake.emit("modify", "src/keep.ts");
    fake.emit("modify", "secrets/api-key.json");
    fake.emit("modify", "logs/run.log");
    await watcher.flushForTest();
    const paths = batch.map((c) => c.path);
    expect(paths).toContain("src/keep.ts");
    expect(paths).not.toContain("secrets/api-key.json");
    expect(paths).not.toContain("logs/run.log");
    watcher.stop();
  });

  it("honors .gitignore in addition to .nexusignore", async () => {
    fs.writeFileSync(path.join(tmpRoot, ".gitignore"), "private/\n");
    fs.writeFileSync(path.join(tmpRoot, ".nexusignore"), "vendor/\n");
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 25,
      subscribe: fake.subscribe,
      honorIgnoreFiles: true,
    });
    let batch: readonly { path: string; kind: string }[] = [];
    watcher.watch((changes) => {
      batch = changes;
    });
    fake.emit("modify", "src/keep.ts");
    fake.emit("modify", "private/secrets.env");
    fake.emit("modify", "vendor/external.js");
    await watcher.flushForTest();
    const paths = batch.map((c) => c.path);
    expect(paths).toEqual(["src/keep.ts"]);
    watcher.stop();
  });

  it("pendingChanges() returns a frozen snapshot", () => {
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 100,
      subscribe: fake.subscribe,
      honorIgnoreFiles: false,
    });
    watcher.watch(() => {});
    fake.emit("modify", "src/a.ts");
    const snap = watcher.pendingChanges();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap).toHaveLength(1);
    watcher.stop();
  });

  it("stop() is idempotent and clears pending state", () => {
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 1000,
      subscribe: fake.subscribe,
      honorIgnoreFiles: false,
    });
    watcher.watch(() => {});
    fake.emit("modify", "src/a.ts");
    expect(watcher.pendingChanges()).toHaveLength(1);
    watcher.stop();
    watcher.stop();
    expect(watcher.pendingChanges()).toHaveLength(0);
  });

  it("normalises Windows backslashes to forward slashes", async () => {
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 25,
      subscribe: fake.subscribe,
      honorIgnoreFiles: false,
    });
    let batch: readonly { path: string; kind: string }[] = [];
    watcher.watch((changes) => {
      batch = changes;
    });
    fake.emit("modify", "src\\nested\\file.ts");
    await watcher.flushForTest();
    expect(batch[0]?.path).toBe("src/nested/file.ts");
    watcher.stop();
  });

  it("refreshes ignore patterns between callback fires", async () => {
    const fake = makeFakeSubscriber();
    const watcher = new FileWatcher(tmpRoot, {
      debounceMs: 25,
      subscribe: fake.subscribe,
      honorIgnoreFiles: true,
    });
    let batches: Array<readonly { path: string; kind: string }[]> = [];
    watcher.watch((changes) => {
      batches.push(changes);
    });
    fake.emit("modify", "tracked/x.ts");
    await watcher.flushForTest();
    expect(batches[0]?.map((c) => c.path)).toEqual(["tracked/x.ts"]);

    // Now write .nexusignore that excludes tracked/, then fire again.
    fs.writeFileSync(path.join(tmpRoot, ".nexusignore"), "tracked/\n");
    fake.emit("modify", "tracked/y.ts");
    fake.emit("modify", "src/z.ts");
    await watcher.flushForTest();
    expect(batches[1]?.map((c) => c.path)).toEqual(["src/z.ts"]);
    watcher.stop();
  });
});
