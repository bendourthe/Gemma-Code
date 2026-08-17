/**
 * v1.0.0 Phase 4.4 -- Local Chatbot Explorer page.
 *
 * The Chat module's top-level page. Hosts:
 *   - left rail: `<FolderTree>` (drag-drop, context menu, keyboard nav)
 *   - right pane: breadcrumb + shared chat shell (`<MessageList>`, `<ChatInput>`)
 *   - compact model switcher (installed-and-ready LLMs + Get more models)
 *   - per-folder `enableTools` toggle (default off; power users opt in)
 *
 * The page consumes an `InMemoryChatExplorerClient` for now (Phase 4 stub);
 * the IPC-backed client lands once the sidecar shared-core build closes
 * known-gap 3.P1.N.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MediaComposer,
  MessageList,
  type ChatMessage,
} from "../../shared/chat";
import { PreviewPane, type PreviewArtifact } from "../../components/PreviewPane";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "../coding/models";
import {
  createIpcDocumentClient,
  type DocumentClient,
} from "./documentClient";
import { QuickModelSwitcher } from "../../shared/models/QuickModelSwitcher";
import { SETTINGS_MODELS_PATH } from "../../shared/models/installedFeed";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";

/** v1.16.0 Phase 3 -- what the composer will take for a parse-document turn. */
const DOCUMENT_ACCEPT = "application/pdf,image/*";

const FALLBACK_LLMS: readonly ListedModelDto[] = FRONTEND_MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  type: "llm" as const,
  installed: true,
  source: "registry" as const,
}));

export interface ChatPageProps {
  /** Optional client override (tests inject an InMemoryChatExplorerClient). */
  client?: ChatExplorerClient;
  /** Optional chat-session client override (tests inject a fake; default: IPC). */
  chatSession?: ChatSessionClient;
  /** Default model id used when starting a fresh chat. */
  defaultModelId?: string;
  /**
   * v1.16.0 Phase 3 (adoption item A5) -- document-parse client. Tests inject
   * the in-memory one; production talks to the sidecar's `ocr.*` IPC.
   */
  documentClient?: DocumentClient;
  /** Deep-link out to Settings > Models when no document model is installed. */
  onGetMoreModels?: () => void;
  /**
   * v1.16.0 Phase 5 (A4) -- installed-model feed for the compact switcher.
   * Tests inject a fake; production talks to the sidecar `models.list` IPC.
   */
  modelsClient?: { list(): Promise<readonly ListedModelDto[]> };
}

export function ChatPage({
  client: clientOverride,
  chatSession: chatSessionOverride,
  defaultModelId = DEFAULT_MODEL_ID,
  documentClient: documentClientOverride,
  onGetMoreModels,
  modelsClient: modelsClientOverride,
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

  // v1.16.0 Phase 3 (adoption item A5) -- document-parse state.
  const [documentClient] = useState<DocumentClient>(
    () => documentClientOverride ?? createIpcDocumentClient(),
  );
  const [documentModelInstalled, setDocumentModelInstalled] = useState<boolean | null>(null);
  // v1.16.0 Phase 5 (A4) -- compact switcher feed. Falls back to the catalog
  // projection when `models.list` is unavailable (tests, sidecar down).
  const [listedModels, setListedModels] = useState<readonly ListedModelDto[]>(FALLBACK_LLMS);

  useEffect(() => {
    let active = true;
    void documentClient.installedDocumentModels().then(
      (models) => {
        if (active) setDocumentModelInstalled(models.length > 0);
      },
      () => {
        if (active) setDocumentModelInstalled(false);
      },
    );
    return () => {
      active = false;
    };
  }, [documentClient]);

  useEffect(() => {
    let cancelled = false;
    const source = modelsClientOverride ?? createIpcModelsClient();
    void source.list().then(
      (all) => {
        if (!cancelled && all.length > 0) setListedModels(all);
      },
      () => {
        // Keep the catalog fallback; the switcher still has something to show.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [modelsClientOverride]);

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

  /** Append one message to a chat's transcript. */
  const appendMessage = useCallback((chatId: string, message: ChatMessage) => {
    setMessagesByChat((prev) => {
      const next = new Map(prev);
      next.set(chatId, [...(next.get(chatId) ?? []), message]);
      return next;
    });
  }, []);

  /** Replace one message in place (used to stream parse progress into a bubble). */
  const patchMessage = useCallback(
    (chatId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setMessagesByChat((prev) => {
        const next = new Map(prev);
        next.set(
          chatId,
          (next.get(chatId) ?? []).map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
        );
        return next;
      });
    },
    [],
  );

  /**
   * v1.16.0 Phase 3 (adoption item A5) -- the parse-document chat action.
   *
   * An attachment turns the turn into a document parse rather than a model
   * chat: the OCR runtime reads it and the extracted text comes back as the
   * assistant message, so the user can then ask questions about it in the same
   * thread. Parsed text is NOT auto-sent to the model -- the user decides what
   * to do with it, which keeps an untrusted document from silently entering a
   * prompt.
   */
  const handleParseDocument = useCallback(
    async (chatId: string, baseId: string, attachment: string, note: string) => {
      const messageId = `${baseId}-parse`;
      appendMessage(chatId, {
        id: messageId,
        role: "assistant",
        content: "Reading document...",
        pending: true,
        activity: "document-parse",
      });
      try {
        const handle = documentClient.parse(attachment, ({ page, totalPages }) => {
          patchMessage(chatId, messageId, {
            content:
              totalPages > 0
                ? `Reading document... page ${page} of ${totalPages}`
                : "Reading document...",
          });
        });
        const result = await handle.done;
        const body = (result.markdown ?? result.text).trim();
        const header =
          result.pageCount > 1
            ? `Parsed ${result.pageCount} pages with ${result.engine}:`
            : `Parsed with ${result.engine}:`;
        patchMessage(chatId, messageId, {
          content: body.length > 0 ? `${header}\n\n${body}` : `${header}\n\n(no text found)`,
          pending: false,
        });
      } catch (err) {
        patchMessage(chatId, messageId, {
          content: `Could not parse the document: ${
            err instanceof Error ? err.message : String(err)
          }`,
          pending: false,
        });
      }
      if (note.trim().length > 0) {
        // The user typed alongside the attachment; keep their note visible.
        appendMessage(chatId, {
          id: `${baseId}-note`,
          role: "assistant",
          content: "Ask a follow-up question about the parsed text above to send it to the model.",
        });
      }
    },
    [appendMessage, documentClient, patchMessage],
  );

  const handleSubmit = useCallback(
    async (text: string, attachments: readonly string[] = []) => {
      if (!activeChat) return;
      const chat = activeChat;
      const baseId = `${chat.id}-${Date.now()}`;
      // Render the user's message immediately.
      const userContent =
        attachments.length > 0
          ? `${text || "(document)"}\n\n[${attachments.length} attachment${
              attachments.length === 1 ? "" : "s"
            }]`
          : text;
      appendMessage(chat.id, { id: `${baseId}-user`, role: "user", content: userContent });
      client.renameChat(chat.id, chat.title); // touch updatedAt

      // An attachment routes to the OCR runtime, not the chat model.
      if (attachments.length > 0) {
        const first = attachments[0];
        if (first !== undefined) {
          await handleParseDocument(chat.id, baseId, first, text);
        }
        return;
      }

      // Drive a real local-model turn via the sidecar (lazily starting a
      // session per chat). Falls back to an inline notice if IPC is unavailable
      // (e.g. running the web bundle outside the Tauri shell).
      const assistantId = `${baseId}-assistant`;
      appendMessage(chat.id, {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
        activity: "chat-streaming",
      });
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

      patchMessage(chat.id, assistantId, { content, pending: false });
    },
    [activeChat, client, chatSession, appendMessage, patchMessage, handleParseDocument],
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
            <QuickModelSwitcher
              testId="chat-model-select"
              models={listedModels}
              taskType="llm"
              value={modelId}
              onChange={setModelId}
              onGetMoreModels={onGetMoreModels}
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
          <footer style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {/*
              v1.16.0 Phase 3 (adoption item A5): with no document model
              installed, say so and deep-link to Settings > Models rather than
              letting the user attach a PDF that can only fail.
            */}
            {documentModelInstalled === false ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <button
                  type="button"
                  data-testid="chat-get-more-models"
                  onClick={() => onGetMoreModels?.()}
                  style={getMoreModelsStyle}
                >
                  No document model installed - get more models
                </button>
                <a
                  data-testid="chat-settings-link"
                  href={SETTINGS_MODELS_PATH}
                  style={{ display: "none" }}
                >
                  Settings
                </a>
              </div>
            ) : null}
            <MediaComposer
              onSubmit={(text, attachments) => void handleSubmit(text, attachments)}
              submitAccentVar="--accent-chatbot"
              accept={DOCUMENT_ACCEPT}
              placeholder="Type a message, or attach a PDF or image to read it."
            />
          </footer>
        )}
      </div>
    </section>
  );
}

const getMoreModelsStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-3)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-2)",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--text-sm)",
};
