import { redactSecrets } from "./redact.js";

export function reportError(err: Error): string {
  return redactSecrets(err.stack ?? err.message);
}

export function reportWarning(message: string): string {
  return redactSecrets(`[warn] ${message}`);
}
