/**
 * v1.16.0 Phase 1.5 (adoption item A1) -- Local API server section types.
 *
 * Mirrors the sidecar's `ServingStatusResponse` (`serving.status` /
 * `serving.setEnabled`). Kept in its own module, matching `modelsTypes.ts` and
 * `credentialsTypes.ts`, so the mock and IPC clients share one shape.
 */

export interface ServingStatusDto {
  /** The `nexus.serving.enabled` opt-in. */
  enabled: boolean;
  /** Whether a listener is actually bound right now. */
  running: boolean;
  host: string;
  port: number;
  /** `http://<host>:<port>/v1` -- what the user pastes into another tool. */
  baseUrl: string;
  /** The local bearer token. Masked in the UI until the user reveals it. */
  token: string;
}

/** v1.18.0 Phase 5 -- ACP mount on the same loopback listener and token. */
export interface AcpStatusDto {
  enabled: boolean;
  running: boolean;
  host: string;
  port: number;
  /** `http://<host>:<port>/acp` -- JSON-RPC endpoint. */
  endpoint: string;
  token: string;
}

export interface ServingClient {
  status(): Promise<ServingStatusDto>;
  setEnabled(enabled: boolean): Promise<ServingStatusDto>;
  acpStatus(): Promise<AcpStatusDto>;
  setAcpEnabled(enabled: boolean): Promise<AcpStatusDto>;
}
