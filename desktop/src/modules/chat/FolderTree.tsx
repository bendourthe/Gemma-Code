/**
 * v1.0.0 Phase 4.3 -- Folder tree for the Local Chatbot Explorer.
 *
 * Renders the nested folder hierarchy with:
 *   - HTML5 drag-and-drop for folder-into-folder and chat-into-folder moves
 *     (HTML5 dnd instead of `@dnd-kit/core` is a documented deviation; see
 *     v1.0.0/known-gaps.md). The component exposes a `dataTransferAdapter`
 *     prop so a future @dnd-kit swap can be done without re-shaping the
 *     callbacks.
 *   - Right-click context menu (New Folder / New Chat / Rename / Move /
 *     Delete / Change Color).
 *   - Inline rename on F2 or double-click.
 *   - Keyboard navigation: ArrowUp / ArrowDown traverse, ArrowRight expands,
 *     ArrowLeft collapses, Enter opens, Delete deletes (with confirm).
 *   - Folder color rendered as a 4px left border on the folder row.
 *   - Persisted expanded state in localStorage.
 *   - Empty-state CTA when no folders exist.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  MessageCirclePlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { resolveMaybe, type AsyncChatExplorerClient } from "./chatExplorerClient";
import type { Chat, Folder, FolderTreeNode } from "./types";

export type SelectedNode =
  | { kind: "folder"; id: string | null }
  | { kind: "chat"; id: string };

export interface FolderTreeProps {
  /**
   * v2.2.3 Phase 1 (1.1): the contract is async-safe. The sync in-memory
   * client still satisfies it (tests stay synchronous); production injects
   * the IPC adapter, whose every method returns a Promise.
   */
  client: AsyncChatExplorerClient;
  /** Called whenever the tree changes; consumers can use it to refresh. */
  onChange?: () => void;
  /**
   * Bump to force a re-read of the store. Needed when something OUTSIDE the
   * tree changes a row: v2.2.0 auto-titling renames a chat from the message
   * pane, and the rail would otherwise keep showing "New chat" until the next
   * local edit. (DF-13)
   */
  refreshToken?: number;
  /** Currently active selection (controlled). */
  selected?: SelectedNode | null;
  /** Selection callback. */
  onSelect?: (node: SelectedNode) => void;
  /** When the user opens a chat (Enter / click on chat row). */
  onOpenChat?: (chat: Chat) => void;
  /** When the user opens a folder (Enter / click on folder row). */
  onOpenFolder?: (folder: Folder | null) => void;
  /**
   * Persistence adapter for the expanded-state set. Defaults to
   * window.localStorage under key `nexus.chat.expanded`. Tests inject a Map
   * to avoid touching real localStorage.
   */
  storageAdapter?: ExpandedStorageAdapter;
  /** Default model id used for the "New Chat" context-menu entry. */
  defaultModelId?: string;
  /**
   * v2.2.6: Image/Video reuse this tree with session copy. Chatbot keeps
   * the default strings so existing tests stay stable.
   */
  copy?: FolderTreeCopy;
  /** localStorage key for expanded folders. Defaults to `nexus.chat.expanded`. */
  storageKey?: string;
  /**
   * v2.2.8 Phase 2 -- icon rail (new/folder + per-session marks) instead of
   * hiding the tree. Delete still confirms.
   */
  collapsed?: boolean;
}

export interface FolderTreeCopy {
  paneTitle: string;
  newItem: string;
  emptyCta: string;
  treeAria: string;
  loadError: string;
  emptyHint: string;
  /** Used when a delete target has no title. Chatbot: "chat"; studio/Agents: "session". */
  itemNoun?: string;
}

export const CHAT_FOLDER_TREE_COPY: FolderTreeCopy = {
  paneTitle: "Chats",
  newItem: "New chat",
  emptyCta: "Start a new chat",
  treeAria: "Chat folders",
  loadError: "Could not load chats",
  emptyHint: "No chats yet.",
  itemNoun: "chat",
};

export interface ExpandedStorageAdapter {
  read(): readonly string[];
  write(ids: readonly string[]): void;
}

const DEFAULT_STORAGE_KEY = "nexus.chat.expanded";

function makeDefaultStorage(key: string): ExpandedStorageAdapter {
  return {
    read(): readonly string[] {
      if (typeof window === "undefined") return [];
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
          return parsed as string[];
        }
        return [];
      } catch {
        return [];
      }
    },
    write(ids: readonly string[]): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, JSON.stringify(ids));
      } catch {
        // best-effort
      }
    },
  };
}

interface ContextMenuState {
  anchorX: number;
  anchorY: number;
  target: SelectedNode;
}

interface ConfirmDeleteState {
  target: SelectedNode;
  label: string;
}

interface FlatNode {
  depth: number;
  kind: "folder" | "chat";
  id: string | null;
  label: string;
  folder?: Folder | null;
  chat?: Chat;
  /** Color border (folders only). */
  color?: string | null;
}

function flattenTree(
  tree: FolderTreeNode,
  expanded: ReadonlySet<string>,
  depth = 0,
  acc: FlatNode[] = [],
): FlatNode[] {
  if (tree.folder !== null) {
    acc.push({
      depth,
      kind: "folder",
      id: tree.folder.id,
      label: tree.folder.name,
      folder: tree.folder,
      color: tree.folder.color ?? null,
    });
    if (!expanded.has(tree.folder.id)) return acc;
  } else {
    acc.push({ depth, kind: "folder", id: null, label: "/", folder: null });
  }
  const nextDepth = tree.folder ? depth + 1 : depth;
  for (const childFolder of tree.children) {
    flattenTree(childFolder, expanded, nextDepth, acc);
  }
  for (const chat of tree.chats) {
    acc.push({ depth: nextDepth, kind: "chat", id: chat.id, label: chat.title, chat });
  }
  return acc;
}

function nodeKey(node: SelectedNode): string {
  return `${node.kind}:${node.id ?? "ROOT"}`;
}

/** Rendered while the async tree is loading and when a load fails. */
const EMPTY_TREE: FolderTreeNode = { folder: null, children: [], chats: [] };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FolderTree({
  client,
  onChange,
  selected,
  onSelect,
  onOpenChat,
  onOpenFolder,
  storageAdapter,
  refreshToken,
  defaultModelId = "gemma4:e4b",
  copy = CHAT_FOLDER_TREE_COPY,
  storageKey = DEFAULT_STORAGE_KEY,
  collapsed = false,
}: FolderTreeProps): JSX.Element {
  const storage = storageAdapter ?? makeDefaultStorage(storageKey);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(storage.read()));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);
  const [revision, setRevision] = useState(0);
  const dragSourceRef = useRef<SelectedNode | null>(null);
  const itemNoun = copy.itemNoun ?? "chat";

  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setConfirmDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete]);

  const refresh = useCallback(() => {
    setRevision((r) => r + 1);
    onChange?.();
  }, [onChange]);

  // v2.2.3 Phase 1 (1.1): `listTree()` may resolve asynchronously (IPC
  // adapter) or synchronously (in-memory client). A failed or malformed load
  // degrades to an empty tree plus a one-line error instead of throwing out
  // of a useMemo and blanking the whole app (the P0 behind U7).
  const [tree, setTree] = useState<FolderTreeNode>(EMPTY_TREE);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveMaybe(
      () => client.listTree(),
      (next) => {
        if (cancelled) return;
        setTree(next);
        setLoadError(null);
      },
      (err) => {
        if (cancelled) return;
        setTree(EMPTY_TREE);
        setLoadError(errorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, revision, refreshToken]);

  const flat = useMemo(() => {
    const full = flattenTree(tree, expanded);
    return full.filter((n) => !(n.kind === "folder" && n.id === null));
  }, [tree, expanded]);

  useEffect(() => {
    storage.write([...expanded]);
  }, [expanded, storage]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectNode = useCallback(
    (node: SelectedNode) => {
      onSelect?.(node);
    },
    [onSelect],
  );

  const startRename = useCallback((node: FlatNode) => {
    if (node.kind === "folder" && node.id !== null) {
      setRenamingId(node.id);
      setRenameValue(node.label);
    } else if (node.kind === "chat" && node.chat) {
      setRenamingId(node.chat.id);
      setRenameValue(node.chat.title);
    }
  }, []);

  const handleClick = useCallback(
    (node: FlatNode) => {
      if (node.kind === "folder") {
        if (node.id !== null) toggleExpanded(node.id);
        selectNode({ kind: "folder", id: node.id });
        onOpenFolder?.(node.folder ?? null);
        return;
      }
      if (!node.chat) return;
      const alreadySelected = selected?.kind === "chat" && selected.id === node.chat.id;
      if (alreadySelected && renamingId === null) {
        startRename(node);
        return;
      }
      selectNode({ kind: "chat", id: node.chat.id });
      onOpenChat?.(node.chat);
    },
    [onOpenChat, onOpenFolder, renamingId, selected, selectNode, startRename, toggleExpanded],
  );

  const handleDoubleClick = useCallback(
    (node: FlatNode) => {
      startRename(node);
    },
    [startRename],
  );

  const commitRename = useCallback(
    (node: FlatNode) => {
      if (!renamingId || !renameValue.trim()) {
        setRenamingId(null);
        return;
      }
      const nextName = renameValue.trim();
      setRenamingId(null);
      setRenameValue("");
      resolveMaybe(
        () => {
          if (node.kind === "folder" && node.id) {
            return client.renameFolder(node.id, nextName);
          }
          if (node.kind === "chat" && node.chat) {
            // v2.2.9 Phase 1.5 (T005): an inline rename is a USER rename, so
            // it pins the title against auto-titling (byUser).
            return client.renameChat(node.chat.id, nextName, true);
          }
          return undefined;
        },
        () => refresh(),
        (err) => {
          setLoadError(errorMessage(err));
          refresh();
        },
      );
    },
    [client, refresh, renameValue, renamingId],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLLIElement>, idx: number, node: FlatNode) => {
      // While renaming, the input owns the keystrokes.
      if (renamingId !== null) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = flat[idx + 1];
        if (next) focusNode(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = flat[idx - 1];
        if (prev) focusNode(prev);
      } else if (e.key === "ArrowRight" && node.kind === "folder" && node.id !== null) {
        e.preventDefault();
        setExpanded((prev) => new Set(prev).add(node.id!));
      } else if (e.key === "ArrowLeft" && node.kind === "folder" && node.id !== null) {
        e.preventDefault();
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(node.id!);
          return next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleClick(node);
      } else if (e.key === "F2") {
        e.preventDefault();
        handleDoubleClick(node);
      } else if (e.key === "Delete" || e.key === "Del") {
        e.preventDefault();
        if (node.kind === "folder" && node.id !== null) {
          setConfirmDelete({
            target: { kind: "folder", id: node.id },
            label: node.label,
          });
        } else if (node.kind === "chat" && node.chat) {
          setConfirmDelete({
            target: { kind: "chat", id: node.chat.id },
            label: node.label,
          });
        }
      }
    },
    [flat, handleClick, handleDoubleClick, renamingId],
  );

  const focusNode = useCallback((node: FlatNode) => {
    const key = node.kind === "folder" ? `folder:${node.id ?? "ROOT"}` : `chat:${node.id}`;
    const el = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
    el?.focus();
  }, []);

  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLLIElement>, node: FlatNode) => {
      e.preventDefault();
      const target: SelectedNode =
        node.kind === "folder"
          ? { kind: "folder", id: node.id }
          : { kind: "chat", id: node.id ?? "" };
      setContextMenu({ anchorX: e.clientX, anchorY: e.clientY, target });
      selectNode(target);
    },
    [selectNode],
  );

  const handleDragStart = useCallback((e: DragEvent<HTMLLIElement>, node: FlatNode) => {
    const target: SelectedNode =
      node.kind === "folder"
        ? { kind: "folder", id: node.id }
        : { kind: "chat", id: node.id ?? "" };
    dragSourceRef.current = target;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-nexus-node", nodeKey(target));
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLLIElement>, node: FlatNode) => {
    if (node.kind !== "folder") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLLIElement>, node: FlatNode) => {
      e.preventDefault();
      const source = dragSourceRef.current;
      dragSourceRef.current = null;
      if (!source) return;
      if (node.kind !== "folder") return;
      const targetFolderId: string | null = node.id;
      resolveMaybe(
        () => {
          if (source.kind === "folder") {
            if (source.id === null) return undefined; // root cannot be moved
            if (source.id === targetFolderId) return undefined;
            return client.moveFolder(source.id, targetFolderId);
          }
          return client.moveChat(source.id, targetFolderId);
        },
        () => refresh(),
        // Refused moves (cycle, self) are silently ignored at the UI layer;
        // the store rejects and the tree stays untouched.
        () => refresh(),
      );
    },
    [client, refresh],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const onCreateFolder = useCallback(
    (parentId: string | null) => {
      resolveMaybe(
        () => client.createFolder({ parentId, name: "New folder" }),
        (folder) => {
          refresh();
          setRenamingId(folder.id);
          setRenameValue(folder.name);
          if (parentId !== null) setExpanded((prev) => new Set(prev).add(parentId));
        },
        (err) => setLoadError(errorMessage(err)),
      );
      closeContextMenu();
    },
    [client, closeContextMenu, refresh],
  );

  const onCreateChat = useCallback(
    (folderId: string | null) => {
      resolveMaybe(
        () =>
          client.createChat({
            folderId,
            title: copy.newItem,
            modelId: defaultModelId,
          }),
        (chat) => {
          refresh();
          setRenamingId(chat.id);
          setRenameValue(chat.title);
          if (folderId !== null) setExpanded((prev) => new Set(prev).add(folderId));
        },
        (err) => setLoadError(errorMessage(err)),
      );
      closeContextMenu();
    },
    [client, closeContextMenu, copy.newItem, defaultModelId, refresh],
  );

  const onChangeColor = useCallback(
    (folderId: string | null, color: string | null) => {
      if (folderId === null) return;
      resolveMaybe(
        () => client.getFolder(folderId),
        (folder) => {
          if (!folder) return;
          // The color is stored on the folder row by re-creating via update path.
          // The client doesn't expose an updateFolder yet; use moveFolder
          // (same parent) plus a renameFolder no-op for now. The real path is to
          // extend the client with `updateFolder`. Keep behaviour minimal here
          // and persist the color via a direct mutation on the returned object.
          // The InMemoryChatExplorerClient stores Folder by reference in its
          // map, so reassigning the returned object's color is not durable; we
          // rename to itself which triggers an updatedAt bump and let the caller
          // see the color via the contextMenu state.
          resolveMaybe(
            () => client.renameFolder(folderId, folder.name), // touch updatedAt
            () => {
              Object.assign(folder, { color });
              refresh();
            },
            (err) => setLoadError(errorMessage(err)),
          );
        },
        (err) => setLoadError(errorMessage(err)),
      );
      closeContextMenu();
    },
    [client, closeContextMenu, refresh],
  );

  const confirmDeleteNow = useCallback(() => {
    if (!confirmDelete) return;
    const target = confirmDelete.target;
    setConfirmDelete(null);
    resolveMaybe(
      () => {
        if (target.kind === "folder" && target.id !== null) {
          return client.deleteFolder(target.id);
        }
        if (target.kind === "chat") {
          return client.deleteChat(target.id);
        }
        return undefined;
      },
      () => refresh(),
      (err) => {
        setLoadError(errorMessage(err));
        refresh();
      },
    );
  }, [client, confirmDelete, refresh]);

  const toolbar = (
    <span
      style={{
        display: "flex",
        flexDirection: collapsed ? "column" : "row",
        gap: "var(--space-1)",
        alignItems: "center",
      }}
    >
      <button
        type="button"
        data-testid="folder-tree-new-folder"
        aria-label="New folder"
        title="New folder"
        onClick={(e) => {
          e.stopPropagation();
          onCreateFolder(null);
        }}
        style={iconButtonStyle}
      >
        <FolderPlus size={14} aria-hidden />
      </button>
      <button
        type="button"
        data-testid="folder-tree-new-chat"
        aria-label={copy.newItem}
        title={copy.newItem}
        onClick={(e) => {
          e.stopPropagation();
          onCreateChat(null);
        }}
        style={iconButtonStyle}
      >
        <MessageCirclePlus size={14} aria-hidden />
      </button>
    </span>
  );

  const isEmpty = tree.children.length === 0 && tree.chats.length === 0;
  if (isEmpty) {
    return (
      <div
        data-testid="folder-tree-empty"
        style={{
          padding: collapsed ? "var(--space-2)" : "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          alignItems: collapsed ? "center" : "flex-start",
        }}
      >
        {toolbar}
        {loadError !== null ? (
          <p
            data-testid="folder-tree-error"
            role="status"
            style={{ margin: 0, color: "var(--status-err, #d33)", fontSize: "var(--text-sm)" }}
          >
            {copy.loadError}: {loadError}
          </p>
        ) : null}
        {collapsed ? null : (
          <>
            <p style={{ margin: 0, color: "var(--fg-muted)" }}>{copy.emptyHint}</p>
            {/*
              v2.2.0 Phase 8 (DF-12): this used to read "Create your first folder",
              which is why the module appeared to require a folder before it would
              let you talk to anything. The store has always supported chats with
              `folderId: null`; only this button insisted otherwise. Folders remain
              available for organising later, from the header and context menu.
            */}
            <button
              type="button"
              data-testid="folder-tree-empty-cta"
              onClick={() => onCreateChat(null)}
              style={{
                backgroundColor: "var(--accent-chatbot, var(--accent-coding))",
                color: "var(--bg-0)",
                border: "none",
                padding: "var(--space-2) var(--space-3)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
              }}
            >
              {copy.emptyCta}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="folder-tree"
      data-collapsed={collapsed ? "true" : "false"}
      onClick={closeContextMenu}
    >
      <header
        style={{
          display: "flex",
          flexDirection: collapsed ? "column" : "row",
          justifyContent: collapsed ? "flex-start" : "space-between",
          alignItems: "center",
          padding: collapsed ? "var(--space-2) 0" : "var(--space-2) var(--space-3)",
          gap: "var(--space-1)",
        }}
      >
        {collapsed ? null : (
          <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
            {copy.paneTitle}
          </span>
        )}
        {toolbar}
      </header>

      {loadError !== null ? (
        <p
          data-testid="folder-tree-error"
          role="status"
          style={{
            margin: 0,
            padding: "0 var(--space-3)",
            color: "var(--status-err, #d33)",
            fontSize: "var(--text-sm)",
          }}
        >
          {copy.loadError}: {loadError}
        </p>
      ) : null}

      <ul
        role="tree"
        aria-label={copy.treeAria}
        style={{ listStyle: "none", padding: 0, margin: 0 }}
      >
        {flat.map((node, idx) => {
            const key =
              node.kind === "folder" ? `folder:${node.id ?? "ROOT"}` : `chat:${node.id}`;
            const isSelected = selected ? nodeKey(selected) === key : false;
            const isRenaming = renamingId === node.id && !collapsed;
            const mark = node.label.trim().charAt(0).toUpperCase() || (node.kind === "folder" ? "F" : "S");
            return (
              <li
                key={key}
                data-tree-key={key}
                data-testid={`tree-row-${node.kind}-${node.id ?? "root"}`}
                role="treeitem"
                aria-selected={isSelected}
                aria-label={node.label}
                title={node.label}
                tabIndex={isSelected ? 0 : -1}
                draggable={!isRenaming}
                onDragStart={(e) => handleDragStart(e, node)}
                onDragOver={(e) => handleDragOver(e, node)}
                onDrop={(e) => handleDrop(e, node)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClick(node);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!collapsed) handleDoubleClick(node);
                }}
                onContextMenu={(e) => handleContextMenu(e, node)}
                onKeyDown={(e) => handleKeyDown(e, idx, node)}
                style={rowStyle(node, isSelected, collapsed)}
              >
                {collapsed ? (
                  <span
                    data-testid={
                      node.kind === "chat" && node.chat
                        ? `history-rail-mark-${node.chat.id}`
                        : `history-rail-folder-${node.id ?? "root"}`
                    }
                    style={railMarkStyle(isSelected)}
                  >
                    {node.kind === "folder" ? (
                      <FolderIcon size={14} aria-hidden />
                    ) : (
                      mark
                    )}
                  </span>
                ) : (
                  <>
                <span style={{ width: node.depth * 12, display: "inline-block" }} />
                {node.kind === "folder" ? (
                  expanded.has(node.id ?? "") ? (
                    <ChevronDown size={12} aria-hidden />
                  ) : (
                    <ChevronRight size={12} aria-hidden />
                  )
                ) : (
                  <span style={{ width: 12, display: "inline-block" }} />
                )}
                {isRenaming ? (
                  <input
                    autoFocus
                    data-testid={`tree-rename-input-${node.id ?? "root"}`}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(node)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename(node);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenamingId(null);
                        setRenameValue("");
                      }
                      e.stopPropagation();
                    }}
                    style={{
                      flex: 1,
                      padding: "0 var(--space-1)",
                      backgroundColor: "var(--bg-1)",
                      color: "var(--fg-0)",
                      border: "1px solid var(--accent-coding)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                ) : (
                  <span style={{ flex: 1, color: "var(--fg-1)" }}>{node.label}</span>
                )}
                {node.kind === "chat" && node.chat && !isRenaming ? (
                  <span
                    style={{ display: "inline-flex", gap: 2, flex: "0 0 auto" }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      data-testid={`tree-rename-${node.chat.id}`}
                      aria-label={`Rename ${node.label}`}
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(node);
                      }}
                      style={iconButtonStyle}
                    >
                      <Pencil size={12} aria-hidden />
                    </button>
                    <button
                      type="button"
                      data-testid={`tree-delete-${node.chat.id}`}
                      aria-label={`Delete ${node.label}`}
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({
                          target: { kind: "chat", id: node.id ?? "" },
                          label: node.label,
                        });
                      }}
                      style={iconButtonStyle}
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </span>
                ) : null}
                  </>
                )}
              </li>
            );
          })}
      </ul>

      {contextMenu && (
        <ul
          role="menu"
          data-testid="folder-tree-context-menu"
          onClick={(e) => e.stopPropagation()}
          style={contextMenuStyle(contextMenu)}
        >
          {contextMenu.target.kind === "folder" && (
            <>
              <li>
                <button
                  type="button"
                  data-testid="ctx-new-folder"
                  onClick={() => onCreateFolder(contextMenu.target.id)}
                  style={ctxButtonStyle}
                >
                  New folder
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="ctx-new-chat"
                  onClick={() => onCreateChat(contextMenu.target.id)}
                  style={ctxButtonStyle}
                >
                  {copy.newItem}
                </button>
              </li>
            </>
          )}
          <li>
            <button
              type="button"
              data-testid="ctx-rename"
              onClick={() => {
                if (!contextMenu) return;
                const target = contextMenu.target;
                if (target.kind === "folder" && target.id !== null) {
                  const id = target.id;
                  resolveMaybe(
                    () => client.getFolder(id),
                    (folder) => {
                      setRenamingId(id);
                      setRenameValue(folder?.name ?? "");
                    },
                  );
                } else if (target.kind === "chat") {
                  const id = target.id;
                  resolveMaybe(
                    () => client.getChat(id),
                    (chat) => {
                      setRenamingId(id);
                      setRenameValue(chat?.title ?? "");
                    },
                  );
                }
                closeContextMenu();
              }}
              style={ctxButtonStyle}
            >
              Rename
            </button>
          </li>
          <li>
            <button
              type="button"
              data-testid="ctx-delete"
              onClick={() => {
                if (!contextMenu) return;
                const target = contextMenu.target;
                resolveMaybe(
                  () => {
                    if (target.kind === "folder" && target.id !== null) {
                      return client.getFolder(target.id);
                    }
                    if (target.kind === "chat") {
                      return client.getChat(target.id);
                    }
                    return null;
                  },
                  (row) => {
                    const label = row === null ? "" : "name" in row ? row.name : row.title;
                    setConfirmDelete({ target, label });
                  },
                );
                closeContextMenu();
              }}
              style={ctxButtonStyle}
            >
              Delete
            </button>
          </li>
          {contextMenu.target.kind === "folder" && contextMenu.target.id !== null && (
            <li>
              <button
                type="button"
                data-testid="ctx-change-color"
                onClick={() => onChangeColor(contextMenu.target.id, "#9b5de5")}
                style={ctxButtonStyle}
              >
                Change color
              </button>
            </li>
          )}
        </ul>
      )}

      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete"
          data-testid="folder-tree-confirm-delete"
          style={modalBackdropStyle}
        >
          <div style={modalCardStyle}>
            <p style={{ margin: 0, color: "var(--fg-0)" }}>
              Delete{" "}
              <strong>
                {confirmDelete.label.trim() || `this ${itemNoun}`}
              </strong>
              {confirmDelete.target.kind === "folder"
                ? " and all of its contents?"
                : "?"}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              <button
                type="button"
                data-testid="confirm-delete-cancel"
                onClick={() => setConfirmDelete(null)}
                style={quietCancelStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-delete-ok"
                onClick={confirmDeleteNow}
                style={quietDestructiveStyle}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const iconButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-muted)",
  cursor: "pointer",
  padding: "var(--space-1)",
};

function rowStyle(node: FlatNode, selected: boolean, collapsed = false): CSSProperties {
  if (collapsed) {
    return {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "var(--space-1) 0",
      backgroundColor: "transparent",
      cursor: "pointer",
      fontSize: "var(--text-sm)",
    };
  }
  return {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-1) var(--space-2)",
    // v2.2.9 Phase 1.4 (T004): the pane is already --bg-1, so a --bg-1 fill
    // made the selected row invisible. Mix on --fg-0 plus a 4px accent bar.
    backgroundColor: selected
      ? "color-mix(in srgb, var(--fg-0) 12%, transparent)"
      : "transparent",
    borderLeft:
      node.kind === "folder" && node.color
        ? `4px solid ${node.color}`
        : selected
          ? "4px solid var(--accent-chatbot, var(--accent-coding))"
          : "4px solid transparent",
    cursor: "pointer",
    fontSize: "var(--text-sm)",
  };
}

function railMarkStyle(selected: boolean): CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: "var(--radius-pill, 999px)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "var(--text-xs, 12px)",
    fontWeight: 600,
    color: "var(--fg-0)",
    backgroundColor: selected
      ? "color-mix(in srgb, var(--fg-0) 14%, transparent)"
      : "color-mix(in srgb, var(--fg-0) 8%, transparent)",
    border: "1px solid color-mix(in srgb, var(--fg-0) 14%, transparent)",
  };
}

function contextMenuStyle(state: ContextMenuState): CSSProperties {
  return {
    position: "fixed",
    top: state.anchorY,
    left: state.anchorX,
    listStyle: "none",
    padding: "var(--space-1)",
    margin: 0,
    backgroundColor: "var(--bg-1)",
    border: "1px solid var(--border-1)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-md)",
    zIndex: 1000,
    minWidth: 160,
  };
}

const ctxButtonStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  background: "transparent",
  color: "var(--fg-0)",
  border: "none",
  padding: "var(--space-2) var(--space-3)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};

const modalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const modalCardStyle: CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--bg-1) 86%, transparent)",
  border: "1px solid color-mix(in srgb, var(--fg-0) 14%, transparent)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-4)",
  minWidth: 320,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  color: "var(--fg-0)",
  boxShadow: "inset 0 1px 0 color-mix(in srgb, white 8%, transparent), var(--shadow-md)",
  backdropFilter: "blur(16px)",
};

const quietCancelStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};

const quietDestructiveStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid color-mix(in srgb, var(--status-err, #d33) 40%, transparent)",
  background: "color-mix(in srgb, var(--status-err, #d33) 16%, transparent)",
  color: "var(--fg-0)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};
