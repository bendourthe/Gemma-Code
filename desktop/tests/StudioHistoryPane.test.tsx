/**
 * v2.2.6 Phase 1 -- Image/Video history pane reuses FolderTree.
 */

import { describe, expect, it } from "vitest";
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
    expect(screen.getByTestId("image-history-pane").style.width).toBe("280px");
    expect(screen.getByText("Fox portrait")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-new-chat")).toHaveAttribute("title", "New session");
  });

  it("collapses to an icon rail and keeps new/folder actions", () => {
    window.localStorage.removeItem("nexus.image.historyCollapsed");
    const client = new InMemoryStudioExplorerClient("image");
    const session = client.createSession({
      folderId: null,
      title: "Fox portrait",
      modelId: "sana-1.6b-1024",
    });
    render(
      <StudioHistoryPane pillar="image" client={client} defaultModelId="sana-1.6b-1024" />,
    );
    fireEvent.click(screen.getByTestId("image-history-collapse-toggle"));
    expect(screen.getByTestId("image-history-pane").style.width).toBe("56px");
    expect(screen.getByTestId("folder-tree-new-folder")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-new-chat")).toBeInTheDocument();
    expect(screen.getByTestId(`history-rail-mark-${session.id}`)).toBeInTheDocument();
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

  it("video pane matches image width and session copy", () => {
    const client = new InMemoryStudioExplorerClient("video");
    render(
      <StudioHistoryPane pillar="video" client={client} defaultModelId="wan2.1" />,
    );
    expect(screen.getByTestId("video-history-pane").style.width).toBe("280px");
    expect(screen.getByTestId("folder-tree-empty-cta")).toHaveTextContent(/start a new session/i);
    expect(screen.getByTestId("video-history-collapse-toggle")).toBeInTheDocument();
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
});
