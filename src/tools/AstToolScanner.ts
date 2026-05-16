import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { getLogger } from "../utils/logger.js";

/**
 * v0.8.0 Phase 5 sub-task 5.3 (item D2) -- AST-scanned tool registry.
 *
 * Walks `src/tools/handlers/**\/*.ts` and parses each file's TypeScript AST to
 * extract the exported symbols that look like tool handlers. The result is a
 * registry-shape independent map the central {@link ToolRegistryBuilder} can
 * cross-validate against: a handler module is only worth importing if its AST
 * advertises at least one class that implements `ToolHandler` (heuristic:
 * exported class that ends in `Tool` and has an `execute` method).
 *
 * Decoupling tool registration from import side effects: any module that does
 * not contain a real handler is skipped, so a stray file under `handlers/`
 * (helper, fixture, types) never triggers an eager import.
 */

export interface ScannedHandler {
  readonly className: string;
  readonly hasExecuteMethod: boolean;
  readonly isExported: boolean;
}

export interface ScannedModule {
  readonly filePath: string;
  readonly handlers: readonly ScannedHandler[];
  readonly registerCalls: readonly string[];
  readonly hasToolHandlerExports: boolean;
}

/**
 * Parse `filePath` and return the handler metadata. Returns null when the file
 * does not exist or cannot be read. Parse failures fall through with an empty
 * handler list and are logged at debug level.
 */
export function scanHandlerFile(filePath: string): ScannedModule | null {
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  return scanHandlerSource(filePath, source);
}

/**
 * Variant that accepts a raw source string. Exposed so the unit tests do not
 * have to round-trip through the filesystem.
 */
export function scanHandlerSource(filePath: string, source: string): ScannedModule {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
  } catch (err) {
    getLogger().debug(`[AstToolScanner] parse failed for ${filePath}:`, err);
    return {
      filePath,
      handlers: [],
      registerCalls: [],
      hasToolHandlerExports: false,
    };
  }

  const handlers: ScannedHandler[] = [];
  const registerCalls: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const isExported =
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const looksLikeHandler = /Tool$/.test(className);
      const hasExecuteMethod = node.members.some(
        (m): m is ts.MethodDeclaration =>
          ts.isMethodDeclaration(m) &&
          ts.isIdentifier(m.name) &&
          m.name.text === "execute",
      );
      if (looksLikeHandler) {
        handlers.push({ className, hasExecuteMethod, isExported });
      }
    }
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
        const callee = expr.name.text;
        if (/^register/.test(callee)) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteralLike(firstArg)) {
            registerCalls.push(firstArg.text);
          } else {
            registerCalls.push(callee);
          }
        }
      } else if (ts.isIdentifier(expr) && /^register/i.test(expr.text)) {
        registerCalls.push(expr.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  const hasToolHandlerExports = handlers.some((h) => h.isExported && h.hasExecuteMethod);
  return {
    filePath,
    handlers,
    registerCalls,
    hasToolHandlerExports,
  };
}

/**
 * Scan an entire directory recursively, returning one {@link ScannedModule}
 * entry per `.ts` file (excluding test files, type-only files, and the
 * scanner itself). The result is sorted by file path for deterministic
 * ordering across runs.
 */
export function scanHandlerDirectory(dir: string): ScannedModule[] {
  const out: ScannedModule[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.ts$/.test(entry.name)) continue;
      if (/\.test\.ts$/.test(entry.name)) continue;
      if (entry.name === "types.ts") continue;
      const scan = scanHandlerFile(full);
      if (scan) out.push(scan);
    }
  }
  out.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return out;
}

/**
 * Diagnostic helper: given a directory of handler modules and a list of names
 * the registry actually wires, return the modules with NO real handler
 * (candidates for skipping the import) plus a list of modules that have a
 * handler but were never wired (a registration miss).
 */
export interface RegistryDriftReport {
  readonly skippableModules: readonly string[];
  readonly unwiredHandlers: ReadonlyArray<{
    readonly filePath: string;
    readonly className: string;
  }>;
}

export function reportRegistryDrift(
  scans: readonly ScannedModule[],
  wiredClassNames: readonly string[],
): RegistryDriftReport {
  const wired = new Set(wiredClassNames);
  const skippable: string[] = [];
  const unwired: Array<{ filePath: string; className: string }> = [];
  for (const scan of scans) {
    if (!scan.hasToolHandlerExports) {
      skippable.push(scan.filePath);
      continue;
    }
    for (const handler of scan.handlers) {
      if (!handler.isExported || !handler.hasExecuteMethod) continue;
      if (!wired.has(handler.className)) {
        unwired.push({ filePath: scan.filePath, className: handler.className });
      }
    }
  }
  return { skippableModules: skippable, unwiredHandlers: unwired };
}
