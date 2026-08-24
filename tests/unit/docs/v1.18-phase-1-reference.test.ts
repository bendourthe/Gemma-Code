/**
 * v1.18.0 Phase 1 -- the llama.cpp loopback recipe and the skill-native
 * adoption note must stay honest against the registry and the builtin catalog.
 * A drifted snippet (wrong protocol, a non-loopback host, a trailing `/v1`)
 * would teach a config the registry rejects. A duplicate builtin skill would
 * violate the reverse-engineer-first "do not rebuild" mapping.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validateLocalAdapterManifest } from "../../../modules/coding/llm/LocalAdapterRegistry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const EXAMPLE = join(
  REPO_ROOT,
  "docs/reference/examples/llamacpp-loopback-adapter.json",
);
const GUIDE = join(REPO_ROOT, "docs/reference/llamacpp-loopback-adapter.md");
const SKILL_NOTE = join(
  REPO_ROOT,
  "docs/reference/skill-native-adoptions-v1.18.md",
);
const BUILTIN_SKILLS = join(REPO_ROOT, "modules/coding/skills/catalog");

const EXPECTED_MANIFEST = {
  name: "llamacpp",
  label: "llama.cpp (llama-server)",
  protocol: "openai",
  endpoint: "http://127.0.0.1:8080",
  capabilities: { chat: true },
} as const;

function extractAdapterManifests(markdown: string): unknown[] {
  const fences = [...markdown.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const out: unknown[] = [];
  for (const match of fences) {
    const raw = match[1];
    if (raw === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Guide contains a json fence that is not valid JSON:\n${raw}`);
    }
    collectManifests(parsed, out);
  }
  return out;
}

function collectManifests(value: unknown, out: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectManifests(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const rec = value as Record<string, unknown>;
  if (typeof rec.protocol === "string" && typeof rec.endpoint === "string") {
    out.push(value);
    return;
  }
  const nested = rec["nexus.llm.localAdapters"];
  if (nested !== undefined) collectManifests(nested, out);
}

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

describe("llamacpp-loopback-adapter example manifest", () => {
  it("parses and passes validateLocalAdapterManifest (loopback accepted)", () => {
    const raw = JSON.parse(readFileSync(EXAMPLE, "utf8")) as unknown;
    expect(raw).toEqual(EXPECTED_MANIFEST);
    const result = validateLocalAdapterManifest(raw);
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (result.ok) {
      expect(result.manifest.protocol).toBe("openai");
      expect(result.manifest.endpoint).toBe("http://127.0.0.1:8080");
    }
  });

  it("rejects a non-loopback mutation of the example (LAN and remote)", () => {
    const base = JSON.parse(readFileSync(EXAMPLE, "utf8")) as {
      name: string;
      protocol: string;
      endpoint: string;
    };
    for (const endpoint of [
      "http://192.168.1.10:8080",
      "http://10.0.0.5:8080",
      "https://api.example.com",
      "http://0.0.0.0:8080",
    ]) {
      const result = validateLocalAdapterManifest({ ...base, endpoint });
      expect(result.ok, endpoint).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/MCP Registry Policy/);
        expect(result.error).toMatch(/non-local endpoint/);
      }
    }
  });

  it("documented endpoints have no trailing /v1 (the client appends it)", () => {
    const example = JSON.parse(readFileSync(EXAMPLE, "utf8")) as {
      endpoint: string;
    };
    expect(example.endpoint.endsWith("/v1")).toBe(false);

    const markdown = readFileSync(GUIDE, "utf8");
    const manifests = extractAdapterManifests(markdown);
    expect(manifests.length).toBeGreaterThanOrEqual(2);
    for (const raw of manifests) {
      const result = validateLocalAdapterManifest(raw);
      expect(result, JSON.stringify(raw)).toEqual(
        expect.objectContaining({ ok: true }),
      );
      const endpoint = (raw as { endpoint: string }).endpoint;
      expect(endpoint.endsWith("/v1"), endpoint).toBe(false);
      expect(endpoint.startsWith("http://127.0.0.1:")).toBe(true);
    }
  });
});

describe("v1.18 Phase 1 reference docs", () => {
  it("internal links in both new reference docs resolve", () => {
    const missing: string[] = [];
    for (const doc of [GUIDE, SKILL_NOTE]) {
      const markdown = readFileSync(doc, "utf8");
      for (const target of markdownRelativeTargets(markdown)) {
        const resolved = resolve(dirname(doc), target);
        if (!existsSync(resolved)) {
          missing.push(`${doc} -> ${target} (${resolved})`);
        }
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("skill-native note maps both coverages and creates no duplicate builtin skill", () => {
    const note = readFileSync(SKILL_NOTE, "utf8");
    expect(note).toContain("agent-presets");
    expect(note).toContain("morning-briefing");
    expect(note).toContain("browser-testing-with-devtools");
    expect(note).toMatch(/OpenWorker comparison/i);
    expect(note).toMatch(/Open Interpreter comparison/i);
    expect(note).toMatch(/no new skill/i);
    expect(note).toContain("OI-A4-native");
    expect(note).toContain("OW-A2");

    const builtinNames = readdirSync(BUILTIN_SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(builtinNames).not.toContain("agent-presets");
    expect(builtinNames).not.toContain("browser-testing-with-devtools");
    expect(builtinNames).not.toContain("morning-briefing");
  });
});
