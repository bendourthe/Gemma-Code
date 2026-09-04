/**
 * v1.1.0 Phase 10 -- extension-only activation branch (legacy in-process
 * engine).
 *
 * This module is the activation path the extension takes when
 * `discoverDesktopDaemon()` reports no live Nexus daemon. The branch
 * preserves the v0.X.0 / v1.0.0 behaviour: a full conversation manager,
 * memory hub, tracer, GPU detector, and Ollama poller are constructed
 * in-process and the panels host webviews that talk to them directly.
 *
 * The branch is kept for compatibility through v1.2.0; the proxy branch
 * (./proxy.ts) is the canonical path once every user host runs the
 * desktop daemon. See [docs/v1/v1.1/plans/phase-10-vscode-thin-adapter-and-republish.md]
 * for the migration plan.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { formatForUser } from "../../modules/coding/utils/errors.js";
import { NexusCodingPanel } from "../panels/NexusCodingPanel.js";
import {
  SessionListPanel,
  SESSION_VIEW_ID,
} from "../panels/SessionListPanel.js";
import { getGpuDetector } from "../../modules/coding/config/GpuDetector.js";
import {
  classifyTier,
  getTierConfig,
} from "../../modules/coding/config/HardwareTier.js";
import type { HardwareTierId } from "../../modules/coding/config/HardwareTier.types.js";
import { TraceStore } from "../../modules/coding/observability/TraceStore.js";
import { MetricsCollector } from "../../modules/coding/observability/MetricsCollector.js";
import {
  TraceDashboardPanel,
  TRACE_DASHBOARD_VIEW_ID,
} from "../panels/TraceDashboardPanel.js";
import { MemoryPanel, MEMORY_PANEL_VIEW_ID } from "../panels/MemoryPanel.js";
import {
  OtlpExporter,
  parseOtlpHeaders,
} from "../../modules/coding/observability/OtlpExporter.js";
import { NexusCodingRuntime } from "../../modules/coding/runtime/NexusCodingRuntime.js";
import { hookFilePath } from "../../modules/coding/chat/ImprovementHook.js";
import { registerOwnedAgenticModelSurface } from "./ownedAgenticPicker.js";

// Fast cadence while the server is unreachable so the UI reconnects quickly.
const OLLAMA_POLL_FAST_MS = 5_000;
// Slow cadence once healthy; just a keep-alive for a lightweight change signal.
const OLLAMA_POLL_SLOW_MS = 30_000;

let ollamaPoller: NodeJS.Timeout | undefined;

function startOllamaPoller(
  panel: NexusCodingPanel,
  channel: vscode.OutputChannel,
  runtime: NexusCodingRuntime,
): void {
  let ollamaWasReachable = false;
  const client = runtime.getOllamaClient();

  const tick = async (): Promise<void> => {
    const healthy = await client.checkHealth().catch(() => false);

    void panel.setOllamaReachable(healthy);

    if (healthy && !ollamaWasReachable) {
      ollamaWasReachable = true;
      channel.appendLine(
        "[Nexus Code] Ollama is now reachable -- resuming normal operation.",
      );
      panel.postStatus("idle");
    } else if (!healthy && ollamaWasReachable) {
      ollamaWasReachable = false;
      channel.appendLine("[Nexus Code] Ollama became unreachable.");
      panel.postError(
        "Ollama is not reachable. Make sure `ollama serve` is running, then it will reconnect automatically.",
      );
    }

    const next = ollamaWasReachable ? OLLAMA_POLL_SLOW_MS : OLLAMA_POLL_FAST_MS;
    ollamaPoller = setTimeout(() => void tick(), next);
  };

  ollamaPoller = setTimeout(() => void tick(), OLLAMA_POLL_FAST_MS);
}

/** Stop the Ollama poller; exposed so `deactivate()` can clear the timer. */
export function stopOllamaPoller(): void {
  if (ollamaPoller !== undefined) {
    clearTimeout(ollamaPoller);
    ollamaPoller = undefined;
  }
}

export function activateExtensionOnly(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
): void {
  const runtime = new NexusCodingRuntime();
  context.subscriptions.push({ dispose: () => runtime.dispose() });
  const settings = runtime.settings;

  // ── Ping command ─────────────────────────────────────────────────────────
  const pingCommand = vscode.commands.registerCommand(
    "nexus.coding.ping",
    async () => {
      channel.show(true);
      channel.appendLine("[Nexus Code] Pinging Ollama...");

      const client = runtime.getOllamaClient();

      const healthy = await client.checkHealth().catch(() => false);
      if (!healthy) {
        channel.appendLine(
          "[Nexus Code] ERROR: Ollama is not reachable. Make sure `ollama serve` is running.",
        );
        void vscode.window
          .showErrorMessage(
            "Nexus Code: Ollama is not reachable. Run `ollama serve` and try again.",
            "Open Ollama docs",
          )
          .then((choice) => {
            if (choice === "Open Ollama docs") {
              void vscode.env.openExternal(
                vscode.Uri.parse("https://ollama.com/download"),
              );
            }
          });
        return;
      }

      channel.appendLine(
        "[Nexus Code] Ollama is healthy. Streaming test message...\n",
      );

      try {
        const stream = client.streamChat({
          model: settings.modelName,
          messages: [{ role: "user", content: "Say hello briefly." }],
          stream: true,
          options: {
            num_ctx: settings.maxTokens,
            temperature: settings.temperature,
          },
        });

        for await (const chunk of stream) {
          if (chunk.message.content) {
            channel.append(chunk.message.content);
          }
        }
        channel.appendLine("\n\n[Nexus Code] Stream complete.");
      } catch (err) {
        const msg = formatForUser(err);
        channel.appendLine(`[Nexus Code] ERROR: ${msg}`);

        if (msg.includes("not found") || msg.includes("model")) {
          void vscode.window
            .showErrorMessage(
              `Nexus Code: Model "${settings.modelName}" not found. Run: ollama pull ${settings.modelName}`,
              "Pull model",
            )
            .then((choice) => {
              if (choice === "Pull model") {
                const terminal = vscode.window.createTerminal(
                  "Nexus Code -- Model Pull",
                );
                terminal.sendText(`ollama pull ${settings.modelName}`);
                terminal.show();
              }
            });
        }
      }
    },
  );
  context.subscriptions.push(pingCommand);

  // ── Chat panel (used by both sidebar fallback and editor panel) ──────────
  const chatPanel = new NexusCodingPanel(
    context.extensionUri,
    runtime,
    context.globalStorageUri,
    context.workspaceState,
  );

  // ── GPU detection and tier classification ──────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = "$(circuit-board) Detecting GPU...";
  statusBarItem.command = "nexus.coding.detectGpu";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // v2.4.6 Phase 4 -- owned agentic picker (AD-13 allowlist, not ollama list).
  registerOwnedAgenticModelSurface(context);

  if (settings.autoDetectGpu) {
    void (async () => {
      try {
        const detector = getGpuDetector();
        const result = await detector.detect();
        const vramMb = result.primaryGpu?.totalVramMb ?? 0;
        const tierId: HardwareTierId =
          (settings.gpuTierOverride as HardwareTierId | null) ??
          classifyTier(vramMb);
        const tierConfig = getTierConfig(tierId);

        channel.appendLine(
          `[Nexus Code] GPU detected: ${result.primaryGpu?.name ?? "none"}, ` +
            `VRAM: ${vramMb} MB, Tier: ${tierId} (${tierConfig.name})`,
        );

        chatPanel.updateTierConfig(tierConfig);
        statusBarItem.text = `$(circuit-board) Tier ${tierId} (${tierConfig.name})`;
        statusBarItem.tooltip = `GPU: ${result.primaryGpu?.name ?? "none"} | VRAM: ${vramMb} MB`;
      } catch (err) {
        const msg = formatForUser(err);
        channel.appendLine(`[Nexus Code] GPU detection failed: ${msg}`);
        statusBarItem.text = "$(circuit-board) Tier 2 (default)";
      }
    })();
  } else if (settings.gpuTierOverride != null) {
    const tierConfig = getTierConfig(settings.gpuTierOverride);
    chatPanel.updateTierConfig(tierConfig);
    statusBarItem.text = `$(circuit-board) Tier ${settings.gpuTierOverride} (${tierConfig.name})`;
  } else {
    statusBarItem.text = "$(circuit-board) Tier 2 (default)";
  }

  // ── Detect GPU command ──────────────────────────────────────────────────
  const detectGpuCommand = vscode.commands.registerCommand(
    "nexus.coding.detectGpu",
    async () => {
      const detector = getGpuDetector();
      detector.refresh();
      const result = await detector.detect();
      const vramMb = result.primaryGpu?.totalVramMb ?? 0;
      const tierId = classifyTier(vramMb);
      const tierConfig = getTierConfig(tierId);

      chatPanel.updateTierConfig(tierConfig);
      statusBarItem.text = `$(circuit-board) Tier ${tierId} (${tierConfig.name})`;
      statusBarItem.tooltip = `GPU: ${result.primaryGpu?.name ?? "none"} | VRAM: ${vramMb} MB`;

      void vscode.window.showInformationMessage(
        `Nexus Code: ${result.primaryGpu?.name ?? "No GPU"}, ${vramMb} MB VRAM -- Tier ${tierId} (${tierConfig.name})`,
      );
    },
  );
  context.subscriptions.push(detectGpuCommand);

  // Helper to open a new chat editor panel.
  // First panel opens beside the editor; subsequent panels open as tabs in the same column.
  let chatColumn: vscode.ViewColumn | undefined;

  function openChatEditorPanel(): void {
    const targetColumn = chatColumn ?? vscode.ViewColumn.Beside;

    const panel = vscode.window.createWebviewPanel(
      "nexus.coding.chatEditor",
      "Nexus Code",
      targetColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [context.extensionUri],
      },
    );

    chatColumn = panel.viewColumn;
    panel.onDidChangeViewState(() => {
      if (panel.viewColumn) chatColumn = panel.viewColumn;
    });
    panel.onDidDispose(() => {
      // Don't clear chatColumn -- next panel should reuse the same column.
    });

    panel.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      "assets",
      "icon.png",
    );
    chatPanel.attachToWebviewPanel(panel);
  }

  // ── Session list sidebar ────────────────────────────────────────────────
  const sessionListPanel = new SessionListPanel(
    context.extensionUri,
    chatPanel.getStore(),
    () => {
      chatPanel.clearChat();
      openChatEditorPanel();
    },
    (sessionId: string) => {
      chatPanel.loadSession(sessionId);
      openChatEditorPanel();
    },
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SESSION_VIEW_ID,
      sessionListPanel,
    ),
  );

  // ── Observability: TraceStore, Tracer, Trace Dashboard ────────────────────
  const traceDbPath = path.join(context.globalStorageUri.fsPath, "traces.db");
  let traceStore: TraceStore | null = null;
  let metricsCollector: MetricsCollector | null = null;

  try {
    traceStore = new TraceStore(traceDbPath);
    metricsCollector = new MetricsCollector(traceStore);
    const tracer = runtime.tracer;
    tracer.init(traceStore);

    if (settings.otlpEnabled) {
      const otlpExporter = new OtlpExporter({
        endpoint: settings.otlpEndpoint,
        headers: parseOtlpHeaders(settings.otlpHeaders),
      });
      tracer.setExporter(otlpExporter);
      context.subscriptions.push({ dispose: () => otlpExporter.dispose() });
      channel.appendLine(
        `[Nexus Code] OTLP export enabled -> ${settings.otlpEndpoint}`,
      );
    }

    channel.appendLine("[Nexus Code] Trace store initialized.");
    context.subscriptions.push({
      dispose: () => {
        traceStore?.close();
      },
    });
  } catch (err) {
    const msg = formatForUser(err);
    channel.appendLine(`[Nexus Code] Trace store init failed: ${msg}`);
  }

  const traceDashboardPanel = new TraceDashboardPanel(
    context.extensionUri,
    traceStore,
    metricsCollector,
    {
      toolOutputCache: chatPanel.getToolOutputCache(),
      webResponseCache: chatPanel.getWebResponseCache(),
    },
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TRACE_DASHBOARD_VIEW_ID,
      traceDashboardPanel,
    ),
  );

  // v0.7.0 Phase 5: Memory panel webview.
  const memoryPanel = new MemoryPanel(context.extensionUri, {
    getMemoryFiles: () => chatPanel.getMemoryFiles(),
    getMemoryStore: () => chatPanel.getMemoryStore(),
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MEMORY_PANEL_VIEW_ID,
      memoryPanel,
    ),
  );

  context.subscriptions.push(chatPanel);

  // ── New Chat command (editor title bar icon) ─────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.coding.newChat", () => {
      chatPanel.clearChat();
      openChatEditorPanel();
    }),
  );

  // ── Focus sidebar command ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.coding.focusSidebar", () => {
      void vscode.commands.executeCommand(`${SESSION_VIEW_ID}.focus`);
    }),
  );

  // ── Open session command ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "nexus.coding.openSession",
      (sessionId?: string) => {
        if (sessionId) {
          chatPanel.loadSession(sessionId);
        }
        openChatEditorPanel();
      },
    ),
  );

  // ── v0.8.0 Phase 3.4: open the plan-mode improvement-hook file ───────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "nexus.coding.hooks.editPlanModeHook",
      async () => {
        const filePath = hookFilePath("enterplanmode-improve");
        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(
              filePath,
              "# Plan-mode improvement rules\n\n" +
                "Add user-supplied rules below. Lines are appended verbatim to the prompt as a system message after the plan-mode addendum and capabilities reminder.\n\n" +
                "Examples:\n" +
                "- When the plan touches the storage layer, always include a migration step.\n" +
                "- When the plan involves git operations, always include a backup checkpoint.\n",
              "utf8",
            );
          }
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
          const message = formatForUser(err);
          channel.appendLine(
            `[Nexus Code] Failed to open plan-mode hook ${filePath}: ${message}`,
          );
          void vscode.window.showErrorMessage(
            `Failed to open plan-mode improvement-hook file: ${message}`,
          );
        }
      },
    ),
  );

  // ── Ollama availability poller ────────────────────────────────────────────
  startOllamaPoller(chatPanel, channel, runtime);

  context.subscriptions.push({
    dispose: () => {
      stopOllamaPoller();
    },
  });

  // ── Initial Ollama health check ───────────────────────────────────────────
  runtime
    .getOllamaClient()
    .checkHealth()
    .then((healthy) => {
      void chatPanel.setOllamaReachable(healthy);
      if (!healthy) {
        channel.appendLine(
          "[Nexus Code] Ollama is not reachable at startup. Polling for availability...",
        );
        chatPanel.postError(
          "Ollama is not reachable. Start it with `ollama serve`. Nexus Code will reconnect automatically.",
        );
      } else {
        channel.appendLine(
          "[Nexus Code] Ollama is reachable. Extension ready.",
        );
      }
    })
    .catch(() => {
      channel.appendLine("[Nexus Code] Ollama health check failed at startup.");
    });
}
