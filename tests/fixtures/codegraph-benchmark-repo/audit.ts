import { redactSecrets } from "./redact.js";

export function auditMessage(raw: string): { clean: string; original: string } {
  const clean = redactSecrets(raw);
  return { clean, original: raw };
}

export function formatAuditTrail(messages: string[]): string {
  return messages.map((m) => redactSecrets(m)).join("\n");
}
