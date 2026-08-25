/**
 * v2.2.8 Phase 2 -- shared history-pane geometry.
 *
 * Chatbot, Agents, Image Studio, and Video Lab use one width contract so the
 * four tabs read as the same chrome. Collapsed width matches the module
 * sidebar rail (56px), not the empty 24px gutter from v2.2.5.
 */

/** Expanded FolderTree aside. */
export const HISTORY_PANE_WIDTH = 280;

/**
 * Collapsed icon rail: new/folder plus per-session marks. Same width as
 * `Sidebar` compact `RAIL_WIDTH`. The edge pill stays a 24px hit target.
 */
export const HISTORY_PANE_COLLAPSED_WIDTH = 56;

export const CHAT_HISTORY_COLLAPSE_KEY = "nexus.chat.chatsPaneCollapsed";
export const CODING_HISTORY_COLLAPSE_KEY = "nexus.coding.historyCollapsed";
export const IMAGE_HISTORY_COLLAPSE_KEY = "nexus.image.historyCollapsed";
export const VIDEO_HISTORY_COLLAPSE_KEY = "nexus.video.historyCollapsed";
