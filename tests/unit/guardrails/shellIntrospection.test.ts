import { describe, it, expect } from "vitest";
import {
  introspectShellCommand,
  detectShellDialect,
  normalizeTouchedPath,
  type PathOperation,
  type TouchedPath,
} from "../../../modules/coding/guardrails/shellIntrospection.js";

/** Convenience: map an introspection to a `operation:raw` string set. */
function pathSet(paths: readonly TouchedPath[]): Set<string> {
  return new Set(paths.map((p) => `${p.operation}:${p.raw}`));
}

/** Convenience: does the enumeration include a path with this op + raw? */
function hasPath(
  paths: readonly TouchedPath[],
  operation: PathOperation,
  raw: string,
): boolean {
  return paths.some((p) => p.operation === operation && p.raw === raw);
}

describe("shellIntrospection / detectShellDialect", () => {
  it("selects cmd on Windows and bash elsewhere", () => {
    expect(detectShellDialect("win32")).toBe("cmd");
    expect(detectShellDialect("linux")).toBe("bash");
    expect(detectShellDialect("darwin")).toBe("bash");
  });
});

describe("shellIntrospection / bash path enumeration", () => {
  it("enumerates a redirection write target", () => {
    const r = introspectShellCommand("echo hello > out/log.txt", "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "write", "out/log.txt")).toBe(true);
  });

  it("enumerates append and fd-prefixed redirections, ignoring fd-dup targets", () => {
    const r = introspectShellCommand("node build.js >> build.log 2>&1", "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "write", "build.log")).toBe(true);
    // `2>&1` duplicates a file descriptor; `&1` is not a filesystem path.
    expect(r.paths.some((p) => p.raw === "&1" || p.raw === "1")).toBe(false);
  });

  it("classifies rm arguments as deletes", () => {
    const r = introspectShellCommand("rm -rf build dist", "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "delete", "build")).toBe(true);
    expect(hasPath(r.paths, "delete", "dist")).toBe(true);
    // The `-rf` flag is not a path.
    expect(r.paths.some((p) => p.raw === "-rf")).toBe(false);
  });

  it("classifies cp source as read and destination as write", () => {
    const r = introspectShellCommand("cp src/a.ts dist/a.ts", "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "read", "src/a.ts")).toBe(true);
    expect(hasPath(r.paths, "write", "dist/a.ts")).toBe(true);
  });

  it("classifies cd as a cwd change", () => {
    const r = introspectShellCommand("cd packages/core", "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "cwd", "packages/core")).toBe(true);
  });

  it("treats an unknown command's non-redirection args as non-paths", () => {
    const r = introspectShellCommand("git commit -m message > commit.log", "bash");
    expect(r.parsed).toBe(true);
    // Only the redirection target is a path; `message` is a git arg, not a file.
    expect(pathSet(r.paths)).toEqual(new Set(["write:commit.log"]));
  });

  it("handles quoted path arguments with spaces", () => {
    const r = introspectShellCommand('rm "my folder/notes.txt"', "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "delete", "my folder/notes.txt")).toBe(true);
  });

  it("enumerates an fd-prefixed append redirection (2>>)", () => {
    const r = introspectShellCommand("node build.js 2>> errors.log", "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "write", "errors.log")).toBe(true);
  });

  it("splits chained sub-commands and enumerates each", () => {
    const r = introspectShellCommand("mkdir out && echo x > out/file.txt", "bash");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "write", "out")).toBe(true);
    expect(hasPath(r.paths, "write", "out/file.txt")).toBe(true);
    expect(r.segments.length).toBe(2);
  });
});

describe("shellIntrospection / cmd path enumeration", () => {
  it("classifies del arguments as deletes", () => {
    const r = introspectShellCommand("del /f /q build\\out.js", "cmd");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "delete", "build\\out.js")).toBe(true);
    // `/f` and `/q` are cmd switches, not paths.
    expect(r.paths.some((p) => p.raw === "/f" || p.raw === "/q")).toBe(false);
  });

  it("classifies copy source as read and destination as write", () => {
    const r = introspectShellCommand("copy src\\a.txt dist\\a.txt", "cmd");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "read", "src\\a.txt")).toBe(true);
    expect(hasPath(r.paths, "write", "dist\\a.txt")).toBe(true);
  });

  it("enumerates a redirection target under cmd", () => {
    const r = introspectShellCommand("echo hi> log.txt", "cmd");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "write", "log.txt")).toBe(true);
  });
});

describe("shellIntrospection / PowerShell path enumeration", () => {
  it("classifies Remove-Item arguments as deletes", () => {
    const r = introspectShellCommand("Remove-Item -Recurse build", "powershell");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "delete", "build")).toBe(true);
    expect(r.paths.some((p) => p.raw === "-Recurse")).toBe(false);
  });

  it("reads a -Path named parameter as the cmdlet's path", () => {
    const r = introspectShellCommand(
      "Set-Content -Path secrets/app.env value",
      "powershell",
    );
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "write", "secrets/app.env")).toBe(true);
  });

  it("classifies Get-Content as a read", () => {
    const r = introspectShellCommand("Get-Content README.md", "powershell");
    expect(r.parsed).toBe(true);
    expect(hasPath(r.paths, "read", "README.md")).toBe(true);
  });

  it("tolerates a trailing -Path parameter with no value", () => {
    const r = introspectShellCommand("Set-Content -Path", "powershell");
    expect(r.parsed).toBe(true);
    expect(r.paths).toHaveLength(0);
  });
});

describe("shellIntrospection / fail-closed behavior", () => {
  it("declines a bash command with command substitution", () => {
    const r = introspectShellCommand("rm $(cat targets.txt)", "bash");
    expect(r.parsed).toBe(false);
    expect(r.paths).toHaveLength(0);
    expect(r.unsupportedReason).toBeTruthy();
  });

  it("declines a bash command with variable expansion", () => {
    const r = introspectShellCommand("rm -rf $HOME/tmp", "bash");
    expect(r.parsed).toBe(false);
    expect(r.paths).toHaveLength(0);
  });

  it("declines a bash command with a backtick subshell", () => {
    const r = introspectShellCommand("rm `find . -name '*.tmp'`", "bash");
    expect(r.parsed).toBe(false);
  });

  it("declines a cmd command with %VAR% expansion", () => {
    const r = introspectShellCommand("del %TEMP%\\x.txt", "cmd");
    expect(r.parsed).toBe(false);
    expect(r.paths).toHaveLength(0);
  });

  it("declines a PowerShell command using Invoke-Expression", () => {
    const r = introspectShellCommand("Invoke-Expression $cmd", "powershell");
    expect(r.parsed).toBe(false);
  });

  it("declines a command with an unbalanced quote in every dialect", () => {
    for (const dialect of ["bash", "cmd", "powershell"] as const) {
      const r = introspectShellCommand('echo "unterminated > out.txt', dialect);
      expect(r.parsed).toBe(false);
      expect(r.unsupportedReason).toBe("unbalanced quote");
    }
  });

  it("returns an empty parsed result for a whitespace-only command", () => {
    const r = introspectShellCommand("   ", "bash");
    expect(r.parsed).toBe(true);
    expect(r.paths).toHaveLength(0);
    expect(r.segments).toHaveLength(0);
  });

  it("skips an empty quoted argument rather than enumerating a blank path", () => {
    const r = introspectShellCommand('cat ""', "bash");
    expect(r.parsed).toBe(true);
    expect(r.paths).toHaveLength(0);
  });
});

describe("shellIntrospection / normalizeTouchedPath edge cases", () => {
  it("strips repeated leading ./ segments", () => {
    expect(normalizeTouchedPath("././secrets/x")).toBe("secrets/x");
  });
});

describe("shellIntrospection / normalizeTouchedPath", () => {
  it("converts back-slashes to forward slashes", () => {
    expect(normalizeTouchedPath("build\\out\\x.js")).toBe("build/out/x.js");
  });

  it("strips a leading ./ prefix", () => {
    expect(normalizeTouchedPath("./secrets/app.env")).toBe("secrets/app.env");
  });

  it("leaves a plain relative path unchanged", () => {
    expect(normalizeTouchedPath("secrets/app.env")).toBe("secrets/app.env");
  });
});
