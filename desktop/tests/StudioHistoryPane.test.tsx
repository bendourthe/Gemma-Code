/**
 * v2.2.6 Phase 1 -- Image/Video history pane reuses FolderTree.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

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
    expect(screen.getByTestId("folder-tree-new-chat")).toHaveAttribute("title", "New session");
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
