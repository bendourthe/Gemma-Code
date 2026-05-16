import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  renderSessionHandoff,
  renderSessionProgress,
  writeSessionDocs,
} from "../../../src/chat/SessionDocs.js";

describe("SessionDocs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sessiondocs-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* tolerated on Windows */
    }
  });

  it("renderSessionHandoff produces a structured markdown layout", () => {
    const md = renderSessionHandoff({
      sessionId: "abc123",
      version: "v0.8.0",
      branch: "main",
      openIssues: ["Item A", "Item B"],
      pendingDecisions: ["Decide X"],
      nextSessionStart: "Pick up at sub-task 5.1.",
      date: "2026-05-16",
    });
    expect(md).toContain("# Session Handoff -- abc123");
    expect(md).toContain("Pick up at sub-task 5.1.");
    expect(md).toContain("- Item A");
    expect(md).toContain("- Decide X");
  });

  it("renderSessionProgress falls back to '(none)' for empty lists", () => {
    const md = renderSessionProgress({
      sessionId: "abc",
      version: "v0.8.0",
      branch: "main",
      commits: [],
      filesTouched: [],
      testsAdded: [],
      notes: [],
      date: "2026-05-16",
    });
    expect(md).toMatch(/Commits\n\n_\(none\)_/);
  });

  it("writeSessionDocs creates both files under the session directory", () => {
    const out = writeSessionDocs(
      tmpDir,
      "v0.8.0",
      "session-1",
      {
        sessionId: "session-1",
        version: "v0.8.0",
        branch: "main",
        openIssues: [],
        pendingDecisions: [],
        nextSessionStart: "n/a",
        date: "2026-05-16",
      },
      {
        sessionId: "session-1",
        version: "v0.8.0",
        branch: "main",
        commits: [],
        filesTouched: [],
        testsAdded: [],
        notes: [],
        date: "2026-05-16",
      },
    );
    expect(fs.existsSync(out.handoffPath)).toBe(true);
    expect(fs.existsSync(out.progressPath)).toBe(true);
    expect(fs.readFileSync(out.handoffPath, "utf8")).toContain("Session Handoff");
    expect(fs.readFileSync(out.progressPath, "utf8")).toContain("Session Progress");
  });
});
