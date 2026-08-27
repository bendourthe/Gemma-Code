/**
 * v2.0.0 Phase 1 -- Chat voice loop (PTT / VAD / barge-in) with mocked audio.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import { createInMemoryAudioClient } from "../src/modules/chat/audioClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";
import type { MicRecorder } from "../src/shared/chat/micRecorder";
import { INSTALLED_CHAT_MODELS, waitForInstalledChatModel } from "./installedChatModels";

function fakeMic(): MicRecorder {
  return {
    async start() {
      return;
    },
    async stop() {
      return "data:audio/webm;base64,AAA";
    },
  };
}

describe("ChatPage voice loop", () => {
  it(
    "push-to-talk captures, transcribes, chats, and speaks offline",
    async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({
      folderId: folder.id,
      title: "draft",
      modelId: "gemma4:e4b",
    });
    const audio = createInMemoryAudioClient({
      transcript: "[origin:stt_transcript]\nhello voice",
    });
    const played: string[] = [];
    const chatSession: ChatSessionClient = {
      start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
      sendMessage: async () => ({
        sessionId: "s1",
        events: [
          { kind: "token", text: "spoken reply" },
          { kind: "done", finishReason: "stop" },
        ],
      }),
    };
    const user = userEvent.setup();
    render(
      <ChatPage
        client={client}
        chatSession={chatSession}
        audioClient={audio}
        voiceMicRecorder={fakeMic()}
        playAudio={async (url) => {
          played.push(url);
        }}
        modelsClient={INSTALLED_CHAT_MODELS}
      />,
    );
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    await waitForInstalledChatModel();
    // v2.2.0 Phase 5 (5.4): the five-button voice row is gone. The same
    // voiceLoop machine is now driven from the composer's mic menu.
    const openMicMenu = async (): Promise<void> => {
      await user.click(screen.getByTestId("media-composer-mic-menu-toggle"));
    };
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-voice-loop"));
    // v2.2.9 Phase 1.1 (T001): no indicator at all while the mic is closed.
    expect(screen.queryByTestId("chat-voice-capture-indicator")).toBeNull();
    // Select push-to-talk, then trigger it: first click arms the mode, the
    // second starts capture.
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-ptt"));
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-ptt"));
    await waitFor(() =>
      expect(screen.getByTestId("chat-voice-capture-indicator")).toHaveAttribute(
        "data-visible",
        "true",
      ),
    );
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-ptt"));
    expect(await screen.findByText("spoken reply")).toBeInTheDocument();
    await waitFor(() => expect(played.length).toBeGreaterThan(0));
    expect(audio.speakCalls.some((t) => t.includes("spoken reply"))).toBe(true);
  },
  15_000,
);

  it("VAD start shows the capture indicator until stop", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    const chat = client.createChat({
      folderId: folder.id,
      title: "draft",
      modelId: "gemma4:e4b",
    });
    const user = userEvent.setup();
    render(
      <ChatPage
        client={client}
        chatSession={{
          start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
          sendMessage: async () => ({
            sessionId: "s1",
            events: [{ kind: "token", text: "ok" }, { kind: "done", finishReason: "stop" }],
          }),
        }}
        audioClient={createInMemoryAudioClient()}
        voiceMicRecorder={fakeMic()}
        playAudio={async () => undefined}
        modelsClient={INSTALLED_CHAT_MODELS}
      />,
    );
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    await waitForInstalledChatModel();
    const openMicMenu = async (): Promise<void> => {
      await user.click(screen.getByTestId("media-composer-mic-menu-toggle"));
    };
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-voice-loop"));
    // First VAD click arms the mode; the second starts capture.
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-vad"));
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-vad"));
    await waitFor(() =>
      expect(screen.getByTestId("chat-voice-capture-indicator")).toHaveAttribute(
        "data-visible",
        "true",
      ),
    );
    await openMicMenu();
    fireEvent.click(screen.getByTestId("media-composer-voice-vad"));
    expect(await screen.findByText("ok")).toBeInTheDocument();
  });
});
