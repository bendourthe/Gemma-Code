/**
 * v2.2.6 Phase 1 -- left history pane for Image Studio / Video Lab.
 * v2.2.8 Phase 2 -- same width, collapse-to-icon-rail, and empty chrome as Chatbot.
 *
 * Reuses FolderTree. Image/Video pages import this module, not Chat types.
 */

import { useMemo, useState } from "react";
import { FolderTree, type FolderTreeCopy, type SelectedNode } from "../../modules/chat/FolderTree";
import type { Chat } from "../../modules/chat/types";
import { studioClientAsChatExplorer } from "./studioAsChatExplorer";
import type { StudioExplorerClient } from "./studioExplorerClient";
import type { StudioPillar } from "../../../../core/generations/StudioSessionStore.types";
import {
  CollapsibleHistoryAside,
  usePersistentCollapsed,
} from "./CollapsibleHistoryAside";
import {
  IMAGE_HISTORY_COLLAPSE_KEY,
  VIDEO_HISTORY_COLLAPSE_KEY,
} from "./historyPaneLayout";

// v2.2.9 Phase 3.1 (T007): Chatbot FolderTree strings, not Sessions / Start a
// new session (screenshots 6-7). Only the aria labels stay pillar-specific so
// screen readers can tell the panes apart.
const IMAGE_COPY: FolderTreeCopy = {
  paneTitle: "Chats",
  newItem: "New chat",
  emptyCta: "Start a new chat",
  treeAria: "Image chats",
  loadError: "Could not load chats",
  emptyHint: "No chats yet.",
  itemNoun: "chat",
};

const VIDEO_COPY: FolderTreeCopy = {
  paneTitle: "Chats",
  newItem: "New chat",
  emptyCta: "Start a new chat",
  treeAria: "Video chats",
  loadError: "Could not load chats",
  emptyHint: "No chats yet.",
  itemNoun: "chat",
};

export interface StudioHistoryPaneProps {
  readonly pillar: StudioPillar;
  readonly client: StudioExplorerClient;
  readonly defaultModelId: string;
  readonly sidecarDown?: boolean;
  readonly onSelectSession?: (sessionId: string) => void;
  /** Bump after create/append so FolderTree re-reads the explorer. */
  readonly refreshToken?: number;
  /**
   * v2.2.9 Phase 1.4 (T004): the session the page has OPEN. When provided,
   * the highlighted row is bound to it instead of drifting on pane-local
   * click state.
   */
  readonly activeSessionId?: string | null;
  readonly onBeforeSessionDisposition?: (sessionId: string) => void | Promise<void>;
  readonly onSessionDisposition?: (sessionId: string) => void | Promise<void>;
}

export function StudioHistoryPane({
  pillar,
  client,
  defaultModelId,
  sidecarDown = false,
  onSelectSession,
  refreshToken,
  activeSessionId,
  onBeforeSessionDisposition,
  onSessionDisposition,
}: StudioHistoryPaneProps): JSX.Element {
  const explorer = useMemo(() => studioClientAsChatExplorer(client), [client]);
  const [localSelected, setLocalSelected] = useState<SelectedNode | null>(null);
  // The open session id wins over local click state; folder clicks (no open
  // session change) still show through the local fallback.
  const selected: SelectedNode | null =
    typeof activeSessionId === "string" && activeSessionId.length > 0
      ? { kind: "chat", id: activeSessionId }
      : localSelected;
  const copy = pillar === "video" ? VIDEO_COPY : IMAGE_COPY;
  const testId = pillar === "video" ? "video-history-pane" : "image-history-pane";
  const collapseKey = pillar === "video" ? VIDEO_HISTORY_COLLAPSE_KEY : IMAGE_HISTORY_COLLAPSE_KEY;
  const { collapsed, toggle } = usePersistentCollapsed(collapseKey);

  return (
    <CollapsibleHistoryAside
      testId={testId}
      ariaLabel={copy.treeAria}
      collapsed={collapsed}
      onToggle={toggle}
      toggleTestId={`${pillar}-history-collapse-toggle`}
      expandLabel="Expand chats"
      collapseLabel="Collapse chats"
    >
      {sidecarDown ? (
        <p
          data-testid={`${pillar}-history-empty`}
          style={{ margin: 0, padding: "var(--space-3)", color: "var(--fg-muted)" }}
        >
          {copy.emptyHint}
        </p>
      ) : (
        <FolderTree
          client={explorer}
          selected={selected}
          onSelect={setLocalSelected}
          onOpenChat={(chat: Chat) => onSelectSession?.(chat.id)}
          defaultModelId={defaultModelId}
          copy={copy}
          storageKey={`nexus.${pillar}.expanded`}
          refreshToken={refreshToken}
          collapsed={collapsed}
          onBeforeSessionDisposition={(id) => onBeforeSessionDisposition?.(id)}
          onSessionDisposition={(id) => onSessionDisposition?.(id)}
        />
      )}
    </CollapsibleHistoryAside>
  );
}
