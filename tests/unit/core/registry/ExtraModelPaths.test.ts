import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  parseExtraModelPathsYaml,
  ExtraModelPathsIndex,
} from "../../../../core/registry/ExtraModelPaths.js";

describe("parseExtraModelPathsYaml", () => {
  it("parses a flat ComfyUI-style profile", () => {
    const yaml = [
      "comfyui:",
      "  base_path: /abs/comfyui",
      "  checkpoints: models/checkpoints",
      "  loras: models/loras",
    ].join("\n");
    const cfg = parseExtraModelPathsYaml(yaml);
    expect(cfg.profiles.size).toBe(1);
    const comfyui = cfg.profiles.get("comfyui");
    expect(comfyui?.basePath).toBe("/abs/comfyui");
    expect(comfyui?.categories.get("checkpoints")).toBe("models/checkpoints");
  });

  it("supports multiple profiles", () => {
    const yaml = [
      "comfyui:",
      "  base_path: /abs/a",
      "  checkpoints: ck",
      "other:",
      "  base_path: /abs/b",
      "  loras: lo",
    ].join("\n");
    const cfg = parseExtraModelPathsYaml(yaml);
    expect(cfg.profiles.size).toBe(2);
  });

  it("strips quoted strings", () => {
    const yaml = [
      "comfyui:",
      "  base_path: \"/abs/spaced path\"",
      "  checkpoints: 'models/ckpts'",
    ].join("\n");
    const cfg = parseExtraModelPathsYaml(yaml);
    expect(cfg.profiles.get("comfyui")?.basePath).toBe("/abs/spaced path");
    expect(cfg.profiles.get("comfyui")?.categories.get("checkpoints")).toBe("models/ckpts");
  });

  it("ignores comments and blank lines", () => {
    const yaml = [
      "# a comment",
      "",
      "comfyui:",
      "  # nested comment",
      "  base_path: /x",
      "  checkpoints: ck   # trailing",
    ].join("\n");
    const cfg = parseExtraModelPathsYaml(yaml);
    expect(cfg.profiles.get("comfyui")?.categories.get("checkpoints")).toBe("ck");
  });

  it("rejects a key without a profile header", () => {
    const yaml = ["  checkpoints: ck"].join("\n");
    expect(() => parseExtraModelPathsYaml(yaml)).toThrow(/profile/i);
  });

  it("rejects an inconsistent indent", () => {
    const yaml = ["a:", "  k1: v", "   k2: v2"].join("\n");
    expect(() => parseExtraModelPathsYaml(yaml)).toThrow(/indent/);
  });

  it("rejects a malformed header", () => {
    const yaml = ["bad-name"].join("\n");
    expect(() => parseExtraModelPathsYaml(yaml)).toThrow();
  });

  it("rejects empty profile name", () => {
    const yaml = [":"].join("\n");
    expect(() => parseExtraModelPathsYaml(yaml)).toThrow(/empty profile name/);
  });

  it("rejects a missing colon", () => {
    const yaml = ["a:", "  foo bar"].join("\n");
    expect(() => parseExtraModelPathsYaml(yaml)).toThrow(/expected 'key: value'/);
  });
});

describe("ExtraModelPathsIndex", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-yaml-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns [] when the yaml is missing", async () => {
    const idx = new ExtraModelPathsIndex({ yamlPath: path.join(tmp, "missing.yaml") });
    expect(await idx.list()).toEqual([]);
  });

  it("surfaces .safetensors files from a referenced directory", async () => {
    const externalDir = path.join(tmp, "ext", "models", "checkpoints");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "a.safetensors"), Buffer.alloc(10, 1));
    await fs.writeFile(path.join(externalDir, "b.ckpt"), Buffer.alloc(20, 2));
    await fs.writeFile(path.join(externalDir, "ignored.txt"), "not a model");
    const yamlPath = path.join(tmp, "extra_model_paths.yaml");
    await fs.writeFile(
      yamlPath,
      ["comfyui:", `  base_path: ${path.join(tmp, "ext")}`, "  checkpoints: models/checkpoints"].join("\n"),
    );
    const idx = new ExtraModelPathsIndex({ yamlPath });
    const list = await idx.list();
    expect(list.length).toBe(2);
    const names = list.map((e) => e.displayName).sort();
    expect(names).toEqual(["a.safetensors", "b.ckpt"]);
    expect(list.every((e) => e.profile === "comfyui")).toBe(true);
    expect(list.every((e) => e.category === "checkpoints")).toBe(true);
  });

  it("returns no entries when the referenced directory is missing", async () => {
    const yamlPath = path.join(tmp, "y.yaml");
    await fs.writeFile(yamlPath, ["a:", "  base_path: /nope/does/not/exist", "  checkpoints: ck"].join("\n"));
    const idx = new ExtraModelPathsIndex({ yamlPath });
    expect(await idx.list()).toEqual([]);
  });

  it("supports an absolute category value (no base_path)", async () => {
    const abs = path.join(tmp, "abs");
    await fs.mkdir(abs, { recursive: true });
    await fs.writeFile(path.join(abs, "x.gguf"), Buffer.from("model"));
    const yamlPath = path.join(tmp, "y.yaml");
    await fs.writeFile(yamlPath, ["p:", `  checkpoints: ${abs}`].join("\n"));
    const idx = new ExtraModelPathsIndex({ yamlPath });
    const list = await idx.list();
    expect(list.map((e) => e.displayName)).toEqual(["x.gguf"]);
  });
});
