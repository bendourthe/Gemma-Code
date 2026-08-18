import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScheduledGitCheckpoint } from "../../../modules/coding/autonomy/gitCheckpoint.js";

describe("createScheduledGitCheckpoint", () => {
  it("returns null when the workspace is not a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexus-ckpt-"));
    try {
      expect(await createScheduledGitCheckpoint(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
