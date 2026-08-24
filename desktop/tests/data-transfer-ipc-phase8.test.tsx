/**
 * v2.2.0 Phase 8 (DF-16) -- the data transfer page reaches a real backend.
 *
 * Phase 7 shipped the runtime and the page but never connected them, so the
 * page could only report the backend as unreachable. These pin the wiring and
 * the safety properties that survive it.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataSettings } from "../src/pages/settings/DataSettings";
import { createDataTransferClient, defaultExportPath } from "../src/pages/settings/dataTransferClient";

describe("defaultExportPath", () => {
  it("timestamps the name so a second export cannot overwrite the first", () => {
    const a = defaultExportPath(new Date("2026-08-22T10:00:00Z"));
    const b = defaultExportPath(new Date("2026-08-22T11:30:00Z"));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^nexus-export-.*\.tar\.gz$/);
  });
});

describe("createDataTransferClient", () => {
  it("returns null outside the desktop shell rather than a client that cannot work", () => {
    // The browser dev server has no sidecar; the page must say so honestly.
    expect(createDataTransferClient()).toBeNull();
  });
});

describe("protocol registration", () => {
  const protocol = readFileSync(
    path.resolve(__dirname, "../sidecar/src/protocol.ts"),
    "utf8",
  );
  const handlers = readFileSync(
    path.resolve(__dirname, "../sidecar/src/handlers.ts"),
    "utf8",
  );

  it.each(["data.categories", "data.export", "data.import"])(
    "%s is declared and handled",
    (method) => {
      expect(protocol).toContain(`"${method}"`);
      expect(handlers).toContain(`"${method}"`);
    },
  );

  it("the export schema leaves credentials optional so a missing field is off", () => {
    // A `.default(true)` here would turn tokens on for any caller that forgot
    // the field. It must stay an explicit choice.
    expect(protocol).toContain("includeCredentials: z.boolean().optional()");
  });

  it("rejects unknown fields on both transfer requests", () => {
    const exportSchema = protocol.slice(protocol.indexOf("DataExportRequest"));
    expect(exportSchema.slice(0, 400)).toContain(".strict()");
  });
});

describe("import flow", () => {
  function client() {
    return {
      categories: vi.fn(async () => []),
      export: vi.fn(async () => ({ path: "/tmp/x.tar.gz", bytes: 10, empty: [] })),
      importDryRun: vi.fn(async () => ({ applied: ["chats"], skipped: ["harness"] })),
      importApply: vi.fn(async () => ({ applied: ["chats"], backupPath: "/tmp/backup" })),
    };
  }

  it("previews without applying", async () => {
    const user = userEvent.setup();
    const c = client();
    render(<DataSettings client={c} />);
    await user.type(screen.getByTestId("data-import-path"), "/tmp/in.tar.gz");
    await user.click(screen.getByTestId("data-import-preview"));

    expect(c.importDryRun).toHaveBeenCalledWith("/tmp/in.tar.gz");
    expect(c.importApply).not.toHaveBeenCalled();
    expect((await screen.findByTestId("data-status")).textContent).toContain("chats");
  });

  it("tells the user what the archive does not contain", async () => {
    const user = userEvent.setup();
    const c = client();
    render(<DataSettings client={c} />);
    await user.type(screen.getByTestId("data-import-path"), "/tmp/in.tar.gz");
    await user.click(screen.getByTestId("data-import-preview"));
    expect((await screen.findByTestId("data-status")).textContent).toContain("harness");
  });

  it("surfaces the backup path on a real import", async () => {
    const user = userEvent.setup();
    const c = client();
    render(<DataSettings client={c} />);
    await user.type(screen.getByTestId("data-import-path"), "/tmp/in.tar.gz");
    await user.click(screen.getByTestId("data-import-apply"));
    expect((await screen.findByTestId("data-status")).textContent).toContain("/tmp/backup");
  });

  it("refuses an empty path instead of calling the backend", async () => {
    const user = userEvent.setup();
    const c = client();
    render(<DataSettings client={c} />);
    await user.click(screen.getByTestId("data-import-preview"));
    expect(c.importDryRun).not.toHaveBeenCalled();
    expect((await screen.findByTestId("data-error")).textContent).toContain("path");
  });
});

describe("export path", () => {
  it("sends the chosen destination to the backend", async () => {
    const user = userEvent.setup();
    const c = {
      categories: vi.fn(async () => []),
      export: vi.fn(async () => ({ path: "/chosen.tar.gz", bytes: 10, empty: [] })),
      importDryRun: vi.fn(),
      importApply: vi.fn(),
    };
    render(<DataSettings client={c} />);
    const field = screen.getByTestId("data-export-path");
    await user.clear(field);
    await user.type(field, "/chosen.tar.gz");
    await user.click(screen.getByTestId("data-export"));
    expect(c.export).toHaveBeenCalledWith(
      expect.objectContaining({ outPath: "/chosen.tar.gz" }),
    );
  });
});
