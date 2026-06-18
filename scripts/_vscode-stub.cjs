/**
 * Minimal `vscode` API stub for running COMPILED extension modules in plain
 * Node -- specifically the `scripts/run-panel-ab.mjs` local A/B benchmark.
 *
 * Several modules in the compiled `out/` tree (notably
 * `modules/coding/utils/logger.js` and `modules/coding/config/settings.js`)
 * `require('vscode')` at import time. That bare specifier only resolves inside
 * the VS Code extension host, so importing those modules from a standalone
 * Node script throws `Cannot find module 'vscode'`. This is the same editor
 * coupling the vitest suite already neutralizes with a `vscode` mock alias;
 * this `--require` preload is the plain-Node equivalent.
 *
 * It installs a tolerant Proxy as the resolved `vscode` module so any property
 * access, call, or construction is a benign no-op. The benchmark never needs
 * real editor behavior -- it only needs the modules to load and the logger to
 * stay silent. Do NOT ship this; it is a local benchmark-only helper.
 *
 * Usage: node --require ./scripts/_vscode-stub.cjs scripts/run-panel-ab.mjs
 */
const Module = require("node:module");

function noopProxy() {
  const target = function () {
    return noopProxy();
  };
  return new Proxy(target, {
    get(_t, prop) {
      // Never masquerade as a thenable (so `await stub` does not hang) and give
      // string coercions an empty string instead of a proxy.
      if (prop === "then") return undefined;
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return undefined;
      return noopProxy();
    },
    apply() {
      return noopProxy();
    },
    construct() {
      return noopProxy();
    },
  });
}

const vscodeStub = noopProxy();
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
