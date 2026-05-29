import { redactSecrets } from "./redact.js";

export function sanitizeSession(session: { input: string }): string {
  return redactSecrets(session.input);
}
