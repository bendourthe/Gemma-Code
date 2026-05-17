/**
 * v1.0.0 Phase 4.3 -- interaction tests for <FolderTree>.
 *
 * Covers: render-from-empty, create, rename (F2 + double-click + context
 * menu), drag-drop folder + chat, delete with confirm modal, keyboard
 * navigation, expanded-state persistence.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderTree, type SelectedNode } from "../src/modules/chat/FolderTree";
import { InMemoryChatExplorerClient } from "../src/modules/chat/chatExplorerClient";

function setupClient() {
  const client = new InMemoryChatExplorerClient();
  return client;
}

describe("<FolderTree>", () => {
  let storage: Map<string, readonly string[]>;
  const storageAdapter = {
    read: () => storage.get("expanded") ?? [],
    write: (ids: readonly string[]) => {
      storage.set("expanded", ids);
    },
  };

  beforeEach(() => {
    storage = new Map();
  });

  it("renders an empty-state CTA when there are no folders or chats", () => {
    const client = setupClient();
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    expect(screen.getByTestId("folder-tree-empty")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-empty-cta")).toHaveTextContent(
      /create your first folder/i,
    );
  });

  it("clicking the empty-state CTA creates a folder and enters rename mode", async () => {
    const client = setupClient();
    const user = userEvent.setup();
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    await user.click(screen.getByTestId("folder-tree-empty-cta"));
    // The new folder shows up with an inline rename input focused.
    const renameInput = await screen.findByTestId(/^tree-rename-input-/);
    expect(renameInput).toHaveValue("New folder");
  });

  it("creates a new folder via the toolbar button", async () => {
    const client = setupClient();
    client.createFolder({ parentId: null, name: "Existing" });
    const user = userEvent.setup();
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    await user.click(screen.getByTestId("folder-tree-new-folder"));
    expect(client.listTree().children.length).toBe(2);
  });

  it("creates a new chat via the toolbar button", async () => {
    const client = setupClient();
    client.createFolder({ parentId: null, name: "Existing" });
    const user = userEvent.setup();
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    await user.click(screen.getByTestId("folder-tree-new-chat"));
    expect(client.listTree().chats.length).toBe(1);
  });

  it("renames a folder via double-click", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "Old" });
    const user = userEvent.setup();
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.doubleClick(row);
    const input = await screen.findByTestId(`tree-rename-input-${folder.id}`);
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    expect(client.getFolder(folder.id)?.name).toBe("Renamed");
  });

  it("cancels a rename on Escape", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "Stable" });
    const user = userEvent.setup();
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.doubleClick(row);
    const input = await screen.findByTestId(`tree-rename-input-${folder.id}`);
    await user.clear(input);
    await user.type(input, "x{Escape}");
    expect(client.getFolder(folder.id)?.name).toBe("Stable");
  });

  it("enters rename mode on F2", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "F2" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.keyDown(row, { key: "F2" });
    expect(await screen.findByTestId(`tree-rename-input-${folder.id}`)).toBeInTheDocument();
  });

  it("right-click opens the context menu with the right entries", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "Ctx" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.contextMenu(row);
    const menu = await screen.findByTestId("folder-tree-context-menu");
    expect(within(menu).getByTestId("ctx-new-folder")).toBeInTheDocument();
    expect(within(menu).getByTestId("ctx-new-chat")).toBeInTheDocument();
    expect(within(menu).getByTestId("ctx-rename")).toBeInTheDocument();
    expect(within(menu).getByTestId("ctx-delete")).toBeInTheDocument();
    expect(within(menu).getByTestId("ctx-change-color")).toBeInTheDocument();
  });

  it("context-menu rename triggers inline rename", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "Ctx" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByTestId("ctx-rename"));
    expect(await screen.findByTestId(`tree-rename-input-${folder.id}`)).toBeInTheDocument();
  });

  it("context-menu delete opens the confirm modal and removes the row on confirm", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "ToGo" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByTestId("ctx-delete"));
    expect(await screen.findByTestId("folder-tree-confirm-delete")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-delete-ok"));
    expect(client.getFolder(folder.id)).toBeNull();
  });

  it("confirm-delete cancel keeps the folder", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "Keep" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.keyDown(row, { key: "Delete" });
    expect(await screen.findByTestId("folder-tree-confirm-delete")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
    expect(client.getFolder(folder.id)?.name).toBe("Keep");
  });

  it("drag-drop moves a chat into a folder", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "Target" });
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const chatRow = screen.getByTestId(`tree-row-chat-${chat.id}`);
    const folderRow = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.dragStart(chatRow, { dataTransfer: makeDt() });
    fireEvent.dragOver(folderRow, { dataTransfer: makeDt() });
    fireEvent.drop(folderRow, { dataTransfer: makeDt() });
    expect(client.getChat(chat.id)?.folderId).toBe(folder.id);
  });

  it("drag-drop refuses to move a folder into its descendant (silently)", () => {
    const client = setupClient();
    const a = client.createFolder({ parentId: null, name: "A" });
    const b = client.createFolder({ parentId: a.id, name: "B" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    // Expand A so child B is rendered.
    fireEvent.click(screen.getByTestId(`tree-row-folder-${a.id}`));
    const aRow = screen.getByTestId(`tree-row-folder-${a.id}`);
    const bRow = screen.getByTestId(`tree-row-folder-${b.id}`);
    fireEvent.dragStart(aRow, { dataTransfer: makeDt() });
    fireEvent.dragOver(bRow, { dataTransfer: makeDt() });
    fireEvent.drop(bRow, { dataTransfer: makeDt() });
    // A is unchanged.
    expect(client.getFolder(a.id)?.parentId).toBeNull();
  });

  it("drop on a chat row is ignored", () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "F" });
    const c1 = client.createChat({ folderId: null, title: "one", modelId: "m" });
    const c2 = client.createChat({ folderId: folder.id, title: "two", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId(`tree-row-folder-${folder.id}`));
    const c1Row = screen.getByTestId(`tree-row-chat-${c1.id}`);
    const c2Row = screen.getByTestId(`tree-row-chat-${c2.id}`);
    fireEvent.dragStart(c1Row, { dataTransfer: makeDt() });
    fireEvent.dragOver(c2Row, { dataTransfer: makeDt() });
    fireEvent.drop(c2Row, { dataTransfer: makeDt() });
    expect(client.getChat(c1.id)?.folderId).toBeNull();
  });

  it("keyboard ArrowDown / ArrowUp moves focus between rows", () => {
    const client = setupClient();
    const a = client.createFolder({ parentId: null, name: "A" });
    const b = client.createFolder({ parentId: null, name: "B" });
    let captured: SelectedNode | null = null;
    render(
      <FolderTree
        client={client}
        storageAdapter={storageAdapter}
        selected={{ kind: "folder", id: a.id }}
        onSelect={(n) => {
          captured = n;
        }}
      />,
    );
    const row = screen.getByTestId(`tree-row-folder-${a.id}`);
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    // The second row should now be the focused element.
    expect(document.activeElement?.getAttribute("data-tree-key")).toBe(`folder:${b.id}`);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("data-tree-key")).toBe(`folder:${a.id}`);
    // Smoke-check the onSelect surface stayed available.
    fireEvent.click(row);
    expect(captured).toBeTruthy();
  });

  it("ArrowRight expands a folder, ArrowLeft collapses it", () => {
    const client = setupClient();
    const a = client.createFolder({ parentId: null, name: "A" });
    client.createFolder({ parentId: a.id, name: "B" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${a.id}`);
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(storage.get("expanded")).toContain(a.id);
    fireEvent.keyDown(row, { key: "ArrowLeft" });
    expect(storage.get("expanded")).not.toContain(a.id);
  });

  it("Enter on a chat row triggers onOpenChat", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    const onOpenChat = vi.fn();
    render(
      <FolderTree client={client} storageAdapter={storageAdapter} onOpenChat={onOpenChat} />,
    );
    const row = screen.getByTestId(`tree-row-chat-${chat.id}`);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: chat.id }));
  });

  it("Enter on a folder triggers onOpenFolder", () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "F" });
    const onOpenFolder = vi.fn();
    render(
      <FolderTree
        client={client}
        storageAdapter={storageAdapter}
        onOpenFolder={onOpenFolder}
      />,
    );
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpenFolder).toHaveBeenCalled();
  });

  it("persists the expanded set to the storage adapter", () => {
    const client = setupClient();
    const a = client.createFolder({ parentId: null, name: "A" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${a.id}`);
    fireEvent.click(row);
    expect(storage.get("expanded")).toContain(a.id);
  });

  it("context-menu Change color applies a colored left border", async () => {
    const client = setupClient();
    const folder = client.createFolder({ parentId: null, name: "Color" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const row = screen.getByTestId(`tree-row-folder-${folder.id}`);
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByTestId("ctx-change-color"));
    const updated = screen.getByTestId(`tree-row-folder-${folder.id}`);
    expect(updated.getAttribute("style")).toContain("border-left");
  });

  it("context-menu New folder creates a folder under the right parent", async () => {
    const client = setupClient();
    const parent = client.createFolder({ parentId: null, name: "Parent" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.contextMenu(screen.getByTestId(`tree-row-folder-${parent.id}`));
    fireEvent.click(await screen.findByTestId("ctx-new-folder"));
    const tree = client.listTree();
    const parentNode = tree.children.find((c) => c.folder?.id === parent.id);
    expect(parentNode?.children.length).toBe(1);
  });

  it("context-menu New chat creates a chat under the right folder", async () => {
    const client = setupClient();
    const parent = client.createFolder({ parentId: null, name: "Parent" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.contextMenu(screen.getByTestId(`tree-row-folder-${parent.id}`));
    fireEvent.click(await screen.findByTestId("ctx-new-chat"));
    const tree = client.listTree();
    const parentNode = tree.children.find((c) => c.folder?.id === parent.id);
    expect(parentNode?.chats.length).toBe(1);
  });
});

function makeDt(): { effectAllowed: string; dropEffect: string; setData: (k: string, v: string) => void; getData: (k: string) => string } {
  // jsdom does not implement DataTransfer; we supply a minimal stub that
  // satisfies the FolderTree dnd handlers without crashing.
  const store = new Map<string, string>();
  return {
    effectAllowed: "move",
    dropEffect: "move",
    setData: (k, v) => {
      store.set(k, v);
    },
    getData: (k) => store.get(k) ?? "",
  };
}
