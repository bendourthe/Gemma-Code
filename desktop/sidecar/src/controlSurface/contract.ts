/**
 * v1.18.0 Phase 5 (OI-A3) -- shared local control-surface contract.
 *
 * One loopback HTTP listener + local bearer auth is the mount point for:
 *
 *   1. The v1.16.0 OpenAI/Anthropic serving gateway (`/v1/*`, `/health`).
 *   2. This cycle's Agent Client Protocol surface (`POST /acp`).
 *
 * Do not add a second `node:http` server, a second bind-address check, or a
 * second token mint for either feature. New inbound local APIs register a
 * `ControlSurfaceRoute` on {@link LoopbackHttpServer} (see `loopbackServer.ts`).
 *
 * Invariants (locked by `desktop/tests/controlSurface-contract.test.ts`):
 *
 *   - Bind is loopback-only. Non-loopback hosts throw before `listen`.
 *   - Every non-`/health` request must present the local bearer token.
 *     Unauthenticated and wrong-token connections are rejected before any
 *     route handler (serving or ACP) runs.
 *   - `/health` stays unauthenticated and reveals only `{ status: "ok" }`.
 *   - The listener opens if serving OR ACP is enabled; it stays closed when
 *     both are off (no idle port).
 *   - Serving routes (`/v1/*`) dispatch only while serving is enabled. ACP
 *     (`POST /acp`) dispatches only while ACP is enabled. Enabling one does
 *     not silently enable the other.
 *
 * Token persistence reuses `nexus.serving.token` (minted by
 * `resolveServingConfig`). ACP does not mint a second credential.
 */

export const CONTROL_SURFACE_HEALTH_PATH = "/health";
export const CONTROL_SURFACE_ACP_PATH = "/acp";
export const CONTROL_SURFACE_OPENAI_PREFIX = "/v1";

/** Documented route families that may mount on the shared listener. */
export const CONTROL_SURFACE_MOUNTS = ["serving", "acp"] as const;
export type ControlSurfaceMount = (typeof CONTROL_SURFACE_MOUNTS)[number];
