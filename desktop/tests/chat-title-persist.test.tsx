/**
 * v2.2.9 Phase 1.5 (T005) -- auto-title persists through the explorer rename.
 *
 * First send on a still-default chat immediately renames the store to a
 * prompt-derived fallback (byUser false) so the rail never sits on "New chat".
 * After the first assistant turn completes, the model title (when a client can
 * generate one) renames again -- unless the user renamed in the meantime.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";
import { fallbackTitle } from "../sidecar/src/chat/titleGenerator";
import { INSTALLED_CHAT_MODELS } from "./installedChatModels";

type TitleCapableClient = InMemoryChatExplorerClient & {
  generateTitle?: (
    chatId: string,
    firstMessage: string,
  ) => Promise<{ title: string; source: string }>;
};

function echoSession(): ChatSessionClient {
  return {
    start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
    sendMessage: async () => ({
      sessionId: "s1",
      events: [
        { kind: "token", text: "ok" },
        { kind: "done", finishReason: "stop" },
      ],
    }),
  };
}

describe("auto-title persistence (T005)", () => {
  it("first send persists a prompt-derived fallback through renameChat and the rail follows", async () => {
    const client = new InMemoryChatExplorerClient();
    const user = userEvent.setup();
    render(
      <ChatPage client={client} chatSession={echoSession()} modelsClient={INSTALLED_CHAT_MODELS} />,
    );
    await user.type(
      screen.getByTestId("media-composer-textarea"),
      "explain quantum entanglement to a beginner please{Enter}",
    );
    const expected = fallbackTitle("explain quantum entanglement to a beginner please");
    expect(expected).not.toBe("New chat");
    await waitFor(() => expect(client.listTree().chats[0]?.title).toBe(expected));
    // The rail re-reads the store after the refreshToken bump.
    const chatId = client.listTree().chats[0]?.id ?? "";
    await waitFor(() =>
      expect(screen.getByTestId(`tree-row-chat-${chatId}`)).toHaveAttribute("title", expected),
    );
    // A machine rename never pins the title.
    expect(client.listTree().chats[0]?.userRenamed).not.toBe(true);
  });

  it("the model title renames again after the first assistant turn completes", async () => {
    const client = new InMemoryChatExplorerClient() as TitleCapableClient;
    const calls: string[] = [];
    client.generateTitle = async (chatId: string) => {
      calls.push(chatId);
      return { title: "Quantum Basics", source: "model" };
    };
    const user = userEvent.setup();
    render(
      <ChatPage client={client} chatSession={echoSession()} modelsClient={INSTALLED_CHAT_MODELS} />,
    );
    await user.type(screen.getByTestId("media-composer-textarea"), "explain quantum things{Enter}");
    await screen.findByText("ok");
    await waitFor(() => expect(client.listTree().chats[0]?.title).toBe("Quantum Basics"));
    expect(calls.length).toBe(1);
  });

  it("a user rename (byUser) wins over a late model title", async () => {
    const client = new InMemoryChatExplorerClient() as TitleCapableClient;
    let releaseTitle!: (value: { title: string; source: string }) => void;
    client.generateTitle = () =>
      new Promise((resolve) => {
        releaseTitle = resolve;
      });
    const user = userEvent.setup();
    render(
      <ChatPage client={client} chatSession={echoSession()} modelsClient={INSTALLED_CHAT_MODELS} />,
    );
    await user.type(screen.getByTestId("media-composer-textarea"), "explain quantum things{Enter}");
    await screen.findByText("ok");
    // The fallback landed; now the user renames before the model answers.
    await waitFor(() => expect(client.listTree().chats[0]?.title).toBe("explain quantum things"));
    const chatId = client.listTree().chats[0]?.id ?? "";
    client.renameChat(chatId, "My own name", true);
    releaseTitle({ title: "Late Model Title", source: "model" });
    // Give the refine path a macrotask to run, then assert it did not clobber.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => expect(client.listTree().chats[0]?.title).toBe("My own name"));
    expect(client.listTree().chats[0]?.userRenamed).toBe(true);
  });

  it("an empty prompt keeps New chat", async () => {
    expect(fallbackTitle("")).toBe("New chat");
    expect(fallbackTitle("   \n\t ")).toBe("New chat");
    const client = new InMemoryChatExplorerClient();
    client.createChat({ folderId: null, title: "New chat", modelId: "gemma4:e4b" });
    const user = userEvent.setup();
    render(
      <ChatPage client={client} chatSession={echoSession()} modelsClient={INSTALLED_CHAT_MODELS} />,
    );
    // Whitespace never submits (composer trims), so the title must not move.
    await user.type(screen.getByTestId("media-composer-textarea"), "   {Enter}");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.listTree().chats[0]?.title).toBe("New chat");
  });

  // The sidecar side of the contract (in-repo style, see chat-gaps-phase8):
  // `chat.generateTitle` persists through the explorer rename and never
  // overwrites a user-pinned title.
  it("the sidecar handler persists the generated title through explorer rename", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../sidecar/src/handlers.ts"),
      "utf8",
    );
    expect(source).toContain("ops.renameChat({ id: req.chatId, title: result.title })");
    expect(source).toContain("chat.userRenamed !== true");
  });
});
