/**
 * v1.0.0 Phase 4.4 -- Local Chatbot Explorer page.
 *
 * The Chat module's top-level page. Hosts:
 *   - left rail: `<FolderTree>` (drag-drop, context menu, keyboard nav)
 *   - right pane: breadcrumb + shared chat shell (`<MessageList>`, `<ChatInput>`)
 *   - model selector wired to the shared `<ModelSelector>`
 *   - per-folder `enableTools` toggle (default off; power users opt in)
 *
 * The page consumes an `InMemoryChatExplorerClient` for now (Phase 4 stub);
 * the IPC-backed client lands once the sidecar shared-core build closes
 * known-gap 3.P1.N.
 */

import { useCallback, useMemo, useState } from "react";
import { FolderTree, type SelectedNode } from "./FolderTree";
import { Breadcrumb } from "./Breadcrumb";
import { InMemoryChatExplorerClient } from "./chatExplorerClient";
import type {
  ChatExplorerClient,
} from "./chatExplorerClient";
import type { Chat } from "./types";
import {
  ChatInput,
  MessageList,
  ModelSelector,
  type ChatMessage,
} from "../../shared/chat";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "../coding/models";

export interface ChatPageProps {
  /** Optional client override (tests inject an InMemoryChatExplorerClient). */
  client?: ChatExplorerClient;
  /** Default model id used when starting a fresh chat. */
  defaultModelId?: string;
}

export function ChatPage({
  client: clientOverride,
  defaultModelId = DEFAULT_MODEL_ID,
}: ChatPageProps = {}): JSX.Element {
  // The client survives re-renders but is recreated per ChatPage instance.
  // Tests can inject one via the prop so they observe state changes.
  const [internalClient] = useState<ChatExplorerClient>(
    () => clientOverride ?? new InMemoryChatExplorerClient(),
  );
  const client = clientOverride ?? internalClient;

  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [modelId, setModelId] = useState<string>(defaultModelId);
  const [enableTools, setEnableTools] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState<Map<string, ChatMessage[]>>(
    () => new Map(),
  );

  const breadcrumbAncestors = useMemo(() => {
    if (!activeChat) return [];
    return client.ancestors(activeChat.folderId);
  }, [activeChat, client]);

  const messages = useMemo(() => {
    if (!activeChat) return [];
    return messagesByChat.get(activeChat.id) ?? [];
  }, [activeChat, messagesByChat]);

  const handleSelect = useCallback((node: SelectedNode) => {
    setSelected(node);
  }, []);

  const handleOpenChat = useCallback((chat: Chat) => {
    setActiveChat(chat);
    setSelected({ kind: "chat", id: chat.id });
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!activeChat) return;
      setMessagesByChat((prev) => {
        const next = new Map(prev);
        const list = next.get(activeChat.id) ?? [];
        const messageId = `${activeChat.id}-${list.length}`;
        const userMessage: ChatMessage = {
          id: `${messageId}-user`,
          role: "user",
          content: text,
        };
        const assistantMessage: ChatMessage = {
          id: `${messageId}-assistant`,
          role: "assistant",
          content: `(local stub) Echo of your message: ${text}`,
        };
        next.set(activeChat.id, [...list, userMessage, assistantMessage]);
        return next;
      });
      client.renameChat(activeChat.id, activeChat.title); // touch updatedAt
    },
    [activeChat, client],
  );

  return (
    <section
      data-testid="chat-page"
      style={{
        flex: 1,
        display: "flex",
        color: "var(--fg-0)",
      }}
    >
      <aside
        style={{
          width: 280,
          borderRight: "1px solid var(--border-1)",
          backgroundColor: "var(--bg-1)",
          overflowY: "auto",
        }}
      >
        <FolderTree
          client={client}
          selected={selected}
          onSelect={handleSelect}
          onOpenChat={handleOpenChat}
          defaultModelId={modelId}
        />
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "var(--space-4)", gap: "var(--space-3)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)" }}>
          <Breadcrumb ancestors={breadcrumbAncestors} />
          <span style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
            <label style={{ display: "flex", gap: "var(--space-2)", color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
              <input
                type="checkbox"
                data-testid="chat-enable-tools"
                checked={enableTools}
                onChange={(e) => setEnableTools(e.target.checked)}
              />
              Enable tools
            </label>
            <ModelSelector
              testId="chat-model-select"
              models={FRONTEND_MODELS}
              value={modelId}
              onChange={setModelId}
              disabled={Boolean(activeChat)}
            />
          </span>
        </header>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {activeChat ? (
            <MessageList messages={messages} enableTools={enableTools} />
          ) : (
            <p data-testid="chat-page-empty" style={{ color: "var(--fg-muted)" }}>
              Select a chat from the left rail, or right-click a folder to create one.
            </p>
          )}
        </div>

        {activeChat && (
          <footer>
            <ChatInput
              onSubmit={handleSubmit}
              submitAccentVar="--accent-chatbot"
              placeholder="Type a message and press Enter to send."
            />
          </footer>
        )}
      </div>
    </section>
  );
}
