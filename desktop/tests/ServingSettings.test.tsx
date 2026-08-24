/**
 * v1.16.0 Phase 1.6 (adoption item A1) -- Local API server settings section.
 *
 * The acceptance criterion for sub-task 1.5 is that a non-technical user can
 * toggle the server on, copy the base URL + token, and paste them elsewhere --
 * so these tests drive exactly that path, plus the token-masking default.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServingSettings } from "../src/pages/settings/ServingSettings";
import { createMockServingClient } from "../src/pages/settings/mockServingClient";
import type { AcpStatusDto, ServingClient, ServingStatusDto } from "../src/pages/settings/servingTypes";

const ENABLED: ServingStatusDto = {
  enabled: true,
  running: true,
  host: "127.0.0.1",
  port: 11500,
  baseUrl: "http://127.0.0.1:11500/v1",
  token: "super-secret-token-ABCD",
};

const ACP_OFF: AcpStatusDto = {
  enabled: false,
  running: false,
  host: "127.0.0.1",
  port: 11500,
  endpoint: "http://127.0.0.1:11500/acp",
  token: "super-secret-token-ABCD",
};

function staticClient(status: ServingStatusDto, acp: AcpStatusDto = ACP_OFF): ServingClient {
  return {
    status: async () => status,
    setEnabled: async () => status,
    acpStatus: async () => acp,
    setAcpEnabled: async () => acp,
  };
}

describe("ServingSettings", () => {
  it("renders the stopped state and hides connection details while off", async () => {
    render(<ServingSettings client={createMockServingClient(false)} />);
    await waitFor(() => expect(screen.getByTestId("serving-state")).toBeInTheDocument());
    expect(screen.getByTestId("serving-state").textContent).toMatch(/stopped/i);
    expect(screen.queryByTestId("serving-base-url")).not.toBeInTheDocument();
    expect(screen.queryByTestId("serving-token")).not.toBeInTheDocument();
  });

  it("shows the base URL and endpoints once enabled", async () => {
    render(<ServingSettings client={staticClient(ENABLED)} />);
    await waitFor(() => expect(screen.getByTestId("serving-base-url")).toBeInTheDocument());
    expect(screen.getByTestId("serving-base-url").textContent).toBe("http://127.0.0.1:11500/v1");
    expect(screen.getByTestId("serving-state").textContent).toMatch(/running/i);
    expect(screen.getByTestId("serving-endpoints").textContent).toContain("/v1/chat/completions");
    expect(screen.getByTestId("serving-endpoints").textContent).toContain("/v1/messages");
  });

  it("masks the token by default and reveals it on demand", async () => {
    const user = userEvent.setup();
    render(<ServingSettings client={staticClient(ENABLED)} />);
    await waitFor(() => expect(screen.getByTestId("serving-token")).toBeInTheDocument());

    expect(screen.getByTestId("serving-token").textContent).not.toContain("super-secret");
    expect(screen.getByTestId("serving-token").textContent).toContain("ABCD");

    await user.click(screen.getByTestId("serving-reveal-token"));
    expect(screen.getByTestId("serving-token").textContent).toBe("super-secret-token-ABCD");

    await user.click(screen.getByTestId("serving-reveal-token"));
    expect(screen.getByTestId("serving-token").textContent).not.toContain("super-secret");
  });

  it("toggling on starts the server and surfaces the details", async () => {
    const user = userEvent.setup();
    render(<ServingSettings client={createMockServingClient(false)} />);
    await waitFor(() => expect(screen.getByTestId("serving-toggle")).toBeInTheDocument());

    await user.click(screen.getByTestId("serving-toggle"));
    await waitFor(() => expect(screen.getByTestId("serving-base-url")).toBeInTheDocument());
    expect(screen.getByTestId("serving-state").textContent).toMatch(/running/i);
  });

  it("copies the base URL and the token without revealing the token", async () => {
    const user = userEvent.setup();
    const writeClipboard = vi.fn(async () => {});
    render(<ServingSettings client={staticClient(ENABLED)} writeClipboard={writeClipboard} />);
    await waitFor(() => expect(screen.getByTestId("serving-copy-url")).toBeInTheDocument());

    await user.click(screen.getByTestId("serving-copy-url"));
    expect(writeClipboard).toHaveBeenCalledWith("http://127.0.0.1:11500/v1");

    await user.click(screen.getByTestId("serving-copy-token"));
    expect(writeClipboard).toHaveBeenCalledWith("super-secret-token-ABCD");
    // Copying must not flip the mask.
    expect(screen.getByTestId("serving-token").textContent).not.toContain("super-secret");
  });

  it("surfaces a toggle failure without crashing", async () => {
    const user = userEvent.setup();
    const client: ServingClient = {
      status: async () => ({ ...ENABLED, enabled: false, running: false }),
      setEnabled: async () => {
        throw new Error("bind failed: port 11500 in use");
      },
      acpStatus: async () => ACP_OFF,
      setAcpEnabled: async () => ACP_OFF,
    };
    render(<ServingSettings client={client} />);
    await waitFor(() => expect(screen.getByTestId("serving-toggle")).toBeInTheDocument());

    await user.click(screen.getByTestId("serving-toggle"));
    await waitFor(() => expect(screen.getByTestId("serving-error")).toBeInTheDocument());
    expect(screen.getByTestId("serving-error").textContent).toContain("port 11500 in use");
  });

  it("reports an enabled-but-not-listening state distinctly", async () => {
    render(<ServingSettings client={staticClient({ ...ENABLED, running: false })} />);
    await waitFor(() => expect(screen.getByTestId("serving-state")).toBeInTheDocument());
    expect(screen.getByTestId("serving-state").textContent).toMatch(/not listening/i);
  });

  it("surfaces a status-load failure", async () => {
    const client: ServingClient = {
      status: async () => {
        throw new Error("sidecar unavailable");
      },
      setEnabled: async () => ENABLED,
      acpStatus: async () => ACP_OFF,
      setAcpEnabled: async () => ACP_OFF,
    };
    render(<ServingSettings client={client} />);
    await waitFor(() => expect(screen.getByTestId("serving-error")).toBeInTheDocument());
    expect(screen.getByTestId("serving-error").textContent).toContain("sidecar unavailable");
  });

  it("shows the ACP endpoint after the ACP toggle is on", async () => {
    const user = userEvent.setup();
    render(<ServingSettings client={createMockServingClient(false)} />);
    await waitFor(() => expect(screen.getByTestId("acp-toggle")).toBeInTheDocument());
    expect(screen.queryByTestId("acp-endpoint")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("acp-toggle"));
    await waitFor(() => expect(screen.getByTestId("acp-endpoint")).toBeInTheDocument());
    expect(screen.getByTestId("acp-endpoint").textContent).toBe("http://127.0.0.1:11500/acp");
    expect(screen.queryByTestId("serving-base-url")).not.toBeInTheDocument();
    expect(screen.getByTestId("serving-token")).toBeInTheDocument();
  });
});
