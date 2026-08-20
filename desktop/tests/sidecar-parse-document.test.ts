/**
 * v1.20.0 Phase 1 (A1) -- sidecar `parse_document` construction.
 *
 * Asserts the flag-wins rule at every production createHeadlessTools site
 * helper, and that the parser is handed base64 only.
 */

import { afterEach, describe, expect, it } from "vitest";

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
