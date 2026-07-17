# Phase 7 background-continuation scenarios

v1.11.0 Phase 7 (T705). Background continuation (tray detach, reattach, resume)
is an inherently GUI flow, so these scenarios are **operator-driven** for the
clicks and **script-verified** for the part that can be checked mechanically:
the persisted state file (`state.json`) the engine writes continuously via its
signal surface (T701).

The unit suite already covers the pure logic exhaustively (state round-trip,
crash/resume decisions, tray state machine, single-instance handshake). These
scenarios exist for the end-to-end visual confirmation that the widgets behave
on a real machine -- the same operator-action posture as the P2/P3 sandbox gates
(`IO.P2.A`).

## Runner

```powershell
# from scripts/installer/  (build dist/NexusSetup.exe first)
./testing/scenarios/background-continuation.ps1 -Scenario close-to-tray
./testing/scenarios/background-continuation.ps1 -Scenario reattach
./testing/scenarios/background-continuation.ps1 -Scenario crash-resume
```

The runner points the installer at an isolated state directory (via the
`NEXUS_INSTALLER_STATE_DIR` override), launches `NexusSetup.exe`, prints the
operator steps, and polls `state.json`, reporting each status/step transition
until a terminal status. It PASSES when the state file went through `running`
and reached `completed` / `failed` / `cancelled` -- proving T701 persistence --
and reminds the operator to confirm the tray/reattach visuals by eye.

## Scenarios

| Scenario | Tasks | Operator confirms |
|---|---|---|
| `close-to-tray` | T702, T703 | Closing mid-install offers "Continue in background"; the tray shows a live percent tooltip; "Open installer" reattaches; completion raises a notification. |
| `reattach` | T703 | Launching a second `NexusSetup.exe` during an install surfaces the FIRST window instead of starting a duplicate. |
| `crash-resume` | T704 | Hard-killing mid-install then relaunching shows the "Resume installation?" prompt; Resume skips already-installed steps (visible in the log). |

## State file

`state.json` (schema `nexus-install-state/v1`) is plain JSON -- inspect it at any
time. Key fields: `status`, `pid`, `overall_progress`, `steps` (per-step
status), `models` (per-model telemetry), `failed_steps` / `failed_models`, and a
`results` snapshot the Complete view reads back after a background completion.
