import { getChatWebviewHtml, formatModelName } from "./scaffold.js";

/** Back-compat alias retained so existing callers keep working. */
export function getWebviewHtml(
  nonce: string,
  cspSource: string,
  modelName: string,
): string {
  return getChatWebviewHtml(nonce, cspSource, modelName);
}

export { getChatWebviewHtml, formatModelName };
