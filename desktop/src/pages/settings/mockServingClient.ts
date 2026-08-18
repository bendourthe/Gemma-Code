/**
 * v1.16.0 Phase 1.5 (adoption item A1) -- in-memory Local API server client for
 * Storybook-style local dev and component tests. Mirrors the real gateway's
 * observable behavior: disabled means not running, and enabling binds.
 * v1.18.0 Phase 5 -- ACP toggle on the same loopback listener.
 */

import type { AcpStatusDto, ServingClient, ServingStatusDto } from "./servingTypes";

const MOCK_HOST = "127.0.0.1";
const MOCK_PORT = 11500;
const MOCK_TOKEN = "mock-local-token-DEMO1234";

export function createMockServingClient(initialEnabled = false): ServingClient {
  let enabled = initialEnabled;
  let acpEnabled = false;

  const snapshot = (): ServingStatusDto => ({
    enabled,
    running: enabled || acpEnabled,
    host: MOCK_HOST,
    port: MOCK_PORT,
    baseUrl: `http://${MOCK_HOST}:${MOCK_PORT}/v1`,
    token: MOCK_TOKEN,
  });

  const acpSnapshot = (): AcpStatusDto => ({
    enabled: acpEnabled,
    running: acpEnabled,
    host: MOCK_HOST,
    port: MOCK_PORT,
    endpoint: `http://${MOCK_HOST}:${MOCK_PORT}/acp`,
    token: MOCK_TOKEN,
  });

  return {
    async status(): Promise<ServingStatusDto> {
      return snapshot();
    },
    async setEnabled(next: boolean): Promise<ServingStatusDto> {
      enabled = next;
      return snapshot();
    },
    async acpStatus(): Promise<AcpStatusDto> {
      return acpSnapshot();
    },
    async setAcpEnabled(next: boolean): Promise<AcpStatusDto> {
      acpEnabled = next;
      return acpSnapshot();
    },
  };
}
