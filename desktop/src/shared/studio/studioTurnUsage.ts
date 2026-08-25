/**
 * v2.2.7 Phase 2 -- persist usage on Image/Video studio turns.
 *
 * User prompts are estimated (labeled Estimate). A successful assistant
 * mediaRef counts as one visual unit. Failed generates, unreadable last
 * output, and 1x1 stubs (never given a mediaRef) count as zero.
 */

import { estimateTokens } from "../../../../core/chat/sessionContextUsage";

export function studioPersistUsage(input: {
  role: "user" | "assistant";
  content: string;
  mediaRef?: string | null;
}): {
  inputTokens?: number;
  tokensEstimated?: boolean;
  visualUnits: number;
} {
  if (input.role === "user") {
    return {
      inputTokens: estimateTokens(input.content),
      tokensEstimated: true,
      visualUnits: 0,
    };
  }
  return { visualUnits: input.mediaRef ? 1 : 0 };
}
