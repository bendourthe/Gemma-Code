import { redactSecrets } from "./redact.js";

export function maskInput(value: string): string {
  return redactSecrets(value);
}

export class Masker {
  apply(payload: string): string {
    return redactSecrets(payload);
  }
}
