import type { ConversationManager } from "../../modules/coding/chat/ConversationManager.js";
import type { ContextCompactor } from "../../modules/coding/chat/ContextCompactor.js";
import type { Message } from "../../modules/coding/chat/types.js";
import type { McpManager } from "../../modules/coding/mcp/McpManager.js";
import type { GemmaCodeSettings } from "../../modules/coding/config/settings.js";
import type { MemoryStore } from "../storage/MemoryStore.js";
import type { DynamicToolMetadata } from "../tools/ToolCatalog.js";
import { renderMarkdown } from "../../modules/coding/utils/MarkdownRenderer.js";
import type { ExtensionToWebviewMessage } from "./messages.js";

export interface ChatStatusReporterContext {
  readonly manager: ConversationManager;
  readonly compactor: ContextCompactor;
  getSettings(): GemmaCodeSettings;
  getMemoryStore(): MemoryStore | null;
  getMcpManager(): McpManager | null;
  getMcpTools(): DynamicToolMetadata[];
  postMessage(msg: ExtensionToWebviewMessage): void;
}

/**
 * Owns the post* status helpers and the per-assistant Markdown render cache
 * extracted from {@link NexusCodingPanel} as part of v0.7.0 Phase 0 sub-task
 * 0.4. The owning panel forwards `requestX` events into the matching
 * `postX()` method on this reporter; the reporter reads from injected
 * context, never from the panel's private fields.
 */
export class ChatStatusReporter {
  private readonly _renderedHtmlCache = new Map<string, string>();

  constructor(private readonly _ctx: ChatStatusReporterContext) {}

  postHistory(): void {
    const ctx = this._ctx;
    const visible = ctx.manager.getHistory().filter((m) => m.role !== "system");

    const liveIds = new Set<string>();
    const renderedHtmlMap: Record<string, string> = {};
    const messages: Message[] = [];

    for (const msg of visible) {
      liveIds.add(msg.id);
      if (msg.role === "assistant") {
        let html = this._renderedHtmlCache.get(msg.id);
        if (html === undefined) {
          html = renderMarkdown(msg.content);
          this._renderedHtmlCache.set(msg.id, html);
        }
        renderedHtmlMap[msg.id] = html;
        // Strip the assistant body now that the HTML map is the source of truth;
        // halves the typical history payload.
        messages.push({
          id: msg.id,
          role: msg.role,
          content: "",
          timestamp: msg.timestamp,
        });
      } else {
        messages.push(msg);
      }
    }

    if (this._renderedHtmlCache.size > liveIds.size) {
      for (const id of this._renderedHtmlCache.keys()) {
        if (!liveIds.has(id)) this._renderedHtmlCache.delete(id);
      }
    }

    ctx.postMessage({ type: "history", messages, renderedHtmlMap });
  }

  postTokenCount(): void {
    const ctx = this._ctx;
    const settings = ctx.getSettings();
    const count = ctx.compactor.estimateTokens();
    ctx.postMessage({
      type: "tokenCount",
      count,
      limit: settings.maxTokens,
    });
  }

  postMemoryStatus(): void {
    const ctx = this._ctx;
    const settings = ctx.getSettings();
    const memoryStore = ctx.getMemoryStore();
    const entryCount = memoryStore?.getStats().totalEntries ?? 0;
    ctx.postMessage({
      type: "memoryStatus",
      enabled: settings.memoryEnabled && memoryStore !== null,
      entryCount,
    });
  }

  postMcpStatus(): void {
    const ctx = this._ctx;
    const settings = ctx.getSettings();
    const mcpManager = ctx.getMcpManager();
    if (!settings.mcpEnabled || !mcpManager) {
      ctx.postMessage({
        type: "mcpStatus",
        enabled: false,
        connectedServerCount: 0,
        totalToolCount: 0,
      });
      return;
    }
    const states = mcpManager.getServerStates();
    const connectedCount = states.filter((s) => s.status === "connected").length;
    ctx.postMessage({
      type: "mcpStatus",
      enabled: true,
      connectedServerCount: connectedCount,
      totalToolCount: ctx.getMcpTools().length,
    });
  }

  postThinkingModeStatus(): void {
    const ctx = this._ctx;
    const settings = ctx.getSettings();
    ctx.postMessage({
      type: "thinkingModeStatus",
      active: settings.thinkingMode,
    });
  }
}
