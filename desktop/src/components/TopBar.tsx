/**
 * v1.0.0 Phase 4.5 -- functional dashboard top bar with search.
 *
 * Replaces the Phase 1 placeholder search field with a debounced search
 * that queries (a) the `ChatExplorerClient` for folders + chats and (b) an
 * optional memory adapter for memory entries. Results render in a dropdown
 * grouped by `Folders | Chats | Memories`. Keyboard shortcut `Ctrl+K`
 * focuses the input; `Esc` closes the dropdown.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Bell, Search, Settings as SettingsIcon } from "lucide-react";
import type {
  Chat,
  ChatExplorerSearchHit,
  Folder,
} from "../modules/chat/types";
import type { ChatExplorerClient } from "../modules/chat/chatExplorerClient";

export interface MemorySearchHit {
  id: string;
  content: string;
  chatId?: string;
}

export interface MemorySearchAdapter {
  search(query: string, limit?: number): Promise<readonly MemorySearchHit[]>;
}

export interface TopBarProps {
  /** Optional chat explorer; falls back to an empty result list. */
  chatClient?: ChatExplorerClient;
  /** Optional memory adapter; when absent the Memories group is hidden. */
  memoryAdapter?: MemorySearchAdapter;
  /** Debounce in milliseconds before invoking search. Default 200. */
  debounceMs?: number;
  /** Click handler for a folder hit. */
  onFolderClick?: (folder: ChatExplorerSearchHit) => void;
  /** Click handler for a chat hit. */
  onChatClick?: (chat: ChatExplorerSearchHit) => void;
  /** Click handler for a memory hit. */
  onMemoryClick?: (memory: MemorySearchHit) => void;
  /** Click handler for the gear icon. */
  onSettingsClick?: () => void;
  /** Slot for additional buttons (e.g. notifications). */
  extraButtons?: ReactNode;
  /** Override the gear's test id (default `top-bar-gear`). */
  settingsTestId?: string;
}

interface SearchResults {
  folders: readonly ChatExplorerSearchHit[];
  chats: readonly ChatExplorerSearchHit[];
  memories: readonly MemorySearchHit[];
}

const EMPTY_RESULTS: SearchResults = { folders: [], chats: [], memories: [] };

export function TopBar({
  chatClient,
  memoryAdapter,
  debounceMs = 200,
  onFolderClick,
  onChatClick,
  onMemoryClick,
  onSettingsClick,
  extraButtons,
  settingsTestId = "top-bar-gear",
}: TopBarProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY_RESULTS);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const explorerHits = chatClient?.search(trimmed) ?? [];
      const folders = explorerHits.filter((h) => h.kind === "folder");
      const chats = explorerHits.filter((h) => h.kind === "chat");
      if (!cancelled) {
        setResults((prev) => ({ folders, chats, memories: prev.memories }));
      }
      if (memoryAdapter) {
        void memoryAdapter.search(trimmed, 10).then((memories) => {
          if (!cancelled) {
            setResults((prev) => ({
              folders: prev.folders,
              chats: prev.chats,
              memories,
            }));
          }
        });
      } else if (!cancelled) {
        setResults((prev) => ({ folders: prev.folders, chats: prev.chats, memories: [] }));
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chatClient, debounceMs, memoryAdapter, query]);

  const handleFolder = useCallback(
    (hit: ChatExplorerSearchHit) => {
      onFolderClick?.(hit);
      setOpen(false);
    },
    [onFolderClick],
  );

  const handleChat = useCallback(
    (hit: ChatExplorerSearchHit) => {
      onChatClick?.(hit);
      setOpen(false);
    },
    [onChatClick],
  );

  const handleMemory = useCallback(
    (hit: MemorySearchHit) => {
      onMemoryClick?.(hit);
      setOpen(false);
    },
    [onMemoryClick],
  );

  const totalHits = results.folders.length + results.chats.length + results.memories.length;

  return (
    <div data-testid="top-bar" style={containerStyle}>
      <label style={inputWrapperStyle}>
        <Search size={16} aria-hidden />
        <input
          ref={inputRef}
          data-testid="top-bar-search-input"
          aria-label="Search folders, chats, and memories"
          placeholder="Search folders, chats, memories (Ctrl+K)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          style={inputStyle}
        />
      </label>
      {extraButtons ?? (
        <button
          type="button"
          aria-label="Notifications"
          data-testid="top-bar-bell"
          style={iconButtonStyle}
        >
          <Bell size={18} aria-hidden />
        </button>
      )}
      <button
        type="button"
        aria-label="Settings"
        data-testid={settingsTestId}
        onClick={onSettingsClick}
        style={iconButtonStyle}
      >
        <SettingsIcon size={18} aria-hidden />
      </button>

      {open && query.trim().length > 0 && (
        <div data-testid="top-bar-dropdown" style={dropdownStyle}>
          {totalHits === 0 ? (
            <p
              data-testid="top-bar-empty"
              style={{ padding: "var(--space-3)", color: "var(--fg-muted)", margin: 0 }}
            >
              No matches.
            </p>
          ) : (
            <>
              <ResultGroup
                label="Folders"
                testId="top-bar-group-folders"
                items={results.folders.map((hit) => ({
                  key: hit.id,
                  label: hit.name,
                  testId: `top-bar-folder-${hit.id}`,
                  onClick: () => handleFolder(hit),
                }))}
              />
              <ResultGroup
                label="Chats"
                testId="top-bar-group-chats"
                items={results.chats.map((hit) => ({
                  key: hit.id,
                  label: hit.name,
                  testId: `top-bar-chat-${hit.id}`,
                  onClick: () => handleChat(hit),
                }))}
              />
              {memoryAdapter && (
                <ResultGroup
                  label="Memories"
                  testId="top-bar-group-memories"
                  items={results.memories.map((hit) => ({
                    key: hit.id,
                    label: hit.content,
                    testId: `top-bar-memory-${hit.id}`,
                    onClick: () => handleMemory(hit),
                  }))}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ResultGroupItem {
  key: string;
  label: string;
  testId: string;
  onClick: () => void;
}

function ResultGroup({
  label,
  testId,
  items,
}: {
  label: string;
  testId: string;
  items: readonly ResultGroupItem[];
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section data-testid={testId} style={groupStyle}>
      <header style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)", padding: "var(--space-1) var(--space-3)" }}>
        {label}
      </header>
      <ul style={listStyle}>
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              data-testid={item.testId}
              onClick={item.onClick}
              style={itemButtonStyle}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Helper used by callers that want to inject the chat-explorer client into a
 * `MemorySearchAdapter` for the Memories group.
 */
export function makeChatMemoryAdapter(options: {
  search: (query: string, limit: number) => Promise<readonly MemorySearchHit[]>;
}): MemorySearchAdapter {
  return {
    async search(query: string, limit = 10) {
      return options.search(query, limit);
    },
  };
}

export type FolderHit = ChatExplorerSearchHit & { kind: "folder" };
export type ChatHit = ChatExplorerSearchHit & { kind: "chat" };
export type { Chat, Folder };

const containerStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
};

const inputWrapperStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  backgroundColor: "var(--bg-1)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-2) var(--space-3)",
  color: "var(--fg-muted)",
};

const inputStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-1)",
  outline: "none",
  fontSize: "var(--text-sm)",
  width: 280,
};

const iconButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-1)",
  cursor: "pointer",
};

const dropdownStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + var(--space-2))",
  right: 0,
  width: 360,
  backgroundColor: "var(--bg-1)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-md)",
  zIndex: 50,
  display: "flex",
  flexDirection: "column",
};

const groupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};

const itemButtonStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "var(--fg-0)",
  cursor: "pointer",
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--text-sm)",
};
