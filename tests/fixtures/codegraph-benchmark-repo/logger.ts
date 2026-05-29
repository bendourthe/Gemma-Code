import { redactSecrets } from "./redact.js";

export class Logger {
  log(message: string): void {
    console.log(redactSecrets(message));
  }
}
