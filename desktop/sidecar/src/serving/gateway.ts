/**
 * v1.16.0 Phase 1.1/1.2 (adoption item A1) -- the serving gateway itself.
 *
 * A `node:http` server (zero new dependencies -- the sidecar bundle is
 * esbuild/CJS on `platform: node`) exposing FOUR routes and nothing else:
 *
 *   GET  /v1/models             OpenAI models list
 *   POST /v1/chat/completions   OpenAI completion (buffered | SSE)
 *   POST /v1/messages           Anthropic completion (buffered | SSE)
 *   GET  /health                unauthenticated liveness probe
 *
 * There is deliberately NO route that reads the filesystem, spawns a process, or
 * reaches a Nexus tool: the gateway serves model inference only. Anything not in
 * the table above is a 404 before any body is read.
 *
 * Lifecycle: `start()` is a no-op unless the resolved config says `enabled`, and
 * it refuses (throws `ServingBindError`) on a non-loopback host BEFORE calling
 * `listen`. `stop()` is idempotent and safe to call on a never-started gateway,
 * because the Rust supervisor may hard-kill the sidecar without a graceful
 * signal (`desktop/src-tauri/src/sidecar.rs`).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ListedModelDto } from "../models/modelsService.js";
import { builtinServingAdapters, type ServingAdapter } from "./adapters.js";
import { handleAnthropicMessages } from "./anthropicRoutes.js";
import type { ResponseWriter, SseWriter } from "./chatCore.js";
import { type ServingConfig, redactToken, servingBaseUrl } from "./config.js";
import {
  type ServingHttpError,
  anthropicErrorBody,
  notFound,
  openAiErrorBody,
  toServingError,
} from "./errors.js";
import {
  ConcurrencyLimiter,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  assertLoopbackHost,
  checkBearerToken,
  parseJsonBody,
  readLimitedBody,
} from "./guard.js";
import { ModelRouter } from "./modelRouter.js";
import { handleOpenAiChatCompletion, handleOpenAiListModels } from "./openaiRoutes.js";

/** Which wire dialect an error should be rendered in. */
type Dialect = "openai" | "anthropic";

export interface ServingGatewayOptions {
  /** Installed-model source; production passes `ModelsService.list`. */
  readonly listInstalled: () => Promise<readonly ListedModelDto[]>;
  /**
   * Routable runtimes. Defaults to the built-in Ollama + LM Studio adapters;
   * the sidecar passes a resolver that also layers in the user's
   * `nexus.llm.localAdapters` manifests.
   */
  readonly adapters?: () => readonly ServingAdapter[];
  readonly maxBodyBytes?: number;
  readonly maxConcurrentRequests?: number;
  /** Structured log sink. Defaults to stderr (stdout is the JSON-RPC channel). */
  readonly log?: (message: string) => void;
}

/** Live gateway state, surfaced to the desktop Settings section over IPC. */
export interface ServingStatus {
  readonly enabled: boolean;
  readonly running: boolean;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly token: string;
}

export class ServingGateway {
  private readonly _opts: ServingGatewayOptions;
  private readonly _limiter: ConcurrencyLimiter;
  private readonly _router: ModelRouter;
  private readonly _log: (message: string) => void;
  private _server: Server | null = null;
  private _config: ServingConfig | null = null;

  constructor(opts: ServingGatewayOptions) {
    this._opts = opts;
    this._limiter = new ConcurrencyLimiter(
      opts.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
    );
    this._router = new ModelRouter({
      listInstalled: opts.listInstalled,
      adapters: opts.adapters ?? (() => builtinServingAdapters()),
    });
    this._log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));
  }

  get running(): boolean {
    return this._server !== null;
  }

  /** The bound port (differs from the configured one only when `port: 0`). */
  get boundPort(): number | null {
    const addr = this._server?.address();
    return addr && typeof addr === "object" ? addr.port : null;
  }

  status(config: ServingConfig): ServingStatus {
    const port = this.boundPort ?? config.port;
    return {
      enabled: config.enabled,
      running: this.running,
      host: config.host,
      port,
      baseUrl: servingBaseUrl({ host: config.host, port }),
      token: config.token,
    };
  }

  /**
   * Start listening. No-op when `config.enabled` is false -- with the setting
   * off, NO port is bound. Throws `ServingBindError` for a non-loopback host
   * before any socket is opened.
   */
  async start(config: ServingConfig): Promise<void> {
    if (!config.enabled) {
      this._config = config;
      return;
    }
    if (this._server) return;

    assertLoopbackHost(config.host);

    const server = createServer((req, res) => {
      void this._handle(req, res, config);
    });
    // A stalled client must not pin a socket forever.
    server.headersTimeout = 30_000;
    server.requestTimeout = 0; // a long local generation is legitimate

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.port, config.host);
    });

    this._server = server;
    this._config = config;
    this._log(
      `[nexus-sidecar] local serving gateway listening on ${servingBaseUrl({
        host: config.host,
        port: this.boundPort ?? config.port,
      })} (token ${redactToken(config.token)})`,
    );
  }

  /** Stop listening. Idempotent; safe on a never-started gateway. */
  async stop(): Promise<void> {
    const server = this._server;
    if (!server) return;
    this._server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Drop keep-alive sockets so close() is not held open by an idle client.
      server.closeAllConnections?.();
    });
    this._log("[nexus-sidecar] local serving gateway stopped");
  }

  /** Apply a new config: start, stop, or restart as the delta requires. */
  async applyConfig(next: ServingConfig): Promise<void> {
    const prev = this._config;
    const rebindNeeded =
      this.running && (prev?.host !== next.host || prev?.port !== next.port);
    if (!next.enabled) {
      await this.stop();
      this._config = next;
      return;
    }
    if (rebindNeeded) await this.stop();
    await this.start(next);
    this._config = next;
  }

  private async _handle(
    req: IncomingMessage,
    res: ServerResponse,
    config: ServingConfig,
  ): Promise<void> {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const method = (req.method ?? "GET").toUpperCase();
    const dialect: Dialect = path === "/v1/messages" ? "anthropic" : "openai";
    const writer = createResponseWriter(res);

    // Unauthenticated liveness probe: reveals nothing but that we are up.
    if (method === "GET" && (path === "/health" || path === "/v1/health")) {
      writer.json(200, { status: "ok" });
      return;
    }

    let release: (() => void) | null = null;
    try {
      checkBearerToken(req.headers, config.token);

      if (method === "GET" && path === "/v1/models") {
        await handleOpenAiListModels({ router: this._router }, writer);
        return;
      }

      if (method === "POST" && (path === "/v1/chat/completions" || path === "/v1/messages")) {
        release = this._limiter.acquire();
        const raw = await readLimitedBody(req, this._opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
        const body = parseJsonBody(raw);
        const signal = abortSignalFor(req);
        if (path === "/v1/messages") {
          await handleAnthropicMessages(body, { router: this._router }, writer, signal);
        } else {
          await handleOpenAiChatCompletion(body, { router: this._router }, writer, signal);
        }
        return;
      }

      writeError(res, dialect, notFound(`No route for ${method} ${path}.`, "unknown_route"));
    } catch (err) {
      writeError(res, dialect, toServingError(err));
    } finally {
      release?.();
    }
  }
}

function writeError(res: ServerResponse, dialect: Dialect, err: ServingHttpError): void {
  const body = dialect === "anthropic" ? anthropicErrorBody(err) : openAiErrorBody(err);
  if (res.headersSent) {
    // Mid-stream failure: the status line is already on the wire, so the only
    // honest signal left is an error frame followed by termination.
    res.write(`data: ${body}\n\n`);
    res.end();
    return;
  }
  res.writeHead(err.status, { "content-type": "application/json" });
  res.end(body);
}

/** Abort the upstream generation when the client hangs up mid-stream. */
function abortSignalFor(req: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  req.on("aborted", () => controller.abort());
  req.on("close", () => {
    if (!req.complete) controller.abort();
  });
  return controller.signal;
}

/** Bridge a `ServerResponse` to the route-facing `ResponseWriter`. */
export function createResponseWriter(res: ServerResponse): ResponseWriter {
  return {
    json(status, body) {
      if (res.headersSent) return;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    },
    sse(): SseWriter {
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
      }
      return {
        write(data, event) {
          if (res.writableEnded) return;
          if (event) res.write(`event: ${event}\n`);
          res.write(`data: ${data}\n\n`);
        },
        end() {
          if (!res.writableEnded) res.end();
        },
      };
    },
  };
}
