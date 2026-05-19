import * as vscode from "vscode";

/**
 * Minimal logger interface. Tests and non-vscode contexts inject their own
 * implementation; the default implementation routes through a shared
 * `vscode.OutputChannel` so messages show up in the "Gemma Code" output pane.
 */
export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

function formatMeta(meta: unknown[]): string {
  if (meta.length === 0) return "";
  const parts = meta.map((m) => {
    if (m instanceof Error) {
      return m.stack ?? `${m.name}: ${m.message}`;
    }
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(m);
    } catch {
      return String(m);
    }
  });
  return " " + parts.join(" ");
}

class OutputChannelLogger implements Logger {
  private _channel: vscode.OutputChannel | null = null;

  /** Lazily resolve the OutputChannel so module import is side-effect free. */
  private channel(): vscode.OutputChannel {
    if (this._channel === null) {
      this._channel = vscode.window.createOutputChannel("Gemma Code");
    }
    return this._channel;
  }

  private line(level: string, message: string, meta: unknown[]): void {
    const stamp = new Date().toISOString();
    this.channel().appendLine(`[${stamp}] [${level}] ${message}${formatMeta(meta)}`);
  }

  debug(message: string, ...meta: unknown[]): void {
    this.line("DEBUG", message, meta);
  }
  info(message: string, ...meta: unknown[]): void {
    this.line("INFO", message, meta);
  }
  warn(message: string, ...meta: unknown[]): void {
    this.line("WARN", message, meta);
  }
  error(message: string, ...meta: unknown[]): void {
    this.line("ERROR", message, meta);
  }
}

/**
 * Fallback logger for contexts that do not have a live vscode OutputChannel
 * (e.g. unit tests that import modules that log during initialization).
 * Writes through `process.stderr` so the default no-op does not swallow
 * warnings silently, but the output is easy to capture in tests.
 */
class StderrLogger implements Logger {
  private line(level: string, message: string, meta: unknown[]): void {
    const stamp = new Date().toISOString();
    process.stderr.write(`[${stamp}] [${level}] ${message}${formatMeta(meta)}\n`);
  }
  debug(message: string, ...meta: unknown[]): void {
    this.line("DEBUG", message, meta);
  }
  info(message: string, ...meta: unknown[]): void {
    this.line("INFO", message, meta);
  }
  warn(message: string, ...meta: unknown[]): void {
    this.line("WARN", message, meta);
  }
  error(message: string, ...meta: unknown[]): void {
    this.line("ERROR", message, meta);
  }
}

let activeLogger: Logger = (() => {
  // Detect whether we can call vscode.window.createOutputChannel; if not, fall
  // back to stderr. Using a try/catch here keeps module initialization safe
  // inside unit-test environments that stub `vscode` with minimal surface area.
  try {
    if (vscode && typeof vscode.window?.createOutputChannel === "function") {
      return new OutputChannelLogger();
    }
  } catch {
    // fall through
  }
  return new StderrLogger();
})();

/** Inject a logger at the composition root (or from tests). */
export function setLogger(logger: Logger): void {
  activeLogger = logger;
}

/** Retrieve the active logger. Modules should call this lazily. */
export function getLogger(): Logger {
  return activeLogger;
}
