import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  downloadAndUnzipVSCode,
  runTests,
  runVSCodeCommand,
} from "@vscode/test-electron";

const VS_CODE_VERSION = "1.134.0";
const ELECTRON_VERSION = "42.8.1";
const NODE_MODULE_VERSION = "146";
const DOWNLOAD_PLATFORM = "win32-x64-archive";
const VSIX_TARGET = "win32-x64";
const EXTENSION_ID = "nexus-coding.nexus-coding";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const TEST_SUITE_PATH = path.join(
  REPO_ROOT,
  "tests",
  "e2e",
  "vsix-runtime",
  "suite.cjs",
);
const DOWNLOAD_CACHE_PATH = path.join(REPO_ROOT, ".vscode-test");
const localRequire = createRequire(import.meta.url);
const runnerRequire = createRequire(
  localRequire.resolve("@vscode/test-electron/package.json"),
);
const JSZip = runnerRequire("jszip");

function fail(message) {
  throw new Error(`[vsix-runtime] ${message}`);
}

function parseArgs(argv) {
  let vsixPath;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--vsix") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        fail("--vsix requires a file path.");
      }
      vsixPath = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: npm run test:vsix-runtime -- [--vsix <nexus-coding-VERSION-win32-x64.vsix>]",
      );
      process.exit(0);
    }
    fail(`Unknown argument: ${argument}`);
  }

  return { vsixPath };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function readVsixTarget(vsixPath) {
  const archive = await JSZip.loadAsync(await readFile(vsixPath));
  const manifestEntry = archive.file("extension.vsixmanifest");
  if (!manifestEntry) {
    fail("VSIX is missing extension.vsixmanifest.");
  }
  const manifest = await manifestEntry.async("string");
  const targetMatch = manifest.match(/\bTargetPlatform="([^"]+)"/);
  if (!targetMatch) {
    fail("VSIX manifest is missing TargetPlatform.");
  }
  return targetMatch[1];
}

async function findInstalledExtension(extensionsDir, expectedVersion) {
  const matches = [];
  const entries = await readdir(extensionsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const extensionPath = path.join(extensionsDir, entry.name);
    const manifestPath = path.join(extensionPath, "package.json");
    try {
      const manifest = await readJson(manifestPath);
      const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
      if (id === EXTENSION_ID && manifest.version === expectedVersion) {
        matches.push({ extensionPath, manifest });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (matches.length !== 1) {
    fail(
      `Expected exactly one installed ${EXTENSION_ID}@${expectedVersion}, found ${matches.length}.`,
    );
  }

  return matches[0];
}

async function assertVsixInstallRegistry(extensionsDir, expectedVersion) {
  const registry = await readJson(path.join(extensionsDir, "extensions.json"));
  const matches = registry.filter(
    (entry) =>
      entry.identifier?.id?.toLowerCase() === EXTENSION_ID &&
      entry.version === expectedVersion,
  );
  if (matches.length !== 1) {
    fail(
      `Expected one ${EXTENSION_ID}@${expectedVersion} registry entry, found ${matches.length}.`,
    );
  }
  if (matches[0].metadata?.source !== "vsix") {
    fail(`Extension registry source is ${matches[0].metadata?.source ?? "missing"}, not vsix.`);
  }
}

async function collectLogText(root) {
  const chunks = [];

  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const details = await stat(entryPath);
      if (details.size > 10 * 1024 * 1024) {
        continue;
      }
      chunks.push(await readFile(entryPath, "utf8"));
    }
  }

  await visit(root);
  return chunks.join("\n");
}

function assertHealthyLogs(logText) {
  const failurePatterns = [
    /Activation failed; starting in safe mode/i,
    /Safe-mode fallbacks registered/i,
    /NODE_MODULE_VERSION/i,
    /compiled against a different Node\.js version/i,
    /ERR_DLOPEN_FAILED/i,
    /\[Nexus Code\] Unhandled promise rejection/i,
  ];
  const failure = failurePatterns.find((pattern) => pattern.test(logText));
  if (failure) {
    fail(`VS Code logs matched forbidden runtime pattern ${failure}.`);
  }
  if (!logText.includes("[Nexus Code] Daemon discovery:")) {
    fail("VS Code logs did not contain the Nexus Code activation marker.");
  }
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail(
      `The ${VSIX_TARGET} smoke must run on win32-x64, not ${process.platform}-${process.arch}.`,
    );
  }

  const rootManifest = await readJson(path.join(REPO_ROOT, "package.json"));
  const expectedFilename = `nexus-coding-${rootManifest.version}-${VSIX_TARGET}.vsix`;
  const { vsixPath: requestedVsixPath } = parseArgs(process.argv.slice(2));
  const vsixPath = path.resolve(REPO_ROOT, requestedVsixPath ?? expectedFilename);
  if (path.basename(vsixPath) !== expectedFilename) {
    fail(`Expected target-qualified artifact name ${expectedFilename}.`);
  }
  await access(vsixPath);
  const vsixTarget = await readVsixTarget(vsixPath);
  if (vsixTarget !== VSIX_TARGET) {
    fail(`VSIX manifest target is ${vsixTarget}; expected ${VSIX_TARGET}.`);
  }

  const isolatedRoot = await mkdtemp(path.join(tmpdir(), "nexus-vsix-runtime-"));
  const userDataDir = path.join(isolatedRoot, "user-data");
  const extensionsDir = path.join(isolatedRoot, "extensions");
  const workspaceDir = path.join(isolatedRoot, "workspace");
  const resultPath = path.join(isolatedRoot, "result.json");
  await Promise.all([
    mkdir(userDataDir, { recursive: true }),
    mkdir(extensionsDir, { recursive: true }),
    mkdir(workspaceDir, { recursive: true }),
    mkdir(DOWNLOAD_CACHE_PATH, { recursive: true }),
  ]);

  try {
    await runVSCodeCommand(
      [
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        "--install-extension",
        vsixPath,
        "--force",
      ],
      {
        version: VS_CODE_VERSION,
        platform: DOWNLOAD_PLATFORM,
        cachePath: DOWNLOAD_CACHE_PATH,
      },
    );

    const installed = await findInstalledExtension(
      extensionsDir,
      rootManifest.version,
    );
    await assertVsixInstallRegistry(extensionsDir, rootManifest.version);
    if (installed.manifest.engines?.vscode !== VS_CODE_VERSION) {
      fail(
        `Installed manifest engines.vscode is ${installed.manifest.engines?.vscode}; expected ${VS_CODE_VERSION}.`,
      );
    }
    const vscodeExecutablePath = await downloadAndUnzipVSCode({
      version: VS_CODE_VERSION,
      platform: DOWNLOAD_PLATFORM,
      cachePath: DOWNLOAD_CACHE_PATH,
    });
    const installedExtensionPath = await realpath(installed.extensionPath);

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: installedExtensionPath,
      extensionTestsPath: TEST_SUITE_PATH,
      extensionTestsEnv: {
        NEXUS_VSIX_SMOKE_EXTENSION_PATH: installedExtensionPath,
        NEXUS_VSIX_SMOKE_RESULT_PATH: resultPath,
        NEXUS_VSIX_SMOKE_VSCODE_VERSION: VS_CODE_VERSION,
        NEXUS_VSIX_SMOKE_ELECTRON_VERSION: ELECTRON_VERSION,
        NEXUS_VSIX_SMOKE_NODE_MODULE_VERSION: NODE_MODULE_VERSION,
        NEXUS_VSIX_SMOKE_EXTENSION_VERSION: rootManifest.version,
      },
      launchArgs: [
        workspaceDir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        "--telemetry-level=off",
      ],
    });

    const result = await readJson(resultPath);
    if (result.success !== true) {
      fail(`Extension-host suite did not report success: ${result.error ?? "unknown error"}.`);
    }
    if ((await realpath(result.extensionPath)) !== installedExtensionPath) {
      fail("Extension-host suite did not activate the CLI-installed VSIX contents.");
    }

    const logText = await collectLogText(path.join(userDataDir, "logs"));
    assertHealthyLogs(logText);

    console.log(
      `[vsix-runtime] PASS ${EXTENSION_ID}@${rootManifest.version} on VS Code ${result.vscodeVersion} / Electron ${result.electronVersion} / ABI ${result.nodeModuleVersion}.`,
    );
    console.log(`[vsix-runtime] VSIX SHA-256 ${await sha256(vsixPath)}.`);
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
