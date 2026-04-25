import * as fs from "fs";
import * as path from "path";
import { formatForUser } from "../utils/errors.js";
import type {
  ToolHandler,
  ToolResult,
  TailOutputParams,
  GrepOutputParams,
} from "./types.js";

/** Result returned when output is redirected to a file. */
export interface RedirectedResult {
  readonly redirectedPath: string;
  readonly summary: string;
  readonly lineCount: number;
  readonly charCount: number;
}

const PREVIEW_CHARS = 500;
const OUTPUT_SUBDIR = ".gemma-code-output";

/**
 * Redirects large tool results to temporary workspace files and provides
 * helper tools (tail_output, grep_output) for the model to read subsets.
 */
export class OutputRedirector {
  private readonly _outputDir: string;

  constructor(
    workspaceRoot: string,
    private readonly _charThreshold: number = 5000,
  ) {
    this._outputDir = path.join(workspaceRoot, OUTPUT_SUBDIR);
  }

  /** Returns true when the output exceeds the character threshold. */
  shouldRedirect(output: string): boolean {
    return output.length > this._charThreshold;
  }

  /**
   * Write the full output to a file and return a summary pointer.
   * On write failure, returns null so the caller can fall back to the original output.
   */
  redirect(toolName: string, callId: string, output: string): RedirectedResult | null {
    try {
      if (!fs.existsSync(this._outputDir)) {
        fs.mkdirSync(this._outputDir, { recursive: true });
      }

      const filePath = path.join(this._outputDir, `${callId}.txt`);
      fs.writeFileSync(filePath, output, "utf-8");

      const lineCount = output.split("\n").length;
      const charCount = output.length;
      const preview = output.slice(0, PREVIEW_CHARS);
      const summary =
        `[Output redirected to ${filePath}] (${lineCount} lines, ${charCount} chars)\n\n` +
        `Preview (first ${PREVIEW_CHARS} chars):\n${preview}\n\n` +
        "Use tail_output or grep_output to read specific parts.";

      return { redirectedPath: filePath, summary, lineCount, charCount };
    } catch {
      return null;
    }
  }

  /** Read the last N lines from a redirected output file. */
  readTail(filePath: string, lines: number): string {
    const content = fs.readFileSync(filePath, "utf-8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  }

  /** Search a redirected file for regex matches, returning lines with numbers. */
  grepOutput(filePath: string, pattern: string, maxResults: number): string {
    const content = fs.readFileSync(filePath, "utf-8");
    const regex = new RegExp(pattern, "g");
    const allLines = content.split("\n");
    const matches: string[] = [];

    for (let i = 0; i < allLines.length && matches.length < maxResults; i++) {
      if (regex.test(allLines[i]!)) {
        matches.push(`${i + 1}: ${allLines[i]}`);
      }
      // Reset lastIndex for global regex per line.
      regex.lastIndex = 0;
    }

    return matches.length > 0
      ? matches.join("\n")
      : `No matches found for pattern: ${pattern}`;
  }

  /** Remove all files in the output directory. */
  cleanup(): void {
    try {
      if (fs.existsSync(this._outputDir)) {
        const files = fs.readdirSync(this._outputDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this._outputDir, file));
        }
      }
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Tool handler that reads the last N lines from a redirected output file.
 */
export class TailOutputTool implements ToolHandler {
  constructor(private readonly _redirector: OutputRedirector) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const params = parameters as unknown as TailOutputParams;

    if (typeof params.path !== "string" || params.path.length === 0) {
      return { id, success: false, output: "", error: "Missing required parameter: path" };
    }

    const lines = typeof params.lines === "number" ? params.lines : 50;

    try {
      const content = this._redirector.readTail(params.path, lines);
      return {
        id,
        success: true,
        output: JSON.stringify({ content, lines: content.split("\n").length }),
      };
    } catch (err) {
      return {
        id,
        success: false,
        output: "",
        error: formatForUser(err),
      };
    }
  }
}

/**
 * Tool handler that searches a redirected output file for regex matches.
 */
export class GrepOutputTool implements ToolHandler {
  constructor(private readonly _redirector: OutputRedirector) {}

  async execute(parameters: Record<string, unknown>): Promise<ToolResult> {
    const id = (parameters["_callId"] as string | undefined) ?? "";
    const params = parameters as unknown as GrepOutputParams;

    if (typeof params.path !== "string" || params.path.length === 0) {
      return { id, success: false, output: "", error: "Missing required parameter: path" };
    }
    if (typeof params.pattern !== "string" || params.pattern.length === 0) {
      return { id, success: false, output: "", error: "Missing required parameter: pattern" };
    }

    const maxResults = typeof params.max_results === "number" ? params.max_results : 20;

    try {
      const matches = this._redirector.grepOutput(params.path, params.pattern, maxResults);
      return {
        id,
        success: true,
        output: JSON.stringify({ matches, count: matches.split("\n").length }),
      };
    } catch (err) {
      return {
        id,
        success: false,
        output: "",
        error: formatForUser(err),
      };
    }
  }
}
