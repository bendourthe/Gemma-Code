/**
 * Linux Landlock (filesystem) + seccomp (block inet sockets when egress is
 * denied). Applied in a Python 3 ctypes helper before exec of /bin/sh -c.
 *
 * No native addon and no Open Interpreter / Rust code. Python 3 is required
 * to issue the syscalls from this Node host; kernels without Landlock, or
 * hosts without python3, degrade per the 6.1 contract.
 *
 * `# DEVIATION:` Landlock + seccomp are applied by an in-repo Python ctypes
 * helper before exec, not by a Node native addon. The child still gets the
 * LSM rules before `/bin/sh -c`. Missing python3 or Landlock is loud
 * unconfined (never a silent retry).
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
import { findOnPath, readTextIfExists } from "../which.js";

const ENFORCED_FULL: readonly SandboxDimension[] = ["filesystem", "network"];

function linuxLsmList(): string {
  return (
    readTextIfExists("/sys/kernel/security/lsm") ??
    readTextIfExists("/proc/sys/kernel/lsm") ??
    ""
  );
}

export function findPython3(): string | null {
  const explicit = process.env["NEXUS_SANDBOX_PYTHON"];
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const candidate of ["/usr/bin/python3", "/usr/local/bin/python3"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return findOnPath(["python3"]);
}

export function probeLinuxLandlock(
  platform: NodeJS.Platform = process.platform,
): SandboxCapability {
  const none: SandboxDimension[] = [
    "filesystem",
    "network",
    "process-limits",
    "restricted-token",
  ];
  if (platform !== "linux") {
    return {
      platform,
      backendId: "linux-landlock",
      available: false,
      detail: "Landlock is a Linux backend",
      enforced: [],
      unenforced: none,
    };
  }
  const lsm = linuxLsmList().toLowerCase();
  const python = findPython3();
  if (!python) {
    return {
      platform,
      backendId: "linux-landlock",
      available: false,
      detail:
        "python3 not on PATH; cannot apply Landlock/seccomp from Node (degraded)",
      enforced: [],
      unenforced: none,
    };
  }
  if (!lsm.includes("landlock")) {
    const why =
      lsm.trim().length > 0
        ? `Landlock not in LSM list (${lsm.trim()})`
        : "cannot read LSM list (/sys/kernel/security/lsm)";
    return {
      platform,
      backendId: "linux-landlock",
      available: false,
      detail: `${why}; old or unconfigured kernel (degraded)`,
      enforced: [],
      unenforced: none,
    };
  }
  return {
    platform,
    backendId: "linux-landlock",
    available: true,
    detail: `Landlock applicator ready (python3 at ${python})`,
    enforced: ENFORCED_FULL,
    unenforced: ["process-limits", "restricted-token"],
  };
}

export const LINUX_LANDLOCK_PREEXEC_PY = `#!/usr/bin/env python3
# Nexus-authored Landlock + seccomp pre-exec helper. Not vendored from Open Interpreter.
import ctypes, ctypes.util, json, os, sys

SANDBOX_APPLY_FAILURE_EXIT = 125
LANDLOCK_CREATE_RULESET_VERSION = 1 << 0
LANDLOCK_RULE_PATH_BENEATH = 1
O_PATH = 0o10000000
O_CLOEXEC = 0o2000000
O_DIRECTORY = 0o200000
PR_SET_NO_NEW_PRIVS = 38
PR_SET_SECCOMP = 22
SECCOMP_MODE_FILTER = 2
SECCOMP_RET_ALLOW = 0x7fff0000
SECCOMP_RET_ERRNO = 0x00050000
EPERM = 1
AF_INET = 2
AF_INET6 = 10
BPF_LD = 0x00
BPF_W = 0x00
BPF_ABS = 0x20
BPF_JMP = 0x05
BPF_JEQ = 0x10
BPF_K = 0x00
BPF_RET = 0x06

ACCESS = {
    "execute": 1 << 0,
    "write_file": 1 << 1,
    "read_file": 1 << 2,
    "read_dir": 1 << 3,
    "remove_dir": 1 << 4,
    "remove_file": 1 << 5,
    "make_char": 1 << 6,
    "make_dir": 1 << 7,
    "make_reg": 1 << 8,
    "make_sock": 1 << 9,
    "make_fifo": 1 << 10,
    "make_block": 1 << 11,
    "make_sym": 1 << 12,
    "refer": 1 << 13,
    "truncate": 1 << 14,
    "ioctl_dev": 1 << 15,
}
NET_BIND = 1 << 0
NET_CONNECT = 1 << 1
ABI_FS_BITS = {
    1: 13, 2: 14, 3: 15, 4: 15, 5: 16, 6: 16,
}

def fail(msg):
    sys.stderr.write("nexus-sandbox: " + msg + "\\n")
    sys.exit(SANDBOX_APPLY_FAILURE_EXIT)

class RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64), ("handled_access_net", ctypes.c_uint64)]

class PathBeneath(ctypes.Structure):
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]

class SockFilter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_uint16), ("jt", ctypes.c_uint8), ("jf", ctypes.c_uint8), ("k", ctypes.c_uint32)]

class SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.POINTER(SockFilter))]

def libc():
    lib = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
    lib.syscall.restype = ctypes.c_long
    lib.prctl.restype = ctypes.c_int
    return lib

def sysnums():
    machine = os.uname().machine
    # Landlock numbers are 444-446 on asm-generic (x86_64, aarch64, riscv64).
    landlock = (444, 445, 446)
    socket_nr = {"x86_64": 41, "aarch64": 198, "riscv64": 198}.get(machine)
    return landlock, socket_nr

def fs_mask(abi):
    bits = 13
    for level, count in sorted(ABI_FS_BITS.items()):
        if abi >= level:
            bits = count
    mask = 0
    for i in range(bits):
        mask |= 1 << i
    return mask

def add_path(lib, sys_add, ruleset, path, access):
    fd = os.open(path, O_PATH | O_CLOEXEC | O_DIRECTORY)
    try:
        attr = PathBeneath(access, fd)
        if lib.syscall(sys_add, ruleset, LANDLOCK_RULE_PATH_BENEATH, ctypes.byref(attr), 0) != 0:
            fail("landlock_add_rule failed for " + path + ": " + os.strerror(ctypes.get_errno()))
    finally:
        os.close(fd)

def install_seccomp(lib, socket_nr):
    if socket_nr is None:
        return False
    filt = (SockFilter * 7)()
    filt[0] = SockFilter(BPF_LD | BPF_W | BPF_ABS, 0, 0, 0)
    filt[1] = SockFilter(BPF_JMP | BPF_JEQ | BPF_K, 0, 4, socket_nr)
    filt[2] = SockFilter(BPF_LD | BPF_W | BPF_ABS, 0, 0, 16)
    filt[3] = SockFilter(BPF_JMP | BPF_JEQ | BPF_K, 1, 0, AF_INET)
    filt[4] = SockFilter(BPF_JMP | BPF_JEQ | BPF_K, 0, 1, AF_INET6)
    filt[5] = SockFilter(BPF_RET | BPF_K, 0, 0, SECCOMP_RET_ERRNO | EPERM)
    filt[6] = SockFilter(BPF_RET | BPF_K, 0, 0, SECCOMP_RET_ALLOW)
    prog = SockFprog(7, ctypes.cast(filt, ctypes.POINTER(SockFilter)))
    if lib.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.byref(prog)) != 0:
        return False
    return True

def main():
    raw = os.environ.get("NEXUS_SANDBOX_POLICY_JSON")
    command = os.environ.get("NEXUS_SANDBOX_COMMAND")
    if not raw or command is None:
        fail("missing NEXUS_SANDBOX_POLICY_JSON or NEXUS_SANDBOX_COMMAND")
    policy = json.loads(raw)
    lib = libc()
    (sys_create, sys_add, sys_restrict), socket_nr = sysnums()
    abi = lib.syscall(sys_create, None, 0, LANDLOCK_CREATE_RULESET_VERSION)
    if abi < 1:
        fail("landlock_create_ruleset version probe failed: " + os.strerror(ctypes.get_errno()))
    handled_fs = fs_mask(int(abi))
    handled_net = 0
    if int(abi) >= 4 and policy.get("network") == "deny":
        handled_net = NET_BIND | NET_CONNECT
    attr = RulesetAttr(handled_fs, handled_net)
    ruleset = lib.syscall(sys_create, ctypes.byref(attr), ctypes.sizeof(attr), 0)
    if ruleset < 0:
        fail("landlock_create_ruleset failed: " + os.strerror(ctypes.get_errno()))
    read_exec = ACCESS["execute"] | ACCESS["read_file"] | ACCESS["read_dir"]
    read_exec &= handled_fs
    write_all = handled_fs
    add_path(lib, sys_add, ruleset, "/", read_exec)
    for root in policy.get("writableRoots") or []:
        if os.path.isdir(root):
            add_path(lib, sys_add, ruleset, root, write_all)
    if lib.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        fail("PR_SET_NO_NEW_PRIVS failed: " + os.strerror(ctypes.get_errno()))
    if lib.syscall(sys_restrict, ruleset, 0) != 0:
        fail("landlock_restrict_self failed: " + os.strerror(ctypes.get_errno()))
    os.close(int(ruleset))
    if policy.get("network") == "deny":
        install_seccomp(lib, socket_nr)
    env = os.environ.copy()
    env.pop("NEXUS_SANDBOX_POLICY_JSON", None)
    env.pop("NEXUS_SANDBOX_COMMAND", None)
    os.execvpe("/bin/sh", ["/bin/sh", "-c", command], env)

if __name__ == "__main__":
    main()
`;

export function createLinuxLandlockBackend(
  probeFn: () => SandboxCapability = probeLinuxLandlock,
): SandboxBackend {
  return {
    id: "linux-landlock",
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
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-landlock-"));
      const scriptPath = path.join(dir, "landlock_preexec.py");
      fs.writeFileSync(scriptPath, LINUX_LANDLOCK_PREEXEC_PY, "utf8");
      const python = findPython3() ?? "python3";
      const mode =
        capability.unenforced.includes("network") ? "partial" : "confined";
      return {
        policy,
        report: reportFromCapability(enabled, capability, mode),
        artifacts: [scriptPath, dir],
        extraEnv: {
          NEXUS_SANDBOX_PYTHON: python,
          NEXUS_SANDBOX_HELPER: scriptPath,
          NEXUS_SANDBOX_POLICY_JSON: JSON.stringify({
            writableRoots: policy.writableRoots,
            denyReadRoots: policy.denyReadRoots,
            network: policy.network,
          }),
        },
      };
    },
    spawn(prepared: SandboxPrepared, request: SandboxSpawnRequest): ChildProcess {
      const helper = prepared.extraEnv.NEXUS_SANDBOX_HELPER;
      const python = prepared.extraEnv.NEXUS_SANDBOX_PYTHON;
      if (!helper || !python) {
        return spawn(request.command, [], {
          shell: true,
          cwd: request.cwd,
          env: request.env,
          signal: request.signal,
        });
      }
      return spawn(python, [helper], {
        shell: false,
        cwd: request.cwd,
        env: {
          ...request.env,
          ...prepared.extraEnv,
          NEXUS_SANDBOX_COMMAND: request.command,
        },
        signal: request.signal,
      });
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
