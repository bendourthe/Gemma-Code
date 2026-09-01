/**
 * Shared this-install chat catalog for ChatPage suites that send a turn.
 * Without it, v2.2.4 honesty treats FALLBACK rows as not installed and never
 * calls chatSession.start.
 */

import { screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

export const INSTALLED_CHAT_MODELS = {
  async list() {
    return [
      {
        id: "gemma4:e4b",
        displayName: "Gemma 4 E4B",
        type: "llm" as const,
        task: "chat",
        installed: true,
        source: "registry" as const,
      },
    ];
  },
};

export async function waitForInstalledChatModel(id = "gemma4:e4b"): Promise<void> {
  await waitFor(() => {
    expect((screen.getByTestId("chat-model-select") as HTMLSelectElement).value).toBe(id);
  });
}
