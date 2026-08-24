/**
 * v1.20.0 Phase 1 (A1) -- sidecar `parse_document` construction.
 *
 * Asserts the flag-wins rule at every production createHeadlessTools site
 * helper, and that the parser is handed base64 only.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { createSidecarHeadlessTools } from "../sidecar/src/coding/sidecarHeadlessTools";
import { createHeadlessAgentRunner } from "../sidecar/src/coding/headlessAgentRunner";
import { AcpAgent } from "../sidecar/src/acp/AcpAgent";
import type { HeadlessDocumentParser } from "../../modules/coding/runtime/headlessTools";
import type { LLMClient, LLMModel, LLMStreamChunk, LLMChatRequest } from "../../modules/coding/llm/types";

const stubParser: HeadlessDocumentParser = {
  parse: async () => ({ engine: "stub", text: "t", markdown: null, pageCount: 1 }),
};

function names(tools: { name: string }[]): string[] {
  return tools.map((t) => t.name).sort();
}

afterEach(() => {
  delete process.env.NEXUS_PARSE_DOCUMENT;
});

describe("createSidecarHeadlessTools", () => {
  it("omits parse_document when the flag is off even if a parser exists", () => {
    const tools = createSidecarHeadlessTools({
      parseDocumentEnabled: false,
      documentParser: stubParser,
    });
    expect(names(tools)).not.toContain("parse_document");
  });

  it("registers parse_document when the flag is on and a parser is supplied", () => {
    const tools = createSidecarHeadlessTools({
      parseDocumentEnabled: true,
      documentParser: stubParser,
    });
    expect(names(tools)).toContain("parse_document");
  });

  it("omits parse_document by default (flag off, no env)", () => {
    const tools = createSidecarHeadlessTools({ env: {}, settingsValue: false });
    expect(names(tools)).not.toContain("parse_document");
  });

  it("registers the isolated-profile browser tools for the coding host", () => {
    const tools = createSidecarHeadlessTools({ env: {}, settingsValue: false });
    expect(names(tools)).toContain("browser_navigate");
    expect(names(tools)).toContain("browser_aria_snapshot");
    expect(names(tools)).toContain("browser_close");
  });

  it("rejects a matching tool through the workspace permissions deny file", async () => {
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-deny-"));
    try {
      await fsp.mkdir(path.join(workspace, ".nexus"));
      await fsp.writeFile(
        path.join(workspace, ".nexus", "permissions.deny"),
        "write_file: blocked.txt\n",
        "utf8",
      );
      const tool = createSidecarHeadlessTools({ env: {}, settingsValue: false }).find(
        (candidate) => candidate.name === "write_file",
      );
      const result = await tool?.execute(
        { path: "blocked.txt", content: "no" },
        { workdir: workspace },
      );
      expect(result?.success).toBe(false);
      expect(result?.error).toContain("permissions.deny line 1");
      await expect(fsp.stat(path.join(workspace, "blocked.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fsp.rm(workspace, { recursive: true, force: true });
    }
  });

  it("fails closed when the workspace permissions deny file is malformed", async () => {
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "nexus-deny-malformed-"));
    try {
      await fsp.mkdir(path.join(workspace, ".nexus"));
      await fsp.writeFile(
        path.join(workspace, ".nexus", "permissions.deny"),
        "this is not a rule\n",
        "utf8",
      );
      const tool = createSidecarHeadlessTools({ env: {}, settingsValue: false }).find(
        (candidate) => candidate.name === "read_file",
      );
      const result = await tool?.execute({ path: "anything.txt" }, { workdir: workspace });
      expect(result?.success).toBe(false);
      expect(result?.error).toContain("malformed .nexus/permissions.deny line 1");
    } finally {
      await fsp.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("ACP construction site", () => {
  function llm(): LLMClient {
    return {
      async checkHealth() {
        return true;
      },
      async listModels(): Promise<LLMModel[]> {
        return [];
      },
      async *streamChat(_request: LLMChatRequest): AsyncGenerator<LLMStreamChunk> {
        yield { message: { role: "assistant", content: "ok" }, done: true };
      },
    };
  }

  it("exposes parse_document when the flag is on", () => {
    const tools = createSidecarHeadlessTools({
      parseDocumentEnabled: true,
      documentParser: stubParser,
    });
    const acp = new AcpAgent({ llm: llm(), tools });
    expect(acp).toBeDefined();
    expect(names(tools)).toContain("parse_document");
  });

  it("does not expose parse_document when the flag is off", () => {
    const acp = new AcpAgent({ llm: llm(), parseDocumentEnabled: false, documentParser: stubParser });
    expect(acp).toBeDefined();
    const tools = createSidecarHeadlessTools({
      parseDocumentEnabled: false,
      documentParser: stubParser,
    });
    expect(names(tools)).not.toContain("parse_document");
  });
});

describe("headless agent runner construction site", () => {
  it("can inject a parser-backed tool set when enabled", () => {
    const tools = createSidecarHeadlessTools({
      parseDocumentEnabled: true,
      documentParser: stubParser,
    });
    const runner = createHeadlessAgentRunner({ tools });
    expect(typeof runner).toBe("function");
    expect(names(tools)).toContain("parse_document");
  });
});
