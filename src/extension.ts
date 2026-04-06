import * as path from "path";
import * as vscode from "vscode";
import { BackendManager } from "./backend/BackendManager.js";
import { getSettings } from "./config/settings.js";
import { createOllamaClient } from "./ollama/client.js";
import { GemmaCodePanel, VIEW_ID } from "./panels/GemmaCodePanel.js";

let outputChannel: vscode.OutputChannel | undefined;
let backendManager: BackendManager | undefined;

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
    backendManager.start().then((ready) => {
      if (!ready) {
        outputChannel?.appendLine(
          "[Gemma Code] Backend unavailable — routing directly to Ollama."
        );
      }
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

      const healthy = await client.checkHealth();
      if (!healthy) {
        channel.appendLine(
          "[Gemma Code] ERROR: Ollama is not reachable. Make sure `ollama serve` is running."
        );
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
        });

        for await (const chunk of stream) {
          if (chunk.message.content) {
            channel.append(chunk.message.content);
          }
        }
        channel.appendLine("\n\n[Gemma Code] Stream complete.");
      } catch (err) {
        channel.appendLine(`[Gemma Code] ERROR: ${String(err)}`);
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
}

export async function deactivate(): Promise<void> {
  if (backendManager) {
    await backendManager.stop();
  }
}
