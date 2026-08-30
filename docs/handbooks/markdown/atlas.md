# Nexus v2.4 Architecture Atlas

This walkthrough maps the durable user flows corrected for v2.4.1 to their owning components.

| User flow | Primary owner | Supporting contract | Evidence |
|---|---|---|---|
| Install or repair media | `scripts/installer/` | Owner-aware lease and atomic runtime state | Installer tests plus packaged operator run |
| Generate an image | `desktop/sidecar/src/image/` | Shared diffusion readiness API | PNG validator and retained artifact |
| Generate a video | `desktop/sidecar/src/video/` | Shared diffusion readiness API | Video probe and retained artifact |
| Browse and install models | `core/registry/` and Settings | Shared availability/recommendation tuple | Cross-language rank fixture |
| Read chat usage | `core/chat/` and shared chat UI | Role-local token provenance | Protocol, hydration, and UI tests |
| Work across local folders | Coding page and workspace scope | Union-of-roots path boundary | Picker, persistence, and denial tests |

## End-to-end path

1. The installer validates catalog sources, prepares the desktop payload, and provisions the media runtime.
2. The sidecar reads the atomic readiness record and exposes one repair contract to Image Studio and Video Lab.
3. Generation jobs validate manifests before loading models and finalize artifacts before reporting success.
4. The desktop renders truthful capability, model, transcript, archive, and workspace state from shared contracts.
5. The packaged acceptance harness proves that the exact installer and installed runtime cross all boundaries successfully.

Release-specific logs and test counts belong under `docs/v2/v2.4/development/`, not in this living atlas.
