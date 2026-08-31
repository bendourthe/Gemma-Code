/**
 * v2.2.8 Phase 2 -- shared history-pane geometry.
 *
 * v2.4.2 Phase 1: Chatbot, Agents, Image Studio, and Video Lab no longer
 * use a second aside. The left sidebar is the host; `HISTORY_PANE_WIDTH`
 * is the expanded sidebar width so session titles fit. Compact width
 * matches the module icon rail (56px).
 */

/** Expanded FolderTree / sidebar host. */
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
