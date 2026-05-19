import * as path from "path";
import * as vscode from "vscode";
import { formatForUser } from "../modules/coding/utils/errors.js";
import { NexusCodingPanel } from "./panels/NexusCodingPanel.js";
import { SessionListPanel, SESSION_VIEW_ID } from "./panels/SessionListPanel.js";
import { getGpuDetector } from "./config/GpuDetector.js";
import { classifyTier, getTierConfig } from "./config/HardwareTier.js";
import type { HardwareTierId } from "./config/HardwareTier.types.js";
import { TraceStore } from "./observability/TraceStore.js";
import { MetricsCollector } from "./observability/MetricsCollector.js";
import { TraceDashboardPanel, TRACE_DASHBOARD_VIEW_ID } from "./panels/TraceDashboardPanel.js";
import { MemoryPanel, MEMORY_PANEL_VIEW_ID } from "./panels/MemoryPanel.js";
import { OtlpExporter, parseOtlpHeaders } from "./observability/OtlpExporter.js";
import { NexusCodingRuntime } from "./runtime/NexusCodingRuntime.js";
import { disposeEncoder as disposeTokenEncoder } from "./config/PromptBudget.js";
import * as fs from "fs";
import { hookFilePath } from "./chat/ImprovementHook.js";

let outputChannel: vscode.OutputChannel | undefined;
let ollamaPoller: NodeJS.Timeout | undefined;

// v1.1.0 Phase 2 (rebrand) -- legacy `gemma-code.<cmd>` command IDs that the
// runtime compat shim translates to the new `nexus.coding.<cmd>` IDs. The
// legacy IDs are registered programmatically (not in the manifest's
// contributes.commands) so they do not appear in the Command Palette; they
// exist purely so previously-bound user keybindings continue to fire the
// correct handler. Each invocation writes a single deprecation line to the
// output channel. Remove the shim in v1.2.0 once user keybindings have had a
// release cycle to migrate.
const COMPAT_COMMAND_MAP: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ["gemma-code.ping", "nexus.coding.ping"],
  ["gemma-code.newChat", "nexus.coding.newChat"],
  ["gemma-code.focusSidebar", "nexus.coding.focusSidebar"],
  ["gemma-code.openSession", "nexus.coding.openSession"],
  ["gemma-code.detectGpu", "nexus.coding.detectGpu"],
  ["gemma-code.hooks.editPlanModeHook", "nexus.coding.hooks.editPlanModeHook"],
] as const);

// ---------------------------------------------------------------------------
// Global unhandled rejection handler
// ---------------------------------------------------------------------------

process.on("unhandledRejection", (reason: unknown) => {
  const message =
    reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  outputChannel?.appendLine(`[Gemma Code] Unhandled promise rejection: ${message}`);
});

// ---------------------------------------------------------------------------
// Ollama availability polling
// ---------------------------------------------------------------------------

// Fast cadence while the server is unreachable so the UI reconnects quickly.
const OLLAMA_POLL_FAST_MS = 5_000;
// Slow cadence once healthy; just a keep-alive for a lightweight change signal.
const OLLAMA_POLL_SLOW_MS = 30_000;

function startOllamaPoller(
  panel: NexusCodingPanel,
  channel: vscode.OutputChannel,
  runtime: NexusCodingRuntime,
): void {
  let ollamaWasReachable = false;
  // Client is created once and reused across every tick. Previously a fresh
  // client was allocated per tick, generating ~17k allocations/day on an idle
  // 8-hour session.
  const client = runtime.getOllamaClient();

  const tick = async (): Promise<void> => {
    const healthy = await client.checkHealth().catch(() => false);

    void panel.setOllamaReachable(healthy);

    if (healthy && !ollamaWasReachable) {
      ollamaWasReachable = true;
      channel.appendLine("[Gemma Code] Ollama is now reachable -- resuming normal operation.");
      panel.postStatus("idle");
    } else if (!healthy && ollamaWasReachable) {
      ollamaWasReachable = false;
      channel.appendLine("[Gemma Code] Ollama became unreachable.");
      panel.postError(
        "Ollama is not reachable. Make sure `ollama serve` is running, then it will reconnect automatically."
      );
    }

    // Reschedule at the cadence that matches current health. Once healthy we
    // only need occasional keep-alive checks; while unreachable we want fast
    // reconnect.
    const next = ollamaWasReachable ? OLLAMA_POLL_SLOW_MS : OLLAMA_POLL_FAST_MS;
    ollamaPoller = setTimeout(() => void tick(), next);
  };

  // Kick off the first poll at the fast cadence.
  ollamaPoller = setTimeout(() => void tick(), OLLAMA_POLL_FAST_MS);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Gemma Code");
  context.subscriptions.push(outputChannel);

  const runtime = new NexusCodingRuntime();
  context.subscriptions.push({ dispose: () => runtime.dispose() });
  const settings = runtime.settings;

  // ── Ping command ─────────────────────────────────────────────────────────
  const pingCommand = vscode.commands.registerCommand(
    "nexus.coding.ping",
    async () => {
      const channel = outputChannel!;
      channel.show(true);
      channel.appendLine("[Gemma Code] Pinging Ollama...");

      const client = runtime.getOllamaClient();

      const healthy = await client.checkHealth().catch(() => false);
      if (!healthy) {
        channel.appendLine(
          "[Gemma Code] ERROR: Ollama is not reachable. Make sure `ollama serve` is running."
        );
        void vscode.window.showErrorMessage(
          "Gemma Code: Ollama is not reachable. Run `ollama serve` and try again.",
          "Open Ollama docs"
        ).then((choice) => {
          if (choice === "Open Ollama docs") {
            void vscode.env.openExternal(vscode.Uri.parse("https://ollama.com/download"));
          }
        });
        return;
      }

      channel.appendLine(
        "[Gemma Code] Ollama is healthy. Streaming test message...\n"
      );

      try {
        const stream = client.streamChat({
          model: settings.modelName,
          messages: [{ role: "user", content: "Say hello briefly." }],
          stream: true,
          options: { num_ctx: settings.maxTokens, temperature: settings.temperature },
        });

        for await (const chunk of stream) {
          if (chunk.message.content) {
            channel.append(chunk.message.content);
          }
        }
        channel.appendLine("\n\n[Gemma Code] Stream complete.");
      } catch (err) {
        const msg = formatForUser(err);
        channel.appendLine(`[Gemma Code] ERROR: ${msg}`);

        if (msg.includes("not found") || msg.includes("model")) {
          void vscode.window.showErrorMessage(
            `Gemma Code: Model "${settings.modelName}" not found. Run: ollama pull ${settings.modelName}`,
            "Pull model"
          ).then((choice) => {
            if (choice === "Pull model") {
              const terminal = vscode.window.createTerminal("Gemma Code — Model Pull");
              terminal.sendText(`ollama pull ${settings.modelName}`);
              terminal.show();
            }
          });
        }
      }
    }
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
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(circuit-board) Detecting GPU...";
  statusBarItem.command = "nexus.coding.detectGpu";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  if (settings.autoDetectGpu) {
    void (async () => {
      try {
        const detector = getGpuDetector();
        const result = await detector.detect();
        const vramMb = result.primaryGpu?.totalVramMb ?? 0;
        const tierId: HardwareTierId = (settings.gpuTierOverride as HardwareTierId | null) ?? classifyTier(vramMb);
        const tierConfig = getTierConfig(tierId);

        outputChannel?.appendLine(
          `[Gemma Code] GPU detected: ${result.primaryGpu?.name ?? "none"}, ` +
          `VRAM: ${vramMb} MB, Tier: ${tierId} (${tierConfig.name})`
        );

        chatPanel.updateTierConfig(tierConfig);
        statusBarItem.text = `$(circuit-board) Tier ${tierId} (${tierConfig.name})`;
        statusBarItem.tooltip = `GPU: ${result.primaryGpu?.name ?? "none"} | VRAM: ${vramMb} MB`;
      } catch (err) {
        const msg = formatForUser(err);
        outputChannel?.appendLine(`[Gemma Code] GPU detection failed: ${msg}`);
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
        `Gemma Code: ${result.primaryGpu?.name ?? "No GPU"}, ${vramMb} MB VRAM -- Tier ${tierId} (${tierConfig.name})`
      );
    }
  );
  context.subscriptions.push(detectGpuCommand);

  // Helper to open a new chat editor panel.
  // First panel opens beside the editor; subsequent panels open as tabs in the same column.
  let chatColumn: vscode.ViewColumn | undefined;

  function openChatEditorPanel(): void {
    const targetColumn = chatColumn ?? vscode.ViewColumn.Beside;

    const panel = vscode.window.createWebviewPanel(
      "nexus.coding.chatEditor",
      "Nexus Coding",
      targetColumn,
      {
        enableScripts: true,
        // Discard webview JS state while hidden to free memory; the panel
        // rehydrates via NexusCodingPanel.onDidChangeViewState + _postHistory.
        retainContextWhenHidden: false,
        localResourceRoots: [context.extensionUri],
      }
    );

    // Track the column so subsequent panels open as tabs in the same group.
    chatColumn = panel.viewColumn;
    panel.onDidChangeViewState(() => {
      if (panel.viewColumn) chatColumn = panel.viewColumn;
    });
    panel.onDidDispose(() => {
      // Don't clear chatColumn -- next panel should reuse the same column.
    });

    // Set the tab icon (colored PNG).
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "icon.png");

    // Wire the webview to the chat panel's logic.
    chatPanel.attachToWebviewPanel(panel);
  }

  // ── Session list sidebar ────────────────────────────────────────────────
  const sessionListPanel = new SessionListPanel(
    context.extensionUri,
    chatPanel.getStore(),
    () => {
      // "New Chat" clicked in sidebar
      chatPanel.clearChat();
      openChatEditorPanel();
    },
    (sessionId: string) => {
      // Session clicked in sidebar
      chatPanel.loadSession(sessionId);
      openChatEditorPanel();
    },
  );
  const sessionProviderDisposable = vscode.window.registerWebviewViewProvider(
    SESSION_VIEW_ID,
    sessionListPanel
  );
  context.subscriptions.push(sessionProviderDisposable);

  // ── Observability: TraceStore, Tracer, Trace Dashboard ────────────────────
  const traceDbPath = path.join(context.globalStorageUri.fsPath, "traces.db");
  let traceStore: TraceStore | null = null;
  let metricsCollector: MetricsCollector | null = null;

  try {
    traceStore = new TraceStore(traceDbPath);
    metricsCollector = new MetricsCollector(traceStore);
    const tracer = runtime.tracer;
    tracer.init(traceStore);

    // Optional OTLP export (off by default).
    if (settings.otlpEnabled) {
      const otlpExporter = new OtlpExporter({
        endpoint: settings.otlpEndpoint,
        headers: parseOtlpHeaders(settings.otlpHeaders),
      });
      tracer.setExporter(otlpExporter);
      context.subscriptions.push({ dispose: () => otlpExporter.dispose() });
      outputChannel?.appendLine(`[Gemma Code] OTLP export enabled -> ${settings.otlpEndpoint}`);
    }

    outputChannel?.appendLine("[Gemma Code] Trace store initialized.");
    context.subscriptions.push({ dispose: () => { traceStore?.close(); } });
  } catch (err) {
    const msg = formatForUser(err);
    outputChannel?.appendLine(`[Gemma Code] Trace store init failed: ${msg}`);
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
  const traceDashboardDisposable = vscode.window.registerWebviewViewProvider(
    TRACE_DASHBOARD_VIEW_ID,
    traceDashboardPanel,
  );
  context.subscriptions.push(traceDashboardDisposable);

  // v0.7.0 Phase 5: Memory panel webview (manual editor for the four-file
  // architecture, SQL-backed memory promotion, archive snapshot management).
  const memoryPanel = new MemoryPanel(context.extensionUri, {
    getMemoryFiles: () => chatPanel.getMemoryFiles(),
    getMemoryStore: () => chatPanel.getMemoryStore(),
  });
  const memoryPanelDisposable = vscode.window.registerWebviewViewProvider(
    MEMORY_PANEL_VIEW_ID,
    memoryPanel,
  );
  context.subscriptions.push(memoryPanelDisposable);

  // Chat panel is only used via the editor panel (not sidebar).
  context.subscriptions.push(chatPanel);

  // ── New Chat command (editor title bar icon) ─────────────────────────────
  const newChatCommand = vscode.commands.registerCommand(
    "nexus.coding.newChat",
    () => {
      chatPanel.clearChat();
      openChatEditorPanel();
    }
  );
  context.subscriptions.push(newChatCommand);

  // ── Focus sidebar command ────────────────────────────────────────────────
  const focusCommand = vscode.commands.registerCommand(
    "nexus.coding.focusSidebar",
    () => {
      void vscode.commands.executeCommand(`${SESSION_VIEW_ID}.focus`);
    }
  );
  context.subscriptions.push(focusCommand);

  // ── Open session command ─────────────────────────────────────────────────
  const openSessionCommand = vscode.commands.registerCommand(
    "nexus.coding.openSession",
    (sessionId?: string) => {
      if (sessionId) {
        chatPanel.loadSession(sessionId);
      }
      openChatEditorPanel();
    }
  );
  context.subscriptions.push(openSessionCommand);

  // ── v0.8.0 Phase 3.4: open the plan-mode improvement-hook file ───────────
  const editPlanModeHookCommand = vscode.commands.registerCommand(
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
        outputChannel?.appendLine(
          `[Gemma Code] Failed to open plan-mode hook ${filePath}: ${message}`,
        );
        void vscode.window.showErrorMessage(
          `Failed to open plan-mode improvement-hook file: ${message}`,
        );
      }
    },
  );
  context.subscriptions.push(editPlanModeHookCommand);

  // ── Legacy command-ID compat shim (v1.1.0 Phase 2 rebrand) ───────────────
  // Each legacy `gemma-code.<cmd>` keybinding is forwarded to its
  // `nexus.coding.<cmd>` replacement with a single deprecation line logged to
  // the output channel. Not declared in package.json so the legacy IDs do not
  // surface in the Command Palette.
  for (const [legacyId, newId] of COMPAT_COMMAND_MAP) {
    const disposable = vscode.commands.registerCommand(legacyId, (...args: unknown[]) => {
      outputChannel?.appendLine(
        `[Nexus Coding] DEPRECATED: command \`${legacyId}\` was renamed to \`${newId}\` in v1.1.0. ` +
        `The legacy ID will be removed in v1.2.0; update your keybindings.`,
      );
      return vscode.commands.executeCommand(newId, ...args);
    });
    context.subscriptions.push(disposable);
  }

  // ── Ollama availability poller ────────────────────────────────────────────
  startOllamaPoller(chatPanel, outputChannel, runtime);

  // Dispose the poller when the extension deactivates.
  context.subscriptions.push({
    dispose: () => {
      if (ollamaPoller !== undefined) {
        clearTimeout(ollamaPoller);
        ollamaPoller = undefined;
      }
    },
  });

  // ── Initial Ollama health check ───────────────────────────────────────────
  runtime
    .getOllamaClient()
    .checkHealth()
    .then((healthy) => {
      void chatPanel.setOllamaReachable(healthy);
      if (!healthy) {
        outputChannel?.appendLine(
          "[Gemma Code] Ollama is not reachable at startup. Polling for availability..."
        );
        chatPanel.postError(
          "Ollama is not reachable. Start it with `ollama serve`. Gemma Code will reconnect automatically."
        );
      } else {
        outputChannel?.appendLine("[Gemma Code] Ollama is reachable. Extension ready.");
      }
    })
    .catch(() => {
      outputChannel?.appendLine("[Gemma Code] Ollama health check failed at startup.");
    });
}

export async function deactivate(): Promise<void> {
  if (ollamaPoller !== undefined) {
    clearTimeout(ollamaPoller);
    ollamaPoller = undefined;
  }
  // Phase 5 (v0.5.0): release the cached tiktoken encoder so its native
  // handle is freed when the extension shuts down.
  disposeTokenEncoder();
}
