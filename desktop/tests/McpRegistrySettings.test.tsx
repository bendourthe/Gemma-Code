/**
 * v1.18.0 Phase 3 (OW-A5) -- Settings > MCP per-tool deny.
 */

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { McpRegistrySettings } from "../src/pages/settings/McpRegistrySettings";
import { createMockMcpRegistryClient } from "../src/pages/settings/mockMcpRegistryClient";
import type { McpRegistryServerDto } from "../src/pages/settings/mcpTypes";

const ALLOWED: McpRegistryServerDto = {
  name: "nexus-skill-server",
  source: "hub",
  policyVerdict: "allow",
  policyReason: "already-local",
  tools: [
    { name: "list_skills", exposed: true, reason: "allowed", toggleable: true },
  ],
};

const DROPPED: McpRegistryServerDto = {
  name: "exa-web-search",
  source: "hub",
  policyVerdict: "drop",
  policyReason: "drop-outright",
  tools: [{ name: "search", exposed: false, reason: "policy-denied", toggleable: false }],
};

describe("McpRegistrySettings", () => {
  it("renders allow and drop servers and locks policy-denied toggles", async () => {
    render(
      <McpRegistrySettings client={createMockMcpRegistryClient([ALLOWED, DROPPED])} />,
    );
    await waitFor(() => expect(screen.getByTestId("mcp-server-nexus-skill-server")).toBeInTheDocument());
    expect(screen.getByTestId("mcp-tool-nexus-skill-server-list_skills")).not.toBeDisabled();
    expect(screen.getByTestId("mcp-tool-exa-web-search-search")).toBeDisabled();
    expect(screen.getByTestId("mcp-server-exa-web-search-locked")).toBeInTheDocument();
  });

  it("disabling a toggleable tool marks it user-denied", async () => {
    const user = userEvent.setup();
    render(<McpRegistrySettings client={createMockMcpRegistryClient([ALLOWED])} />);
    await waitFor(() =>
      expect(screen.getByTestId("mcp-tool-nexus-skill-server-list_skills")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("mcp-tool-nexus-skill-server-list_skills"));
    await waitFor(() =>
      expect(screen.getByTestId("mcp-tool-nexus-skill-server-list_skills")).not.toBeChecked(),
    );
  });
});
