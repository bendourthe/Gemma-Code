# Runtime Contract - `~/.nexus/runtime.json` (v2.2.0 Phase 1)

The installer/app contract that makes a packaged Nexus AI Studio self-sufficient. Written atomically by the installer's `RuntimeProvisioner` (a new always-on step in `InstallEngine.run`), read by the Rust shell and the Node sidecar at boot.

## Schema (v1)

```json
{
  "schemaVersion": 1,
  "nodePath": "C:\\Users\\me\\AppData\\Local\\Nexus\\runtime\\node\\node.exe",
  "diffusionPython": "C:\\Users\\me\\AppData\\Local\\Nexus\\python\\venv\\Scripts\\python.exe",
  "diffusionCwd": "C:\\Users\\me\\AppData\\Local\\Nexus\\runtimes",
  "modelsRoot": "C:\\Users\\me\\.nexus\\models",
  "ollama": { "url": "http://127.0.0.1:11434" },
  "writtenBy": "nexus-installer 2.2.0",
  "writtenAt": "2026-08-22T00:00:00+00:00"
}
```

Fields are nullable: the writer records only what actually exists on disk (a missing diffusion venv yields `"diffusionPython": null`, never a guessed path). Unknown fields must be ignored by readers so the installer can extend the schema.

## Readers

| Reader | Field(s) | Behavior |
|---|---|---|
| `desktop/src-tauri/src/sidecar.rs` (`resolve_node`) | `nodePath` | Resolution chain: `NEXUS_NODE_PATH` env -> `nodePath` -> per-OS provisioned default -> PATH `node` (dev). Rejected candidates are recorded in `SidecarStatus.candidatesRejected`. |
| `desktop/sidecar/src/runtimeConfig.ts` (`applyRuntimeConfigEnv`) | `diffusionPython`, `diffusionCwd`, `modelsRoot` | Applied at sidecar boot to `NEXUS_DIFFUSION_PYTHON` / `NEXUS_DIFFUSION_CWD` / `NEXUS_MODELS_ROOT` ONLY when those env vars are unset. Explicit env always wins. Missing/corrupt file is a silent no-op. |

## Writer

`scripts/installer/src/nexus_installer/engine/runtime_provisioner.py`:

1. **Node**: reuse the provisioned runtime if present; else install from the offline payload (`NodeProvisioner`); else download the pinned Node 22.11.0 dist from nodejs.org (sha256-verified against `NODE_DOWNLOADS`, which must match `build/versions.lock.json` - enforced by `tests/test_runtime_provisioner.py::TestNodePins`).
2. **Runtime sources**: copy the `runtimes/` Python package (staged into the frozen installer by `nexus-installer.spec`, fail-closed) to the per-user runtime tree; `diffusionCwd` is the directory from which `python -m runtimes.diffusion.main` is importable.
3. **Write** `runtime.json` via temp-file + `os.replace` (atomic; never a half-written contract).

The step returns failure only when no usable Node exists (the sidecar cannot run without one); every other fact is best-effort and recorded as null.

## Related diagnostics

- `sidecar_status` / `sidecar_restart` Tauri commands: spawn outcome, node source, stderr tail (50-line ring buffer), single-flight restart.
- Windows sidecar spawn (`desktop/src-tauri/src/sidecar.rs` `sidecar_command`) sets `CREATE_NO_WINDOW` (`0x08000000`) so console-subsystem `node.exe` does not allocate a console. `DETACHED_PROCESS` is not set (it would break piped JSON-RPC stdin/stdout). The flag is Windows-only; macOS and Linux have no extra console window to hide.
- `Nexus AI Studio.exe --healthcheck`: headless verdict `{sidecar, catalogRows, catalogStatus, hubCatalog}` on stdout, nonzero exit on sidecar failure; consumed by the installer's `first_run_health_check`.
- `models.list` replies now include `catalogStatus: "ok" | "catalog-load-failed: <reason>"`.
