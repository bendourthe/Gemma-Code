# Session History - v1.16.0 Phase 3: Local Document-OCR Capability

**Date**: 2026-08-13
**Version**: v1.16.0
**Plan**: [../../plans/v1.16.0-adoption-local-serving-and-ocr.md](../../plans/v1.16.0-adoption-local-serving-and-ocr.md)
**Phase**: 3 of 6 - Local Document-OCR Capability (adoption item A5)
**Outcome**: Complete, at the largest of the three scopes offered. All quality gates passed without bypass.

## Goal

Give Nexus a document-OCR / PDF-parsing capability: an OCR model in the catalog, a Python sidecar runtime that runs it, and a "parse document -> text/markdown" action, wired the same way SANA / Whisper / Kokoro are.

## Pre-flight

`is_final_phase` = **false** (Phase 6 terminal). Model routing: plan recommends the strong-reasoning tier at high effort, which matches the session. Prerequisite (v1.15 Phase 4 registry) satisfied.

Four findings from the codebase review shaped the whole phase:

1. **This is only the second Python runtime ever.** `runtimes/diffusion/` is the sole template.
2. **`tests/python/` had no CI job at all** - its ~135 diffusion tests had never run in CI.
3. **The in-app install path cannot install any HF model.** `Downloader.ts` fails closed on a digest mismatch and every HF entry carries an all-zero placeholder `sha256`.
4. **No `revision` field existed.** HF URLs hardcoded `resolve/main/`, but the plan explicitly requires pinning a commit for supply-chain safety.

## Decisions taken at the start

Three questions were put up front; all were answered at the largest scope:

1. **Which OCR model** -> **ship both**, not the CUDA-only one with a deferred fallback.
2. **Which UI surface** -> **add attachments to the Local Chatbot** and expose parse as a chat action (the plan's first choice, and the largest option, since the chat module had zero attachment plumbing).
3. **How much scope** -> **core + CI + full installer integration.**

Facts were verified against primary sources before writing the catalog, not assumed: the Unlimited-OCR model card (MIT, 3B, `trust_remote_code`, CUDA 12.9 / NVIDIA only, `infer`/`infer_multi`, 32K max_length), the RapidOCR and pypdfium2 licenses, and both repos' current commit shas via the HF API.

## The portability decision (3.1 asked for it on the record)

| | RapidOCR PP-OCRv4 | Unlimited-OCR 3B |
|---|---|---|
| License | Apache-2.0 | MIT |
| Size / VRAM | ~20 MB, `requiredVramGB: 0` | 6.7 GB, `requiredVramGB: 12` |
| Hosts | Windows, macOS (Intel + Apple Silicon), Linux - CPU | NVIDIA CUDA only |
| Approach | detect-then-recognize | vision-language, layout-aware markdown |
| `trust_remote_code` | no | **yes** (hence the mandatory pin) |

**Surya 2** was evaluated - 650M, genuinely cross-platform via llama.cpp, strong benchmarks - and **rejected on licensing**: GPL-3.0 copyleft against Apache-2.0 + MIT for the pair shipped. Shipping both means OS parity is met *in-cycle* rather than deferred, matching the `faster-whisper` precedent already in the catalog. Neither model is in `recommended.json`, so neither is ever auto-installed.

## Supply chain: enforced, not advisory

Unlimited-OCR executes repo-supplied Python, so three controls were built and are all enforced by tests:

1. **`source.revision`** pins a 40-hex commit sha. `validateSpec` (TS) and `load_weights_manifest` (Python) BOTH refuse a `trustRemoteCode` entry without one, and both **reject a branch or tag name** - mutable refs are the exact hole pinning closes.
2. **Preflight probes the pinned commit**, so a reachability check cannot pass against `main` while the pinned commit is gated.
3. **`local_files_only=True` inside the sandboxed Python child.** Repo code never runs in the Node sidecar or the renderer.

## Sub-tasks implemented

### 3.1 Catalog + types

`ModelType` and `ModelTask` gained `document`; `ModelSpecSource` gained `revision`; `ModelSpec` gained `trustRemoteCode` and `ocrEngine`. Threaded through `ModelStorage`'s manifest union, `NexusModelRegistry`'s type->runtime map, the sidecar wire schema, `modelsTypes.ts`, and the Models-page filter row.

### 3.2 `runtimes/ocr/`

`main.py` / `registry.py` / `version.py` mirror the diffusion runtime's JSON-RPC dispatcher. `documents.py` decodes base64 (accepting a `data:` prefix) and rasterizes PDFs through **pypdfium2** - chosen because it bundles PDFium in the wheel (no Poppler, no per-platform system dep) and is Apache-2.0/BSD rather than copyleft. Bounded deliberately: a 200-page cap, a 64 MB byte cap, and a 72-400 DPI clamp, because the input is untrusted. `engines/` holds the shared contract, a dependency-free stub, and the two real backends. `parse.py` owns the job envelope and emits **per-page progress notifications** - the repo's first real producer of them.

### 3.3 Sidecar + chat

`ocr/runtimeClient.ts`, `parseManager.ts`, and `runtimeFactory.ts` follow the **models-install** accept/drain/cancel shape, not the diffusion fire-and-return shape, because a long parse must never block the IPC channel; a finished job is forgotten on its terminal drain so parsed text does not linger. `MediaComposer` became accept-aware (it hard-filtered `image/` before, silently dropping PDFs regardless of `accept`) and renders a labelled chip for a non-image attachment instead of a broken `<img>`. `ChatPage` gained attachments, the parse action, and an install-gated empty state that deep-links to Settings > Models.

### 3.4 Tests, CI, installer

61 Python tests, 17 installer revision-pinning tests, 4 new TypeScript suites. **`tests/python/` gained its first CI job ever**, covering both runtimes on a bare runner with no GPU, no weights, and no torch - which keeps the "unavailable on this host" path continuously tested. Installer: the Document tab was added (without it `load_catalog_models` silently drops any entry whose tab resolves to None) and the portable wheels declared in the venv provisioner.

## Troubleshooting

**An ordering bug in the availability messages**, caught by the tests. `unlimited_ocr_availability` checked for `transformers` before checking the hardware, so on a Mac it reported "transformers is not installed" - sending the user to install a package that would still leave the model unusable. Reordered so an unfixable hardware fact outranks a fixable dependency one, with torch as the deliberate exception (without it we cannot probe the hardware at all). A test now pins that precedence directly.

**Two catalog rules the suite taught us.** `multimodal: true` was rejected on the OCR VLM - correctly, because `multimodal` means *the chat prompt-assembly may attach images to this model*, not "this model can read images". A `type: "document"` model never goes through the LLM path, so it stays false; the field's doc comment now records the distinction. Second, a description must name its `origin` verbatim; both entries were reworded.

**Existing ChatPage tests broke** when `ChatInput` was swapped for `MediaComposer`. They assert behaviour that still works through a different element, so they were retargeted at the new test ids - not weakened. `sharedChat.test.tsx` still tests `ChatInput` directly, since that component remains in use elsewhere.

**A `_comment_multimodal` key was briefly added to catalog.json and removed** - it would have been the only one in the file, i.e. a convention invented for one entry. The rationale went into the `ModelSpec` field's doc comment instead.

## Quality gates (Phase 7 GO/NO-GO)

| Gate | Threshold | Result |
|------|-----------|--------|
| Test failures | 0 | **0** - root 429/4754, desktop 93/808, Python runtimes 196, installer suite clean apart from 2 pre-existing `zstandard` failures (missing LOCAL dep; verified pre-existing by stashing) |
| Coverage | >= 80% lines | **88.45% lines / 84.18% branches / 91.47% functions** |
| Lint errors | 0 | **0** - eslint root + desktop (`--max-warnings=0`) |
| Build | succeeds | **Yes** - `tsc -b`, desktop `tsc --noEmit`, `build:sidecar` |

Also clean: `check:tampering` (0 findings), `deps:check` (0 errors), `check:docs-layout`, `security:check`.

**Verdict: GO.** No gate bypassed.

## Files

**New**: `runtimes/ocr/` (`__init__`, `version`, `device`, `documents`, `registry`, `parse`, `main`, `requirements.txt`, `engines/{__init__,base,rapidocr_engine,unlimited_ocr_engine}`); `desktop/sidecar/src/ocr/{runtimeClient,parseManager,runtimeFactory}.ts`; `desktop/src/modules/chat/documentClient.ts`; `tests/python/ocr/{test_documents,test_parse,test_main}.py`; `desktop/tests/{ocr-parseManager,ocr-handlers}.test.ts`; `desktop/tests/{MediaComposer.accept,ChatPage.document}.test.tsx`; `scripts/installer/tests/test_hf_revision_pinning.py`; this file.

**Modified**: `core/registry/{catalog.ts,catalog.json,ModelStorage.ts,NexusModelRegistry.ts}`; `desktop/sidecar/src/{protocol,handlers}.ts`; `desktop/src/App.tsx`; `desktop/src/modules/chat/ChatPage.tsx`; `desktop/src/shared/chat/MediaComposer.tsx`; `desktop/src/pages/settings/{modelsTypes.ts,ModelsSettings.tsx}`; `desktop/tests/{ChatPage,ChatPage.preview,sidecar-handlers}.test.ts(x)`; `scripts/installer/src/nexus_installer/engine/{hf_weights_puller,model_preflight,diffusion_venv_provisioner}.py`; `scripts/installer/src/nexus_installer/pages/typed_catalog.py`; `scripts/installer/tests/test_typed_catalog.py`; `.github/workflows/ci.yml`; `docs/DEVLOG.md`; `docs/v1/v1.16/known-gaps.md`.

Unrelated benchmark-fixture timing noise regenerated by the test runs was reverted, not committed.

## Known gaps

6 new deferrals in [../../known-gaps.md](../../known-gaps.md): LSO.P3.A (in-app HF install blocked by placeholder digests - inherited, repo-wide), LSO.P3.B (wheel payload staging does not exist since the v1.9.0 slim-installer switch), LSO.P3.C (neither engine run against real weights - weights stay out of CI by design), LSO.P3.D (cancel does not interrupt an in-flight page inside Python), LSO.P3.E (the Models page has no VRAM gating at all - pre-existing, surfaced here), LSO.P3.F (`ChildProcessOcrRuntime` spawn path untested).

## Next steps

Phase 4 - Document-Parse Agent Tool + Memory Ingestion (A6). It wraps this phase's OCR path as a governed `parse_document` agent tool behind `pathGuard`, routes parsed text through the inbound content classifier (the same gate `fetch_page` uses), and adds opt-in memory ingestion with redaction. The trust boundary is the point: this phase already established that parsed text is untrusted and is deliberately not auto-sent to a model, which is the invariant Phase 4 must carry into agent context and memory.
