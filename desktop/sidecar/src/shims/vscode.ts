/**
 * v2.2.0 Phase 8 -- `vscode` stub for the sidecar bundle.
 *
 * The sidecar reuses the coding runtime (`modules/coding/**`), which was
 * written for the VS Code extension and reaches `vscode` through its logger.
 * There is no VS Code process here, so the bundle could not resolve the module
 * at all and `npm run build:sidecar` failed outright. Since Phase 1 the
 * installer embeds `sidecar/dist` as a Tauri resource, so a sidecar that
 * cannot be built is a shipped app with no backend.
 *
 * Only the surface the logger actually touches is provided. Anything else is
 * deliberately absent: a broader fake would let extension-only code compile
 * here and fail at runtime instead of at the build.
 *
 * Output goes to STDERR on purpose. The sidecar's stdout carries the
 * line-delimited JSON-RPC stream, and a stray log line on stdout would corrupt
 * the protocol rather than merely being noisy.
 */

export interface OutputChannel {
  appendLine(value: string): void;
  append(value: string): void;
  clear(): void;
  dispose(): void;
  show(): void;
  hide(): void;
  readonly name: string;
}

function createOutputChannel(name: string): OutputChannel {
  return {
    name,
    appendLine(value: string): void {
      process.stderr.write(`[${name}] ${value}\n`);
    },
    append(value: string): void {
      process.stderr.write(value);
    },
    clear(): void {
      /* Nothing to clear: stderr is a stream, not a buffer we own. */
    },
    dispose(): void {
      /* The stream outlives any single channel. */
    },
    show(): void {
      /* No UI to reveal. */
    },
    hide(): void {
      /* No UI to hide. */
    },
  };
}

export const window = { createOutputChannel };

export default { window };
