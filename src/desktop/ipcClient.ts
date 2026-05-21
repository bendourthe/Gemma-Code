/**
 * v1.1.0 Phase 11 -- structural IPC client interface consumed by the VS Code
 * extension's proxy branch.
 *
 * The cross-process transport (named pipe on Windows, UNIX domain socket on
 * macOS / Linux) is the upstream Phase 2 deliverable tracked under known-gap
 * 10.1.P1.Z. This module defines only the *shape* the proxy and the Phase 11
 * panels consume, plus two in-process implementations that exercise the same
 * shape end-to-end:
 *
 *   - `NoopIpcClient` -- every call rejects with a deterministic "daemon
 *     unavailable" reason. Used as the activation-time placeholder until the
 *     real transport is wired.
 *   - `createInProcessIpcClient(handlers)` -- routes calls through an
 *     in-process handler table. Used by integration tests and by the parity
 *     tests in Phase 11.9 that exercise the extension webview against a
 *     fake daemon.
 *
 * The structural type is intentionally narrow: a single `call<R>(method,
 * params): Promise<R>` plus a `subscribe(method, listener): Disposable` for
 * streaming channels. Schema validation is the responsibility of the caller
 * (every Phase 11 module owns its own Zod schemas and validates at the
 * boundary).
 */

export type IpcMethod = string;

export interface IpcEventListener<E = unknown> {
  (event: E): void;
}

export interface IpcSubscription {
  /** Unsubscribe from the channel. Idempotent. */
  dispose(): void;
}

export interface IpcClient {
  /**
   * Send a unary RPC. Resolves with the response payload; rejects with an
   * `Error` whose `.message` describes the failure surface (transport
   * unavailable, schema rejection, handler threw, etc.).
   */
  call<R = unknown>(method: IpcMethod, params?: unknown): Promise<R>;
  /**
   * Subscribe to a streaming channel. The returned subscription's `dispose`
   * detaches the listener; subsequent emits do not invoke it.
   */
  subscribe<E = unknown>(
    method: IpcMethod,
    listener: IpcEventListener<E>,
  ): IpcSubscription;
  /**
   * Close the underlying transport. After `close()` every call rejects and
   * every subscription becomes inert. Idempotent.
   */
  close(): void;
}

const NOOP_REASON =
  "Nexus daemon IPC client not wired in this build (see v1.1.0 known-gap 10.1.P1.Z).";

/**
 * Activation-time placeholder. Every `call` rejects with a deterministic
 * "daemon unavailable" reason; subscriptions return inert disposables. The
 * proxy branch installs this client when the real transport is absent so
 * Phase 11 panels can degrade gracefully (the chat panel surfaces a status
 * bar hint; the memory and session panels render an "open the desktop app"
 * placeholder).
 */
export class NoopIpcClient implements IpcClient {
  private _closed = false;

  async call<R = unknown>(_method: IpcMethod, _params?: unknown): Promise<R> {
    if (this._closed) {
      throw new Error(`${NOOP_REASON} (transport already closed)`);
    }
    throw new Error(NOOP_REASON);
  }

  subscribe<E = unknown>(
    _method: IpcMethod,
    _listener: IpcEventListener<E>,
  ): IpcSubscription {
    return { dispose: () => {} };
  }

  close(): void {
    this._closed = true;
  }
}

export interface IpcHandlerTable {
  readonly [method: string]:
    | ((params: unknown) => unknown | Promise<unknown>)
    | undefined;
}

/**
 * In-process IPC client: every `call(method, params)` dispatches to a
 * handler in the provided table. Streaming subscriptions are backed by a
 * map of listener sets; tests drive emissions via the returned `emit`
 * helper.
 */
export interface InProcessIpcClient extends IpcClient {
  /**
   * Push an event to every listener subscribed to `method`. Returns the
   * count of listeners that received it. Used by integration tests to
   * replay recorded streams.
   */
  emit<E>(method: IpcMethod, event: E): number;
}

export function createInProcessIpcClient(
  handlers: IpcHandlerTable,
): InProcessIpcClient {
  const subscribers = new Map<string, Set<IpcEventListener>>();
  let closed = false;

  const ensureLive = (): void => {
    if (closed) {
      throw new Error("IPC client is closed.");
    }
  };

  return {
    async call<R = unknown>(method: IpcMethod, params?: unknown): Promise<R> {
      ensureLive();
      const handler = handlers[method];
      if (!handler) {
        throw new Error(`No handler registered for IPC method '${method}'.`);
      }
      const result = await handler(params);
      return result as R;
    },
    subscribe<E = unknown>(
      method: IpcMethod,
      listener: IpcEventListener<E>,
    ): IpcSubscription {
      ensureLive();
      let set = subscribers.get(method);
      if (!set) {
        set = new Set();
        subscribers.set(method, set);
      }
      set.add(listener as IpcEventListener);
      return {
        dispose: () => {
          subscribers.get(method)?.delete(listener as IpcEventListener);
        },
      };
    },
    emit<E>(method: IpcMethod, event: E): number {
      const set = subscribers.get(method);
      if (!set) return 0;
      let count = 0;
      for (const listener of set) {
        try {
          listener(event);
          count += 1;
        } catch {
          // Listeners are isolated from one another; a throwing listener
          // never blocks the rest of the fan-out.
        }
      }
      return count;
    },
    close(): void {
      closed = true;
      subscribers.clear();
    },
  };
}
