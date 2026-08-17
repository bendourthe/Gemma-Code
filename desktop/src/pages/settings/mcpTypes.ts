/**
 * v1.18.0 Phase 3 (OW-A5) -- DTOs for Settings > MCP per-tool deny.
 */

export type McpPolicyVerdict = "allow" | "drop";

export interface McpRegistryToolDto {
  readonly name: string;
  readonly exposed: boolean;
  readonly reason: "allowed" | "user-denied" | "policy-denied";
  readonly toggleable: boolean;
}

export interface McpRegistryServerDto {
  readonly name: string;
  readonly source: "user" | "hub";
  readonly policyVerdict: McpPolicyVerdict;
  readonly policyReason: string;
  readonly tools: readonly McpRegistryToolDto[];
}

export interface McpRegistryClient {
  list(): Promise<readonly McpRegistryServerDto[]>;
  setToolDenied(serverName: string, toolName: string, denied: boolean): Promise<{
    readonly ok: boolean;
    readonly reason: string;
    readonly servers: readonly McpRegistryServerDto[];
  }>;
}
