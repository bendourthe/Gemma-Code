# Generation Recovery and Validation

This handbook describes the supported operator path for recovering local image and video generation after an interrupted install. It applies to the packaged Windows installer and installed Nexus desktop application.

## Recover the runtime

1. Close Nexus and any active installer window.
2. Run the exact `NexusSetup.exe` candidate and choose repair when an existing install is detected.
3. Let the installer reclaim only a lease whose owner is proven dead or mismatched. A live or uncertain owner remains protected.
4. Treat the install as successful only when the runtime readiness probe reaches `ready`. A selected media capability that remains unavailable is a required failure.

## Validate image and video generation

Run `scripts/installer/build/smoke-installed-media.ps1` against the exact installer artifact and installed sidecar. The harness must retain one decodable PNG and one playable video. Record the installer hash, runtime versions, model ids, elapsed time, artifact hashes, and probe metadata.

The PNG proof includes format, dimensions, non-zero pixel content, and SHA-256. The video proof includes codec, duration, frame count, dimensions, and SHA-256. Unit tests and mock CUDA runs do not replace this packaged evidence.

## Interpret failures

- `REPAIR_BUSY` means a verified live owner holds the repair lease.
- `REPAIR_OWNER_UNKNOWN` means ownership cannot be proved safely; stop the competing process or reboot before retrying.
- `runtime-unavailable` means the installed media environment failed readiness and should expose Repair rather than claiming generation is available.
- A missing PNG or video after the exact packaged run blocks release publication.

See the [installer runtime](../technical/installer-runtime.md) and [media runtime](../technical/media-runtime.md) companions for component ownership.
