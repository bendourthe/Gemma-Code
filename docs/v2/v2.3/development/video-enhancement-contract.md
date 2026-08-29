# Video Enhancement Backend and Service Contract

**Release**: v2.3.0
**Decision date**: 2026-08-28
**Status**: Accepted for implementation
**Selected backend boundary**: Separately installed Video2X 6.4.0 executable
**Support tier**: Candidate until Phase 5 platform and quality evidence passes
**Seed comparison**: [Qwen3.8-Flash-Next, Video2X, and OpenWorker](../comparisons/v2.3.0-comparison-qwen-video2x-openworker.md)

## Decision summary

Nexus v2.3.0 will implement video enhancement as a backend-neutral post-generation service with one guarded adapter for a user-installed Video2X 6.4.0 executable. Nexus will not bundle, link, download, update, or copy Video2X binaries, libraries, model files, or source. The adapter is opt-in and local; a missing or incompatible backend fails closed.

The original completed MP4 is immutable. Every enhancement receives a unique child-job identity, job-owned staging directory, and separately published output. Combined upscale and interpolation is a two-stage workflow because the pinned Video2X CLI accepts exactly one processor per invocation.

This engineering boundary is not a legal conclusion. Any future distribution, linking, or code reuse requires a distribution-specific review of Video2X AGPL-3.0, FFmpeg build terms, component licenses, and the exact Nexus artifact.

## Options considered

| Option                                                       | Delivery and risk                                                                                                                                                     | Decision                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Separately installed Video2X executable                      | Ships Nexus-owned types and process isolation while the user supplies the AGPL executable and models; adds no Nexus binary distribution or runtime egress             | **Selected for v2.3.0**                                                                         |
| Bundle Video2X                                               | Lowest setup friction, but would distribute an AGPL application plus mixed component and FFmpeg build terms; publisher digests are absent from current release assets | Rejected until a documented distribution review approves an exact artifact and packaging method |
| Build a permissively licensed native Real-ESRGAN/RIFE subset | Could produce a cleaner long-term internal backend, but adds native build, model-distribution, platform, Vulkan, quality, and maintenance scope                       | Future candidate after Phase 5 evidence justifies the work                                      |

Evidence that could change the decision includes a written distribution review for an exact binary and FFmpeg build, reproducible publisher attestations, a complete source-offer and notices plan where required, platform packaging tests, or a proven permissive internal backend with equivalent quality and lifecycle behavior.

## Pinned upstream compatibility

The adapter targets the latest stable upstream release observed on 2026-08-28:

```text
compatibilityId: video2x-cli-6.4.0
upstreamTag: 6.4.0
upstreamCommit: a96bda9b4d79616cc6b71b94e6945146b5b4d509
acceptedVersionOutput: /^Video2X version 6\.4\.0\r?\n?$/
binaryProvenance: user-supplied-unverified
```

Primary sources:

- Stable release: https://github.com/k4yt3x/video2x/releases/tag/6.4.0
- Tagged argument parser: https://github.com/k4yt3x/video2x/blob/6.4.0/tools/video2x/src/argparse.cpp
- License: https://github.com/k4yt3x/video2x/blob/6.4.0/LICENSE
- Component notices: https://github.com/k4yt3x/video2x/blob/6.4.0/NOTICE
- Native platform documentation: https://github.com/k4yt3x/video2x/blob/6.4.0/README.md

The comparison's previously reviewed `7db9c18` revision is unreleased `master` evidence and is not the compatibility target. A future upstream release requires a new compatibility identifier, grammar fixture, and adapter test update; semver range acceptance is not allowed.

## Supported delivery envelope

| Host                                          | v2.3.0 classification         | Evidence boundary                                                                                               |
| --------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Windows x64 with AVX2 and a usable Vulkan GPU | Candidate                     | Upstream publishes a native CLI archive; Nexus packaged-field evidence is still required                        |
| Linux x64 with AVX2 and a usable Vulkan GPU   | Candidate/internal-compatible | Upstream publishes an x86_64 AppImage; Nexus does not currently ship a Linux desktop package                    |
| macOS                                         | Unsupported                   | Upstream container instructions do not establish a native desktop adapter; native support remains open upstream |
| Any ARM64 host                                | Unsupported                   | The pinned upstream native release contract is x64                                                              |
| CPU-only or non-AVX2 host                     | Unsupported                   | Prebuilt release requirements are not met                                                                       |
| Host without a usable Vulkan GPU              | Unsupported                   | Device preflight cannot establish an executable enhancement path                                                |

No platform is promoted to supported until Phase 5 records the required local and packaged evidence. User-facing copy must use the classification returned by the capability probe and must not infer support from OS name alone.

## Configuration and capability probe

The executable is resolved only from an absolute explicit path, in this order:

1. `NEXUS_VIDEO2X_PATH`, for process-scoped operator override.
2. Typed setting `video.video2xPath`.

The adapter does not search `PATH` and does not download a binary. Conflicting configured values are resolved by the documented precedence, and diagnostics identify the winning source without printing a sensitive full path.

The capability probe must:

1. Reject unsupported OS/architecture combinations before process launch.
2. Canonicalize the configured path, require a regular executable file, and record its SHA-256 as `user-supplied-unverified`; the hash is provenance, not an upstream attestation.
3. Run `['--version']` with shell disabled and a short timeout; require the exact pinned output.
4. Run `['--help']`; require grammar tokens `--list-devices`, `--device`, `--scaling-factor`, `--frame-rate-mul`, `--realesrgan-model`, and `--rife-model`.
5. Check AVX2 independently. On Windows 10 2004 or later, the argv-safe process host calls `IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE)` and treats zero, including an unsupported HAL, as unavailable. On Linux, parse the processor flags from `/proc/cpuinfo`; unreadable or missing evidence fails closed. Never infer AVX2 from x64 or a CPU model string.
6. Run `['--list-devices']` with shell disabled and a bounded timeout; require exit 0 and parse the tagged numeric ID plus `Type:` lines. Select the lowest-ID `Discrete GPU`, otherwise the lowest-ID `Integrated GPU`. Reject `CPU`, `Virtual GPU`, `Unknown`, malformed, and empty device results rather than inferring usability from a name.
7. Report processor/model readiness separately from executable and GPU readiness because device enumeration does not load model files. A preset may remain `unverified` after a successful base probe and becomes `available` only after that exact model mapping completes a staged run. A model-load failure marks only that preset `unavailable` when the failure can be classified; otherwise it remains a typed process failure.

Capability status is one of `ready`, `unavailable`, or `unsupported`. Its typed reason is one of `missing_configuration`, `invalid_path`, `unsupported_platform`, `unsupported_architecture`, `process_host_unavailable`, `cpu_probe_failed`, `missing_avx2`, `incompatible_version`, `incompatible_grammar`, `probe_timeout`, `probe_failed`, `no_vulkan_device`, `model_unavailable`, or `internal_error`. The result includes the compatibility ID, redacted configuration source, executable hash when obtained, device summaries without sensitive paths, and per-preset availability.

## Honest preset contract

Video2X 6.4.0 accepts one processor per invocation. Its RIFE interface accepts an integer frame-rate multiplier, not an arbitrary target FPS. Its Real-ESRGAN model assets do not support every parser-accepted scale. Nexus therefore exposes only mappings proven by the tagged grammar and model set:

| Preset ID              | Stage mapping                                                | Initial state                              |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `animation-upscale-2x` | `-p realesrgan -s 2 --realesrgan-model realesr-animevideov3` | Candidate pending Phase 5 quality evidence |
| `animation-upscale-4x` | `-p realesrgan -s 4 --realesrgan-model realesr-animevideov3` | Candidate pending Phase 5 quality evidence |
| `general-upscale-4x`   | `-p realesrgan -s 4 --realesrgan-model realesrgan-plus`      | Candidate pending Phase 5 quality evidence |
| `smooth-2x`            | `-p rife -m 2 --rife-model rife-v4.6`                        | Candidate pending Phase 5 quality evidence |

Combined mode composes one eligible upscale preset followed by `smooth-2x` in separate job-owned stages. The first stage writes an intermediate MP4, and the second stage alone writes the final staging file. Cancellation or failure removes or quarantines both exact job-owned paths.

Nexus v2.3.0 does not expose arbitrary 48/60 FPS, 1080p/4K, custom shader, URL input, codec, encoder-option, processor, model-path, or free-form backend-flag fields. A target FPS may be displayed only when the source rational FPS multiplied by two produces that exact target. Automatic content routing is not an upstream guarantee and remains disabled until benchmark evidence justifies a deterministic Nexus policy.

## Backend-neutral service types

The load-bearing core contract uses these semantic shapes. Exact TypeScript syntax may use readonly fields and discriminated unions, but field meaning and closed vocabularies must remain stable.

### `VideoEnhancementRequest`

- `requestId`: immutable UUID.
- `parentJobId`: completed source-generation job ID.
- `source`: absolute canonical local MP4 path, SHA-256, byte size, duration, dimensions, and rational FPS observed before enqueue.
- `mode`: `upscale`, `interpolate`, or `upscale_interpolate`.
- `upscalePreset`: one of the three pinned upscale IDs when the mode includes upscale; absent otherwise.
- `interpolationPreset`: `smooth-2x` when the mode includes interpolation; absent otherwise.
- `requestedAt`: ISO-8601 UTC timestamp.
- `timeoutMs`: bounded positive integer; default 21,600,000 ms (6 hours), minimum 60,000 ms, maximum 86,400,000 ms (24 hours).

Callers do not provide output paths, backend flags, processor names, or model paths. The runtime derives those from the immutable request and unique child-job ID under a Nexus-owned job root.

Validation rejects a non-UUID request ID, an empty or overlong opaque parent job ID, a non-absolute/non-MP4 source path, a malformed 64-character lowercase SHA-256, non-positive media facts, an incompatible mode/preset combination, unknown fields, and out-of-range timeouts. Existing generation and queue IDs such as `video-N` remain valid; migrating persisted IDs is outside this feature. Validation failure occurs before queue insertion and returns `invalid_request` without retry.

### `VideoEnhancementCapability`

- Overall status and typed reason from the capability contract above.
- Backend descriptor: `video2x`, compatibility ID, version `6.4.0`, executable SHA-256, and provenance status `user-supplied-unverified`.
- Native platform, architecture, AVX2 result, and Vulkan device summaries.
- Per-preset state: `available`, `unavailable`, or `unverified`, plus a reason.
- Probe timestamp and bounded diagnostic text.

### `VideoEnhancementProgress`

- Request and child-job IDs.
- Stage: `preflight`, `upscale`, `interpolate`, `validate`, `provenance`, or `publish`.
- One-based stage index and total stage count.
- Processed and total frames when finite and non-negative.
- Percent from 0 through 100 only when total frames are known.
- Processing FPS, elapsed milliseconds, and remaining milliseconds when finite and non-negative.
- Human-safe message with ANSI sequences and canonical paths removed.

Video2X emits carriage-return-delimited ANSI stdout. The adapter must split on both carriage return and newline, strip ANSI, retain output on valid UTF-8 codepoint boundaries within the byte cap, and treat malformed, non-finite, or regressing telemetry as indeterminate progress rather than a job failure. Progress and successful-result elapsed claims may not exceed the request timeout.

### Cancellation

The service accepts an `AbortSignal` for each invocation. Cancellation is authoritative in Nexus even if the child later exits 0:

1. Set adapter-local cancelled state before signaling the child.
2. Send `q` on stdin only as a best-effort grace hint.
3. After a bounded grace period, terminate the isolated process group or Windows job object; force-kill after a second bound.
4. Return `cancelled` regardless of child exit code.
5. Never validate, promote, index, or expose an output after Nexus cancellation.
6. Delete or quarantine only the exact job-owned staging and intermediate paths. If process-tree termination cannot be proven, return the authoritative terminal failure with `terminationConfirmed: false`, retain the exact root in quarantine, and never validate, delete, or expose its contents from the finishing invocation.

### Result and error contract

Phase 2 backend success returns `ok: true`, outcome `staged`, request ID, parent and child job IDs, immutable source identity, exact job-owned staged path, backend data, the actual execution platform and selected device, normalized per-stage processor/model/scalar argument fields, semantic stage parameters, timings bounded by the request timeout, warnings, and observed progress facts. Processor, model, device, and normalized arguments come from the same adapter execution that produced the staged file; Phase 3 must not reconstruct them from a preset or run a second capability probe. It is not a public completed generation and is not downloadable. Phase 3 alone may transform a staged result into outcome `completed` after ffprobe validation, source rehash, provenance embedding, atomic promotion, durable indexing, and session linkage all succeed.

Failure returns `ok: false` and one typed code:

- `invalid_request`
- `backend_unavailable`
- `unsupported_platform`
- `incompatible_backend`
- `model_unavailable`
- `source_changed`
- `source_invalid`
- `output_conflict`
- `process_timeout`
- `process_failed`
- `cancelled`
- `output_invalid`
- `provenance_failed`
- `publish_failed`
- `internal_error`

Errors contain a safe user message, retryability, stage, and bounded redacted diagnostics. They never include raw environment values, full canonical paths, retained media bytes, or arbitrary child output. A nonzero child exit is `process_failed` unless Nexus already requested cancellation. Exit code 0 is never sufficient proof of success.

`VideoEnhancementBackend` exposes `probe(signal?)` and `run(request, context)`. `VideoEnhancementService` validates unknown input before calling the backend, performs no implicit retry, preserves request identity across cancellation, and maps unexpected failures to `internal_error`. The pure core service stops at the staged result; Phase 3 owns publication orchestration.

## Subprocess boundary

Every probe and enhancement process must use a direct executable plus an argument array with `shell: false`. The adapter must also:

- Use `windowsHide: true` where applicable.
- Start enhancement in a fresh, empty, job-owned working directory rather than the repository or source directory. Video2X searches relative `models/` before installation locations, so this prevents hostile `cwd/models` shadowing.
- Scrub inherited loader, managed-runtime injection, and Vulkan override variables, including `APPDIR`, `GLIBC_TUNABLES`, every `LD_*`, `DYLD_*`, `VK_*`, `COR_*`, `CORECLR_*`, `COMPlus_*`, and `DOTNET_*` name, unless a future explicit compatibility contract allows one.
- Pass canonical source, staging, and intermediate paths only as discrete arguments.
- Refuse a destination that already exists, aliases the source, resolves outside the exact job root, or is reachable through a symlink escape.
- Isolate the process tree so cancellation affects only that job.
- Bound stdout/stderr retention and redact source, output, job-root, home, and workspace paths before diagnostics leave the adapter.
- Make no network request and invoke no package manager or installer.

### Windows argv-safe process host

Windows uses a dedicated sidecar helper boundary rather than the existing terminal sandbox, which wraps `cmd.exe /c` and is incompatible with this contract. The helper must:

1. Receive the canonical executable, string-array argv, working directory, scrubbed environment, and timeout through an exclusive job-owned structured manifest. It must reject unknown fields and delete the manifest after loading.
2. Be launched by Node through an absolute PowerShell executable with `-NoProfile`, `-NonInteractive`, and one fixed encoded helper program under `shell: false`; no generated script, media path, backend flag, or request environment value may enter a PowerShell or `cmd.exe` command string.
3. Call `CreateProcessW` with the exact canonical executable in `lpApplicationName`, a writable command-line buffer produced by tested Microsoft C-runtime argv quoting, and `CREATE_SUSPENDED`.
4. Use `STARTUPINFOEX` plus `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` so only stdin, stdout, and stderr are inherited.
5. Create a job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assign the suspended process, and resume it only after successful assignment.
6. Hold the job handle for the full invocation. Killing the helper closes the handle and terminates Video2X descendants; no `taskkill`, PID-tree walk, or child cooperation is the safety boundary.
7. Expose an AVX2 probe mode that calls `IsProcessorFeaturePresent(40)` and returns a closed structured result.
8. Authenticate the manifest and fixed C# source paths and SHA-256 values through a minimal loader environment containing only required Windows roots, a PATH pinned to those roots (never the process PATH), PATHEXT, temporary-directory values, and those four Nexus controls. Compile the authenticated C# source in memory; never load a mutable generated assembly.
9. Refuse capability with `process_host_unavailable` if PowerShell, helper compilation/loading, handle-list setup, job assignment, or AVX2 probing cannot be proven. There is no unconfined Windows fallback.

The manifest and fixed helper source live in an exclusive Nexus control directory, are authenticated against out-of-band hashes before use, and are removed only after canonical directory-identity validation. The fixed encoded PowerShell program and in-memory compiled type leave no mutable script or assembly to replace. Phase 2 tests must cover Windows quoting for spaces, quotes, backslashes, ampersands, pipes, percent signs, carets, and Unicode paths; Phase 5 must execute a real packaged Windows cancellation and descendant-kill probe before promotion from candidate support.

Microsoft API contracts:

- `IsProcessorFeaturePresent` and `PF_AVX2_INSTRUCTIONS_AVAILABLE`: https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-isprocessorfeaturepresent
- `CreateProcessW` process and command-line contract: https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
- `AssignProcessToJobObject`: https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject

On Linux, Node launches the canonical executable directly with `shell: false` in a new process group. Cancellation signals the negative process-group ID after setting Nexus cancellation state, escalates after bounded grace periods, and never falls back to a shell command. If the process group remains observable or its disappearance cannot be proven, the host returns `terminationConfirmed: false`, starts only bounded best-effort background reaping, and leaves the exact job root quarantined.

The tagged grammar is:

```text
video2x -i INPUT -o OUTPUT -p PROCESSOR [options]
```

The adapter must use `--list-devices`, not stale prose aliases such as `--list-gpus`; `--device`, not `--gpu`; and the singular `--extra-encoder-option` only internally if a later compatibility contract explicitly permits it. v2.3.0 exposes none of those advanced fields to users.

## Output validation and atomic publication

Video2X opens or truncates its destination early and may leave partial output after failure or cancellation. Every invocation therefore writes to a unique `*.partial.mp4` under the job root. The runtime uses this sequence:

1. Canonicalize and ffprobe the completed source; calculate its SHA-256 immediately before work.
2. Create a new child job and exclusive job root whose leaf is the first 32 lowercase hexadecimal characters of the SHA-256 digest of the persisted child-job ID, without placing the raw ID in the path; reject collisions rather than reuse or delete a pre-existing directory. This exact derivation lets restart recovery address only that child's root without a broad directory scan.
3. Run each process stage into a new non-existing partial or intermediate file.
4. On ordinary exit 0, ffprobe the last staged output and verify a video stream, positive size and duration, expected dimensions, expected rational frame rate, and duration within the larger of one source frame or 250 ms of the source. After validation, calculate `preProvenanceContainerSha256` over those exact staged bytes.
5. Verify the original source still has the same canonical identity, size, and SHA-256.
6. Embed the complete Nexus enhancement provenance, including `preProvenanceContainerSha256` and a stable `provenanceRecordId`, into a job-owned staged copy. Metadata failure is fatal, not a swallowed warning. Embedded metadata must not contain a placeholder or claim for the hash of its own final container bytes.
7. Re-run ffprobe, calculate `publishedContainerSha256` over the exact post-embedding staged bytes, and verify the source hash again. Store this final hash only in the durable index.
8. Atomically rename on the same filesystem to a unique final output path that does not exist.
9. Commit queue, generation-index, source-link, and session-reference records before exposing a download or completion event.

For `smooth-2x`, the expected rational output FPS is exactly twice the source FPS. For scale presets, dimensions are exactly source dimensions multiplied by two or four. Combined mode must satisfy both. Frame counts may differ only where the container lacks a reliable count; that case records `not_observed` and does not silently substitute a pass. Audio/subtitle preservation is recorded but is not used as a success claim unless probed.

If validation, provenance, or indexing fails, the runtime returns a typed failure and quarantines or removes only the exact job-owned files. It never deletes or rewrites the source. A promoted but unindexed file remains quarantined and is not presented as completed.

## Provenance contract

The enhanced MP4 metadata and durable generation index must record the fields below, except that `publishedContainerSha256` is durable-index-only because embedding a container's own final hash would be self-referential:

- Schema version and Nexus release.
- Parent generation job ID, enhancement request ID, and child job ID.
- Source canonical identity, SHA-256, byte size, duration, dimensions, and rational FPS.
- Output `preProvenanceContainerSha256`, byte size, duration, dimensions, and rational FPS in both records; stable `provenanceRecordId` in both records; and final `publishedContainerSha256` only in the durable index.
- Backend name, compatibility ID, version, executable SHA-256, and `user-supplied-unverified` status.
- Actual execution platform and selected Vulkan device summary, captured by the adapter invocation that produced the staged file.
- Ordered stages with processor, model, scale or frame multiplier, bounded scalar normalized argument fields, start/end timestamps, duration, child exit code, and outcome.
- Selected preset IDs and whether routing was explicit or derived.
- Vulkan device summary without sensitive paths.
- Validation results and any `not_observed` fields.
- Final outcome: `completed`, `cancelled`, `failed`, or `interrupted`.

Provenance stores normalized semantic parameters, not a shell command string. Absolute source/output paths remain in the local durable index where needed but are redacted from user-visible diagnostics.

## Restart and concurrency semantics

Enhancement jobs do not blindly resume a native process after application restart. A persisted `running` enhancement becomes `interrupted`; its exact process-owned root is recovered from the persisted child ID through the same deterministic hashed-root function, and its partials are quarantined or removed by exact path without scanning or deleting sibling job roots. The user may request a new child job with a new identity. Completed source and enhanced outputs remain immutable. Two concurrent requests for the same source use distinct child IDs, job roots, intermediate files, final names, cancellation signals, and provenance records.

The queue must retain the scheduler `JobHandle` so cancellation reaches the running `AbortSignal`; changing only the SQLite state is insufficient. `parentId` must be accepted at enqueue time and exposed through sidecar and desktop job DTOs.

## FFmpeg prerequisite

The existing installer provisioner does not by itself prove runtime wiring. Current runtime discovery relies on `NEXUS_FFMPEG_PATH`, `NEXUS_FFPROBE_PATH`, or `PATH`, while the provisioned executable path is not durably connected to that lookup. Phase 3 must close or explicitly gate this dependency before claiming packaged enhancement support. Enhancement capability is unavailable when a compatible ffprobe path cannot be proven.

## Tasks unblocked

- T005 implements the backend-neutral request, capability, progress, result, validation, and backend interface.
- T006 implements exact 6.4.0 probing, deterministic discrete/integrated Vulkan selection, staged-output execution, safe argument mapping, Linux process-group isolation, the argv-safe Windows process host, AVX2 detection, cancellation, and redaction.
- T007 proves preset mapping, path containment, hostile arguments and working directories, timeout, cancellation despite child exit 0, and concurrent isolation.
- T008 adds durable parent-child queue identity, retained scheduler cancellation, and interruption recovery.
- T009 adds immutable-source validation, enhancement provenance, atomic publication, and index linkage.
- T010 proves partial-file, combined-stage, restart, ffprobe, metadata, and atomic-publication behavior.
- T011 through T013 expose only capability-backed presets and honest synthesized-detail copy.
- T014 through T016 measure quality/resource/platform behavior and keep unsupported packaging claims disabled.

No implementation-blocking backend, version, grammar, preset, license-boundary, platform, cancellation, or publication question remains for Phase 2.
