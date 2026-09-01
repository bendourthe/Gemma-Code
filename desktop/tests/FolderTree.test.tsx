/**
 * v1.0.0 Phase 4.3 -- interaction tests for <FolderTree>.
 *
 * Covers: render-from-empty, create, rename (F2 + double-click + context
 * menu), drag-drop folder + chat, delete with confirm modal, keyboard
 * navigation, expanded-state persistence.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // v2.2.0 DF-12: this used to read "Create your first folder", which is why
    // the module looked like it required a folder before you could talk to
    // anything. Folders stay available; they are just no longer the entry.
    expect(screen.getByTestId("folder-tree-empty-cta")).toHaveTextContent(
      /start a new chat/i,
    );
    expect(screen.getByTestId("folder-tree-new-folder")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-new-chat")).toBeInTheDocument();
  });

  it("clicking the empty-state CTA creates a chat at the root, not a folder", async () => {
    const client = setupClient();
    const user = userEvent.setup();
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    await user.click(screen.getByTestId("folder-tree-empty-cta"));
    const tree = client.listTree();
    expect(tree.chats.length).toBe(1);
    expect(tree.chats[0]?.folderId).toBeNull();
    expect(tree.children.length).toBe(0);
  });

  // v2.2.9 Phase 1.4 (T004): the selected row must be visibly distinct on a
  // --bg-1 pane -- a --bg-1 fill was invisible (screenshot 2).
  it("gives the selected chat row a contrast fill, an accent bar, and aria-selected", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "Open me", modelId: "m" });
    const other = client.createChat({ folderId: null, title: "Not open", modelId: "m" });
    render(
      <FolderTree
        client={client}
        storageAdapter={storageAdapter}
        selected={{ kind: "chat", id: chat.id }}
      />,
    );
    const row = screen.getByTestId(`tree-row-chat-${chat.id}`);
    const idle = screen.getByTestId(`tree-row-chat-${other.id}`);
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(idle).toHaveAttribute("aria-selected", "false");
    // Contrast: never the pane background token, never transparent.
    expect(row.style.backgroundColor).not.toBe("var(--bg-1)");
    expect(row.style.backgroundColor).not.toBe("transparent");
    expect(row.style.backgroundColor).not.toBe(idle.style.backgroundColor);
    // 4px accent left bar marks the open chat.
    expect(row.style.borderLeft).toContain("4px solid");
    expect(row.style.borderLeft).not.toContain("transparent");
    expect(idle.style.borderLeft).toContain("transparent");
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

  it("selects and opens a chat created from the toolbar", async () => {
    const client = setupClient();
    const onSelect = vi.fn();
    const onOpenChat = vi.fn();
    const user = userEvent.setup();
    render(
      <FolderTree
        client={client}
        storageAdapter={storageAdapter}
        onSelect={onSelect}
        onOpenChat={onOpenChat}
      />,
    );
    await user.click(screen.getByTestId("folder-tree-new-chat"));
    const created = client.listTree().chats[0];
    expect(created).toBeTruthy();
    if (!created) throw new Error("expected created chat");
    expect(onSelect).toHaveBeenCalledWith({ kind: "chat", id: created.id });
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
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
    await waitFor(() => expect(client.getFolder(folder.id)).toBeNull());
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

  it("shows rename and delete icons on a chat row without stealing the open click", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    const onOpenChat = vi.fn();
    render(
      <FolderTree client={client} storageAdapter={storageAdapter} onOpenChat={onOpenChat} />,
    );
    expect(screen.getByTestId(`tree-rename-${chat.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`tree-delete-${chat.id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ id: chat.id }));
    expect(screen.queryByTestId(`tree-rename-input-${chat.id}`)).not.toBeInTheDocument();
  });

  it("rename icon starts inline rename without opening the chat again", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    const onOpenChat = vi.fn();
    render(
      <FolderTree client={client} storageAdapter={storageAdapter} onOpenChat={onOpenChat} />,
    );
    fireEvent.click(screen.getByTestId(`tree-rename-${chat.id}`));
    expect(screen.getByTestId(`tree-rename-input-${chat.id}`)).toBeInTheDocument();
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("delete icon opens the confirm modal and does not delete until confirmed", async () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId(`tree-delete-${chat.id}`));
    expect(screen.getByTestId("folder-tree-confirm-delete")).toBeInTheDocument();
    expect(document.body).toContainElement(screen.getByTestId("folder-tree-confirm-delete"));
    expect(screen.getByTestId("folder-tree-confirm-delete").parentElement).toBe(document.body);
    expect(client.getChat(chat.id)?.title).toBe("draft");
    fireEvent.click(screen.getByTestId("confirm-delete-ok"));
    await waitFor(() => expect(client.getChat(chat.id)).toBeNull());
  });

  it("archives a chat through reversible copy and reports disposition after success", async () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "Keep safely", modelId: "m" });
    const before = vi.fn();
    const after = vi.fn();
    render(<FolderTree client={client} storageAdapter={storageAdapter} onBeforeSessionDisposition={before} onSessionDisposition={after} />);
    fireEvent.click(screen.getByTestId(`tree-archive-${chat.id}`));
    expect(screen.getByTestId("folder-tree-confirm-archive")).toHaveTextContent(/restore it from Settings/i);
    fireEvent.click(screen.getByTestId("confirm-archive-ok"));
    await waitFor(() => expect(client.getChat(chat.id)).toBeNull());
    expect(before).toHaveBeenCalledWith(chat.id, "archived");
    expect(after).toHaveBeenCalledWith(chat.id, "archived");
  });

  it("offers Archive instead and labels permanent deletion as irreversible", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "Risky", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId(`tree-delete-${chat.id}`));
    const dialog = screen.getByTestId("folder-tree-confirm-delete");
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(screen.getByTestId("folder-tree-confirm-delete-question")).toHaveTextContent(
      "Delete the selected chat?",
    );
    expect(dialog.textContent).not.toContain("Risky");
    expect(screen.getByTestId("confirm-delete-archive-instead")).toBeInTheDocument();
  });

  it("ctrl-click selects several chats and bulk-delete uses generic copy", async () => {
    const client = setupClient();
    const a = client.createChat({ folderId: null, title: "Alpha prompt title here", modelId: "m" });
    const b = client.createChat({ folderId: null, title: "Beta prompt title here", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId(`tree-row-chat-${a.id}`));
    fireEvent.click(screen.getByTestId(`tree-row-chat-${b.id}`), { ctrlKey: true });
    expect(screen.getByTestId(`tree-row-chat-${a.id}`)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(`tree-row-chat-${b.id}`)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByTestId(`tree-row-chat-${b.id}`), { key: "Delete" });
    const question = await screen.findByTestId("folder-tree-confirm-delete-question");
    expect(question).toHaveTextContent("Delete the selected chats?");
    expect(screen.getByTestId("folder-tree-confirm-delete").textContent).not.toContain("Alpha prompt");
    fireEvent.click(screen.getByTestId("confirm-delete-ok"));
    await waitFor(() => {
      expect(client.getChat(a.id)).toBeNull();
      expect(client.getChat(b.id)).toBeNull();
    });
  });

  it("Escape clears the multi-selection", () => {
    const client = setupClient();
    const a = client.createChat({ folderId: null, title: "A", modelId: "m" });
    const b = client.createChat({ folderId: null, title: "B", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId(`tree-row-chat-${a.id}`));
    fireEvent.click(screen.getByTestId(`tree-row-chat-${b.id}`), { ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId(`tree-row-chat-${b.id}`)).toHaveAttribute("aria-selected", "false");
  });

  it("confirm-delete uses a rounded quiet destructive, not a square flash-red fill", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId(`tree-delete-${chat.id}`));
    const dialog = screen.getByTestId("folder-tree-confirm-delete");
    const card = dialog.firstElementChild as HTMLElement;
    const ok = screen.getByTestId("confirm-delete-ok");
    expect(getComputedStyle(card).borderRadius === "" ? card.style.borderRadius : card.style.borderRadius).not.toBe("0px");
    expect(card.style.borderRadius).toContain("radius");
    expect(ok.style.borderRadius).toContain("radius");
    expect(ok.style.backgroundColor).not.toMatch(/^(#d33|rgb\(221,\s*51,\s*51\)|white)$/i);
    expect(ok.style.background).toMatch(/color-mix|status-err/);
    expect(ok.style.color).not.toBe("white");
  });

  it("confirm-delete Escape and Cancel keep the chat", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "keep-me", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId(`tree-delete-${chat.id}`));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("folder-tree-confirm-delete")).not.toBeInTheDocument();
    expect(client.getChat(chat.id)?.title).toBe("keep-me");
    fireEvent.click(screen.getByTestId(`tree-delete-${chat.id}`));
    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
    expect(client.getChat(chat.id)?.title).toBe("keep-me");
  });

  it("collapsed rail keeps new/folder actions and still confirms delete", async () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} collapsed />);
    expect(screen.getByTestId("folder-tree")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("folder-tree-new-folder")).toBeInTheDocument();
    expect(screen.getByTestId("folder-tree-new-chat")).toBeInTheDocument();
    expect(screen.getByTestId(`history-rail-mark-${chat.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`tree-delete-${chat.id}`)).not.toBeInTheDocument();
    const row = screen.getByTestId(`tree-row-chat-${chat.id}`);
    fireEvent.keyDown(row, { key: "Delete" });
    expect(screen.getByTestId("folder-tree-confirm-delete")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
    expect(client.getChat(chat.id)).not.toBeNull();
    fireEvent.keyDown(row, { key: "Delete" });
    fireEvent.click(screen.getByTestId("confirm-delete-ok"));
    await waitFor(() => expect(client.getChat(chat.id)).toBeNull());
  });

  it("left-click on the already-selected chat enters rename", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    const onOpenChat = vi.fn();
    render(
      <FolderTree
        client={client}
        storageAdapter={storageAdapter}
        selected={{ kind: "chat", id: chat.id }}
        onOpenChat={onOpenChat}
      />,
    );
    fireEvent.click(screen.getByTestId(`tree-row-chat-${chat.id}`));
    expect(screen.getByTestId(`tree-rename-input-${chat.id}`)).toBeInTheDocument();
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it("keeps the right-click context menu on a chat row", () => {
    const client = setupClient();
    const chat = client.createChat({ folderId: null, title: "draft", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.contextMenu(screen.getByTestId(`tree-row-chat-${chat.id}`));
    const menu = screen.getByTestId("folder-tree-context-menu");
    expect(within(menu).getByTestId("ctx-rename")).toBeInTheDocument();
    expect(within(menu).getByTestId("ctx-delete")).toBeInTheDocument();
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

/**
 * v2.4.4 Phase 2 (T008) -- history chrome and whole-list actions.
 *
 * Field screenshot 2 showed three misses at once: the hairline sat closer to
 * Videos than to Chats, selected chat titles were pushed a further 12px off
 * the blue selection rail by a dummy chevron spacer, and there was no way to
 * clear a pillar's history without deleting rows one at a time.
 */
describe("history chrome and bulk actions (v2.4.4 Phase 2)", () => {
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

  function seed(count: number): InMemoryChatExplorerClient {
    const client = new InMemoryChatExplorerClient();
    for (let i = 0; i < count; i += 1) {
      client.createChat({ folderId: null, title: `Chat ${i + 1}`, modelId: "m" });
    }
    return client;
  }

  it("gives the header no top padding so the hairline gap stays symmetric", () => {
    render(<FolderTree client={seed(1)} storageAdapter={storageAdapter} />);
    const header = screen.getByTestId("folder-tree").querySelector("header");
    expect(header).not.toBeNull();
    // The sidebar rule owns the whole gap on both of its sides. A second
    // padding-top here is exactly what made the gap below the rule larger.
    expect((header as HTMLElement).style.paddingTop).toBe("0px");
  });

  it("puts the chat title first after the rail, with no dummy chevron spacer", () => {
    const client = seed(1);
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const chatId = client.listTree().chats[0]!.id;
    const row = screen.getByTestId(`tree-row-chat-${chatId}`);
    // Chat rows have no chevron and are at depth 0, so nothing may sit
    // between the 4px selection rail and the label.
    expect(row.querySelectorAll("span").length).toBeGreaterThanOrEqual(1);
    const first = row.firstElementChild as HTMLElement;
    expect(first.textContent).toContain("Chat 1");
    expect(row.style.borderLeft).toContain("4px");
  });

  it("keeps the folder chevron on folder rows", () => {
    const client = new InMemoryChatExplorerClient();
    client.createFolder({ parentId: null, name: "Work" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    const folderId = client.listTree().children[0]!.folder!.id;
    const row = screen.getByTestId(`tree-row-folder-${folderId}`);
    expect(row.querySelector("svg")).not.toBeNull();
  });

  it("archives every chat in the tree behind one confirm", async () => {
    const client = seed(3);
    const archive = vi.spyOn(client, "archiveChat");
    const remove = vi.spyOn(client, "deleteChat");
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId("folder-tree-archive-all"));
    const dialog = screen.getByTestId("folder-tree-confirm-bulk");
    expect(dialog).toHaveAttribute("data-bulk-kind", "archive");
    // Portaled to document.body like the per-row confirm, not nested in the row.
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByTestId("folder-tree-confirm-bulk-question")).toHaveTextContent("3");
    fireEvent.click(screen.getByTestId("confirm-bulk-ok"));
    await waitFor(() => expect(client.listTree().chats).toHaveLength(0));
    expect(archive).toHaveBeenCalledTimes(3);
    // Archive All must not delete.
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes every chat in the tree behind one confirm", async () => {
    const client = seed(2);
    const archive = vi.spyOn(client, "archiveChat");
    const remove = vi.spyOn(client, "deleteChat");
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId("folder-tree-delete-all"));
    expect(screen.getByTestId("folder-tree-confirm-bulk")).toHaveAttribute("data-bulk-kind", "delete");
    fireEvent.click(screen.getByTestId("confirm-bulk-ok"));
    await waitFor(() => expect(client.listTree().chats).toHaveLength(0));
    expect(remove).toHaveBeenCalledTimes(2);
    // Delete All must not quietly archive instead.
    expect(archive).not.toHaveBeenCalled();
  });

  it("reaches chats inside collapsed folders, not only the visible rows", async () => {
    const client = new InMemoryChatExplorerClient();
    const folder = client.createFolder({ parentId: null, name: "Work" });
    client.createChat({ folderId: folder.id, title: "Nested", modelId: "m" });
    client.createChat({ folderId: null, title: "Root", modelId: "m" });
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    // The folder is collapsed, so "Nested" is not a rendered row.
    expect(screen.queryByText("Nested")).toBeNull();
    fireEvent.click(screen.getByTestId("folder-tree-delete-all"));
    expect(screen.getByTestId("folder-tree-confirm-bulk-question")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("confirm-bulk-ok"));
    await waitFor(() => expect(client.listTree().chats).toHaveLength(0));
    expect(client.listTree().children[0]!.chats).toHaveLength(0);
  });

  it("cancel leaves the list untouched", async () => {
    const client = seed(2);
    render(<FolderTree client={client} storageAdapter={storageAdapter} />);
    fireEvent.click(screen.getByTestId("folder-tree-delete-all"));
    fireEvent.click(screen.getByTestId("confirm-bulk-cancel"));
    await waitFor(() => expect(screen.queryByTestId("folder-tree-confirm-bulk")).toBeNull());
    expect(client.listTree().chats).toHaveLength(2);
  });

  it("offers no bulk actions when the list is empty", () => {
    render(<FolderTree client={new InMemoryChatExplorerClient()} storageAdapter={storageAdapter} />);
    // The empty state renders the toolbar; both whole-list actions are inert.
    expect(screen.getByTestId("folder-tree-delete-all")).toBeDisabled();
    expect(screen.getByTestId("folder-tree-archive-all")).toBeDisabled();
  });
});
