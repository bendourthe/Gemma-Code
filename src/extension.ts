import * as vscode from "vscode";
import { createOllamaClient } from "./ollama/client.js";
import { getSettings } from "./config/settings.js";
import { GemmaCodePanel, VIEW_ID } from "./panels/GemmaCodePanel.js";

let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Gemma Code");
  context.subscriptions.push(outputChannel);

  const pingCommand = vscode.commands.registerCommand(
    "gemma-code.ping",
    async () => {
      const channel = outputChannel!;
      channel.show(true);
      channel.appendLine("[Gemma Code] Pinging Ollama...");

      const settings = getSettings();
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

  const chatPanel = new GemmaCodePanel(context.extensionUri, context.globalStorageUri);
  const chatProviderDisposable = vscode.window.registerWebviewViewProvider(
    VIEW_ID,
    chatPanel
  );
  context.subscriptions.push(chatProviderDisposable, chatPanel);
}

export function deactivate(): void {
  // Disposables are cleaned up automatically via context.subscriptions
}
