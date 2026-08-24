/**
 * v1.18.0 Phase 5 (OI-A3) -- ACP opt-in on the shared control surface.
 *
 * Defaults OFF. Enabling binds the shared loopback listener (the same one
 * the serving gateway uses) and mounts `POST /acp`. The bearer token is the
 * existing `nexus.serving.token` -- ACP does not mint a second credential.
 */

export const ACP_KEYS = {
  enabled: "nexus.acp.enabled",
} as const;

export function acpEndpoint(host: string, port: number): string {
  const h = host.includes(":") ? `[${host}]` : host;
  return `http://${h}:${port}/acp`;
}
