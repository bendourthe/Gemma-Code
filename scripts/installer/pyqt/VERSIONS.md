# Pinned Installer Dependency Versions

The Gemma Code cross-platform installer downloads and verifies third-party binaries against pinned checksums to prevent supply-chain compromise. When upstream releases a new version and you want to adopt it, you must bump **both** the version tag **and** the checksum in lockstep.

## Ollama

| Field | Value | Notes |
| --- | --- | --- |
| Pinned tag | `v0.3.6` | Bump by editing `OLLAMA_PINNED_TAG` in `src/gemma_installer/engine/ollama_installer.py`. |
| Windows binary | `OllamaSetup.exe` | Downloaded from `https://github.com/ollama/ollama/releases/download/<tag>/OllamaSetup.exe`. |
| Windows SHA-256 | `0000...` (placeholder) | Update `OLLAMA_WINDOWS_SHA256`. Pull the hash from the upstream release page. |
| Linux install script | `install.sh` | Downloaded from `https://ollama.com/install.sh`. |
| Linux script SHA-256 | `0000...` (placeholder) | Update `OLLAMA_LINUX_SCRIPT_SHA256`. Re-record whenever upstream changes the script. |
| Trusted Windows signers | `CN=Ollama Inc.` | Update `TRUSTED_WINDOWS_SIGNERS` if the code-signing cert rotates. |

## Update Procedure

1. Download the intended binary locally.
2. Run `sha256sum OllamaSetup.exe` (Linux / macOS) or `Get-FileHash -Algorithm SHA256 OllamaSetup.exe` (PowerShell) to compute the hash.
3. On Windows, run `Get-AuthenticodeSignature OllamaSetup.exe` and confirm the SignerCertificate subject. If it differs from the existing trusted signers list, treat it as a compromise unless you have an out-of-band confirmation from the Ollama team.
4. Edit the constants in `ollama_installer.py`.
5. Update this file.
6. Open a PR titled `chore(installer): bump Ollama to <tag>`. The PR reviewer MUST independently confirm the hash and signer.
7. CI runs `pip audit` on the installer venv to flag any new Python-side vulns pulled by the dep bump.

Never merge a pinned-version bump without someone other than the author re-computing the hash.
