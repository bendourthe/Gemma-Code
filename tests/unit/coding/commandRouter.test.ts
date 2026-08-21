import { describe, it, expect } from "vitest";
import { classifyShortImperative } from "../../../modules/coding/routing/commandRouter.js";
import { runCodeAsAction } from "../../../core/project/codeAsAction.js";

describe("classifyShortImperative", () => {
  it("abstains unless enabled", () => {
    expect(classifyShortImperative("run tests")).toBeNull();
  });

  it("maps a short test command when enabled", () => {
    const routed = classifyShortImperative("run the tests", { enabled: true });
    expect(routed?.tool).toBe("run_terminal");
    expect(routed?.parameters.command).toBe("npm test");
  });

  it("abstains on long or multiline text", () => {
    expect(
      classifyShortImperative("run tests\nand then deploy", { enabled: true }),
    ).toBeNull();
  });
});

describe("runCodeAsAction", () => {
  it("fails closed when disabled", () => {
    expect(runCodeAsAction({ source: "1+1" }).deny).toBe("disabled");
  });

  it("rejects network and fs even when enabled", () => {
    expect(runCodeAsAction({ source: "x", enabled: true, allowNetwork: true }).deny).toBe(
      "network",
    );
    expect(runCodeAsAction({ source: "x", enabled: true, allowFs: true }).deny).toBe("fs");
  });
});
