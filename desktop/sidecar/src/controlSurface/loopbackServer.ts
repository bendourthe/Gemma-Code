/**
 * v1.18.0 Phase 5 (OI-A3) -- shared loopback HTTP listener.
 *
 * Extracted from the v1.16.0 serving gateway so ACP (this phase) and the
 * OpenAI/Anthropic inference API share one bind + auth layer. See
 * `contract.ts` for the reuse rules.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { ResponseWriter, SseWriter } from "../serving/chatCore.js";
import {
  type ServingHttpError,
  notFound,
  openAiErrorBody,
  toServingError,
} from "../serving/errors.js";
import {
  ConcurrencyLimiter,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  ServingBindError,
  assertLoopbackHost,
  checkBearerToken,
  parseJsonBody,
  readLimitedBody,
} from "../serving/guard.js";
import { CONTROL_SURFACE_HEALTH_PATH } from "./contract.js";

export interface LoopbackListenConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  /** When false, `start` is a no-op and any existing listener is closed. */
  readonly listen: boolean;
}

export interface ControlSurfaceContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly token: string;
  readonly writer: ResponseWriter;
  readonly signal: AbortSignal;
  readonly maxBodyBytes: number;
  readonly limiter: ConcurrencyLimiter;
}

/**
 * Return true when this mount handled the request (including writing the
 * response). Return false to let the next mount try.
 */
export type ControlSurfaceRoute = (ctx: ControlSurfaceContext) => Promise<boolean>;

export interface LoopbackHttpServerOptions {
  readonly maxBodyBytes?: number;
  readonly maxConcurrentRequests?: number;
  readonly log?: (message: string) => void;
}

/**
 * Loopback-only HTTP server with bearer auth applied before any mount.
 *
 * Mounts are tried in registration order after `/health` and the token check.
 */
export class LoopbackHttpServer {
  private readonly _limiter: ConcurrencyLimiter;
  private readonly _maxBodyBytes: number;
  private readonly _log: (message: string) => void;
  private readonly _routes: ControlSurfaceRoute[] = [];
  private _server: Server | null = null;
  private _token = "";
  private _host = "127.0.0.1";
  private _port = 0;

  constructor(opts: LoopbackHttpServerOptions = {}) {
    this._limiter = new ConcurrencyLimiter(
      opts.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
    );
    this._maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this._log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));
  }

  get running(): boolean {
    return this._server !== null;
  }

  get boundPort(): number | null {
    const addr = this._server?.address();
    return addr && typeof addr === "object" ? addr.port : null;
  }

  /** Register a mount. Order is registration order; first true wins. */
  mount(route: ControlSurfaceRoute): void {
    this._routes.push(route);
  }

  async start(config: LoopbackListenConfig): Promise<void> {
    if (!config.listen) {
      await this.stop();
      this._token = config.token;
      this._host = config.host;
      this._port = config.port;
      return;
    }

    assertLoopbackHost(config.host);
    this._token = config.token;
    this._host = config.host;
    this._port = config.port;

    if (this._server) return;

    const server = createServer((req, res) => {
      void this._handle(req, res);
    });
    server.headersTimeout = 30_000;
    server.requestTimeout = 0;

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
    this._log(
      `[nexus-sidecar] local control surface listening on http://${config.host}:${this.boundPort ?? config.port}`,
    );
  }

  async stop(): Promise<void> {
    const server = this._server;
    if (!server) return;
    this._server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    this._log("[nexus-sidecar] local control surface stopped");
  }

  async applyConfig(config: LoopbackListenConfig): Promise<void> {
    const rebindNeeded = this.running && (this._host !== config.host || this._port !== config.port);
    if (!config.listen) {
      await this.stop();
      this._token = config.token;
      this._host = config.host;
      this._port = config.port;
      return;
    }
    if (rebindNeeded) await this.stop();
    await this.start(config);
  }

  private async _handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const method = (req.method ?? "GET").toUpperCase();
    const writer = createResponseWriter(res);

    if (method === "GET" && (path === CONTROL_SURFACE_HEALTH_PATH || path === "/v1/health")) {
      writer.json(200, { status: "ok" });
      return;
    }

    try {
      checkBearerToken(req.headers, this._token);

      const ctx: ControlSurfaceContext = {
        req,
        res,
        method,
        path,
        token: this._token,
        writer,
        signal: abortSignalFor(req),
        maxBodyBytes: this._maxBodyBytes,
        limiter: this._limiter,
      };

      for (const route of this._routes) {
        if (await route(ctx)) return;
      }

      writeControlSurfaceError(res, notFound(`No route for ${method} ${path}.`, "unknown_route"));
    } catch (err) {
      writeControlSurfaceError(res, toServingError(err));
    }
  }
}

export function writeControlSurfaceError(res: ServerResponse, err: ServingHttpError): void {
  const body = openAiErrorBody(err);
  if (res.headersSent) {
    res.write(`data: ${body}\n\n`);
    res.end();
    return;
  }
  res.writeHead(err.status, { "content-type": "application/json" });
  res.end(body);
}

/** Abort the in-flight work when the client hangs up mid-stream. */
export function abortSignalFor(req: IncomingMessage): AbortSignal {
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

export {
  DEFAULT_MAX_BODY_BYTES,
  parseJsonBody,
  readLimitedBody,
  ServingBindError,
};
