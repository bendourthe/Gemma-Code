import { describe, expect, it, vi } from "vitest";

const setTreeSitterWasmDir = vi.fn();
const initTreeSitter = vi.fn(async () => true);

vi.mock("../../../core/codegraph/scanner/TreeSitterScanner.js", () => ({
  setTreeSitterWasmDir,
  initTreeSitter,
}));

describe("warmUpTreeSitter", () => {
  it("points the scanner at the bundled wasm dir and reports init success", async () => {
    const { bundledWasmDir, warmUpTreeSitter } = await import("./treeSitterWarmup");
    const dir = bundledWasmDir();
    expect(dir.replace(/\\/g, "/")).toMatch(/wasm$/);
    await expect(warmUpTreeSitter("/tmp/wasm")).resolves.toBe(true);
    expect(setTreeSitterWasmDir).toHaveBeenCalledWith("/tmp/wasm");
    expect(initTreeSitter).toHaveBeenCalled();
  });
});
