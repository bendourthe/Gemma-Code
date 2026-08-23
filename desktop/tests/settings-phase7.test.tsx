/**
 * v2.2.0 Phase 7 -- settings modernization, profile retirement, data transfer.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataSettings } from "../src/pages/settings/DataSettings";
import { Select, Switch } from "../src/components/ui/Select";

describe("styled controls replace the OS-chrome ones", () => {
  const files = [
    "src/pages/settings/ModelsSettings.tsx",
    "src/pages/settings/FineTuningSettings.tsx",
    "src/pages/settings/SecuritySettings.tsx",
    "src/modules/image/ImagePromptForm.tsx",
    "src/modules/video/VideoPromptForm.tsx",
    "src/shared/chat/ModelSelector.tsx",
  ];

  it.each(files)("%s renders no bare <select>", (rel) => {
    // A raw <select> draws with Windows chrome: a grey box with a system
    // arrow inside an otherwise dark app. That was the reported "Windows 95"
    // look.
    const source = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
    expect(source).not.toContain("<select");
  });

  it("keeps the native element underneath so keyboard behaviour survives", () => {
    render(
      <Select testId="t" value="a" onChange={() => undefined}>
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByTestId("t").tagName).toBe("SELECT");
  });

  it("does not clobber a caller's data-testid", () => {
    // Regression: the wrapper set data-testid from its own prop AFTER the
    // spread, overwriting every existing call site with undefined.
    render(
      <Select data-testid="from-caller" value="a" onChange={() => undefined}>
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByTestId("from-caller")).toBeTruthy();
  });

  it("Switch wraps a real checkbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch testId="sw" checked={false} onChange={onChange} label="Enable" />);
    const input = screen.getByTestId("sw");
    expect(input.getAttribute("type")).toBe("checkbox");
    await user.click(input);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Settings > Data", () => {
  it("insets the page with the same padding token as Models", () => {
    render(<DataSettings />);
    expect(screen.getByTestId("settings-data").style.padding).toBe("var(--space-6, 24px)");
  });

  it("selects every non-sensitive category by default", () => {
    render(<DataSettings />);
    expect((screen.getByTestId("data-category-chats") as HTMLInputElement).checked).toBe(true);
    // Credentials must never be on by default: an export file gets emailed,
    // synced, and forgotten.
    expect((screen.getByTestId("data-category-credentials") as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("warns before including credentials", async () => {
    const user = userEvent.setup();
    render(<DataSettings />);
    expect(screen.queryByTestId("data-credentials-warning")).toBeNull();
    await user.click(screen.getByTestId("data-category-credentials"));
    expect(screen.getByTestId("data-credentials-warning")).toBeTruthy();
  });

  it("passes the credentials opt-in explicitly to the backend", async () => {
    const user = userEvent.setup();
    const client = {
      categories: vi.fn(async () => []),
      export: vi.fn(async () => ({ path: "/tmp/x.tar.gz", bytes: 2_000_000, empty: [] })),
      importDryRun: vi.fn(),
      importApply: vi.fn(),
    };
    render(<DataSettings client={client} />);
    await user.click(screen.getByTestId("data-category-credentials"));
    await user.click(screen.getByTestId("data-export"));
    expect(client.export).toHaveBeenCalledWith(
      expect.objectContaining({ includeCredentials: true }),
    );
  });

  it("reports categories that held nothing", async () => {
    const user = userEvent.setup();
    const client = {
      categories: vi.fn(async () => []),
      export: vi.fn(async () => ({
        path: "/tmp/x.tar.gz",
        bytes: 1024,
        empty: ["generations"],
      })),
      importDryRun: vi.fn(),
      importApply: vi.fn(),
    };
    render(<DataSettings client={client} />);
    await user.click(screen.getByTestId("data-export"));
    expect((await screen.findByTestId("data-status")).textContent).toContain("generations");
  });

  it("explains when the backend is unreachable instead of failing silently", async () => {
    const user = userEvent.setup();
    render(<DataSettings />);
    await user.click(screen.getByTestId("data-export"));
    expect((await screen.findByTestId("data-error")).textContent).toContain("backend");
  });
});

describe("retired routes", () => {
  it("redirects /profile and /inbox instead of rendering placeholders", () => {
    const app = readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    expect(app).toContain('path="/profile" element={<Navigate');
    expect(app).toContain('path="/inbox" element={<Navigate');
    // The placeholder that "reads ~/.nexus/profile.json once Phase 2 lands"
    // is gone; it never read anything.
    expect(app).not.toContain("ModulePlaceholder");
  });
});
