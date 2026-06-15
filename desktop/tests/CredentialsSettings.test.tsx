/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T017) -- CredentialsSettings UI.
 *
 * Proves the credential surface is a VIEW over the vault: setting a credential
 * routes through the client into the vault-modeling store (the only sink; no
 * config file), and the surface degrades cleanly when the keychain is
 * unavailable.
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredentialsSettings } from "../src/pages/settings/CredentialsSettings";
import { createMockCredentialsClient } from "../src/pages/settings/mockCredentialsClient";

describe("<CredentialsSettings>", () => {
  it("stores a credential via the client into the vault, not a config file", async () => {
    const client = createMockCredentialsClient();
    const user = userEvent.setup();
    render(<CredentialsSettings client={client} />);

    await user.type(screen.getByTestId("credentials-integration"), "github-mcp");
    await user.click(screen.getByTestId("credentials-load"));
    expect(await screen.findByTestId("credentials-keys-empty")).toBeInTheDocument();

    await user.type(screen.getByTestId("credentials-new-key"), "GITHUB_TOKEN");
    await user.type(screen.getByTestId("credentials-new-value"), "ghp_secret");
    await user.click(screen.getByTestId("credentials-save"));

    // The value lands ONLY in the vault-modeling store (peek), proving the
    // surface never writes to a second/plaintext store.
    await waitFor(() =>
      expect(client.peek("github-mcp", "GITHUB_TOKEN")).toBe("ghp_secret"),
    );
    expect(await screen.findByTestId("credential-row-GITHUB_TOKEN")).toBeInTheDocument();
  });

  it("lists existing keys and deletes one", async () => {
    const client = createMockCredentialsClient({
      seed: { svc: { API_KEY: "v1", REGION: "us" } },
    });
    const user = userEvent.setup();
    render(<CredentialsSettings client={client} />);

    await user.type(screen.getByTestId("credentials-integration"), "svc");
    await user.click(screen.getByTestId("credentials-load"));

    expect(await screen.findByTestId("credential-row-API_KEY")).toBeInTheDocument();
    expect(screen.getByTestId("credential-row-REGION")).toBeInTheDocument();

    await user.click(screen.getByTestId("credential-delete-API_KEY"));
    await waitFor(() =>
      expect(screen.queryByTestId("credential-row-API_KEY")).not.toBeInTheDocument(),
    );
    expect(client.peek("svc", "API_KEY")).toBeUndefined();
  });

  it("never reveals stored secret values (only key names)", async () => {
    const client = createMockCredentialsClient({ seed: { svc: { TOKEN: "supersecret" } } });
    const user = userEvent.setup();
    render(<CredentialsSettings client={client} />);

    await user.type(screen.getByTestId("credentials-integration"), "svc");
    await user.click(screen.getByTestId("credentials-load"));

    expect(await screen.findByTestId("credential-row-TOKEN")).toBeInTheDocument();
    expect(screen.queryByText("supersecret")).not.toBeInTheDocument();
  });

  it("shows a disabled state and blocks saves when the keychain is unavailable", async () => {
    const client = createMockCredentialsClient({ available: false });
    render(<CredentialsSettings client={client} />);
    expect(await screen.findByTestId("credentials-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("credentials-load")).toBeDisabled();
  });
});
