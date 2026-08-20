import { describe, expect, it } from "vitest";

import { InMemorySettingsStore } from "../../core/storage/SettingsStore";
import { PARSE_DOCUMENT_SETTING_KEY } from "../../core/documents/parseDocumentEnabled";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";
import { IPC_METHODS, METHOD_SCHEMAS } from "../sidecar/src/protocol";

describe("coding.parseDocument settings IPC", () => {
  it("declares status and setEnabled", () => {
    expect(IPC_METHODS).toContain("coding.parseDocument.status");
    expect(IPC_METHODS).toContain("coding.parseDocument.setEnabled");
    expect(METHOD_SCHEMAS["coding.parseDocument.status"]?.implemented).toBe(true);
    expect(METHOD_SCHEMAS["coding.parseDocument.setEnabled"]?.implemented).toBe(true);
  });

  it("persists the opt-in on the injected settings store", async () => {
    const settings = new InMemorySettingsStore();
    const ctx = createHandlerContext({ pid: 1, platform: process.platform });
    ctx.settings = settings;
    const before = (await dispatch("coding.parseDocument.status", {}, ctx)) as { enabled: boolean };
    expect(before.enabled).toBe(false);
    const after = (await dispatch(
      "coding.parseDocument.setEnabled",
      { enabled: true },
      ctx,
    )) as { enabled: boolean };
    expect(after.enabled).toBe(true);
    expect(await settings.get<boolean>(PARSE_DOCUMENT_SETTING_KEY)).toBe(true);
    const status = (await dispatch("coding.parseDocument.status", {}, ctx)) as { enabled: boolean };
    expect(status.enabled).toBe(true);
  });
});
