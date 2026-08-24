import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildDataset } from "../../../../core/tuning/datasetBuilder.js";

describe("buildDataset", () => {
  it("redacts secrets and never writes the raw key", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-ds-"));
    writeFileSync(
      path.join(root, "chat.jsonl"),
      `${JSON.stringify({ messages: [{ role: "user", content: "key AKIAIOSFODNN7EXAMPLE" }] })}\n`,
    );
    const result = await buildDataset({
      sources: [root],
      id: "t1",
      homeDirFn: () => root,
    });
    expect(result.written).toBe(1);
    expect(result.redacted).toBe(1);
    const body = readFileSync(result.outputPath, "utf8");
    expect(body).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(body).toContain("<redacted>");
    expect(result.preview[0]?.messages[0]?.content).toContain("<redacted>");
  });

  it("skips oversized and pdf files without aborting", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-ds-"));
    writeFileSync(path.join(root, "ok.txt"), "hello");
    writeFileSync(path.join(root, "big.txt"), "x".repeat(100));
    writeFileSync(path.join(root, "scan.pdf"), "%PDF-1.4");
    const result = await buildDataset({
      sources: [root],
      id: "t2",
      maxBytes: 20,
      homeDirFn: () => root,
    });
    expect(result.written).toBe(1);
    expect(result.skipped.some((s) => s.reason.includes("oversized"))).toBe(true);
    expect(result.skipped.some((s) => s.path.endsWith(".pdf"))).toBe(true);
  });

  it("extracts csv prompt/completion rows", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-ds-"));
    writeFileSync(path.join(root, "rows.csv"), "prompt,completion\nhello,world\n");
    const result = await buildDataset({ sources: [root], id: "t3", homeDirFn: () => root });
    expect(result.written).toBe(1);
    expect(result.preview[0]?.messages[1]?.content).toBe("world");
  });

  it("extracts json arrays and skips unreadable files", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-ds-"));
    writeFileSync(
      path.join(root, "rows.json"),
      JSON.stringify([{ instruction: "a", output: "b" }]),
    );
    writeFileSync(path.join(root, "bad.json"), "{");
    const result = await buildDataset({ sources: [root], id: "t4", homeDirFn: () => root });
    expect(result.written).toBeGreaterThanOrEqual(1);
    expect(result.skipped.some((s) => s.reason === "parse error")).toBe(true);
  });

  it("routes PDFs through extractPdf then redactSecrets", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-ds-"));
    writeFileSync(path.join(root, "scan.pdf"), "%PDF-1.4 secret AKIAIOSFODNN7EXAMPLE");
    const result = await buildDataset({
      sources: [root],
      id: "t5",
      homeDirFn: () => root,
      extractPdf: async () => "invoice AKIAIOSFODNN7EXAMPLE",
    });
    expect(result.written).toBe(1);
    expect(result.redacted).toBe(1);
    expect(result.preview[0]?.messages[0]?.content).toContain("<redacted>");
    expect(result.skipped.some((s) => s.path.endsWith(".pdf"))).toBe(false);
  });
});
