import type { ChatMessage } from "./types";
import {
  sessionContextUsage,
  type SessionContextUsage,
  type SessionUsageTurn,
  type VisualBudgetDenom,
} from "../../../../core/chat/sessionContextUsage";

/** Map transcript bubbles onto sessionContextUsage turns. Skip pending rows. */
export function usageTurnsFromMessages(messages: readonly ChatMessage[]): SessionUsageTurn[] {
  return messages
    .filter((message) => !message.pending)
    .map((message) => {
      const usage = message.requestUsage ?? message.messageUsage;
      return {
        role: message.role === "system" ? undefined : message.role,
        content: message.content,
        inputTokens: usage?.inputTokens ?? message.inputTokens,
        reasoningTokens: usage?.reasoningTokens ?? message.reasoningTokens,
        outputTokens: usage?.outputTokens ?? message.outputTokens,
        tokensEstimated: usage ? usage.provenance.accuracy !== "exact" : message.tokensEstimated,
        visualUnits: message.media ? 1 : 0,
      };
    });
}

/** Meter against the current picker window (or visual budget). Never invents 128k. */
export function composerSessionUsage(
  messages: readonly ChatMessage[],
  model:
    | {
        readonly contextWindow?: number | null;
        readonly visualTokenBudget?: VisualBudgetDenom | null;
      }
    | undefined,
): SessionContextUsage {
  return sessionContextUsage({
    turns: usageTurnsFromMessages(messages),
    contextWindow: model?.contextWindow ?? null,
    visualTokenBudget: model?.visualTokenBudget ?? null,
  });
}
