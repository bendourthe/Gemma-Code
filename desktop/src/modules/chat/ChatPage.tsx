/**
 * v1.0.0 Phase 4.4 -- Local Chatbot Explorer page.
 *
 * The Chat module's top-level page. Hosts:
 *   - left rail: `<FolderTree>` (drag-drop, context menu, keyboard nav)
 *   - right pane: breadcrumb + shared chat shell (`<MessageList>`, `<MediaComposer>`)
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
import {
  chatComposerAccept,
  imageAttachmentAffordance,
  audioAttachmentCopy,
} from "../../shared/chat/modalityGating";
import { partitionAttachments } from "../../shared/chat/classifyAttachment";
import { stripDataUrlPrefix, mimeFromDataUrl } from "../../shared/chat/dataUrl";
import {
  modelAcceptsVision,
  nonVisionAttachmentGuidance,
  resolveVisualTokenBudget,
} from "../../../../core/chat/vision";
import { enforceVisualBudget, capVideoFrames } from "../../../../core/chat/visualBudget";
import { recordMultimodalTurn } from "../../../../core/memory/multimodalSurrogate";
import type { MemoryHub } from "../../../../core/memory/MemoryHub";
import { PreviewPane, type PreviewArtifact } from "../../components/PreviewPane";
import { DEFAULT_MODEL_ID, FRONTEND_MODELS } from "../coding/models";
import {
  createIpcDocumentClient,
  type DocumentClient,
} from "./documentClient";
import {
  createIpcAudioClient,
  type AudioClient,
} from "./audioClient";
import { createBrowserMicRecorder, type MicRecorder } from "../../shared/chat/micRecorder";
import { labelSttTranscript, STT_TRANSCRIPT_ORIGIN } from "./transcriptProvenance";
import {
  INITIAL_VOICE_LOOP,
  reduceVoiceLoop,
  shouldStopTts,
  type VoiceCaptureMode,
  type VoiceLoopState,
} from "./voiceLoop";
import { QuickModelSwitcher } from "../../shared/models/QuickModelSwitcher";
import { SETTINGS_MODELS_PATH } from "../../shared/models/installedFeed";
import { createIpcModelsClient } from "../../pages/settings/ipcModelsClient";
import type { ListedModelDto } from "../../pages/settings/modelsTypes";

const FALLBACK_LLMS: readonly ListedModelDto[] = FRONTEND_MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  type: "llm" as const,
  installed: true,
  source: "registry" as const,
  modalities: ["text"] as const,
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
  /**
   * v2.1.0 Phase 4 -- turn a video data URL into still frames. Tests inject
   * a stub; production can wire ffmpeg. Missing sampler skips the video
   * with a notice rather than sending container bytes to the model.
   */
  sampleVideoFrames?: (dataUrl: string) => Promise<{ frames: string[]; notice?: string }>;
  /**
   * v2.1.0 Phase 4 -- optional episodic hub so non-text turns are indexed by
   * a redacted caption surrogate. Tests inject InMemoryMemoryHub.
   */
  memoryHub?: Pick<MemoryHub, "episodic">;
  /**
   * v2.0.0 Phase 1 -- local STT/TTS client. Tests inject an in-memory fake;
   * production talks to sidecar `audio.*` IPC.
   */
  audioClient?: AudioClient;
  /** Optional TTS playback (tests inject a no-op). */
  playAudio?: (dataUrl: string, signal: AbortSignal) => Promise<void>;
  /** Tests inject a fake mic; production uses getUserMedia. */
  voiceMicRecorder?: import("../../shared/chat/micRecorder").MicRecorder;
}

export function ChatPage({
  client: clientOverride,
  chatSession: chatSessionOverride,
  defaultModelId = DEFAULT_MODEL_ID,
  documentClient: documentClientOverride,
  onGetMoreModels,
  modelsClient: modelsClientOverride,
  audioClient: audioClientOverride,
  playAudio: playAudioOverride,
  voiceMicRecorder,
  sampleVideoFrames,
  memoryHub,
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
  const [audioClient] = useState<AudioClient>(
    () => audioClientOverride ?? createIpcAudioClient(),
  );
  const [voiceLoop, setVoiceLoop] = useState<VoiceLoopState>(INITIAL_VOICE_LOOP);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const voiceMicRef = useRef<MicRecorder | null>(voiceMicRecorder ?? null);
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

  const selectedListedModel = useMemo(() => {
    const id = activeChat?.modelId ?? modelId;
    return listedModels.find((m) => m.id === id);
  }, [activeChat, listedModels, modelId]);

  const imageGate = imageAttachmentAffordance(selectedListedModel);
  const audioHint = audioAttachmentCopy(selectedListedModel);

  const dispatchVoice = useCallback((event: Parameters<typeof reduceVoiceLoop>[1]) => {
    setVoiceLoop((prev) => {
      const next = reduceVoiceLoop(prev, event);
      if (shouldStopTts(prev, next)) {
        ttsAbortRef.current?.abort();
        ttsAbortRef.current = null;
      }
      return next;
    });
  }, []);

  const playReply = useCallback(
    async (text: string) => {
      if (!voiceEnabled || !text.trim()) return;
      dispatchVoice({ type: "tts-started" });
      const abort = new AbortController();
      ttsAbortRef.current = abort;
      try {
        const spoken = await audioClient.speak(text);
        if (abort.signal.aborted) return;
        const dataUrl = `data:${spoken.mimeType};base64,${spoken.audioBase64}`;
        const play =
          playAudioOverride ??
          (async (url: string, signal: AbortSignal) => {
            const audio = new Audio(url);
            await new Promise<void>((resolve, reject) => {
              const stop = () => {
                audio.pause();
                resolve();
              };
              signal.addEventListener("abort", stop, { once: true });
              audio.onended = () => resolve();
              audio.onerror = () => reject(new Error("tts playback failed"));
              void audio.play();
            });
          });
        await play(dataUrl, abort.signal);
        if (!abort.signal.aborted) dispatchVoice({ type: "tts-ended" });
      } catch (err) {
        if (!abort.signal.aborted) {
          dispatchVoice({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [audioClient, dispatchVoice, playAudioOverride, voiceEnabled],
  );

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

  const sendChatTurn = useCallback(
    async (
      chatId: string,
      baseId: string,
      message: string,
      images: readonly string[] = [],
    ): Promise<string> => {
      const assistantId = `${baseId}-assistant`;
      appendMessage(chatId, {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
        activity: "chat-streaming",
      });
      let content: string;
      try {
        const chat = activeChat;
        let sessionId = sessionIdsRef.current.get(chatId);
        if (!sessionId) {
          const started = await chatSession.start({
            modelId: chat?.modelId ?? modelId,
            title: chat?.title,
          });
          sessionId = started.sessionId;
          sessionIdsRef.current.set(chatId, sessionId);
        }
        const reply = await chatSession.sendMessage({
          sessionId,
          message: message.trim().length > 0 ? message : images.length > 0 ? "(image)" : message,
          ...(images.length > 0 ? { images: images.map(stripDataUrlPrefix) } : {}),
        });
        content = joinChatReply(reply.events) || "(no reply)";
      } catch (err) {
        content = `(chat unavailable) ${err instanceof Error ? err.message : String(err)}`;
      }
      patchMessage(chatId, assistantId, { content, pending: false });
      return content;
    },
    [activeChat, appendMessage, chatSession, modelId, patchMessage],
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
      const groups = partitionAttachments(attachments);
      let prompt = text;
      let origin: ChatMessage["origin"];
      const displayAttachments = groups.images;

      if (groups.audio.length > 0) {
        const parts: string[] = [];
        for (const clip of groups.audio) {
          const mime = mimeFromDataUrl(clip) ?? "audio/webm";
          const result = await audioClient.transcribe(clip, mime);
          parts.push(result.transcript);
        }
        const labelled = labelSttTranscript(parts.join("\n"));
        origin = STT_TRANSCRIPT_ORIGIN;
        prompt = [text, labelled].filter((part) => part.trim().length > 0).join("\n\n");
      }

      const userContent =
        attachments.length > 0
          ? `${prompt || (groups.images.length > 0 ? "(image)" : "(attachment)")}\n\n[${attachments.length} attachment${
              attachments.length === 1 ? "" : "s"
            }]`
          : prompt;
      appendMessage(chat.id, {
        id: `${baseId}-user`,
        role: "user",
        content: userContent,
        ...(displayAttachments.length > 0 ? { attachments: displayAttachments } : {}),
        ...(origin ? { origin } : {}),
      });
      client.renameChat(chat.id, chat.title);

      if (memoryHub && attachments.length > 0) {
        const kinds = [
          ...groups.images.map(() => "image"),
          ...groups.video.map(() => "video"),
          ...groups.audio.map(() => "audio"),
          ...groups.documents.map(() => "document"),
        ];
        void recordMultimodalTurn(memoryHub.episodic, {
          id: `${baseId}-mm`,
          prompt: text,
          kinds,
        }).catch(() => undefined);
      }

      if (groups.documents.length > 0) {
        const first = groups.documents[0];
        if (first !== undefined) {
          await handleParseDocument(chat.id, baseId, first, prompt);
        }
        return;
      }

      const visual = [...groups.images, ...groups.video];
      if (visual.length > 0 && !imageGate.enabled) {
        const alt = listedModels.find((m) => m.installed && modelAcceptsVision(m));
        appendMessage(chat.id, {
          id: `${baseId}-assistant`,
          role: "assistant",
          content: nonVisionAttachmentGuidance(alt?.displayName),
        });
        return;
      }

      const notices: string[] = [];
      const frameUrls: string[] = [];
      const budget = resolveVisualTokenBudget(selectedListedModel);
      for (const clip of groups.video) {
        if (!sampleVideoFrames) {
          notices.push("Video was not sent: frame sampling is unavailable. Attach a still image instead.");
          continue;
        }
        const sampled = await sampleVideoFrames(clip);
        if (sampled.notice) notices.push(sampled.notice);
        const capped = capVideoFrames(sampled.frames.length, budget);
        if (capped.notice) notices.push(capped.notice);
        frameUrls.push(...sampled.frames.slice(0, capped.keep));
      }

      const rawImages = [...groups.images, ...frameUrls];
      const budgeted = enforceVisualBudget(
        rawImages.map((url) => ({
          bytes: dataUrlToBytes(url),
          mime: mimeFromDataUrl(url) ?? "image/png",
        })),
        budget,
      );
      notices.push(...budgeted.notices, ...budgeted.rejected);
      const sendImages = budgeted.images.map((img) => uint8ToBase64(img.bytes));

      if (notices.length > 0) {
        appendMessage(chat.id, {
          id: `${baseId}-budget`,
          role: "assistant",
          content: notices.join(" "),
        });
      }

      if (sendImages.length === 0 && rawImages.length > 0 && prompt.trim().length === 0) {
        return;
      }

      const reply = await sendChatTurn(chat.id, baseId, prompt, imageGate.enabled ? sendImages : []);
      if (voiceEnabled) void playReply(reply);
    },
    [
      activeChat,
      appendMessage,
      audioClient,
      client,
      handleParseDocument,
      imageGate.enabled,
      listedModels,
      memoryHub,
      playReply,
      sampleVideoFrames,
      selectedListedModel,
      sendChatTurn,
      voiceEnabled,
    ],
  );

  const ensureVoiceMic = useCallback((): MicRecorder => {
    if (!voiceMicRef.current) {
      voiceMicRef.current = voiceMicRecorder ?? createBrowserMicRecorder();
    }
    return voiceMicRef.current;
  }, [voiceMicRecorder]);

  const finishVoiceCapture = useCallback(async () => {
    const recorder = voiceMicRef.current;
    if (!recorder) return;
    const url = await recorder.stop();
    dispatchVoice({ type: "ptt-up" });
    if (!url) {
      dispatchVoice({ type: "error", message: "no audio captured" });
      return;
    }
    dispatchVoice({ type: "transcript-ready" });
    await handleSubmit("", [url]);
    dispatchVoice({ type: "reply-ready" });
  }, [dispatchVoice, handleSubmit]);

  const onPttDown = useCallback(() => {
    if (!voiceEnabled || voiceLoop.mode !== "ptt") return;
    dispatchVoice({ type: "ptt-down" });
    void ensureVoiceMic().start();
  }, [dispatchVoice, ensureVoiceMic, voiceEnabled, voiceLoop.mode]);

  const onPttUp = useCallback(() => {
    if (!voiceEnabled || voiceLoop.mode !== "ptt") return;
    void finishVoiceCapture();
  }, [finishVoiceCapture, voiceEnabled, voiceLoop.mode]);

  const onVadToggle = useCallback(() => {
    if (!voiceEnabled || voiceLoop.mode !== "vad") return;
    if (voiceLoop.phase === "recording") {
      dispatchVoice({ type: "vad-stop" });
      void finishVoiceCapture();
      return;
    }
    dispatchVoice({ type: "vad-start" });
    void ensureVoiceMic().start();
  }, [
    dispatchVoice,
    ensureVoiceMic,
    finishVoiceCapture,
    voiceEnabled,
    voiceLoop.mode,
    voiceLoop.phase,
  ]);

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
              v1.20.0 Phase 2: RapidOCR remains required for PDF/image. Native
              Office parse does not, so the composer stays usable when this
              banner is showing.
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
            <div
              data-testid="chat-voice-bar"
              style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}
            >
              <label style={{ display: "flex", gap: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
                <input
                  type="checkbox"
                  data-testid="chat-voice-enabled"
                  checked={voiceEnabled}
                  onChange={(e) => {
                    setVoiceEnabled(e.target.checked);
                    if (!e.target.checked) dispatchVoice({ type: "reset" });
                  }}
                />
                Voice loop
              </label>
              <button
                type="button"
                data-testid="chat-voice-mode-ptt"
                disabled={!voiceEnabled}
                onClick={() => dispatchVoice({ type: "set-mode", mode: "ptt" })}
                style={getMoreModelsStyle}
              >
                Push to talk
              </button>
              <button
                type="button"
                data-testid="chat-voice-mode-vad"
                disabled={!voiceEnabled}
                onClick={() => dispatchVoice({ type: "set-mode", mode: "vad" as VoiceCaptureMode })}
                style={getMoreModelsStyle}
              >
                VAD
              </button>
              <button
                type="button"
                data-testid="chat-voice-ptt"
                disabled={!voiceEnabled || voiceLoop.mode !== "ptt"}
                onMouseDown={onPttDown}
                onMouseUp={onPttUp}
                onTouchStart={onPttDown}
                onTouchEnd={onPttUp}
                style={getMoreModelsStyle}
              >
                Hold to talk
              </button>
              <button
                type="button"
                data-testid="chat-voice-vad-toggle"
                disabled={!voiceEnabled || voiceLoop.mode !== "vad"}
                onClick={onVadToggle}
                style={getMoreModelsStyle}
              >
                {voiceLoop.mode === "vad" && voiceLoop.phase === "recording" ? "Stop VAD" : "Start VAD"}
              </button>
              <span
                data-testid="chat-voice-capture-indicator"
                data-visible={voiceLoop.captureVisible ? "true" : "false"}
                role="status"
                aria-live="polite"
                style={{
                  fontSize: "var(--text-xs)",
                  color: voiceLoop.captureVisible ? "var(--accent-chatbot)" : "var(--fg-muted)",
                }}
              >
                {voiceLoop.captureVisible ? "Recording -- microphone is open" : "Mic closed"}
              </span>
            </div>
            <MediaComposer
              onSubmit={(text, attachments) => void handleSubmit(text, attachments)}
              submitAccentVar="--accent-chatbot"
              accept={chatComposerAccept({ allowImages: imageGate.enabled, allowAudio: true })}
              placeholder="Type a message, attach a document, or record audio to transcribe locally."
              streaming={messages.some((m) => m.pending)}
              imageEnabled={imageGate.enabled}
              imageDisabledReason={imageGate.tooltip}
              audioEnabled
              audioHint={audioHint}
            />
          </footer>
        )}
      </div>
    </section>
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = stripDataUrlPrefix(dataUrl);
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
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
