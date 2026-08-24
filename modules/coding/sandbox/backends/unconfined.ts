/**
 * Passthrough backend: spawn(shell:true) at user privilege. Used when the
 * setting is off or the OS backend is unavailable. Always reports unconfined.
 */

import { spawn, type ChildProcess } from "child_process";

import { NONE_CAPABILITY, reportFromCapability } from "../report.js";
import type {
  SandboxBackend,
  SandboxCapability,
  SandboxPolicy,
  SandboxPrepared,
  SandboxSpawnRequest,
} from "../types.js";

export function createUnconfinedBackend(
  capability: SandboxCapability = NONE_CAPABILITY,
): SandboxBackend {
  return {
    id: capability.backendId,
    probe(): SandboxCapability {
      return capability;
    },
    prepare(policy: SandboxPolicy, enabled: boolean): SandboxPrepared {
      return {
        policy,
        report: reportFromCapability(enabled, capability),
        artifacts: [],
        extraEnv: {},
      };
    },
    spawn(_prepared: SandboxPrepared, request: SandboxSpawnRequest): ChildProcess {
      return spawn(request.command, [], {
        shell: true,
        cwd: request.cwd,
        env: request.env,
        signal: request.signal,
      });
    },
    teardown(): void {
      // no artifacts
    },
  };
}
