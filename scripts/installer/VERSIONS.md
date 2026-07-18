# Pinned Installer Dependency Versions

The Nexus cross-platform installer (v1.0.0; renamed from Gemma Code in Phase 2.5) downloads and verifies third-party binaries against pinned checksums to prevent supply-chain compromise. When upstream releases a new version and you want to adopt it, you must bump **both** the version tag **and** the checksum in lockstep.

## Ollama

| Field | Value | Notes |
| --- | --- | --- |
| Pinned tag | `v0.32.0` | Bump by editing `OLLAMA_PINNED_TAG` in `src/nexus_installer/engine/ollama_installer.py`. The real per-asset SHA-256 digests live beside it (`OLLAMA_WINDOWS_SHA256`, `OLLAMA_LINUX_SHA256`); update all three in lockstep. |
| Minimum version | `0.22.0` | `MIN_OLLAMA_VERSION` in `ollama_installer.py`. Gemma 4 support landed in Ollama 0.20.0; 0.21.0-0.21.2 had a Flash-Attention bug fixed in 0.22.0. The entire recommended chat/agentic default line is Gemma 4, so a pre-existing Ollama below this floor is upgraded to the pinned tag rather than left unable to load the default model. |
| Windows binary | `OllamaSetup.exe` | Downloaded from `https://github.com/ollama/ollama/releases/download/<tag>/OllamaSetup.exe`; SHA-256 in `OLLAMA_WINDOWS_SHA256` and Authenticode-verified against `CN=Ollama Inc.` (fail closed). |
| Linux binary | `ollama-linux-amd64.tar.zst` | Downloaded from `https://github.com/ollama/ollama/releases/download/<tag>/ollama-linux-amd64.tar.zst` and installed user-locally (no sudo); SHA-256 in `OLLAMA_LINUX_SHA256`. Replaced the unpinnable `install.sh` pipe-to-shell flow in v1.11.0 Phase 3 -- the versioned release asset is immutable, so its digest is pinnable. |
| Trusted Windows signers | `CN=Ollama Inc.` | Update `TRUSTED_WINDOWS_SIGNERS` if the code-signing cert rotates. |

## Nexus Desktop (v1.8.0 Phase 2)

| Field | Value | Notes |
| --- | --- | --- |
| Pinned tag | `v2.1.0` | Bump by editing `NEXUS_DESKTOP_PINNED_TAG` in `src/nexus_installer/engine/desktop_provisioner.py`. semantic-release owns the tag; the bundle version is the tag without the leading `v`. |
| Assets | `Nexus-Desktop_{version}_x64-setup.exe` / `_universal.dmg` / `_amd64.AppImage` | Downloaded from `https://github.com/bendourthe/Nexus-AI/releases/download/<tag>/<asset>`. Names are staged by `release.yml`'s `desktop-bundle` jobs. |
| Verification | `SHA256SUMS.txt` from the same release | Per-asset SHA-256, fail closed. No per-file constant to bump here: the manifest is fetched at install time and covers every attached asset (T102). |
| Local override | `InstallerState.desktop_bundle_override` | Installs a locally-built bundle without a release fetch (checksum skipped, logged loudly). Used by the T204 integration test against the `.local-fixtures/` T104 bundle. |

## Update Procedure

1. Download the intended binary locally.
2. Run `sha256sum OllamaSetup.exe` (Linux / macOS) or `Get-FileHash -Algorithm SHA256 OllamaSetup.exe` (PowerShell) to compute the hash.
3. On Windows, run `Get-AuthenticodeSignature OllamaSetup.exe` and confirm the SignerCertificate subject. If it differs from the existing trusted signers list, treat it as a compromise unless you have an out-of-band confirmation from the Ollama team.
4. Edit the constants in `ollama_installer.py`.
5. Update this file.
6. Open a PR titled `chore(installer): bump Ollama to <tag>`. The PR reviewer MUST independently confirm the hash and signer.
7. CI runs `pip audit` on the installer venv to flag any new Python-side vulns pulled by the dep bump.

Never merge a pinned-version bump without someone other than the author re-computing the hash.
