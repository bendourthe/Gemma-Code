import * as path from "path";
import * as vscode from "vscode";
import { BackendManager } from "./backend/BackendManager.js";
import { getSettings } from "./config/settings.js";
import { createOllamaClient } from "./ollama/client.js";
import { GemmaCodePanel, VIEW_ID } from "./panels/GemmaCodePanel.js";

let outputChannel: vscode.OutputChannel | undefined;
let backendManager: BackendManager | undefined;
let ollamaPoller: NodeJS.Timeout | undefined;

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

const OLLAMA_POLL_INTERVAL_MS = 5_000;

function startOllamaPoller(
  panel: GemmaCodePanel,
  channel: vscode.OutputChannel
): void {
  let ollamaWasReachable = false;

  ollamaPoller = setInterval(async () => {
    const client = createOllamaClient();
    const healthy = await client.checkHealth().catch(() => false);

    if (healthy && !ollamaWasReachable) {
      ollamaWasReachable = true;
      channel.appendLine("[Gemma Code] Ollama is now reachable — resuming normal operation.");
      panel.postStatus("idle");
    } else if (!healthy && ollamaWasReachable) {
      ollamaWasReachable = false;
      channel.appendLine("[Gemma Code] Ollama became unreachable.");
      panel.postError(
        "Ollama is not reachable. Make sure `ollama serve` is running, then it will reconnect automatically."
      );
    }
  }, OLLAMA_POLL_INTERVAL_MS);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Gemma Code");
  context.subscriptions.push(outputChannel);

  const settings = getSettings();

  // ── Optional Python backend ──────────────────────────────────────────────
  if (settings.useBackend) {
    const backendDir = path.join(context.extensionPath, "src", "backend");
    backendManager = new BackendManager({
      pythonPath: settings.pythonPath,
      backendDir,
      port: settings.backendPort,
      channel: outputChannel,
    });
    context.subscriptions.push(backendManager);

    // Start asynchronously; fall-through to direct Ollama on failure.
    void backendManager.start().then((ready) => {
      if (!ready) {
        outputChannel?.appendLine(
          "[Gemma Code] Backend unavailable — routing directly to Ollama."
        );
        // Show a non-blocking notification so the user is aware.
        void vscode.window.showWarningMessage(
          "Gemma Code: Python backend process exited; using direct Ollama mode."
        );
      }
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel?.appendLine(`[Gemma Code] Backend start error: ${msg}`);
      void vscode.window.showWarningMessage(
        "Gemma Code: Backend process could not start; using direct Ollama mode."
      );
    });
  }

  // ── Ping command ─────────────────────────────────────────────────────────
  const pingCommand = vscode.commands.registerCommand(
    "gemma-code.ping",
    async () => {
      const channel = outputChannel!;
      channel.show(true);
      channel.appendLine("[Gemma Code] Pinging Ollama...");

      const client = createOllamaClient();

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
        const msg = err instanceof Error ? err.message : String(err);
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

  // ── Chat panel ───────────────────────────────────────────────────────────
  const chatPanel = new GemmaCodePanel(
    context.extensionUri,
    context.globalStorageUri
  );
  const chatProviderDisposable = vscode.window.registerWebviewViewProvider(
    VIEW_ID,
    chatPanel
  );
  context.subscriptions.push(chatProviderDisposable, chatPanel);

  // ── Ollama availability poller ────────────────────────────────────────────
  startOllamaPoller(chatPanel, outputChannel);

  // Dispose the poller when the extension deactivates.
  context.subscriptions.push({
    dispose: () => {
      if (ollamaPoller !== undefined) {
        clearInterval(ollamaPoller);
        ollamaPoller = undefined;
      }
    },
  });

  // ── Initial Ollama health check ───────────────────────────────────────────
  createOllamaClient()
    .checkHealth()
    .then((healthy) => {
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
    clearInterval(ollamaPoller);
    ollamaPoller = undefined;
  }
  if (backendManager) {
    await backendManager.stop();
  }
}
