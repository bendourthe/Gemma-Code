import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  VIDEO2X_ENV_KEY,
  VIDEO2X_SETTING_KEY,
  VIDEO_ENHANCEMENT_PRESETS,
  VIDEO_ENHANCEMENT_SUPPORT,
  expectedVideoEnhancementGeometry,
  videoEnhancementCapabilityCopy,
} from "../../../core/video/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const SUPPORT_JSON = join(
  REPO_ROOT,
  "core/video/video-enhancement-support.json",
);
const ADAPTER = join(
  REPO_ROOT,
  "desktop/sidecar/src/video/Video2xAdapter.ts",
);
const PANEL = join(
  REPO_ROOT,
  "desktop/src/modules/video/VideoEnhancementPanel.tsx",
);
const VIDEO_SETTINGS = join(
  REPO_ROOT,
  "desktop/src/pages/settings/VideoSettings.tsx",
);
const INSTALLER_SUPPORT = join(
  REPO_ROOT,
  "scripts/installer/src/nexus_installer/video_enhancement_support.py",
);
const CONFIGURATION = join(
  REPO_ROOT,
  "scripts/installer/src/nexus_installer/pages/configuration.py",
);
const COMPLETE = join(
  REPO_ROOT,
  "scripts/installer/src/nexus_installer/pages/complete.py",
);
const CATALOG = join(REPO_ROOT, "core/registry/catalog.json");
const HANDOFF = join(
  REPO_ROOT,
  "docs/v2/v2.3/development/nexus-hub-security-audit-handoff.md",
);
const BENCH = join(REPO_ROOT, "scripts/bench-video-enhancement.mjs");
const BASELINE = join(
  REPO_ROOT,
  "docs/v2/v2.3/benchmarks/video-enhancement-baseline.md",
);

const DOWNLOAD_PATTERN =
  /github\.com\/k4yt3x\/video2x\/releases\/download|video2x.*auto[- ]?download|downloadAndInstallVideo2x/i;
const BINARY_NAMES = new Set([
  "video2x.exe",
  "video2x",
  "video2x.AppImage",
  "libvideo2x.dll",
  "libvideo2x.so",
]);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function walkFiles(root: string, files: string[] = []): string[] {
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "out" ||
        entry.name === "dist" ||
        entry.name === "__pycache__"
      ) {
        continue;
      }
      walkFiles(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

describe("video enhancement support geometry", () => {
  it("scales and interpolates from the preset registry", () => {
    const source = {
      width: 854,
      height: 480,
      frameRate: { numerator: 24, denominator: 1 },
      durationSeconds: 0.333333,
      frameCount: 8,
    };
    expect(
      expectedVideoEnhancementGeometry(source, {
        upscalePreset: "animation-upscale-2x",
      }),
    ).toMatchObject({ width: 1708, height: 960, frameCount: 8 });
    expect(
      expectedVideoEnhancementGeometry(source, {
        interpolationPreset: "smooth-2x",
      }),
    ).toMatchObject({
      width: 854,
      height: 480,
      frameCount: 16,
      frameRate: { numerator: 48, denominator: 1 },
    });
    expect(VIDEO_ENHANCEMENT_PRESETS["general-upscale-4x"].scaleFactor).toBe(4);
    expect(
      expectedVideoEnhancementGeometry(
        {
          width: 1280,
          height: 720,
          frameRate: { numerator: 24, denominator: 1 },
          durationSeconds: 0.333333,
        },
        { upscalePreset: "general-upscale-4x", interpolationPreset: "smooth-2x" },
      ),
    ).toMatchObject({
      width: 5120,
      height: 2880,
      frameCount: 16,
      frameRate: { numerator: 48, denominator: 1 },
    });
  });

  it("returns shared capability copy and a fallback for unknown reasons", () => {
    expect(videoEnhancementCapabilityCopy("missing_configuration")).toBe(
      VIDEO_ENHANCEMENT_SUPPORT.capabilityCopy.missing_configuration,
    );
    expect(videoEnhancementCapabilityCopy("not-a-reason")).toBe(
      "Video enhancement is unavailable on this host.",
    );
  });
});

describe("video enhancement packaging parity", () => {
  it("keeps installer, desktop, env, and setting names on one contract", () => {
    const contract = JSON.parse(read(SUPPORT_JSON)) as {
      envKey: string;
      settingKey: string;
      installerNote: string;
      setupCopy: string;
      capabilityCopy: Record<string, string>;
    };
    expect(contract.envKey).toBe(VIDEO2X_ENV_KEY);
    expect(contract.settingKey).toBe(VIDEO2X_SETTING_KEY);
    expect(VIDEO_ENHANCEMENT_SUPPORT.envKey).toBe("NEXUS_VIDEO2X_PATH");
    expect(VIDEO_ENHANCEMENT_SUPPORT.settingKey).toBe("video.video2xPath");

    expect(read(ADAPTER)).toContain("VIDEO2X_ENV_KEY");
    expect(read(ADAPTER)).toContain("VIDEO2X_SETTING_KEY");
    expect(read(ADAPTER)).toContain('from "../../../../core/video/index.js"');
    expect(read(PANEL)).toContain("videoEnhancementCapabilityCopy");
    expect(read(VIDEO_SETTINGS)).toContain("VIDEO_ENHANCEMENT_SUPPORT.setupCopy");
    expect(read(VIDEO_SETTINGS)).toContain("Settings > Video");

    const installer = read(INSTALLER_SUPPORT);
    expect(installer).toContain(`ENV_KEY = "${contract.envKey}"`);
    expect(installer).toContain(`SETTING_KEY = "${contract.settingKey}"`);
    expect(installer).toContain("never installed by this wizard");
    expect(installer).toContain("does not download, bundle, or search");
    expect(read(CONFIGURATION)).not.toContain("INSTALLER_NOTE");
    expect(read(COMPLETE)).toContain("INSTALLER_NOTE");
    expect(read(CONFIGURATION)).not.toMatch(/Install Video2X/i);
    expect(read(CONFIGURATION)).not.toMatch(/download.*Video2X/i);

    expect(contract.capabilityCopy.missing_configuration).toBe(
      "Configure a local Video2X executable in Settings.",
    );
    expect(read(PANEL)).toContain("videoEnhancementCapabilityCopy");
  });

  it("does not bundle Video2X, AGPL source, an automatic download, or Qwen3.8", () => {
    const catalog = read(CATALOG).toLowerCase();
    expect(catalog).not.toContain("qwen3.8-flash-next");

    const runtimeRoots = [
      join(REPO_ROOT, "desktop/sidecar/src"),
      join(REPO_ROOT, "desktop/src"),
      join(REPO_ROOT, "scripts/installer/src"),
      join(REPO_ROOT, "scripts/bench-video-enhancement.mjs"),
    ];
    const hits: string[] = [];
    for (const root of runtimeRoots) {
      const files = existsSync(root) && !root.endsWith(".mjs")
        ? walkFiles(root)
        : [root];
      for (const file of files) {
        const name = file.split(/[/\\]/).pop() ?? "";
        if (BINARY_NAMES.has(name)) {
          hits.push(`binary:${relative(REPO_ROOT, file)}`);
        }
        if (!/\.(ts|tsx|py|mjs|json)$/.test(file)) continue;
        const body = read(file);
        if (DOWNLOAD_PATTERN.test(body)) {
          hits.push(`download:${relative(REPO_ROOT, file)}`);
        }
        if (
          /GNU AFFERO GENERAL PUBLIC LICENSE/.test(body) &&
          /video2x/i.test(body)
        ) {
          hits.push(`agpl:${relative(REPO_ROOT, file)}`);
        }
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("records the Hub handoff as not released and keeps the baseline honest", () => {
    const handoff = read(HANDOFF);
    expect(handoff).toContain("implementation not started, not released");
    const baseline = read(BASELINE);
    expect(baseline).toContain("not proven here");
    expect(baseline).toContain(VIDEO2X_ENV_KEY);
    expect(baseline).toContain(VIDEO2X_SETTING_KEY);
    expect(baseline).toContain("fake-deterministic");
  });

  it("runs the fake-backend benchmark without overwriting another output dir", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "nexus-video-enh-pack-"));
    try {
      const stdout = execFileSync(process.execPath, [BENCH, "--backend", "fake", "--output-dir", outputDir], {
        encoding: "utf8",
        cwd: REPO_ROOT,
      });
      const summary = JSON.parse(stdout) as {
        cases: number;
        failed: number;
      };
      expect(summary.cases).toBe(8);
      expect(summary.failed).toBe(0);
      const report = JSON.parse(read(join(outputDir, "results.json"))) as {
        backendMode: string;
        cases: Array<{
          validation: { ok: boolean };
          source: { sha256: string };
          output: { width: number; height: number; frameCount: number };
        }>;
      };
      expect(report.backendMode).toBe("fake");
      expect(report.cases).toHaveLength(8);
      for (const item of report.cases) {
        expect(item.validation.ok).toBe(true);
        expect(item.source.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(item.output.frameCount).toBeGreaterThan(0);
      }
      expect(() =>
        execFileSync(
          process.execPath,
          [BENCH, "--backend", "fake", "--output-dir", outputDir],
          { encoding: "utf8", cwd: REPO_ROOT },
        ),
      ).toThrow();
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
