/**
 * v1.19.1 Phase 2.5 -- Security posture settings tab.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  SecuritySettings,
  type DesktopSecurityPosture,
  type SecuritySettingsClient,
} from "../src/pages/settings/SecuritySettings";

function memoryClient(initial: DesktopSecurityPosture = "standard"): SecuritySettingsClient {
  let stored = initial;
  return {
    getPosture: async () => stored,
    setPosture: async (id) => {
      stored = id;
    },
  };
}

describe("SecuritySettings", () => {
  it("renders Strict, Standard, and Unattended with a hard-denial floor", async () => {
    render(<SecuritySettings client={memoryClient()} />);
    await waitFor(() => expect(screen.getByTestId("settings-security")).toBeInTheDocument());
    expect(screen.getByTestId("security-posture-strict").textContent).toMatch(/hard-denied/i);
    expect(screen.getByTestId("security-posture-standard").textContent).toMatch(/hard-denied/i);
    expect(screen.getByTestId("security-posture-unattended").textContent).toMatch(/not a no-floor/i);
  });

  it("persists the selected posture through the client", async () => {
    const user = userEvent.setup();
    const setPosture = vi.fn(async (_id: DesktopSecurityPosture) => undefined);
    const client: SecuritySettingsClient = {
      getPosture: async () => "standard",
      setPosture,
    };
    render(<SecuritySettings client={client} />);
    await waitFor(() => expect(screen.getByTestId("security-posture-unattended")).toBeInTheDocument());
    await user.click(screen.getByTestId("security-posture-unattended").querySelector("input")!);
    expect(setPosture).toHaveBeenCalledWith("unattended");
  });

  it("renders untrusted audit rows from the injected client", async () => {
    render(
      <SecuritySettings
        client={memoryClient()}
        auditClient={{
          list: async () => [
            {
              id: 1,
              ts: "2026-08-20T00:00:00.000Z",
              actor: "worker",
              pillar: "coding",
              kind: "chat.turn",
              trusted: false,
            },
          ],
          status: async () => ({ eventCount: 1, droppedCount: 3, vaultAvailable: false }),
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("audit-row-1")).toBeInTheDocument());
    expect(screen.getByTestId("audit-dropped-count")).toHaveTextContent("Dropped: 3");
    expect(screen.getByText("untrusted")).toBeInTheDocument();
    expect(screen.getByTestId("audit-vault-notice")).toBeInTheDocument();
  });

  it("toggles parse_document through the injected client", async () => {
    const user = userEvent.setup();
    const setEnabled = vi.fn(async (_enabled: boolean) => undefined);
    render(
      <SecuritySettings
        client={memoryClient()}
        parseDocumentClient={{
          getEnabled: async () => false,
          setEnabled,
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("parse-document-toggle")).toBeInTheDocument());
    await user.click(screen.getByTestId("parse-document-toggle"));
    expect(setEnabled).toHaveBeenCalledWith(true);
  });
});
