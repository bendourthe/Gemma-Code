/**
 * BackendManager — starts and stops the Python FastAPI inference backend.
 *
 * On activate the extension spawns `python -m backend.main` (or the `gemma-backend`
 * script if installed) as a child process.  The manager polls /health until the
 * process is ready, then signals success to callers.  On deactivate it sends SIGTERM
 * and waits up to 3 s for a clean exit before force-killing.
 */

import * as child_process from "child_process";
import * as vscode from "vscode";

export interface BackendManagerOptions {
  /** Absolute path to the Python executable to use. */
  pythonPath: string;
  /** Absolute path to the `src/backend` directory (contains `pyproject.toml`). */
  backendDir: string;
  /** Port the backend will listen on. */
  port: number;
  /** Output channel for process stdout/stderr. */
  channel: vscode.OutputChannel;
}

const READY_POLL_INTERVAL_MS = 200;
const READY_TIMEOUT_MS = 15_000;

export class BackendManager implements vscode.Disposable {
  private _proc: child_process.ChildProcess | undefined;
  private readonly _options: BackendManagerOptions;
  private _ready = false;

  constructor(options: BackendManagerOptions) {
    this._options = options;
  }

  get isReady(): boolean {
    return this._ready;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._options.port}`;
  }

  /**
   * Spawn the backend process and wait until /health responds with 200.
   * Resolves `true` on success, `false` if the process fails to start or times out.
   */
  async start(): Promise<boolean> {
    const { pythonPath, backendDir, port, channel } = this._options;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GEMMA_BACKEND_PORT: String(port),
      PYTHONPATH: `${backendDir}/src`,
    };

    channel.appendLine(`[Backend] Spawning Python backend on port ${port}…`);

    this._proc = child_process.spawn(
      pythonPath,
      ["-m", "backend.main"],
      { cwd: backendDir, env, stdio: ["ignore", "pipe", "pipe"] }
    );

    this._proc.stdout?.on("data", (data: Buffer) => {
      channel.append(`[Backend] ${data.toString()}`);
    });
    this._proc.stderr?.on("data", (data: Buffer) => {
      channel.append(`[Backend] ${data.toString()}`);
    });
    this._proc.on("exit", (code) => {
      this._ready = false;
      if (code !== 0 && code !== null) {
        channel.appendLine(`[Backend] Process exited with code ${code}`);
      }
    });

    const started = await this._waitUntilReady();
    if (started) {
      this._ready = true;
      channel.appendLine("[Backend] Ready.");
    } else {
      channel.appendLine("[Backend] Did not become ready in time; falling back to direct Ollama.");
      this._kill();
    }
    return started;
  }

  /** Terminate the backend process gracefully. */
  async stop(): Promise<void> {
    if (!this._proc) return;
    this._ready = false;
    const proc = this._proc;
    this._proc = undefined;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 3000);

      proc.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  dispose(): void {
    this._kill();
  }

  // -------------------------------------------------------------------------

  private _kill(): void {
    if (this._proc) {
      this._proc.kill("SIGKILL");
      this._proc = undefined;
    }
    this._ready = false;
  }

  private async _waitUntilReady(): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const url = `${this.baseUrl}/health`;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (res.status === 200) return true;
      } catch {
        // Not ready yet — keep polling.
      }
      await _sleep(READY_POLL_INTERVAL_MS);
    }
    return false;
  }
}

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
