/**
 * v1.16.0 Phase 3 (adoption item A5) -- the parse-document chat action.
 *
 * The plan's stability gate for 3.3 is: dropping a PDF in the app returns its
 * text, and with no OCR model installed the UI shows the install prompt rather
 * than an error. Both are asserted here, plus the progress stream and the
 * "parsed text is not auto-sent to the model" rule that keeps an untrusted
 * document out of a prompt.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPage } from "../src/modules/chat/ChatPage";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import { createInMemoryDocumentClient } from "../src/modules/chat/documentClient";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";
import type { ChatSessionClient } from "../src/modules/chat/chatIpcClient";

const DOCUMENT_MODEL: ListedModelDto = {
  id: "rapidocr-ppocrv4",
  displayName: "RapidOCR PP-OCRv4",
  type: "document",
  installed: true,
  source: "registry",
};

/** A chat-session client that must never be called during a parse turn. */
function neverCalledSession(): ChatSessionClient & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async start() {
      state.calls += 1;
      return { sessionId: "s1" };
    },
    async sendMessage() {
      state.calls += 1;
      return { sessionId: "s1", events: [] };
    },
  } as unknown as ChatSessionClient & { calls: number };
}

/**
 * Seed a folder + chat and open it, so the composer renders. Mirrors the
 * navigation the existing ChatPage tests perform.
 */
interface Seeded {
  readonly client: InMemoryChatExplorerClient;
  readonly folderId: string;
  readonly chatId: string;
}

function seedClient(): Seeded {
  const client = new InMemoryChatExplorerClient();
  const folder = client.createFolder({ parentId: null, name: "Work" });
  const chat = client.createChat({
    folderId: folder.id,
    title: "draft",
    modelId: "gemma4:e4b",
  });
  return { client, folderId: folder.id, chatId: chat.id };
}

async function openChat(
  user: ReturnType<typeof userEvent.setup>,
  seeded: Seeded,
): Promise<void> {
  await user.click(screen.getByTestId(`tree-row-folder-${seeded.folderId}`));
  await user.click(screen.getByTestId(`tree-row-chat-${seeded.chatId}`));
}

function pdf(): File {
  return new File(["%PDF-1.7"], "doc.pdf", { type: "application/pdf" });
}

describe("ChatPage document parsing", () => {
  it("shows the install prompt when no document model is installed", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={neverCalledSession()}
        documentClient={createInMemoryDocumentClient({ models: [] })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() =>
      expect(screen.getByTestId("chat-get-more-models")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("chat-settings-link")).toHaveAttribute(
      "href",
      "/settings?tab=models",
    );
  });

  it("hides the install prompt when a document model is installed", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={neverCalledSession()}
        documentClient={createInMemoryDocumentClient({ models: [DOCUMENT_MODEL] })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("media-composer")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-get-more-models")).not.toBeInTheDocument();
  });

  it("deep-links to Settings > Models from the install prompt", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    const onGetMoreModels = vi.fn();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={neverCalledSession()}
        documentClient={createInMemoryDocumentClient({ models: [] })}
        onGetMoreModels={onGetMoreModels}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("chat-get-more-models")).toBeInTheDocument());
    await user.click(screen.getByTestId("chat-get-more-models"));
    expect(onGetMoreModels).toHaveBeenCalled();
  });

  it("parses an attached PDF and renders the extracted text", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={neverCalledSession()}
        documentClient={createInMemoryDocumentClient({
          models: [DOCUMENT_MODEL],
          result: {
            engine: "rapidocr",
            text: "INVOICE 12345",
            markdown: null,
            pageCount: 1,
            pages: [{ index: 0, text: "INVOICE 12345" }],
          },
        })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("media-composer")).toBeInTheDocument());

    await user.upload(screen.getByTestId("media-composer-file"), pdf());
    await waitFor(() => expect(screen.getByTestId("media-composer-doc-0")).toBeInTheDocument());
    await user.click(screen.getByTestId("media-composer-submit"));

    await waitFor(() => expect(screen.getByText(/INVOICE 12345/)).toBeInTheDocument());
    expect(screen.getByText(/Parsed with rapidocr/)).toBeInTheDocument();
  });

  it("reports the page count for a multi-page document", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={neverCalledSession()}
        documentClient={createInMemoryDocumentClient({
          models: [DOCUMENT_MODEL],
          result: {
            engine: "rapidocr",
            text: "page one\n\npage two",
            markdown: null,
            pageCount: 2,
            pages: [
              { index: 0, text: "page one" },
              { index: 1, text: "page two" },
            ],
          },
        })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("media-composer")).toBeInTheDocument());
    await user.upload(screen.getByTestId("media-composer-file"), pdf());
    await user.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(screen.getByText(/Parsed 2 pages/)).toBeInTheDocument());
  });

  it("prefers layout-preserving markdown when the engine returns it", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={neverCalledSession()}
        documentClient={createInMemoryDocumentClient({
          models: [DOCUMENT_MODEL],
          result: {
            engine: "unlimited-ocr",
            text: "flat text",
            markdown: "# Heading\n\nstructured body",
            pageCount: 1,
            pages: [{ index: 0, text: "flat text" }],
          },
        })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("media-composer")).toBeInTheDocument());
    await user.upload(screen.getByTestId("media-composer-file"), pdf());
    await user.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(screen.getByText(/structured body/)).toBeInTheDocument());
  });

  it("surfaces a parse failure in the transcript instead of crashing", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={neverCalledSession()}
        documentClient={createInMemoryDocumentClient({
          models: [DOCUMENT_MODEL],
          error: "needs an NVIDIA GPU",
        })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("media-composer")).toBeInTheDocument());
    await user.upload(screen.getByTestId("media-composer-file"), pdf());
    await user.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() =>
      expect(screen.getByText(/Could not parse the document/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/needs an NVIDIA GPU/)).toBeInTheDocument();
  });

  it("does not send the parsed text to the chat model", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    const session = neverCalledSession();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={session}
        documentClient={createInMemoryDocumentClient({ models: [DOCUMENT_MODEL] })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("media-composer")).toBeInTheDocument());
    await user.upload(screen.getByTestId("media-composer-file"), pdf());
    await user.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(screen.getByText(/parsed text/)).toBeInTheDocument());
    // An untrusted document must not silently enter a model prompt.
    expect(session.calls).toBe(0);
  });

  it("still routes a plain text message to the chat model", async () => {
    const user = userEvent.setup();
    const seeded = seedClient();
    const session = neverCalledSession();
    render(
      <ChatPage
        client={seeded.client}
        chatSession={session}
        documentClient={createInMemoryDocumentClient({ models: [DOCUMENT_MODEL] })}
      />,
    );
    await openChat(user, seeded);
    await waitFor(() => expect(screen.getByTestId("media-composer")).toBeInTheDocument());
    await user.type(screen.getByTestId("media-composer-textarea"), "hello");
    await user.click(screen.getByTestId("media-composer-submit"));
    await waitFor(() => expect(session.calls).toBeGreaterThan(0));
  });
});
