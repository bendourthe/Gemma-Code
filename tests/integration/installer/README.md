# Installer package checks

Fast, self-contained checks that the PyQt5 installer package itself is healthy:

- the package imports cleanly,
- pure-function helpers (GPU detection, platform discovery) return expected values,
- the installer binary is wired up correctly.

These run **nightly** under `.github/workflows/nightly.yml` as
`installer-package-check-{windows,macos,linux}`.

They do NOT install VS Code, Ollama, or the Gemma model — that is the job of
the full smoke suite in [tests/smoke/](../../smoke/), which runs **weekly**
under `.github/workflows/installer-smoke.yml`.

## Files

| File | Platform | Run by |
|------|----------|--------|
| `test-install-pyqt.ps1` | Windows | nightly CI |
| `test-install-pyqt-macos.sh` | macOS | nightly CI |
| `test-install-pyqt-linux.sh` | Linux | nightly CI |
| `test-install-sequence.ps1` | Windows (historical) | manual / ad-hoc |

## When to run manually

Run one of these scripts locally if you have changed anything under
`scripts/installer/`. The scripts are quick (<2 min on a dev machine)
and require only the installer's own Python dependencies.

Run the full smoke suite (see [tests/smoke/README.md](../../smoke/README.md))
before cutting a release or when you touch installer logic that changes how
components are downloaded / registered.
