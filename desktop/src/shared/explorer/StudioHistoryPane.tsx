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

const IMAGE_COPY: FolderTreeCopy = {
  paneTitle: "Sessions",
  newItem: "New session",
  emptyCta: "Start a new session",
  treeAria: "Image sessions",
  loadError: "Could not load sessions",
  emptyHint: "No sessions yet.",
  itemNoun: "session",
};

const VIDEO_COPY: FolderTreeCopy = {
  paneTitle: "Sessions",
  newItem: "New session",
  emptyCta: "Start a new session",
  treeAria: "Video sessions",
  loadError: "Could not load sessions",
  emptyHint: "No sessions yet.",
  itemNoun: "session",
};

export interface StudioHistoryPaneProps {
  readonly pillar: StudioPillar;
  readonly client: StudioExplorerClient;
  readonly defaultModelId: string;
  readonly sidecarDown?: boolean;
  readonly onSelectSession?: (sessionId: string) => void;
  /** Bump after create/append so FolderTree re-reads the explorer. */
  readonly refreshToken?: number;
}

export function StudioHistoryPane({
  pillar,
  client,
  defaultModelId,
  sidecarDown = false,
  onSelectSession,
  refreshToken,
}: StudioHistoryPaneProps): JSX.Element {
  const explorer = useMemo(() => studioClientAsChatExplorer(client), [client]);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
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
      expandLabel="Expand sessions"
      collapseLabel="Collapse sessions"
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
          onSelect={setSelected}
          onOpenChat={(chat: Chat) => onSelectSession?.(chat.id)}
          defaultModelId={defaultModelId}
          copy={copy}
          storageKey={`nexus.${pillar}.expanded`}
          refreshToken={refreshToken}
          collapsed={collapsed}
        />
      )}
    </CollapsibleHistoryAside>
  );
}
