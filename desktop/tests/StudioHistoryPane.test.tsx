/**
 * v2.2.6 Phase 1 -- Image/Video history pane reuses FolderTree.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { StudioHistoryPane } from "../src/shared/explorer/StudioHistoryPane";
import { InMemoryStudioExplorerClient } from "../src/shared/explorer/studioExplorerClient";
import { FolderTree } from "../src/modules/chat/FolderTree";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";

describe("StudioHistoryPane", () => {
  it("renders FolderTree sessions when the sidecar is up", () => {
    const client = new InMemoryStudioExplorerClient("image");
    client.createSession({
      folderId: null,
      title: "Fox portrait",
      modelId: "sana-1.6b-1024",
    });
    render(
      <StudioHistoryPane pillar="image" client={client} defaultModelId="sana-1.6b-1024" />,
    );
    expect(screen.getByTestId("image-history-pane")).toBeInTheDocument();
    expect(screen.getByText("Fox portrait")).toBeInTheDocument();
    // v2.2.9 Phase 3.1 (T007): Chatbot copy, not "New session".
    expect(screen.getByTestId("folder-tree-new-chat")).toHaveAttribute("title", "New chat");
    expect(screen.getByText("Chats")).toBeInTheDocument();
  });

  it("keeps new/folder actions without a second-column collapse pill", () => {
    const client = new InMemoryStudioExplorerClient("image");
    const session = client.createSession({
      folderId: null,
      title: "Fox portrait",
      modelId: "sana-1.6b-1024",
    });
    render(
      <StudioHistoryPane pillar="image" client={client} defaultModelId="sana-1.6b-1024" />,
    );
    expect(screen.queryByTestId("image-history-collapse-toggle")).toBeNull();
    expect(screen.getByTestId("folder-tree-new-folder")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-new-chat")).toBeInTheDocument();
    expect(screen.getByTestId(`tree-row-chat-${session.id}`)).toBeInTheDocument();
  });

  // v2.2.9 Phase 1.4 (T004): the highlighted row is bound to the session the
  // page has OPEN, not to pane-local click state.
  it("binds the selected row to the open session id", () => {
    const client = new InMemoryStudioExplorerClient("image");
    const open = client.createSession({
      folderId: null,
      title: "Open session",
      modelId: "sana-1.6b-1024",
    });
    const other = client.createSession({
      folderId: null,
      title: "Other session",
      modelId: "sana-1.6b-1024",
    });
    render(
      <StudioHistoryPane
        pillar="image"
        client={client}
        defaultModelId="sana-1.6b-1024"
        activeSessionId={open.id}
      />,
    );
    const openRow = screen.getByTestId(`tree-row-chat-${open.id}`);
    const otherRow = screen.getByTestId(`tree-row-chat-${other.id}`);
    expect(openRow).toHaveAttribute("aria-selected", "true");
    expect(otherRow).toHaveAttribute("aria-selected", "false");
    expect(openRow.style.backgroundColor).not.toBe("transparent");
    expect(openRow.style.backgroundColor).not.toBe(otherRow.style.backgroundColor);
  });

  // v2.2.9 Phase 3.1 (T007): the studio panes use Chatbot FolderTree strings
  // (Chats / New chat / No chats yet.), never "Sessions" / "Start a new session".
  it("video pane matches image width and Chatbot copy", () => {
    const client = new InMemoryStudioExplorerClient("video");
    render(
      <StudioHistoryPane pillar="video" client={client} defaultModelId="wan2.1" />,
    );
    expect(screen.getByTestId("folder-tree-empty-cta")).toHaveTextContent(/start a new chat/i);
    expect(screen.getByText("No chats yet.")).toBeInTheDocument();
    expect(screen.queryByText(/start a new session/i)).toBeNull();
    expect(screen.queryByTestId("video-history-collapse-toggle")).toBeNull();
  });

  it("image pane empty state also uses the Chatbot strings", () => {
    const client = new InMemoryStudioExplorerClient("image");
    render(
      <StudioHistoryPane pillar="image" client={client} defaultModelId="sana-1.6b-1024" />,
    );
    expect(screen.getByTestId("folder-tree-empty-cta")).toHaveTextContent(/start a new chat/i);
    expect(screen.getByText("No chats yet.")).toBeInTheDocument();
    expect(screen.queryByText(/session/i)).toBeNull();
  });

  it("sidecar down shows an empty hint and does not fabricate sessions", () => {
    const client = new InMemoryStudioExplorerClient("image");
    client.createSession({
      folderId: null,
      title: "Must not appear",
      modelId: "sana",
    });
    render(
      <StudioHistoryPane
        pillar="image"
        client={client}
        defaultModelId="sana"
        sidecarDown
      />,
    );
    expect(screen.getByTestId("image-history-empty")).toBeInTheDocument();
    expect(screen.queryByText("Must not appear")).toBeNull();
    expect(screen.queryByTestId("folder-tree-empty-cta")).toBeNull();
  });

  it("Chatbot FolderTree default copy is still Start a new chat", () => {
    const storage = new Map<string, readonly string[]>();
    const storageAdapter = {
      read: () => storage.get("expanded") ?? [],
      write: (ids: readonly string[]) => {
        storage.set("expanded", ids);
      },
    };
    render(
      <FolderTree client={new InMemoryChatExplorerClient()} storageAdapter={storageAdapter} />,
    );
    expect(screen.getByTestId("folder-tree-empty-cta")).toHaveTextContent(/start a new chat/i);
  });

  it("opens a newly created chat as the selected session", () => {
    const client = new InMemoryStudioExplorerClient("image");
    const onSelectSession = vi.fn();
    render(
      <StudioHistoryPane
        pillar="image"
        client={client}
        defaultModelId="sana-1.6b-1024"
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-tree-new-chat"));
    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession.mock.calls[0]?.[0]).toEqual(expect.any(String));
  });
});
