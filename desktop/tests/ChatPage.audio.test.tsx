/**
 * v2.0.0 Phase 1 -- audio attachment + transcribe-then-chat.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import { createInMemoryAudioClient } from "../src/modules/chat/audioClient";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";

function seed() {
  const client = new InMemoryChatExplorerClient();
  const folder = client.createFolder({ parentId: null, name: "Work" });
  const chat = client.createChat({
    folderId: folder.id,
    title: "draft",
    modelId: "gemma4:e4b",
  });
  return { client, folder, chat };
}

describe("ChatPage audio bridge", () => {
  it("transcribes attached audio, labels origin, and sends the transcript to chat", async () => {
    const { client, folder, chat } = seed();
    const sent: string[] = [];
    const chatSession: ChatSessionClient = {
      start: async () => ({ sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t" }),
      sendMessage: async (input) => {
        sent.push(input.message);
        return {
          sessionId: "s1",
          events: [
            { kind: "token", text: "heard you" },
            { kind: "done", finishReason: "stop" },
          ],
        };
      },
    };
    const audio = createInMemoryAudioClient({
      transcript: "[origin:stt_transcript]\nplease sit down",
    });
    const user = userEvent.setup();
    render(<ChatPage client={client} chatSession={chatSession} audioClient={audio} />);
    await user.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    await user.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    fireEvent.change(screen.getByTestId("media-composer-file"), {
      target: { files: [new File(["x"], "clip.wav", { type: "audio/wav" })] },
    });
    await waitFor(() => expect(screen.getByTestId("media-composer-thumb-0")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("media-composer-submit"));
    expect(await screen.findByText("heard you")).toBeInTheDocument();
    expect(audio.transcribeCalls).toHaveLength(1);
    expect(sent[0]).toContain("[origin:stt_transcript]");
    expect(sent[0]).toContain("please sit down");
    expect(screen.getByText("origin:stt_transcript", { selector: "span" })).toBeInTheDocument();
  });
});
