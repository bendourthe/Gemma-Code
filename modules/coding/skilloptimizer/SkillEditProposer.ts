// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S2 / SO003) -- the
// LLM-backed bounded-edit proposer.
//
// Given the current skill body + a redacted failure diagnosis, it asks the
// resident (local) model for a small set of add/delete/replace ops that would
// fix the diagnosed failures, within the textual learning-rate budget. The
// model output is parsed with the shared tolerant JSON extractor and validated
// op-by-op; anything unparseable yields `null` (fail-closed -- no edit beats a
// malformed edit). The resident model is reached ONLY through the injected
// `OllamaClient` port (never a cloud model), so the module is vscode-free.
// ---------------------------------------------------------------------------

import type { OllamaClient, OllamaMessage, OllamaOptions } from "../llm/types.js";
import { extractJsonFromLlmOutput } from "../orchestration/utils.js";
import type {
  ProposeInput,
  ProposedSkillEdit,
  SkillEditKind,
  SkillEditOp,
  SkillEditProposer,
} from "./types.js";

const PROPOSER_SYSTEM_PROMPT = `You optimize a coding agent's SKILL.md instruction text. You are given the current skill body and a diagnosis of why tasks failed. Propose a SMALL, surgical edit that would fix the diagnosed failures.

Respond with ONLY a JSON object. No markdown, no prose, no preamble.

Schema:
{
  "rationale": string,            // one sentence: why this edit fixes the failures
  "ops": [                        // 1..N bounded edits, applied in order to the body
    { "kind": "add",     "match": string?, "text": string },   // append text, or insert after the first match
    { "kind": "delete",  "match": string },                    // remove the first occurrence of match
    { "kind": "replace", "match": string, "text": string }     // substitute the first occurrence of match
  ]
}

Rules:
- Keep the edit minimal: prefer one or two ops. Match strings must be copied EXACTLY from the body.
- Do not touch YAML frontmatter; edit the instruction body only.
- If no useful edit is possible, return {"rationale":"no change","ops":[]}.`;

const KNOWN_KINDS: ReadonlySet<string> = new Set<SkillEditKind>(["add", "delete", "replace"]);

/**
 * Parse + validate the model's proposal into a {@link ProposedSkillEdit}.
 * Drops malformed ops; returns `null` when no valid op survives (fail-closed).
 * Exported for direct unit testing.
 */
export function parseProposedEdit(raw: string, skillId: string): ProposedSkillEdit | null {
  const parsed = extractJsonFromLlmOutput(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const rawOps = obj["ops"];
  if (!Array.isArray(rawOps)) return null;

  const ops: SkillEditOp[] = [];
  for (const candidate of rawOps) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const c = candidate as Record<string, unknown>;
    const kind = c["kind"];
    if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) continue;
    const match = typeof c["match"] === "string" ? (c["match"] as string) : undefined;
    const text = typeof c["text"] === "string" ? (c["text"] as string) : undefined;

    // Validate the op carries what its kind requires.
    if (kind === "add" && (text === undefined || text.length === 0)) continue;
    if (kind === "delete" && (match === undefined || match.length === 0)) continue;
    if (kind === "replace" && (match === undefined || match.length === 0 || text === undefined)) continue;

    ops.push({ kind: kind as SkillEditKind, ...(match !== undefined ? { match } : {}), ...(text !== undefined ? { text } : {}) });
  }

  if (ops.length === 0) return null;
  const rationale = typeof obj["rationale"] === "string" ? (obj["rationale"] as string) : "";
  return { skillId, ops, rationale };
}

/** The production proposer: one local-model call per round, parsed fail-closed. */
export class LlmSkillEditProposer implements SkillEditProposer {
  constructor(
    private readonly _client: OllamaClient,
    private readonly _modelName: string,
    private readonly _ollamaOptions: OllamaOptions,
  ) {}

  async propose(input: ProposeInput): Promise<ProposedSkillEdit | null> {
    const messages: OllamaMessage[] = [
      { role: "system", content: PROPOSER_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Skill id: ${input.skillId}`,
          `Budget: at most ${input.budget.maxOps} op(s), ${input.budget.maxChangedChars} changed chars total.`,
          ``,
          `Current skill body:`,
          `"""`,
          input.skillBody,
          `"""`,
          ``,
          `Failure diagnosis:`,
          input.diagnosis,
          ``,
          `Respond with ONLY the JSON edit object.`,
        ].join("\n"),
      },
    ];

    const raw = await this._callModel(messages);
    return parseProposedEdit(raw, input.skillId);
  }

  private async _callModel(messages: OllamaMessage[]): Promise<string> {
    const stream = this._client.streamChat({
      model: this._modelName,
      messages,
      stream: true,
      options: this._ollamaOptions,
    });
    let result = "";
    for await (const chunk of stream) {
      result += chunk.message.content ?? "";
    }
    return result;
  }
}
