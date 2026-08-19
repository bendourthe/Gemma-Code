/**
 * v1.19.1 Phase 1 -- skill-native adoption note must stay honest against
 * the builtin catalog. A duplicate builtin skill would violate the
 * reverse-engineer-first "do not rebuild" mapping. Hub skill bodies are
 * not in this repository; CI asserts the Nexus-AI contract only.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const SKILL_NOTE = join(
  REPO_ROOT,
  "docs/reference/skill-native-adoptions-v1.19.1.md",
);
const BUILTIN_SKILLS = join(REPO_ROOT, "modules/coding/skills/catalog");

function markdownRelativeTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    if (raw.startsWith("#")) continue;
    targets.push(raw.split("#")[0] ?? raw);
  }
  return targets;
}

describe("v1.19.1 Phase 1 skill-native reference", () => {
  it("internal links in the adoption note resolve", () => {
    const markdown = readFileSync(SKILL_NOTE, "utf8");
    const missing: string[] = [];
    for (const target of markdownRelativeTargets(markdown)) {
      const resolved = resolve(dirname(SKILL_NOTE), target);
      if (!existsSync(resolved)) {
        missing.push(`${target} (${resolved})`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("maps the three Hub skill edits and the four verify-only dedups", () => {
    const note = readFileSync(SKILL_NOTE, "utf8");
    expect(note).toContain("deep-research-compilation");
    expect(note).toContain("[UNVERIFIED QUOTE]");
    expect(note).toContain("[UNSUPPORTED]");
    expect(note).toContain("prompt-engineering");
    expect(note).toContain("creative-generation");
    expect(note).toMatch(/persona-card/i);
    expect(note).toMatch(/when available/i);
    expect(note).toContain("AgentRunScheduler");
    expect(note).toContain("continuous-learning");
    expect(note).toMatch(/271 skills/i);
    expect(note).toMatch(/no new skill|Hub skill prose only/i);
    expect(note).toContain("per-chat system-prompt field");
  });

  it("creates no duplicate builtin skill for the Hub coverages", () => {
    const builtinNames = readdirSync(BUILTIN_SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(builtinNames).not.toContain("deep-research-compilation");
    expect(builtinNames).not.toContain("prompt-engineering");
    expect(builtinNames).not.toContain("creative-generation");
    expect(builtinNames).not.toContain("continuous-learning");
    expect(builtinNames).not.toContain("agent-presets");
  });
});
