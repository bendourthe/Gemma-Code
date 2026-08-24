/**
 * v2.1.0 Phase 3 -- redact free-text workflow fields before the generation index.
 */

import { redactSecrets } from "../observability/redactSecrets.js";

export function redactWorkflow<T extends Record<string, unknown>>(workflow: T): T {
  const out: Record<string, unknown> = { ...workflow };
  if (typeof out.prompt === "string") out.prompt = redactSecrets(out.prompt);
  if (typeof out.negativePrompt === "string") {
    out.negativePrompt = redactSecrets(out.negativePrompt);
  }
  return out as T;
}
