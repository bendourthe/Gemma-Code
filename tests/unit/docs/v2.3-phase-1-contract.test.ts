import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DEVELOPMENT_ROOT = join(REPO_ROOT, "docs/v2/v2.3/development");
const HUB_HANDOFF = join(
  DEVELOPMENT_ROOT,
  "nexus-hub-security-audit-handoff.md",
);
const QWEN_ADMISSION = join(DEVELOPMENT_ROOT, "model-admission-qwen38.md");
const VIDEO_CONTRACT = join(DEVELOPMENT_ROOT, "video-enhancement-contract.md");
const HISTORY = join(
  DEVELOPMENT_ROOT,
  "history/2026-08-27_v2.3.0-phase-1-decisions.md",
);
const CATALOG = join(REPO_ROOT, "core/registry/catalog.json");
const DECISION_DOCS = [HUB_HANDOFF, QWEN_ADMISSION, VIDEO_CONTRACT] as const;

function markdownRelativeTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1]?.trim();
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) {
      continue;
    }
    targets.push(raw.split("#")[0] ?? raw);
  }
  return targets;
}

describe("v2.3 Phase 1 decision contracts", () => {
  it("keeps decision documents ASCII-safe with resolvable relative links", () => {
    const missing: string[] = [];
    const nonAscii: string[] = [];
    for (const doc of [...DECISION_DOCS, HISTORY]) {
      const markdown = readFileSync(doc, "utf8");
      if (/[^\x00-\x7f]/.test(markdown)) nonAscii.push(doc);
      for (const target of markdownRelativeTargets(markdown)) {
        const targetPath = resolve(dirname(doc), target);
        if (!existsSync(targetPath)) missing.push(`${doc} -> ${target}`);
      }
    }
    expect(nonAscii, nonAscii.join("\n")).toEqual([]);
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("keeps Qwen3.8 fail-closed behind exactly six gates", () => {
    const admission = readFileSync(QWEN_ADMISSION, "utf8");
    const catalog = readFileSync(CATALOG, "utf8").toLowerCase();
    const gateNumbers = [...admission.matchAll(/^\| ([1-6])\./gm)].map(
      (match) => match[1],
    );

    expect(gateNumbers).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(admission).toContain("Rejected for v2.3.0 catalog admission");
    expect(admission).toContain("51B n-gram embeddings");
    expect(admission).toContain("4B multi-token-prediction parameters");
    expect(admission).toContain("not a legal conclusion");
    expect(admission).toContain("no entry to `core/registry/catalog.json`");
    expect(catalog).not.toContain("qwen3.8-flash-next");
  });

  it("pins the guarded Video2X boundary and immutable publication flow", () => {
    const contract = readFileSync(VIDEO_CONTRACT, "utf8");

    expect(contract).toContain("video2x-cli-6.4.0");
    expect(contract).toContain("a96bda9b4d79616cc6b71b94e6945146b5b4d509");
    expect(contract).toContain("`NEXUS_VIDEO2X_PATH`");
    expect(contract).toContain("does not search `PATH`");
    expect(contract).toContain("`shell: false`");
    expect(contract).toMatch(
      /will not bundle, link, download, update, or copy Video2X/i,
    );
    expect(contract).toMatch(/cancellation is authoritative in Nexus/i);
    expect(contract).toMatch(/atomic publication/i);
    expect(contract).toContain("Verify the original source still has the same");
    expect(contract).toContain("`animation-upscale-2x`");
    expect(contract).toContain("`general-upscale-4x`");
    expect(contract).toContain("`smooth-2x`");
    expect(contract).toContain("does not expose arbitrary 48/60 FPS, 1080p/4K");
  });

  it("keeps the Hub work upstream with the authoritative receipt vocabulary", () => {
    const handoff = readFileSync(HUB_HANDOFF, "utf8");

    for (const state of [
      "`RAN`",
      "`NOT_APPLICABLE`",
      "`UNAVAILABLE`",
      "`FAILED`",
      "`DECLINED`",
    ]) {
      expect(handoff).toContain(state);
    }
    expect(handoff).toContain("`data/workflows.json`");
    expect(handoff).toContain("`data/bundles.json`");
    expect(handoff).toContain("aggregate deterministic coverage degraded");
    expect(handoff).toContain("does not edit, commit, or publish");
    expect(handoff).toContain(
      "There is no official v4.1.1 implementation branch",
    );
    expect(handoff).toContain("independent verifier");
  });

  it("assigns all nine seeded criteria to later plan tasks", () => {
    const history = readFileSync(HISTORY, "utf8");
    const rows = history
      .split(/\r?\n/)
      .filter((line) => /^\|\s+AC-\d{2}\s+\|/.test(line));

    expect(rows).toHaveLength(9);
    for (let index = 1; index <= 9; index += 1) {
      const id = `AC-${String(index).padStart(2, "0")}`;
      const row = rows.find((candidate) =>
        new RegExp(`^\\|\\s+${id}\\s+\\|`).test(candidate),
      );
      expect(row, id).toBeDefined();
      expect(row, id).toMatch(/T00[5-9]|T0[12]\d/);
    }
  });

  it("contains no unresolved decision marker", () => {
    for (const doc of [...DECISION_DOCS, HISTORY]) {
      expect(readFileSync(doc, "utf8"), doc).not.toMatch(
        /\b(?:TODO|TBD|FIXME)\b/,
      );
    }
  });
});
