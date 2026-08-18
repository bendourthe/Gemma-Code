/**
 * macOS Seatbelt profile generation and sandbox-exec launch.
 *
 * Design reference: Open Interpreter's Seatbelt approach (Apache-2.0). The
 * profile text here is Nexus-authored; no OI source is vendored.
 *
 * `# DEVIATION:` Seatbelt does not apply Windows-style process-limits or a
 * restricted token. Mode is still "confined" when filesystem and network are
 * enforced (sandbox-exec present).
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { reportFromCapability } from "../report.js";
import type {
  SandboxBackend,
  SandboxCapability,
  SandboxDimension,
  SandboxPolicy,
  SandboxPrepared,
  SandboxSpawnRequest,
} from "../types.js";

const SEATBELT_BIN = "/usr/bin/sandbox-exec";

const ENFORCED: readonly SandboxDimension[] = ["filesystem", "network"];
const UNENFORCED: readonly SandboxDimension[] = [
  "process-limits",
  "restricted-token",
];

export function probeMacosSeatbelt(
  platform: NodeJS.Platform = process.platform,
): SandboxCapability {
  if (platform !== "darwin") {
    return {
      platform,
      backendId: "macos-seatbelt",
      available: false,
      detail: "Seatbelt is a macOS backend",
      enforced: [],
      unenforced: ["filesystem", "network", "process-limits", "restricted-token"],
    };
  }
  const exists = fs.existsSync(SEATBELT_BIN);
  return {
    platform,
    backendId: "macos-seatbelt",
    available: exists,
    detail: exists
      ? "sandbox-exec present (Seatbelt is deprecated by Apple but still the confinement primitive)"
      : "sandbox-exec missing; Seatbelt unavailable (degraded)",
    enforced: exists ? ENFORCED : [],
    unenforced: exists
      ? UNENFORCED
      : ["filesystem", "network", "process-limits", "restricted-token"],
  };
}

function sbPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/"/g, '\\"');
}

/**
 * Generate a per-run Seatbelt profile. Write access is limited to writable
 * roots; network is denied unless the policy allows it; deny-read roots match
 * the secret-path denylist's well-known home directories.
 */
export function renderSeatbeltProfile(policy: SandboxPolicy): string {
  const writeClauses = policy.writableRoots
    .map((root) => `  (subpath "${sbPath(root)}")`)
    .join("\n");
  const denyRead = policy.denyReadRoots
    .map(
      (root) =>
        `(deny file-read* (subpath "${sbPath(root)}"))\n(deny file-write* (subpath "${sbPath(root)}"))`,
    )
    .join("\n");
  const network =
    policy.network === "allow"
      ? "(allow network*)"
      : "(deny network*)\n(deny network-outbound*)\n(deny network-inbound*)";

  return `(version 1)
(deny default)
(allow process*)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)
(allow mach-register)
(allow ipc-posix-shm)
(allow ipc-posix-sem)
(allow system-socket)
(allow file-ioctl)
(allow file-read-metadata)
(allow file-read*)
(allow file-write-data (literal "/dev/null"))
(allow file-write-data (literal "/dev/zero"))
(allow file-write-data (literal "/dev/dtracehelper"))
(allow file-write*
${writeClauses}
)
${denyRead}
${network}
`;
}

export function createMacosSeatbeltBackend(
  probeFn: () => SandboxCapability = probeMacosSeatbelt,
): SandboxBackend {
  return {
    id: "macos-seatbelt",
    probe: probeFn,
    prepare(policy: SandboxPolicy, enabled: boolean): SandboxPrepared {
      const capability = probeFn();
      if (!enabled || !capability.available) {
        return {
          policy,
          report: reportFromCapability(enabled, capability),
          artifacts: [],
          extraEnv: {},
        };
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-seatbelt-"));
      const profilePath = path.join(dir, "profile.sb");
      fs.writeFileSync(profilePath, renderSeatbeltProfile(policy), "utf8");
      return {
        policy,
        report: reportFromCapability(enabled, capability, "confined"),
        artifacts: [profilePath, dir],
        extraEnv: { NEXUS_SANDBOX_PROFILE: profilePath },
      };
    },
    spawn(prepared: SandboxPrepared, request: SandboxSpawnRequest): ChildProcess {
      const profilePath = prepared.extraEnv.NEXUS_SANDBOX_PROFILE;
      if (!profilePath) {
        return spawn(request.command, [], {
          shell: true,
          cwd: request.cwd,
          env: request.env,
          signal: request.signal,
        });
      }
      return spawn(
        SEATBELT_BIN,
        ["-f", profilePath, "/bin/sh", "-c", request.command],
        {
          shell: false,
          cwd: request.cwd,
          env: { ...request.env, ...prepared.extraEnv },
          signal: request.signal,
        },
      );
    },
    teardown(prepared: SandboxPrepared): void {
      for (const artifact of [...prepared.artifacts].reverse()) {
        try {
          const stat = fs.statSync(artifact);
          if (stat.isDirectory()) fs.rmSync(artifact, { recursive: true, force: true });
          else fs.unlinkSync(artifact);
        } catch {
          // best-effort
        }
      }
    },
  };
}
