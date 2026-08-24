/**
 * v1.16.0 Phase 1.1/1.2 (adoption item A1) -- the serving gateway itself.
 * v1.18.0 Phase 5 (OI-A3) -- mounts on the shared {@link LoopbackHttpServer}
 * instead of owning a second `node:http` listener.
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
 * reaches a Nexus tool: the gateway serves model inference only. ACP lives on
 * the same listener at `POST /acp` and is a separate mount.
 *
 * Lifecycle: `start()` is a no-op unless serving or ACP is enabled, and it
 * refuses (throws `ServingBindError`) on a non-loopback host BEFORE calling
 * `listen`. `stop()` is idempotent and safe to call on a never-started gateway,
 * because the Rust supervisor may hard-kill the sidecar without a graceful
 * signal (`desktop/src-tauri/src/sidecar.rs`).
 */

import type { ServerResponse } from "node:http";
import type { ListedModelDto } from "../models/modelsService.js";
import { builtinServingAdapters, type ServingAdapter } from "./adapters.js";
import { handleAnthropicMessages } from "./anthropicRoutes.js";
import { type ServingConfig, redactToken, servingBaseUrl } from "./config.js";
import {
  type ServingHttpError,
  anthropicErrorBody,
  notFound,
  openAiErrorBody,
  toServingError,
} from "./errors.js";
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_CONCURRENT_REQUESTS,
} from "./guard.js";
import { ModelRouter } from "./modelRouter.js";
import { handleOpenAiChatCompletion, handleOpenAiListModels } from "./openaiRoutes.js";
import {
  LoopbackHttpServer,
  parseJsonBody,
  readLimitedBody,
  type ControlSurfaceContext,
} from "../controlSurface/loopbackServer.js";

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

function listenRequested(config: ServingConfig): boolean {
  return config.enabled || config.acpEnabled === true || config.jsonCliEnabled === true;
}

export class ServingGateway {
  private readonly _router: ModelRouter;
  private readonly _log: (message: string) => void;
  /** Shared loopback listener. ACP mounts additional routes on this instance. */
  readonly surface: LoopbackHttpServer;
  private _config: ServingConfig | null = null;
  private _servingRoutesEnabled = false;

  constructor(opts: ServingGatewayOptions) {
    this._router = new ModelRouter({
      listInstalled: opts.listInstalled,
      adapters: opts.adapters ?? (() => builtinServingAdapters()),
    });
    this._log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));
    this.surface = new LoopbackHttpServer({
      maxBodyBytes: opts.maxBodyBytes,
      maxConcurrentRequests: opts.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
      log: this._log,
    });
    this.surface.mount((ctx) => this._handleServing(ctx));
  }

  get running(): boolean {
    return this.surface.running;
  }

  /** The bound port (differs from the configured one only when `port: 0`). */
  get boundPort(): number | null {
    return this.surface.boundPort;
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
   * Start listening. No-op when serving, ACP, and JSON CLI are all off -- with
   * all three off, NO port is bound. Throws `ServingBindError` for a non-loopback
   * host before any socket is opened.
   */
  async start(config: ServingConfig): Promise<void> {
    this._servingRoutesEnabled = config.enabled;
    this._config = config;
    const listen = listenRequested(config);
    await this.surface.start({
      host: config.host,
      port: config.port,
      token: config.token,
      listen,
    });
    if (listen) {
      this._log(
        `[nexus-sidecar] local serving gateway ${config.enabled ? "routes on" : "idle on"} ${servingBaseUrl({
          host: config.host,
          port: this.boundPort ?? config.port,
        })} (token ${redactToken(config.token)})`,
      );
    }
  }

  /** Stop listening. Idempotent; safe on a never-started gateway. */
  async stop(): Promise<void> {
    await this.surface.stop();
    this._log("[nexus-sidecar] local serving gateway stopped");
  }

  /** Apply a new config: start, stop, or restart as the delta requires. */
  async applyConfig(next: ServingConfig): Promise<void> {
    const prev = this._config;
    const listen = listenRequested(next);
    const rebindNeeded =
      this.running && (prev?.host !== next.host || prev?.port !== next.port);
    this._servingRoutesEnabled = next.enabled;
    if (!listen) {
      await this.stop();
      this._config = next;
      return;
    }
    if (rebindNeeded) await this.surface.stop();
    await this.start(next);
    this._config = next;
  }

  private async _handleServing(ctx: ControlSurfaceContext): Promise<boolean> {
    if (!this._servingRoutesEnabled) return false;

    const { method, path, req, res, writer } = ctx;
    const dialect: Dialect = path === "/v1/messages" ? "anthropic" : "openai";

    let release: (() => void) | null = null;
    try {
      if (method === "GET" && path === "/v1/models") {
        await handleOpenAiListModels({ router: this._router }, writer);
        return true;
      }

      if (method === "POST" && (path === "/v1/chat/completions" || path === "/v1/messages")) {
        release = ctx.limiter.acquire();
        const raw = await readLimitedBody(req, ctx.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
        const body = parseJsonBody(raw);
        const signal = ctx.signal;
        if (path === "/v1/messages") {
          await handleAnthropicMessages(body, { router: this._router }, writer, signal);
        } else {
          await handleOpenAiChatCompletion(body, { router: this._router }, writer, signal);
        }
        return true;
      }

      if (path.startsWith("/v1/")) {
        writeServingError(res, dialect, notFound(`No route for ${method} ${path}.`, "unknown_route"));
        return true;
      }
      return false;
    } catch (err) {
      writeServingError(res, dialect, toServingError(err));
      return true;
    } finally {
      release?.();
    }
  }
}

function writeServingError(res: ServerResponse, dialect: Dialect, err: ServingHttpError): void {
  const body = dialect === "anthropic" ? anthropicErrorBody(err) : openAiErrorBody(err);
  if (res.headersSent) {
    res.write(`data: ${body}\n\n`);
    res.end();
    return;
  }
  res.writeHead(err.status, { "content-type": "application/json" });
  res.end(body);
}

export { abortSignalFor, createResponseWriter } from "../controlSurface/loopbackServer.js";
