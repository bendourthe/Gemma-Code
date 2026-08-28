const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { realpath, writeFile } = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

const EXTENSION_ID = "nexus-coding.nexus-coding";

function requiredEnvironment(name) {
  const value = process.env[name];
  assert.ok(value, `Missing required environment variable ${name}.`);
  return value;
}

function serializeError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function run() {
  const expectedExtensionPath = requiredEnvironment(
    "NEXUS_VSIX_SMOKE_EXTENSION_PATH",
  );
  const resultPath = requiredEnvironment("NEXUS_VSIX_SMOKE_RESULT_PATH");
  const expectedVSCodeVersion = requiredEnvironment(
    "NEXUS_VSIX_SMOKE_VSCODE_VERSION",
  );
  const expectedElectronVersion = requiredEnvironment(
    "NEXUS_VSIX_SMOKE_ELECTRON_VERSION",
  );
  const expectedNodeModuleVersion = requiredEnvironment(
    "NEXUS_VSIX_SMOKE_NODE_MODULE_VERSION",
  );
  const expectedExtensionVersion = requiredEnvironment(
    "NEXUS_VSIX_SMOKE_EXTENSION_VERSION",
  );
  const result = { success: false };

  try {
    assert.equal(vscode.version, expectedVSCodeVersion, "Unexpected VS Code version.");
    assert.equal(
      process.versions.electron,
      expectedElectronVersion,
      "Unexpected Electron version.",
    );
    assert.equal(
      process.versions.modules,
      expectedNodeModuleVersion,
      "Unexpected Node module ABI.",
    );

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension ${EXTENSION_ID} is not installed.`);
    assert.equal(
      await realpath(extension.extensionPath),
      await realpath(expectedExtensionPath),
      "VS Code loaded a different extension directory.",
    );
    assert.equal(
      extension.packageJSON.version,
      expectedExtensionVersion,
      "Unexpected extension version.",
    );
    const extensionRequire = createRequire(
      path.join(extension.extensionPath, "package.json"),
    );
    const Database = extensionRequire("better-sqlite3");
    const database = new Database(":memory:");
    try {
      const row = database.prepare("SELECT 42 AS value").get();
      assert.equal(row.value, 42, "Packaged better-sqlite3 query failed.");
    } finally {
      database.close();
    }

    await extension.activate();
    assert.equal(extension.isActive, true, "Nexus Code did not activate.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("nexus.coding.newChat"),
      "Activated extension did not register nexus.coding.newChat.",
    );

    Object.assign(result, {
      success: true,
      extensionPath: extension.extensionPath,
      extensionVersion: extension.packageJSON.version,
      vscodeVersion: vscode.version,
      electronVersion: process.versions.electron,
      nodeModuleVersion: process.versions.modules,
    });
  } catch (error) {
    result.error = serializeError(error);
    throw error;
  } finally {
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
}

module.exports = { run };
