/**
 * v1.0.0 Phase 4.5 -- TopBar search dropdown tests.
 *
 * Covers: debounce, grouped results (Folders / Chats / Memories), click
 * handlers, empty state, Ctrl+K focus shortcut, Escape close.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "../src/components/TopBar";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";
import type { MemorySearchAdapter, MemorySearchHit } from "../src/components/TopBar";

function memoryAdapter(hits: readonly MemorySearchHit[]): MemorySearchAdapter {
  return {
    async search(): Promise<readonly MemorySearchHit[]> {
      return hits;
    },
  };
}

describe("<TopBar>", () => {

  it("renders the search input and no dropdown when empty", () => {
    render(<TopBar />);
    expect(screen.getByTestId("top-bar-search-input")).toBeInTheDocument();
    expect(screen.queryByTestId("top-bar-dropdown")).toBeNull();
  });

  it("debounces the query before searching", async () => {
    const client = new InMemoryChatExplorerClient();
    client.createFolder({ parentId: null, name: "Work" });
    render(<TopBar chatClient={client} debounceMs={50} />);
    const input = screen.getByTestId("top-bar-search-input");
    fireEvent.change(input, { target: { value: "work" } });
    expect(screen.queryByTestId("top-bar-group-folders")).toBeNull();
    await waitFor(
      () => expect(screen.getByTestId("top-bar-group-folders")).toBeInTheDocument(),
      { timeout: 1000 },
    );
  });

  it("groups results into Folders / Chats / Memories", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work roadmap" });
    client.createChat({ folderId: folder.id, title: "kickoff roadmap", modelId: "m" });
    const adapter = memoryAdapter([
      { id: "mem1", content: "roadmap memory note" },
    ]);
    render(<TopBar chatClient={client} memoryAdapter={adapter} debounceMs={10} />);
    fireEvent.change(screen.getByTestId("top-bar-search-input"), {
      target: { value: "roadmap" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("top-bar-group-folders")).toBeInTheDocument();
      expect(screen.getByTestId("top-bar-group-chats")).toBeInTheDocument();
      expect(screen.getByTestId("top-bar-group-memories")).toBeInTheDocument();
    });
  });

  it("clicking a folder fires onFolderClick and closes the dropdown", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Hits" });
    const onFolderClick = vi.fn();
    render(<TopBar chatClient={client} onFolderClick={onFolderClick} debounceMs={10} />);
    fireEvent.change(screen.getByTestId("top-bar-search-input"), {
      target: { value: "hits" },
    });
    const button = await screen.findByTestId(`top-bar-folder-${folder.id}`);
    fireEvent.click(button);
    expect(onFolderClick).toHaveBeenCalled();
    expect(screen.queryByTestId("top-bar-dropdown")).toBeNull();
  });

  it("clicking a chat fires onChatClick", async () => {
    const client = new InMemoryChatExplorerClient();
    const chat = client.createChat({ folderId: null, title: "draft chat", modelId: "m" });
    const onChatClick = vi.fn();
    render(<TopBar chatClient={client} onChatClick={onChatClick} debounceMs={10} />);
    fireEvent.change(screen.getByTestId("top-bar-search-input"), {
      target: { value: "draft" },
    });
    const button = await screen.findByTestId(`top-bar-chat-${chat.id}`);
    fireEvent.click(button);
    expect(onChatClick).toHaveBeenCalled();
  });

  it("clicking a memory fires onMemoryClick", async () => {
    const client = new InMemoryChatExplorerClient();
    const adapter = memoryAdapter([{ id: "mem1", content: "snippet" }]);
    const onMemoryClick = vi.fn();
    render(
      <TopBar
        chatClient={client}
        memoryAdapter={adapter}
        onMemoryClick={onMemoryClick}
        debounceMs={10}
      />,
    );
    fireEvent.change(screen.getByTestId("top-bar-search-input"), {
      target: { value: "snippet" },
    });
    const button = await screen.findByTestId("top-bar-memory-mem1");
    fireEvent.click(button);
    expect(onMemoryClick).toHaveBeenCalled();
  });

  it("shows an empty state when no group has hits", async () => {
    const client = new InMemoryChatExplorerClient();
    render(<TopBar chatClient={client} debounceMs={10} />);
    fireEvent.change(screen.getByTestId("top-bar-search-input"), {
      target: { value: "noresults" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("top-bar-empty")).toBeInTheDocument();
    });
  });

  it("Ctrl+K focuses the search input", async () => {
    const user = userEvent.setup();
    render(<TopBar />);
    await user.keyboard("{Control>}k{/Control}");
    expect(document.activeElement).toBe(screen.getByTestId("top-bar-search-input"));
  });

  it("Escape closes the dropdown", async () => {
    const client = new InMemoryChatExplorerClient();
    client.createFolder({ parentId: null, name: "Esc" });
    const user = userEvent.setup();
    render(<TopBar chatClient={client} debounceMs={10} />);
    const input = screen.getByTestId("top-bar-search-input");
    await user.type(input, "esc");
    await waitFor(() => {
      expect(screen.getByTestId("top-bar-dropdown")).toBeInTheDocument();
    });
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("top-bar-dropdown")).toBeNull();
  });

  it("the gear button surfaces onSettingsClick under a custom test id", () => {
    const onSettingsClick = vi.fn();
    render(<TopBar onSettingsClick={onSettingsClick} settingsTestId="custom-gear" />);
    fireEvent.click(screen.getByTestId("custom-gear"));
    expect(onSettingsClick).toHaveBeenCalled();
  });

  it("renders the default bell button when no extraButtons is passed", () => {
    render(<TopBar />);
    expect(screen.getByTestId("top-bar-bell")).toBeInTheDocument();
  });

  it("extraButtons replaces the default bell slot", () => {
    render(
      <TopBar
        extraButtons={<button data-testid="custom-button" type="button">x</button>}
      />,
    );
    expect(screen.queryByTestId("top-bar-bell")).toBeNull();
    expect(screen.getByTestId("custom-button")).toBeInTheDocument();
  });

  it("Memories group is hidden when no memoryAdapter is provided", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "OnlyFolder" });
    render(<TopBar chatClient={client} debounceMs={10} />);
    fireEvent.change(screen.getByTestId("top-bar-search-input"), {
      target: { value: "only" },
    });
    await screen.findByTestId(`top-bar-folder-${folder.id}`);
    expect(screen.queryByTestId("top-bar-group-memories")).toBeNull();
  });
});
