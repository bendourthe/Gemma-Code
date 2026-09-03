/**
 * v2.4.6 Phase 1 -- desktop payload identity reader.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  desktopPayloadPath,
  formatDesktopPayloadLabel,
  parseDesktopPayloadIdentity,
  readDesktopPayloadIdentity,
} from "../../../../core/storage/desktopPayload.js";

describe("desktopPayloadPath", () => {
  it("resolves under ~/.nexus/desktop-payload.json", () => {
    expect(desktopPayloadPath(() => path.join(path.sep, "home", "u"))).toBe(
      path.join(path.sep, "home", "u", ".nexus", "desktop-payload.json"),
    );
  });
});

describe("formatDesktopPayloadLabel", () => {
  it("shows version and a 12-char hash", () => {
    expect(
      formatDesktopPayloadLabel({
        version: "2.4.1",
        sha256: "abcdef0123456789ffff",
      }),
    ).toBe("Desktop payload 2.4.1 (abcdef012345)");
  });

  it("shows unknown when the sidecar has nothing to read", () => {
    expect(formatDesktopPayloadLabel(null)).toBe("Desktop payload unknown");
    expect(formatDesktopPayloadLabel({ version: "", sha256: "" })).toBe(
      "Desktop payload unknown",
    );
  });
});

describe("readDesktopPayloadIdentity", () => {
  it("returns null for a missing file", () => {
    expect(
      readDesktopPayloadIdentity(path.join(os.tmpdir(), "nexus-missing-payload.json")),
    ).toBeNull();
  });

  it("reads a fixture that matches the installer manifest fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-payload-"));
    const file = path.join(dir, "desktop-payload.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: "2.4.1",
        sha256: "AB" + "cd".repeat(31),
        original_name: "Nexus AI Studio_2.4.1_x64-setup.exe",
      }),
    );
    const identity = readDesktopPayloadIdentity(file);
    expect(identity).toEqual({
      version: "2.4.1",
      sha256: ("ab" + "cd".repeat(31)).toLowerCase(),
      originalName: "Nexus AI Studio_2.4.1_x64-setup.exe",
    });
    expect(formatDesktopPayloadLabel(identity)).toBe(
      `Desktop payload 2.4.1 (${identity!.sha256.slice(0, 12)})`,
    );
  });

  it("rejects a body without sha256", () => {
    expect(parseDesktopPayloadIdentity({ version: "2.4.1" })).toBeNull();
  });
});
