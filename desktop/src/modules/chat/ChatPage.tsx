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

import { useCallback, useMemo, useRef, useState } from "react";
import { FolderTree, type SelectedNode } from "./FolderTree";
import { Breadcrumb } from "./Breadcrumb";
import { InMemoryChatExplorerClient } from "./chatExplorerClient";
import type {
  ChatExplorerClient,
} from "./chatExplorerClient";
import {
  createChatIpcClient,
  joinChatReply,
  type ChatSessionClient,
} from "./chatIpcClient";
import type { Chat } from "./types";
import {
  ChatInput,
  MessageList,
  ModelSelector,
  type ChatMessage,
} from "../../shared/chat";
import { PreviewPane, type PreviewArtifact } from "../../components/PreviewPane";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "../coding/models";

export interface ChatPageProps {
  /** Optional client override (tests inject an InMemoryChatExplorerClient). */
  client?: ChatExplorerClient;
  /** Optional chat-session client override (tests inject a fake; default: IPC). */
  chatSession?: ChatSessionClient;
  /** Default model id used when starting a fresh chat. */
  defaultModelId?: string;
}

export function ChatPage({
  client: clientOverride,
  chatSession: chatSessionOverride,
  defaultModelId = DEFAULT_MODEL_ID,
}: ChatPageProps = {}): JSX.Element {
  // The client survives re-renders but is recreated per ChatPage instance.
  // Tests can inject one via the prop so they observe state changes.
  const [internalClient] = useState<ChatExplorerClient>(
    () => clientOverride ?? new InMemoryChatExplorerClient(),
  );
  const client = clientOverride ?? internalClient;
  const [chatSession] = useState<ChatSessionClient>(
    () => chatSessionOverride ?? createChatIpcClient(),
  );
  // Per-chat sidecar session id, lazily started on first message.
  const sessionIdsRef = useRef<Map<string, string>>(new Map());

  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [modelId, setModelId] = useState<string>(defaultModelId);
  const [enableTools, setEnableTools] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState<Map<string, ChatMessage[]>>(
    () => new Map(),
  );
  // v1.5.0 Phase 5 (item 24): the artifact currently shown in the side-by-side
  // preview pane, or null when the pane is closed.
  const [preview, setPreview] = useState<PreviewArtifact | null>(null);

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
    setPreview(null);
  }, []);

  // v1.5.0 Phase 5 (item 24): open a message's output in the side-by-side
  // preview pane. HTML artifacts (interactive forms / tool HTML) render through
  // the shared `InteractiveArtifact`; everything else renders as text.
  const handleSelectMessage = useCallback((message: ChatMessage) => {
    const isHtmlArtifact = message.content.includes("data-nexus-artifact");
    setPreview(
      isHtmlArtifact
        ? { kind: "html", title: "Artifact", html: message.content }
        : {
            kind: "text",
            title: message.role === "assistant" ? "Assistant output" : "Message",
            text: message.content,
          },
    );
  }, []);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!activeChat) return;
      const chat = activeChat;
      const baseId = `${chat.id}-${Date.now()}`;
      // Render the user's message immediately.
      setMessagesByChat((prev) => {
        const next = new Map(prev);
        const list = next.get(chat.id) ?? [];
        next.set(chat.id, [...list, { id: `${baseId}-user`, role: "user", content: text }]);
        return next;
      });
      client.renameChat(chat.id, chat.title); // touch updatedAt

      // Drive a real local-model turn via the sidecar (lazily starting a
      // session per chat). Falls back to an inline notice if IPC is unavailable
      // (e.g. running the web bundle outside the Tauri shell).
      let content: string;
      try {
        let sessionId = sessionIdsRef.current.get(chat.id);
        if (!sessionId) {
          const started = await chatSession.start({ modelId: chat.modelId, title: chat.title });
          sessionId = started.sessionId;
          sessionIdsRef.current.set(chat.id, sessionId);
        }
        const reply = await chatSession.sendMessage({ sessionId, message: text });
        content = joinChatReply(reply.events) || "(no reply)";
      } catch (err) {
        content = `(chat unavailable) ${err instanceof Error ? err.message : String(err)}`;
      }

      setMessagesByChat((prev) => {
        const next = new Map(prev);
        const list = next.get(chat.id) ?? [];
        next.set(chat.id, [...list, { id: `${baseId}-assistant`, role: "assistant", content }]);
        return next;
      });
    },
    [activeChat, client, chatSession],
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

        <div style={{ flex: 1, display: "flex", minHeight: 0, gap: "var(--space-3)" }}>
          <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
            {activeChat ? (
              <MessageList
                messages={messages}
                enableTools={enableTools}
                onSelectMessage={handleSelectMessage}
              />
            ) : (
              <p data-testid="chat-page-empty" style={{ color: "var(--fg-muted)" }}>
                Select a chat from the left rail, or right-click a folder to create one.
              </p>
            )}
          </div>
          {preview ? (
            <PreviewPane
              artifact={preview}
              onClose={() => setPreview(null)}
              style={{ flex: 1 }}
            />
          ) : null}
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
