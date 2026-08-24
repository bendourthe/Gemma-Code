/**
 * v2.1.0 Phase 5 -- Settings-side Unsloth Core provisioner (Node).
 * Installer wizard uses the Python twin. Both read the same pins file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { nexusHome } from "../storage/paths.js";
import { evaluateTrainingHardware, type TrainingHost } from "./hardwareGate.js";
import { argvIncludesForbiddenExtra, pipInstallArgs } from "./licensePins.js";

export type ProvisionStatus = "pending" | "ready" | "failed" | "unsupported";

export interface ProvisionState {
  readonly status: ProvisionStatus;
  readonly error?: string;
  readonly packages?: readonly string[];
}

export interface CommandResult {
  readonly returncode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (argv: readonly string[]) => CommandResult | Promise<CommandResult>;

export interface TuningProvisionerOptions {
  readonly host: TrainingHost;
  readonly root?: string;
  readonly homeDirFn?: () => string;
  readonly runner?: CommandRunner;
}

function defaultRoot(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), "tuning");
}

export function venvPython(root: string): string {
  return process.platform === "win32"
    ? path.join(root, "venv", "Scripts", "python.exe")
    : path.join(root, "venv", "bin", "python");
}

export class TuningProvisioner {
  readonly root: string;
  private readonly host: TrainingHost;
  private readonly runner: CommandRunner;

  constructor(opts: TuningProvisionerOptions) {
    this.host = opts.host;
    this.root = opts.root ?? defaultRoot(opts.homeDirFn);
    this.runner = opts.runner ?? (() => ({ returncode: 1, stdout: "", stderr: "no runner" }));
  }

  hardware() {
    return evaluateTrainingHardware(this.host);
  }

  state(): ProvisionState {
    const file = path.join(this.root, "provision.json");
    if (!existsSync(file)) return { status: "pending" };
    try {
      return JSON.parse(readFileSync(file, "utf8")) as ProvisionState;
    } catch {
      return { status: "failed", error: "corrupt provision.json" };
    }
  }

  private write(payload: ProvisionState): void {
    mkdirSync(this.root, { recursive: true });
    writeFileSync(path.join(this.root, "provision.json"), JSON.stringify(payload, null, 2));
  }

  async provision(): Promise<ProvisionState> {
    const gate = this.hardware();
    if (!gate.supported) {
      const next: ProvisionState = { status: "unsupported", error: gate.reason };
      this.write(next);
      return next;
    }
    const args = pipInstallArgs();
    const py = venvPython(this.root);
    if (!existsSync(py)) {
      const created = await this.runner(["uv", "venv", path.join(this.root, "venv")]);
      if (created.returncode !== 0) {
        const error = (created.stderr || created.stdout || "uv venv failed").trim();
        const next: ProvisionState = { status: "failed", error };
        this.write(next);
        return next;
      }
    }
    const argv = ["uv", "pip", "install", "--python", py, ...args];
    if (argvIncludesForbiddenExtra(argv)) {
      const next: ProvisionState = { status: "failed", error: "refusing AGPL studio/cli extra" };
      this.write(next);
      return next;
    }
    this.write({ status: "pending" });
    const result = await this.runner(argv);
    if (result.returncode !== 0) {
      const error = (result.stderr || result.stdout || "uv pip install failed").trim();
      const next: ProvisionState = { status: "failed", error };
      this.write(next);
      return next;
    }
    const next: ProvisionState = { status: "ready", packages: args };
    this.write(next);
    return next;
  }

  async preflight(): Promise<{ ok: boolean; message: string }> {
    const py = venvPython(this.root);
    if (!existsSync(py)) {
      return { ok: false, message: "tuning venv python is missing; re-provision from Settings." };
    }
    const result = await this.runner([py, "-c", "import unsloth; print('ok')"]);
    if (result.returncode !== 0) {
      return { ok: false, message: (result.stderr || result.stdout || "import unsloth failed").trim() };
    }
    return { ok: true, message: "ok" };
  }
}
