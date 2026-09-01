# Installer Repair and Runtime State

The installer owns dependency provisioning and repair. `diffusion_venv_provisioner.py` owns the versioned repair lease; `runtime_provisioner.py` owns atomic runtime-state transitions; model workers own success or failure, while Qt callbacks are telemetry only.

The lease identifies its process by PID plus process-start identity and attempt nonce. A stale record is reclaimed only after ownership is disproved. Runtime state transitions from `unavailable` to `repairing`, then exactly once to `ready` or `failed` with an actionable code and smoke evidence.

Hugging Face repository, revision, exact file path, and gated status are catalog data validated before packaging. Public models never open an authorization dialog. Genuine gated models use explicit account, license, sign-in, device-code, copy, manual-token, and skip controls.
