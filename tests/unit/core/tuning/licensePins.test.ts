import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import {
  argvIncludesForbiddenExtra,
  loadUnslothPins,
  pipInstallArgs,
  UNSLOTH_PINS,
} from "../../../../core/tuning/licensePins.js";
import { pipInstallArgs as fromIndex } from "../../../../core/tuning/index.js";

describe("Unsloth pins", () => {
  it("pins Apache unsloth and LGPL zoo, never AGPL studio", () => {
    const pins = loadUnslothPins();
    expect(pins.provisioned.map((p) => p.name)).toEqual(["unsloth", "unsloth-zoo"]);
    expect(pins.provisioned[0]?.license).toBe("Apache-2.0");
    expect(pins.provisioned[0]?.version).toMatch(/^\d{4}\.\d+\.\d+$/);
    expect(pins.provisioned[1]?.license).toBe("LGPL-3.0-or-later");
    expect(pins.excluded.some((e) => e.license === "AGPL-3.0")).toBe(true);
    expect(pipInstallArgs()).toContain("unsloth==2026.8.18");
    expect(argvIncludesForbiddenExtra(["uv", "pip", "install", "unsloth[studio]"])).toBe(true);
    expect(argvIncludesForbiddenExtra(["uv", "pip", "install", ...pipInstallArgs()])).toBe(false);
    expect(fromIndex()).toEqual(pipInstallArgs());
  });

  it("matches the decision-record pins file", () => {
    const doc = readFileSync(
      path.resolve("docs/v2/v2.1/development/unsloth-license-boundary.md"),
      "utf8",
    );
    expect(doc).toContain("2026.8.18");
    expect(doc).toContain("2026.8.13");
    expect(doc).toContain("Apache-2.0");
    expect(doc).toContain("LGPL-3.0-or-later");
    expect(doc).toMatch(/required AGPL component:\s+\*\*none\*\*/i);
    expect(UNSLOTH_PINS.verifiedOn).toBe("2026-08-20");
  });
});
