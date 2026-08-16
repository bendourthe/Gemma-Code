/**
 * v1.16.0 Phase 5.3 -- the documented `nexus.llm.localAdapters` examples in
 * the MLX how-to must keep parsing against `validateLocalAdapterManifest`.
 * A drifted snippet (wrong protocol, a non-loopback host, a trailing `/v1`
 * that the client would then double) would silently teach users a config
 * that the registry rejects.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validateLocalAdapterManifest } from "../../../modules/coding/llm/LocalAdapterRegistry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUIDE = join(
  HERE,
  "../../../docs/v1/v1.16/guides/mlx-via-local-adapters.md",
);

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

describe("mlx-via-local-adapters documented manifests", () => {
  it("every json example parses against validateLocalAdapterManifest", () => {
    const markdown = readFileSync(GUIDE, "utf8");
    const manifests = extractAdapterManifests(markdown);
    expect(manifests.length).toBeGreaterThanOrEqual(3);
    for (const raw of manifests) {
      const result = validateLocalAdapterManifest(raw);
      expect(result, JSON.stringify(raw)).toEqual(
        expect.objectContaining({ ok: true }),
      );
    }
  });

  it("documented endpoints have no trailing /v1 (the client appends it)", () => {
    const markdown = readFileSync(GUIDE, "utf8");
    const manifests = extractAdapterManifests(markdown);
    for (const raw of manifests) {
      const endpoint = (raw as { endpoint: string }).endpoint;
      expect(endpoint.endsWith("/v1"), endpoint).toBe(false);
      expect(endpoint.startsWith("http://127.0.0.1:")).toBe(true);
    }
  });
});
