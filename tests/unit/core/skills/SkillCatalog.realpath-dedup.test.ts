import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  InMemorySkillCatalog,
  dedupeByRealpath,
  type Skill,
} from "../../../../core/skills/SkillCatalog.js";
import {
  InProcessTelemetryBus,
  type TelemetryEvent,
} from "../../../../core/telemetry/TelemetryBus.js";

const HASH = "0".repeat(64);

/**
 * Probe whether this host can create directory symlinks without elevation.
 * Junctions are privilege-free on Windows; on POSIX a plain symlink is used.
 * When neither works the symlink-dependent cases are skipped.
 */
function detectSymlinkSupport(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-dedup-probe-"));
  try {
    const target = path.join(probe, "target");
    fs.mkdirSync(target);
    fs.symlinkSync(
      target,
      path.join(probe, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

const CAN_SYMLINK = detectSymlinkSupport();

function skill(id: string, source: Skill["provenance"]["source"], p: string): Skill {
  return {
    id,
    displayName: id,
    category: "test",
    path: p,
    frontmatter: {},
    body: "# x\n",
    provenance: { source, contentHash: HASH },
  };
}

describe("dedupeByRealpath (symlink fixture)", () => {
  let root: string;
  let realSkillMd: string;
  let linkedSkillMd: string;

  beforeAll(() => {
    if (!CAN_SYMLINK) return;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-dedup-"));
    const realDir = path.join(root, "real");
    fs.mkdirSync(realDir);
    realSkillMd = path.join(realDir, "SKILL.md");
    fs.writeFileSync(realSkillMd, "# real\n", "utf8");
    const linkDir = path.join(root, "linked");
    fs.symlinkSync(realDir, linkDir, process.platform === "win32" ? "junction" : "dir");
    linkedSkillMd = path.join(linkDir, "SKILL.md");
  });

  afterAll(() => {
    if (CAN_SYMLINK && root) fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!CAN_SYMLINK)(
    "drops the lower-priority source when two paths resolve to the same physical file",
    () => {
      const deduped = dedupeByRealpath([
        skill("nexus-hub/x", "nexus-hub", linkedSkillMd),
        skill("x", "builtin", realSkillMd),
      ]);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.provenance.source).toBe("builtin");
    },
  );

  it.skipIf(!CAN_SYMLINK)("keeps user over nexus-hub regardless of input order", () => {
    const deduped = dedupeByRealpath([
      skill("user/x", "user", realSkillMd),
      skill("nexus-hub/x", "nexus-hub", linkedSkillMd),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.provenance.source).toBe("user");
  });

  it.skipIf(!CAN_SYMLINK)("emits a skills.dedup telemetry event for the dropped entry", () => {
    const bus = new InProcessTelemetryBus();
    const events: TelemetryEvent[] = [];
    bus.subscribe({ kinds: ["skills.dedup"] }, (e) => events.push(e));
    dedupeByRealpath(
      [
        skill("x", "builtin", realSkillMd),
        skill("nexus-hub/x", "nexus-hub", linkedSkillMd),
      ],
      bus,
    );
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as { keptPath: string; droppedPath: string };
    expect(payload.keptPath).toBe(realSkillMd);
    expect(payload.droppedPath).toBe(linkedSkillMd);
  });

  it.skipIf(!CAN_SYMLINK)("InMemorySkillCatalog dedups symlinked roots at construction", () => {
    const catalog = new InMemorySkillCatalog([
      skill("nexus-hub/x", "nexus-hub", linkedSkillMd),
      skill("x", "builtin", realSkillMd),
    ]);
    const records = catalog.list();
    expect(records).toHaveLength(1);
    expect(records[0]!.provenance.source).toBe("builtin");
  });
});

describe("dedupeByRealpath (no symlinks)", () => {
  it("keeps every entry when paths resolve to distinct physical files", () => {
    const deduped = dedupeByRealpath([
      skill("a", "builtin", "/skills/a/SKILL.md"),
      skill("b", "user", "/skills/b/SKILL.md"),
    ]);
    expect(deduped).toHaveLength(2);
  });

  it("falls back to the literal path for nonexistent paths (no false dedup)", () => {
    // Two different logical paths that do not exist on disk must NOT collapse.
    const deduped = dedupeByRealpath([
      skill("a", "builtin", "/nope/one/SKILL.md"),
      skill("b", "nexus-hub", "/nope/two/SKILL.md"),
    ]);
    expect(deduped).toHaveLength(2);
  });

  it("emits no telemetry when there is nothing to drop", () => {
    const bus = new InProcessTelemetryBus();
    let count = 0;
    bus.subscribe({ kinds: ["skills.dedup"] }, () => (count += 1));
    dedupeByRealpath([skill("a", "builtin", "/skills/a/SKILL.md")], bus);
    expect(count).toBe(0);
  });
});
