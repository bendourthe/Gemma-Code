/**
 * v2.2.6 Phase 1 -- left history pane for Image Studio / Video Lab.
 *
 * Reuses FolderTree. Image/Video pages import this module, not Chat types.
 */

import { useMemo, useState } from "react";
import { FolderTree, type FolderTreeCopy, type SelectedNode } from "../../modules/chat/FolderTree";
import type { Chat } from "../../modules/chat/types";
import { studioClientAsChatExplorer } from "./studioAsChatExplorer";
import type { StudioExplorerClient } from "./studioExplorerClient";
import type { StudioPillar } from "../../../../core/generations/StudioSessionStore.types";

const IMAGE_COPY: FolderTreeCopy = {
  paneTitle: "Sessions",
  newItem: "New session",
  emptyCta: "Start a new session",
  treeAria: "Image sessions",
  loadError: "Could not load sessions",
  emptyHint: "No sessions yet.",
};

const VIDEO_COPY: FolderTreeCopy = {
  paneTitle: "Sessions",
  newItem: "New session",
  emptyCta: "Start a new session",
  treeAria: "Video sessions",
  loadError: "Could not load sessions",
  emptyHint: "No sessions yet.",
};

export interface StudioHistoryPaneProps {
  readonly pillar: StudioPillar;
  readonly client: StudioExplorerClient;
  readonly defaultModelId: string;
  readonly sidecarDown?: boolean;
  readonly onSelectSession?: (sessionId: string) => void;
}

export function StudioHistoryPane({
  pillar,
  client,
  defaultModelId,
  sidecarDown = false,
  onSelectSession,
}: StudioHistoryPaneProps): JSX.Element {
  const explorer = useMemo(() => studioClientAsChatExplorer(client), [client]);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const copy = pillar === "video" ? VIDEO_COPY : IMAGE_COPY;
  const testId = pillar === "video" ? "video-history-pane" : "image-history-pane";

  return (
    <aside
      data-testid={testId}
      aria-label={copy.treeAria}
      style={{
        width: 240,
        flex: "0 0 240px",
        minHeight: 0,
        overflowY: "auto",
        borderRight: "1px solid var(--border-1)",
        background: "var(--bg-1)",
      }}
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
        />
      )}
    </aside>
  );
}
