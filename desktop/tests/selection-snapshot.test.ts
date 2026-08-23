import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  appendDownloadedId,
  loadOrMigrate,
  loadSnapshot,
  migrateFromInstalled,
  parseSnapshot,
  saveSnapshot,
  selectionSnapshotPath,
} from "../sidecar/src/models/selectionSnapshot";

describe("selectionSnapshot", () => {
  it("rejects corrupt JSON payloads", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ schemaVersion: 2, orderedIds: [] })).toBeNull();
    expect(parseSnapshot({ schemaVersion: 1, orderedIds: ["ok"] })?.orderedIds).toEqual(["ok"]);
  });

  it("migrates currently installed ids when the file is missing", () => {
    const migrated = migrateFromInstalled([
      { id: "leftover", installed: true, source: "registry", type: "llm" },
      { id: "catalog", installed: false, source: "catalog-only", type: "llm" },
      { id: "sana", installed: true, source: "registry", type: "image", task: "image", tags: ["recommended"] },
    ]);
    expect(migrated.orderedIds).toEqual(["leftover", "sana"]);
    expect(migrated.recommendedByTask.image).toBe("sana");
  });

  it("round-trips on disk and appends later downloads", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-snap-"));
    await saveSnapshot(
      {
        schemaVersion: 1,
        orderedIds: ["lfm2.5:1.2b"],
        recommendedByTask: { chat: "lfm2.5:1.2b" },
        downloadedSinceInstall: [],
      },
      home,
    );
    expect(selectionSnapshotPath(home)).toBe(path.join(home, ".nexus", "selected-models.json"));
    await appendDownloadedId("qwen2.5-coder:7b", home);
    await appendDownloadedId("lfm2.5:1.2b", home);
    const loaded = await loadSnapshot(home);
    expect(loaded?.orderedIds).toEqual(["lfm2.5:1.2b"]);
    expect(loaded?.downloadedSinceInstall).toEqual(["qwen2.5-coder:7b"]);
  });

  it("does not create a snapshot when appending a download with no installer file", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-nosnap-"));
    await appendDownloadedId("qwen2.5-coder:7b", home);
    expect(await loadSnapshot(home)).toBeNull();
  });

  it("writes a migration snapshot when none exists", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-mig-"));
    const snap = await loadOrMigrate(
      [{ id: "a", installed: true, source: "registry" }],
      home,
    );
    expect(snap.orderedIds).toEqual(["a"]);
    expect(await loadSnapshot(home)).toEqual(snap);
  });
});
