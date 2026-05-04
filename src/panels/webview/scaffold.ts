import { STYLES } from "./styles.js";
import { getBodyMarkup } from "./bodyMarkup.js";
import { RUNTIME_SCRIPT } from "./runtime.js";

/**
 * Format a raw Ollama model name into a human-friendly display string.
 * "gemma4:e4b" -> "Gemma 4 E4B"
 * "gemma4" -> "Gemma 4"
 * "gemma4:26b" -> "Gemma 4 26B"
 */
export function formatModelName(raw: string): string {
  const parts = raw.split(":");
  const base = parts[0] ?? raw;
  const variant = parts[1];
  const formatted = base.replace(/(\d)/g, " $1").trim();
  const capitalized = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  if (variant) return `${capitalized} ${variant.toUpperCase()}`;
  return capitalized;
}

/**
 * Build the chat webview's HTML scaffold. The CSP is locked down to allow
 * inline styles and one inline script, both gated by the per-render nonce.
 *
 * No CDN dependencies, no `connect-src`, no `img-src`. Markdown rendering
 * happens in the extension host (server-side via `marked` + `highlight.js`)
 * and the rendered HTML is posted to the webview as a string. The webview
 * never executes untrusted markup.
 */
export function getChatWebviewHtml(
  nonce: string,
  cspSource: string,
  modelName: string,
): string {
  const displayName = formatModelName(modelName);
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gemma Code</title>
  <style nonce="${nonce}">${STYLES}</style>
</head>
${getBodyMarkup(modelName, displayName)}
  <script nonce="${nonce}">${RUNTIME_SCRIPT}</script>
</body>
</html>`;
}
