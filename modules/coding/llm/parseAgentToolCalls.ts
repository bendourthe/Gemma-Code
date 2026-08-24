/**
 * v2.1 known-gaps -- dispatch tool-call parsing by catalog `toolFormat`.
 *
 * Gemma 4 XML stays on the existing balanced-brace parser so that path is
 * byte-identical. Other families use `getToolCallFormat(name).parse` and are
 * adapted into the AgentLoop / HeadlessAgentSession `ParseResult` shape.
 */

import { randomUUID } from "crypto";
import {
  ModelCatalog,
  type ToolFormatName,
} from "../../../core/registry/ModelCatalog.js";
import {
  parseToolCalls as parseGemma,
  stripToolCalls as stripGemma,
  type ParseResult,
} from "../../../src/tools/Gemma4ToolFormat.js";
import type { ToolName } from "../../../src/tools/types.js";
import { getToolCallFormat } from "./ToolCallFormat.js";

export function toolFormatForModel(modelId: string): ToolFormatName {
  return ModelCatalog.byId(modelId)?.toolFormat ?? "gemma4-xml";
}

export function parseAgentToolCalls(
  text: string,
  format: ToolFormatName = "gemma4-xml",
): { results: ParseResult[]; hasAny: boolean } {
  if (format === "gemma4-xml") {
    return parseGemma(text);
  }
  const parsed = getToolCallFormat(format).parse(text);
  const results: ParseResult[] = parsed.map((p) => ({
    ok: true,
    call: {
      tool: p.name as ToolName,
      id: randomUUID(),
      parameters: p.args,
    },
  }));
  return { results, hasAny: parsed.length > 0 };
}

export function stripAgentToolCalls(
  text: string,
  format: ToolFormatName = "gemma4-xml",
): string {
  if (format === "gemma4-xml") {
    return stripGemma(text);
  }
  let out = text;
  for (const p of getToolCallFormat(format).parse(text)) {
    out = out.split(p.raw).join("");
  }
  return out.trim();
}
