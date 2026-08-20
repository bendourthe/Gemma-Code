/**
 * v1.16.0 Phase 4 (adoption item A6) -- `parse_document` registration wiring.
 *
 * Mirrors `codegraph-wiring.test.ts`: assert the tool is declared in every place
 * a builtin must be, that it only registers when a parser is wired, and that its
 * security posture (tier, classifier membership) is what the phase decided.
 */

import { describe, it, expect } from "vitest";

import { BUILTIN_TOOL_NAMES } from "../../../src/tools/types.js";
import { TOOL_CATALOG } from "../../../src/tools/ToolCatalog.js";
import { buildToolRegistry } from "../../../src/tools/ToolRegistryBuilder.js";
import { buildParseDocumentDeps } from "../../../src/tools/parseDocumentWiring.js";
import {
  PermissionTier,
  TOOL_PERMISSION_MAP,
} from "../../../modules/coding/guardrails/permissionTierMap.js";
import { getPermissionTier } from "../../../modules/coding/guardrails/PermissionTiers.js";

const PARSER = {
  resolveParser: () => ({
    parse: async () => ({ engine: "stub", text: "t", markdown: null, pageCount: 1 }),
  }),
};

describe("parse_document declaration", () => {
  it("is a declared builtin tool name", () => {
    expect(BUILTIN_TOOL_NAMES).toContain("parse_document");
  });

  it("has a catalog entry with a path parameter", () => {
    const entry = TOOL_CATALOG.find((t) => t.name === "parse_document");
    expect(entry).toBeDefined();
    expect(entry?.parameters.path?.required).toBe(true);
    expect(entry?.parameters.max_pages).toBeDefined();
    expect(entry?.parameters.allow_secrets).toBeDefined();
  });

  it("describes its output as untrusted so the model is primed", () => {
    const entry = TOOL_CATALOG.find((t) => t.name === "parse_document");
    expect(entry?.description).toMatch(/untrusted/i);
  });
});

describe("parse_document security posture", () => {
  it("carries the CONFIRM tier in the shared map", () => {
    expect(TOOL_PERMISSION_MAP.parse_document).toBe(PermissionTier.CONFIRM);
  });

  it("requires confirmation through the behavioral module too", () => {
    // Guards against the re-export in PermissionTiers.ts drifting from the map.
    expect(getPermissionTier("parse_document")).toBe(PermissionTier.CONFIRM);
  });

  it("cannot be downgraded to auto-approve by an override", () => {
    expect(getPermissionTier("parse_document", { parse_document: 0 })).toBe(
      PermissionTier.CONFIRM,
    );
  });
});

describe("parse_document registration", () => {
  it("registers when a parser is wired", () => {
    const registry = buildToolRegistry({
      confirmationGate: null,
      parseDocument: PARSER,
    } as never);
    expect(registry.has("parse_document")).toBe(true);
  });

  it("does NOT register when no parser is wired", () => {
    // A host with no document runtime simply lacks the tool, so it costs no
    // prompt budget and can never be called into a missing runtime.
    const registry = buildToolRegistry({ confirmationGate: null } as never);
    expect(registry.has("parse_document")).toBe(false);
  });

  it("bootstrap-shaped helper registers when the flag is on", () => {
    const deps = buildParseDocumentDeps({
      parseDocumentEnabled: true,
      parseDocumentMemoryIngestEnabled: false,
      createParser: () => PARSER.resolveParser(),
    });
    const registry = buildToolRegistry({
      confirmationGate: null,
      parseDocument: deps,
    } as never);
    expect(registry.has("parse_document")).toBe(true);
  });

  it("bootstrap-shaped helper omits the tool when the flag is off", () => {
    const deps = buildParseDocumentDeps({
      parseDocumentEnabled: false,
      parseDocumentMemoryIngestEnabled: true,
      createParser: () => PARSER.resolveParser(),
    });
    const registry = buildToolRegistry({
      confirmationGate: null,
      parseDocument: deps,
    } as never);
    expect(registry.has("parse_document")).toBe(false);
  });
});

describe("inbound classifier membership", () => {
  it("routes parse_document output through the classifier", async () => {
    // The set is module-private, so assert through behaviour: AgentLoop screens
    // only tools in INBOUND_EXTERNAL_DATA_TOOLS.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../../src/tools/AgentLoop.ts", import.meta.url), "utf8"),
    );
    const line = source
      .split("\n")
      .find((l) => l.includes("INBOUND_EXTERNAL_DATA_TOOLS = new Set"));
    expect(line).toBeDefined();
    expect(line).toContain("parse_document");
    expect(line).toContain("fetch_page");
  });
});
