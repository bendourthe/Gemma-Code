# Local Media Runtime

The desktop sidecar exposes one vendor-neutral readiness and repair API from `desktop/sidecar/src/diffusion/runtimeFactory.ts`. Image and video runtimes consume that API rather than deriving readiness independently from GPU telemetry or model presence.

Image generation validates model manifests, Python ABI, torch/CUDA readiness, and output decoding before success. Video generation also validates decoder/encoder availability and finalized container metadata. A generation failure remains retryable through the bounded Repair action and preserves the actual failure code.

Packaged qualification is stronger than internal tests: the exact installed sidecar must produce a PNG with non-zero pixels and a video with valid codec, duration, frames, and dimensions.
